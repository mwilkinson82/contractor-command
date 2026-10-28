import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const state = vi.hoisted(() => ({
  sb: null as unknown,
  lost: false,
  job: {
    job_id: "00000000-0000-4000-8000-000000000201",
    company_id: "00000000-0000-4000-8000-000000000202",
    job_number: "SYN-A",
    name: "Synthetic",
  },
}));
vi.mock("./guard", () => ({
  run: async (_n: unknown, _c: unknown, _o: unknown, f: (sb: unknown) => unknown) => f(state.sb),
  text: (s: string) => ({ content: [{ type: "text", text: s }] }),
  dbError: (e: { message: string }) => {
    if (e.message.startsWith("MCP_BAD:")) throw new (requireToolError())(e.message.slice(8));
    throw new Error(e.message);
  },
}));
// The actual dbError turns business rejections into ToolError; use a static import in the mock.
import { ToolError } from "@lovable.dev/mcp-js";
function requireToolError() {
  return ToolError;
}
vi.mock("./jobs", () => ({
  resolveJob: async (_sb: unknown, job: string) => {
    if (job !== "SYN-A") throw new Error("Job unavailable");
    return state.job;
  },
}));
import {
  jobCostSubmissionRead,
  jobCostSubmissionRecord,
  jobCostAccountingRecord,
} from "./tools/job-cost-submission-tools";
const owner = "00000000-0000-4000-8000-000000000203";
let db: PGlite;
type Reply = { content: Array<{ text: string }>; structuredContent: Record<string, unknown> };
const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(
    args,
    {},
  );
beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("docs/athena/job-cost-submission.schema-draft.sql", "utf8"));
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
    "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,'SYN-A','Synthetic')",
    [state.job.job_id, state.job.company_id, owner],
  );
  state.sb = {
    rpc: async (name: string, values: Record<string, unknown>) => {
      try {
        const args = Object.values(values).map((v) =>
          v && typeof v === "object" ? JSON.stringify(v) : v,
        );
        const result = await asUser(
          db,
          { sub: owner, email: "synthetic@example.test", role: "authenticated" },
          (tx) =>
            tx.query(
              `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
              args,
            ) as Promise<{ rows: Array<{ value: unknown }> }>,
        );
        if (name === "mcp_cost_submission_save" && state.lost) {
          state.lost = false;
          throw new Error("response lost");
        }
        return { data: result.rows[0].value, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
}, 30000);
afterAll(async () => db.close());
describe("staged conversational submission", () => {
  it("asks sparse questions, reviews facts, requires confirmation, reconciles retry and reads saved metadata", async () => {
    expect(
      (await call(jobCostSubmissionRecord, { step: "review", facts: { description: "Fuel" } }))
        .structuredContent.missing,
    ).toEqual(["job"]);
    const sparse = await call(jobCostSubmissionRecord, {
      step: "review",
      job_number: "SYN-A",
      facts: { description: "Fuel" },
    });
    expect(sparse.structuredContent.missing).toContain("amount");
    expect(sparse.structuredContent.missing).not.toContain("purchase order");
    const review = await call(jobCostSubmissionRecord, {
      step: "review",
      job_number: "SYN-A",
      facts: {
        kind: "company_paid_expense",
        description: "Fuel",
        counterparty_name: "Gas station",
        incurred_on: "2026-10-28",
        amount_cents: 4000,
        allocations: [{ cost_code: "FUEL", amount_cents: 4000 }],
      },
    });
    expect(review.content[0].text).toContain("Original attachment: missing");
    expect(review.content[0].text).toContain("not posted or paid");
    const payload = review.structuredContent.payload as Record<string, unknown>,
      review_key = review.structuredContent.review_key;
    await expect(
      call(jobCostSubmissionRecord, { step: "save", job_number: "SYN-A", payload, review_key }),
    ).rejects.toThrow(/confirm/);
    await expect(
      call(jobCostSubmissionRecord, {
        step: "save",
        job_number: "SYN-A",
        payload: { ...payload, expected_version: 1 },
        review_key,
        confirmed: true,
      }),
    ).rejects.toThrow(/confirm/);
    state.lost = true;
    const lost = await call(jobCostSubmissionRecord, {
      step: "save",
      job_number: "SYN-A",
      payload,
      review_key,
      confirmed: true,
    });
    expect(lost.structuredContent).toMatchObject({ saved: null, outcome: "unknown" });
    expect(
      (await call(jobCostSubmissionRead, { job_number: "SYN-A" })).structuredContent
        .records as unknown[],
    ).toHaveLength(1);
    const retry = await call(jobCostSubmissionRecord, {
      step: "save",
      job_number: "SYN-A",
      payload,
      review_key,
      confirmed: true,
    });
    expect(retry.structuredContent.result).toMatchObject({
      already_applied: true,
      status: "submitted",
    });
  });
  it("stages accounting review only under a synthetic authority and does not move funds", async () => {
    const entry = await call(jobCostSubmissionRecord, {
      step: "review",
      job_number: "SYN-A",
      facts: {
        kind: "reimbursable_expense",
        description: "Receipt",
        counterparty_name: "Synthetic employee",
        incurred_on: "2026-10-28",
        amount_cents: 2000,
        allocations: [{ cost_code: "FUEL", amount_cents: 2000 }],
      },
    });
    const payload = entry.structuredContent.payload as { id: string };
    await call(jobCostSubmissionRecord, {
      step: "save",
      job_number: "SYN-A",
      payload,
      review_key: entry.structuredContent.review_key,
      confirmed: true,
    });
    await expect(
      call(jobCostAccountingRecord, {
        step: "review",
        job_number: "SYN-A",
        action: "approve",
        id: payload.id,
        expected_version: 1,
      }),
    ).rejects.toThrow(/not available/);
    await db.exec(
      "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;",
    );
    try {
      async function reviewAction(action: string, extra: Record<string, unknown> = {}) {
        return call(jobCostAccountingRecord, {
          step: "review",
          job_number: "SYN-A",
          action,
          id: payload.id,
          expected_version: 1,
          ...extra,
        });
      }
      async function saveAction(review: Reply) {
        return call(jobCostAccountingRecord, {
          step: "save",
          job_number: "SYN-A",
          payload: review.structuredContent.payload,
          review_key: review.structuredContent.review_key,
          confirmed: true,
        });
      }
      await expect(reviewAction("post")).rejects.toThrow(/Approval/);
      const approval = await reviewAction("approve");
      expect(approval.content[0].text).toContain("SYN-A / FUEL: $20.00");
      expect(approval.content[0].text).toContain("Original attachment: missing");
      await expect(
        call(jobCostAccountingRecord, {
          step: "save",
          job_number: "SYN-A",
          payload: approval.structuredContent.payload,
          review_key: approval.structuredContent.review_key,
        }),
      ).rejects.toThrow(/confirm/);
      expect((await saveAction(approval)).structuredContent.result).toMatchObject({
        status: "approved",
      });
      expect((await saveAction(await reviewAction("post"))).structuredContent.result).toMatchObject(
        { status: "posted" },
      );
      const payment = await reviewAction("payment", {
        amount_cents: 1000,
        paid_on: "2026-10-29",
        reference: "check",
      });
      expect(payment.content[0].text).toContain("No funds will be transferred");
      expect((await saveAction(payment)).structuredContent.result).toMatchObject({
        status: "payment_recorded",
      });
    } finally {
      await db.exec(
        "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT false $$;",
      );
    }
  });
});
