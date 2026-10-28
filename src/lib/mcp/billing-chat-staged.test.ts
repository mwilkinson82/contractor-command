import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  sb: null as unknown,
  lost: false,
  job: {
    job_id: "00000000-0000-4000-8000-000000000115",
    company_id: "00000000-0000-4000-8000-000000000114",
    job_number: "SYN-A",
    name: "Synthetic A",
    scope: "full",
  },
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, f: (sb: unknown) => unknown) => f(state.sb),
  text: (s: string) => ({ content: [{ type: "text", text: s }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({ resolveJob: async () => state.job }));
import { billingEvidenceRead, billingEvidenceRecord } from "./tools/billing-evidence-tools";
import { jobLinksMissingToken } from "./board-url";
const owner = "00000000-0000-4000-8000-000000000111";
let db: PGlite;
const query = (sql: string, args: unknown[] = []) =>
  asUser(
    db,
    { sub: owner, email: "synthetic@example.test", role: "authenticated" },
    async (tx) => (await tx.query(sql, args)).rows as Record<string, unknown>[],
  );
type Reply = { content: Array<{ text: string }>; structuredContent: Record<string, unknown> };
const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(
    args,
    {},
  );
const context = { job_number: "SYN-A" };
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261020213000_athena_living_reports.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"),
  );
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.test')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic',$2)", [
    state.job.company_id,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Synthetic')",
    [state.job.company_id, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,'SYN-A','Synthetic')",
    [state.job.job_id, owner, state.job.company_id],
  );
  await db.query(
    "INSERT INTO mcp_living_reports(job_id,report_type,version,data,change_what,updated_by) VALUES($1,'billing_forecast',1,$2::jsonb,'Synthetic',$3)",
    [state.job.job_id, JSON.stringify({ billing: { earned_from_dailies: 12345 } }), owner],
  );
  state.sb = {
    rpc: async (name: string, values: Record<string, unknown>) => {
      const args = Object.values(values).map((v) =>
        v && typeof v === "object" ? JSON.stringify(v) : v,
      );
      try {
        const result = (
          await query(
            `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
            args,
          )
        )[0].value;
        if (name === "mcp_billing_evidence_record" && state.lost) {
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
afterAll(async () => {
  await db.close();
});

describe("staged chat billing on the live ledger contract", () => {
  it("asks missing facts, confirms, reconciles a lost response, and keeps billing separate", async () => {
    const missing = await call(billingEvidenceRecord, {
      ...context,
      step: "review",
      action: "invoice",
      facts: { kind: "invoice" },
    });
    expect(missing.structuredContent.saved).toBe(false);
    expect(missing.structuredContent.missing).toContain("net due");
    const invoice = {
      kind: "invoice",
      document_number: "SYN-1",
      status: "submitted",
      invoice_date: "2026-10-01",
      effective_date: "2026-10-01",
      source: "synthetic invoice",
      gross_cents: 100000,
      withheld_cents: 10000,
      released_cents: 0,
      net_due_cents: 90000,
    };
    async function review(action: string, facts: Record<string, unknown>) {
      const r = await call(billingEvidenceRecord, { ...context, step: "review", action, facts });
      expect(r.structuredContent.saved).toBe(false);
      expect(r.content[0].text).toContain("attachments are not available");
      return {
        p: r.structuredContent.facts as Record<string, unknown>,
        key: r.structuredContent.review_key,
      };
    }
    async function save(action: string, p: Record<string, unknown>, key: unknown) {
      return call(billingEvidenceRecord, {
        ...context,
        step: "save",
        action,
        facts: p,
        review_key: key,
        confirmed: true,
      });
    }
    const inv = await review("invoice", invoice);
    await expect(
      call(billingEvidenceRecord, {
        ...context,
        step: "save",
        action: "invoice",
        facts: inv.p,
        review_key: inv.key,
      }),
    ).rejects.toThrow(/confirm/i);
    await expect(save("invoice", { ...inv.p, net_due_cents: 1 }, inv.key)).rejects.toThrow(
      /review/i,
    );
    state.lost = true;
    const lost = await save("invoice", inv.p, inv.key);
    expect(lost.structuredContent).toMatchObject({ saved: null, outcome: "unknown" });
    const readAfterLost = await call(billingEvidenceRead, context);
    expect(readAfterLost.structuredContent.invoices).toHaveLength(1);
    const retry = await save("invoice", inv.p, inv.key);
    expect(retry.structuredContent.result).toMatchObject({ already_applied: true });
    await expect(review("invoice", invoice)).rejects.toThrow(/already exists/i);
    const receipt = await review("receipt", {
      receipt_date: "2026-10-02",
      source: "synthetic receipt",
      amount_cents: 40000,
    });
    await save("receipt", receipt.p, receipt.key);
    await expect(
      review("receipt", {
        receipt_date: "2026-10-02",
        source: "synthetic receipt",
        amount_cents: 40000,
      }),
    ).rejects.toThrow(/already exists/i);
    const alloc = await review("allocation", {
      receipt_id: receipt.p.id,
      invoice_id: inv.p.id,
      amount_cents: 40000,
      effective_date: "2026-10-02",
      source: "synthetic allocation",
    });
    await save("allocation", alloc.p, alloc.key);
    const credit = await review("invoice", {
      kind: "credit",
      document_number: "SYN-C1",
      status: "posted",
      invoice_date: "2026-10-03",
      effective_date: "2026-10-03",
      source: "synthetic credit",
      net_due_cents: 10000,
      credit_for: inv.p.id,
    });
    await save("invoice", credit.p, credit.key);
    const read = await call(billingEvidenceRead, context);
    expect(read.structuredContent.balances).toMatchObject([
      {
        document_number: "SYN-1",
        cash_cents: 40000,
        credits_cents: 10000,
        remaining_cents: 40000,
        remaining_display: "$400.00",
      },
    ]);
    await db.query(
      "UPDATE mcp_living_reports SET data=jsonb_set(data,'{billing,earned_from_dailies}','98765'::jsonb) WHERE job_id=$1",
      [state.job.job_id],
    );
    expect((await call(billingEvidenceRead, context)).structuredContent.balances).toEqual(
      read.structuredContent.balances,
    );
  });
  it("allows only the authenticated billing records link without a board token", () => {
    const job = state.job.job_id;
    expect(jobLinksMissingToken(`https://app.meetathena.io/r/job/${job}/billing-records`)).toEqual(
      [],
    );
    expect(jobLinksMissingToken(`https://app.meetathena.io/r/job/${job}/items`)).toHaveLength(1);
  });
});
