import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser, fakeClient } from "../../../tests/mcp-roles/fake-supabase";
const state = vi.hoisted(() => ({ sb: null as unknown, calls: [] as string[] }));
vi.mock("./guard", () => ({
  run: async (_name: unknown, _ctx: unknown, _options: unknown, fn: (sb: unknown) => unknown) =>
    fn(state.sb),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", async (original) => ({
  ...(await original<typeof import("./jobs")>()),
  resolveJob: async (_sb: unknown, number: string) => {
    if (number !== "2701") throw new Error("Fictional job not selected");
    return {
      job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      job_number: "2701",
      name: "Fictional closure verification",
      scope: "full",
    };
  },
}));
import { resolveItem } from "./tools/workflow-tools";

const owner = "00000000-0000-4000-8000-000000000010",
  outsider = "00000000-0000-4000-8000-000000000020";
const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const claims = { sub: owner, email: "pm@example.com", role: "authenticated" as const };
const evidence = "Fictional supplier email dated 2026-10-23, delivery confirmation QA-1.";
let db: PGlite;
const query = async (sql: string, params: unknown[] = []) =>
  asUser(db, claims, async (tx) => (await tx.query(sql, params)).rows);
const call = (args: Record<string, unknown>, user = owner) =>
  (
    resolveItem.handler as unknown as (
      a: unknown,
      c: unknown,
    ) => Promise<{
      content: { text: string }[];
      structuredContent: {
        closed: boolean;
        confirmation_required?: boolean;
        confirmation_key?: string | null;
        selected_items?: { item_id: string; item_ref: string; owner: string; due: string }[];
      };
    }>
  )({ job_number: "2701", ...args }, { getUserId: () => user });
async function create(fields: Record<string, unknown> = {}) {
  const result = await query("SELECT mcp_open_item_create($1,$2::jsonb) data", [
    job,
    JSON.stringify({
      action: `Fictional supplier delivery ${crypto.randomUUID()}`,
      kind: "general",
      accountable: "Fictional PM",
      needed_by: "2026-10-23",
      ...fields,
    }),
  ]);
  return result[0].data.item_id as string;
}
async function item(id: string) {
  return (
    await query("SELECT status, resolution, updated_at FROM mcp_open_items WHERE id=$1", [id])
  )[0];
}
function useUser(user = owner) {
  const sb = fakeClient(db, {
    ...claims,
    sub: user,
    email: user === owner ? "pm@example.com" : "outsider@example.com",
  });
  state.sb = {
    ...sb,
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push(name);
      return sb.rpc(name, args);
    },
  };
}
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    readFileSync("supabase/migrations/20261025120000_athena_reopen_open_item.sql", "utf8"),
  );
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES ($1,'pm@example.com'),($2,'outsider@example.com')",
    [owner, outsider],
  );
  await db.query("INSERT INTO test_active_members VALUES ($1),($2)", [owner, outsider]);
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Example Construction',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id,time_zone) VALUES ($1,$2,'Fictional closure verification','2701',$3,'America/Manaus')",
    [job, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','Fictional PM')",
    [company, owner],
  );
});
beforeEach(() => {
  state.calls = [];
  useUser();
});
afterAll(async () => {
  await db?.close();
});

describe("item closure against actual database functions and RLS", () => {
  it("lists the exact selected item and leaves it open until confirmation", async () => {
    const id = await create();
    const preview = await call({ item_id: id, kind: "verified", evidence });
    expect(preview.structuredContent).toMatchObject({
      closed: false,
      confirmation_required: true,
      selected_items: [{ item_id: id, owner: "Fictional PM", due: "2026-10-23" }],
    });
    expect(preview.structuredContent.confirmation_key).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.content[0].text).toContain("still open");
    expect((await item(id)).status).toBe("open");
    expect(state.calls).not.toContain("mcp_resolve_item");
  });
  it.each([
    { confirmed: false },
    { confirmed: true },
    { confirmed: true, confirmation_key: "0".repeat(64) },
  ])("does not close without the exact preview confirmation: %j", async (confirmation) => {
    const id = await create();
    const result = await call({ item_id: id, kind: "verified", evidence, ...confirmation });
    expect(result.structuredContent.closed).toBe(false);
    expect((await item(id)).status).toBe("open");
    expect(state.calls).not.toContain("mcp_resolve_item");
  });
  it("executes the existing close only after a matching second call, preserving evidence and history", async () => {
    const id = await create(),
      proposal = { item_id: id, kind: "verified", evidence };
    const preview = await call(proposal);
    const saved = await call({
      ...proposal,
      confirmed: true,
      confirmation_key: preview.structuredContent.confirmation_key,
    });
    expect(saved.structuredContent.closed).toBe(true);
    expect(await item(id)).toMatchObject({ status: "resolved", resolution: "verified" });
    expect(state.calls.filter((name) => name === "mcp_resolve_item")).toHaveLength(1);
    expect(
      (await query("SELECT evidence FROM mcp_item_evidence WHERE item_id=$1", [id]))[0].evidence,
    ).toBe(evidence);
    expect(
      (
        await query(
          "SELECT count(*)::int n FROM mcp_item_events WHERE item_id=$1 AND event='resolved'",
          [id],
        )
      )[0].n,
    ).toBe(1);
    await expect(
      call({
        ...proposal,
        confirmed: true,
        confirmation_key: preview.structuredContent.confirmation_key,
      }),
    ).rejects.toThrow(/No open item/);
  });
  it("invalidates review when evidence or the saved item changes", async () => {
    const id = await create(),
      proposal = { item_id: id, kind: "verified", evidence };
    const preview = await call(proposal);
    const changedEvidence = await call({
      ...proposal,
      evidence: "Different fictional evidence dated 2026-10-23.",
      confirmed: true,
      confirmation_key: preview.structuredContent.confirmation_key,
    });
    expect(changedEvidence.structuredContent.closed).toBe(false);
    await query(
      "UPDATE mcp_open_items SET action=action||' amended',updated_at=updated_at+interval '1 second' WHERE id=$1",
      [id],
    );
    const changedItem = await call({
      ...proposal,
      confirmed: true,
      confirmation_key: preview.structuredContent.confirmation_key,
    });
    expect(changedItem.structuredContent.closed).toBe(false);
    expect((await item(id)).status).toBe("open");
    expect(state.calls).not.toContain("mcp_resolve_item");
  });
  it("keeps updates open, rejects missing evidence and keeps N/A as a refusal", async () => {
    const id = await create();
    const missing = await call({ item_id: id, kind: "verified" });
    expect(missing.structuredContent.confirmation_key).toBeNull();
    expect((await item(id)).status).toBe("open");
    const updated = await call({
      item_id: id,
      kind: "update",
      evidence: "Fictional PM is waiting for supplier confirmation.",
    });
    expect(updated.structuredContent.closed).toBe(false);
    expect(updated.content[0].text).toContain("Item updated — still open");
    expect(updated.content[0].text).not.toContain("Item closed");
    expect((await item(id)).status).toBe("open");
    await expect(call({ item_id: id, kind: "na" })).rejects.toThrow(/N\/A is not a resolution/);
    expect((await item(id)).status).toBe("open");
  });
  it("does not expose or close another member's item despite a copied confirmation", async () => {
    const id = await create(),
      proposal = { item_id: id, kind: "verified", evidence };
    const preview = await call(proposal);
    useUser(outsider);
    await expect(
      call(
        {
          ...proposal,
          confirmed: true,
          confirmation_key: preview.structuredContent.confirmation_key,
        },
        outsider,
      ),
    ).rejects.toThrow(/No open item|not selected|permission/i);
    expect((await item(id)).status).toBe("open");
    expect(state.calls).not.toContain("mcp_resolve_item");
  });
  it.each([
    { kind: "member_statement", evidence },
    { kind: "waive", reason: " " },
    { kind: "commercial_close", approval: "Fictional approval", billing: "Fictional invoice" },
  ])("asks for missing closure records without a key or write: %j", async (proposal) => {
    const id = await create();
    const result = await call({ item_id: id, ...proposal, confirmed: true });
    expect(result.structuredContent).toMatchObject({ closed: false, confirmation_key: null });
    expect((await item(id)).status).toBe("open");
    expect(state.calls).not.toContain("mcp_resolve_item");
  });
  it.each([
    {
      kind: "member_statement",
      fields: { kind: "confirm_unknown" },
      details: { evidence, stated_on: "2026-10-23" },
      resolution: "member_statement",
    },
    {
      kind: "waive",
      fields: {},
      details: { reason: "Fictional owner waiver for QA only." },
      resolution: "waived",
    },
    {
      kind: "commercial_close",
      fields: { kind: "commercial", commercial_type: "co" },
      details: {
        approval: "Fictional signed CO",
        billing: "Fictional invoice",
        collection: "Fictional payment receipt",
      },
      resolution: "collected",
    },
  ])(
    "retains the existing rules for confirmed $kind",
    async ({ kind, fields, details, resolution }) => {
      const id = await create(fields);
      const proposal = { item_id: id, kind, ...details };
      const preview = await call(proposal);
      expect((await item(id)).status).toBe("open");
      expect(preview.content[0].text).toContain("Yes or no?");
      if (kind === "member_statement") expect(preview.content[0].text).toContain("Fictional PM");
      const result = await call({
        ...proposal,
        confirmed: true,
        confirmation_key: preview.structuredContent.confirmation_key,
      });
      expect(result.structuredContent.closed).toBe(true);
      expect(await item(id)).toMatchObject({ status: "resolved", resolution });
      expect(result.content[0].text).toContain("Item closed");
    },
  );
});
