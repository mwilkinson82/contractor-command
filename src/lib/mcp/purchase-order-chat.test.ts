import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { ToolError } from "@lovable.dev/mcp-js";
const state = vi.hoisted(() => ({
  sb: null as unknown,
  lost: false,
  job: {
    job_id: "00000000-0000-4000-8000-000000000115",
    company_id: "00000000-0000-4000-8000-000000000114",
    job_number: "SYN-A",
    name: "Synthetic",
    scope: "full",
  },
}));
vi.mock("./guard", () => ({
  run: async (_n: unknown, _c: unknown, _o: unknown, f: (sb: unknown) => unknown) => f(state.sb),
  text: (s: string) => ({ content: [{ type: "text", text: s }] }),
  dbError: (e: { message: string }) => {
    if (e.message.includes("MCP_BAD:")) throw new ToolError(e.message);
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => state.job,
  memberCompanies: async () => [{ id: state.job.company_id, name: "Synthetic Company" }],
}));
import { purchaseOrdersRead, purchaseOrdersRecord } from "./tools/purchase-order-tools";
const owner = "00000000-0000-4000-8000-000000000111";
let db: PGlite;
const query = (sql: string, values: unknown[] = []) =>
  asUser(
    db,
    { sub: owner, email: "synthetic@example.test", role: "authenticated" },
    async (tx) => (await tx.query(sql, values)).rows as Record<string, unknown>[],
  );
type Reply = { content: Array<{ text: string }>; structuredContent: Record<string, unknown> };
const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(
    args,
    {},
  );
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    readFileSync("supabase/migrations/20261028143924_athena_project_purchase_orders.sql", "utf8"),
  );
  await db.query("insert into auth.users(id,email) values($1,'synthetic@example.test')", [owner]);
  await db.query("insert into test_active_members values($1)", [owner]);
  await db.query("insert into mcp_companies(id,name,created_by) values($1,'Synthetic',$2)", [
    state.job.company_id,
    owner,
  ]);
  await db.query(
    "insert into mcp_company_members(company_id,user_id,role,display_name) values($1,$2,'owner','Owner')",
    [state.job.company_id, owner],
  );
  await db.query(
    "insert into mcp_jobs(id,user_id,company_id,job_number,name) values($1,$2,$3,'SYN-A','Synthetic')",
    [state.job.job_id, owner, state.job.company_id],
  );
  state.sb = {
    rpc: async (name: string, values: Record<string, unknown>) => {
      try {
        const args = Object.values(values).map((v) =>
          v && typeof v === "object" ? JSON.stringify(v) : v,
        );
        const result = (
          await query(
            `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
            args,
          )
        )[0].value;
        if (name === "mcp_project_purchase_orders_record" && state.lost) {
          state.lost = false;
          throw new Error("simulated lost response");
        }
        return { data: result, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
}, 30000);
afterAll(async () => db.close());
describe("conversational draft workflow", () => {
  it("asks missing facts, confirms exact values and reconciles retries", async () => {
    const short = await call(purchaseOrdersRecord, { step: "review", action: "order", facts: {} });
    expect(short.structuredContent.missing).toContain("job");
    const review = async (action: string, facts: Record<string, unknown>) => {
      const r = await call(purchaseOrdersRecord, {
        job_number: "SYN-A",
        step: "review",
        action,
        facts,
      });
      return {
        reply: r,
        p: r.structuredContent.facts as Record<string, unknown>,
        key: r.structuredContent.review_key,
      };
    };
    const save = (action: string, p: Record<string, unknown>, key: unknown, confirmed = true) =>
      call(purchaseOrdersRecord, {
        job_number: "SYN-A",
        step: "save",
        action,
        facts: p,
        review_key: key,
        confirmed,
      });
    const party = await review("party", {
      name: "Synthetic Supply",
      kind: "supplier",
      trade: "Electrical",
    });
    await expect(save("party", party.p, party.key, false)).rejects.toThrow(/confirm/);
    await save("party", party.p, party.key);
    const terms = await review("terms", {
      scope: "company",
      title: "Standard",
      body: "Synthetic payment terms",
      source: "Approved synthetic policy",
    });
    await save("terms", terms.p, terms.key);
    const def = await review("default_terms", { id: terms.p.id });
    expect(def.reply.content[0].text).toContain("Synthetic payment terms");
    expect(def.reply.content[0].text).toContain("default");
    await save("default_terms", def.p, def.key);
    const variant = await review("terms", {
      scope: "supplier",
      party_id: party.p.id,
      parent_id: terms.p.id,
      title: "Negotiated",
      body: "Synthetic revised payment terms",
      source: "Synthetic redline",
      change_note: "Payment timing",
    });
    expect(variant.reply.structuredContent.comparison).toMatchObject({
      removed: "Synthetic payment terms",
      added: "Synthetic revised payment terms",
    });
    await save("terms", variant.p, variant.key);
    const mismatch = await review("order", {
      supplier_name: "Different Supplier",
      party_id: party.p.id,
    }).catch((e) => e);
    expect(mismatch).toBeInstanceOf(ToolError);
    const incomplete = await review("order", { supplier_name: "Synthetic Supply" });
    expect(incomplete.reply.structuredContent.missing).toContain(
      "item or scope, quantity, unit and price",
    );
    const draft = await review("order", {
      supplier_name: "Synthetic Supply",
      number: "PO-1",
      lines: [{ description: "Cable", quantity: 2, unit: "roll", unit_price_cents: 2500 }],
      order_date: "2026-11-01",
      needed_by: "2026-12-01",
    });
    expect(draft.reply.content[0].text).toContain("Synthetic payment terms");
    expect(draft.p.party_id).toBe(party.p.id);
    expect(draft.p.terms_id).toBe(terms.p.id);
    await expect(save("order", { ...draft.p, number: "PO-2" }, draft.key)).rejects.toThrow(
      /review/i,
    );
    state.lost = true;
    expect((await save("order", draft.p, draft.key)).structuredContent.saved).toBeNull();
    const existing = await call(purchaseOrdersRead, { job_number: "SYN-A" });
    expect(existing.structuredContent.orders as unknown[]).toHaveLength(1);
    const retry = await save("order", draft.p, draft.key);
    expect(retry.structuredContent.result).toMatchObject({ already_applied: true });
    expect(retry.content[0].text).toContain("previously recorded");
    const partyRevision = await review("party", {
      id: party.p.id,
      expected_version: 1,
      name: "Synthetic Supply Renamed",
      reason: "Correct the name",
    });
    expect(partyRevision.p.kind).toBe("supplier");
    expect(partyRevision.p.trade).toBe("Electrical");
    await save("party", partyRevision.p, partyRevision.key);
    const readAfter = await call(purchaseOrdersRead, { job_number: "SYN-A" });
    const parties = readAfter.structuredContent.parties as Array<{ name: string; trade: string }>;
    expect(parties[0]).toMatchObject({ name: "Synthetic Supply Renamed", trade: "Electrical" });
    const duplicate = await review("order", {
      supplier_name: "Synthetic Supply Renamed",
      number: "PO-1",
      lines: [{ description: "Cable", quantity: 2, unit: "roll", unit_price_cents: 2500 }],
      order_date: "2026-11-01",
      needed_by: "2026-12-01",
    }).catch((e) => e);
    expect(duplicate).toBeInstanceOf(ToolError);
  });
});

describe("MCP discovery and wire schema", () => {
  it("accepts an ordinary short request and complete draft facts through tools/call", async () => {
    const { defineMcp } = await import("@lovable.dev/mcp-js");
    const { createTanStackMcpHandler } = await import("@lovable.dev/mcp-js/stacks/tanstack");
    const app = defineMcp({
      name: "athena",
      title: "Athena",
      version: "test",
      instructions: "test",
      tools: [purchaseOrdersRead, purchaseOrdersRecord],
      metrics: false,
    } as never);
    const handler = createTanStackMcpHandler(app, { resourcePath: "/mcp" });
    const post = async (body: unknown) => {
      const response = await handler({
        request: new Request("https://test/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(body),
        }),
      });
      const text = await response.text();
      return JSON.parse(
        text.trimStart().startsWith("{")
          ? text
          : text
              .split("\n")
              .find((l) => l.startsWith("data:"))!
              .slice(5),
      );
    };
    await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "fixture", version: "1" },
      },
    });
    const short = await post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "purchase_orders_record",
        arguments: {
          job_number: "SYN-A",
          step: "review",
          action: "order",
          facts: { supplier_name: "Synthetic Supply Renamed" },
        },
      },
    });
    expect(JSON.stringify(short)).toContain("item or scope");
    const complete = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "purchase_orders_record",
        arguments: {
          job_number: "SYN-A",
          step: "review",
          action: "order",
          facts: {
            supplier_name: "Synthetic Supply Renamed",
            number: "PO-2",
            lines: [
              { description: "Conduit", quantity: 2, unit: "length", unit_price_cents: 1000 },
            ],
            order_date: "2026-11-01",
            needed_by: "2026-12-01",
          },
        },
      },
    });
    expect(JSON.stringify(complete)).toContain("review_key");
    expect(JSON.stringify(complete)).toContain("Synthetic payment terms");
  });
});
