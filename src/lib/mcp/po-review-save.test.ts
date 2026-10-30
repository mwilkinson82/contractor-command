import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  sb: null as unknown,
  job: {
    job_id: "00000000-0000-4000-8000-000000000203",
    company_id: "00000000-0000-4000-8000-000000000202",
    job_number: "2810",
    name: "Willow Creek",
    scope: "full",
  },
}));
// No network: real SQL functions and review hashes run in an ephemeral database.
// Existing guard tests cover the transport gate; SQL membership/scope checks remain active.
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) => fn(state.sb),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => state.job,
  memberCompanies: async () => [{ id: state.job.company_id, name: "ALP Construction" }],
}));
import { purchaseOrdersRecord } from "./tools/purchase-order-tools";

type Reply = {
  structuredContent: {
    facts: Record<string, unknown>;
    review_key: string;
    saved: boolean;
    missing?: string[];
  };
};
const call = (args: Record<string, unknown>) =>
  (
    purchaseOrdersRecord as unknown as {
      handler: (args: Record<string, unknown>, ctx: unknown) => Promise<Reply>;
    }
  ).handler({ job_number: state.job.job_number, ...args }, {});
const owner = "00000000-0000-4000-8000-000000000201";
let db: PGlite;
let rpc: ReturnType<typeof vi.fn>;
let party: string;
let terms: string;
const lines = [
  { description: "Conduit materials", quantity: 4000, unit: "LF", unit_price_cents: 200 },
  { description: "Distribution materials", quantity: 200, unit: "EA", unit_price_cents: 2200 },
];
const order = () => ({
  party_id: party,
  number: "WC-2810-PO01",
  terms_id: terms,
  lines,
  order_date: "2026-10-30",
  needed_by: "2026-11-02",
});
async function reviewedSave(action: string, facts: Record<string, unknown>) {
  const review = await call({ action, step: "review", facts });
  expect(review.structuredContent.saved).toBe(false);
  await call({
    action,
    step: "save",
    facts: review.structuredContent.facts,
    review_key: review.structuredContent.review_key,
    confirmed: true,
  });
  return review;
}
beforeAll(async () => {
  db = await makeDb();
  for (const path of ["0035_accounting_purchase_orders.sql", "0041_po_company_approval.sql"])
    await db.exec(readFileSync(`drizzle/migrations/${path}`, "utf8"));
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'owner@example.test')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'ALP Construction',$2)", [
    state.job.company_id,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Owner')",
    [state.job.company_id, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,'2810','Willow Creek')",
    [state.job.job_id, owner, state.job.company_id],
  );
  const client = fakeClient(db, { sub: owner, email: "owner@example.test", role: "authenticated" });
  rpc = vi.fn(client.rpc.bind(client));
  state.sb = { ...client, rpc };
  party = String(
    (await reviewedSave("party", { name: "Summit Electrical Supply", kind: "supplier" }))
      .structuredContent.facts.id,
  );
  terms = String(
    (
      await reviewedSave("approve_company_terms", {
        scope: "company",
        title: "Net 30",
        body: "Payment due 30 days after invoice.",
        source: "Owner's approved base",
      })
    ).structuredContent.facts.id,
  );
});
afterAll(async () => {
  await db?.close();
});

describe("PO review and confirmed save share the order-field contract", () => {
  it.each(["source", "body", "scope", "expected_default_version"])(
    "rejects unsupported order %s before creating a review",
    async (field) => {
      const before = (await db.query("SELECT count(*)::int AS n FROM mcp_po_reviews")).rows;
      rpc.mockClear();
      await expect(
        call({
          action: "order",
          step: "review",
          facts: {
            ...order(),
            [field]:
              field === "expected_default_version"
                ? 0
                : field === "scope"
                  ? "company"
                  : "Reference",
          },
        }),
      ).rejects.toThrow(`do not apply to a purchase order: ${field}`);
      expect(rpc).not.toHaveBeenCalled();
      expect((await db.query("SELECT count(*)::int AS n FROM mcp_po_reviews")).rows).toEqual(
        before,
      );
      expect((await db.query("SELECT count(*)::int AS n FROM mcp_purchase_orders")).rows).toEqual([
        { n: 0 },
      ]);
    },
  );
  it("also rejects source on save before touching the write RPC", async () => {
    rpc.mockClear();
    await expect(
      call({
        action: "order",
        step: "save",
        facts: { ...order(), source: "Supplier quote" },
        confirmed: true,
      }),
    ).rejects.toThrow(/source.*Nothing was saved/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reviews and saves the unchanged allowed facts, resolves supplier hints, and retains draft versions", async () => {
    const review = await reviewedSave("order", {
      ...order(),
      party_id: undefined,
      supplier_name: "Summit Electrical Supply",
    });
    expect(review.structuredContent.facts).toMatchObject({
      party_id: party,
      lines,
      status: "draft",
      expected_version: 0,
    });
    expect(review.structuredContent.facts).not.toHaveProperty("supplier_name");
    const id = review.structuredContent.facts.id;
    const retry = await call({
      action: "order",
      step: "save",
      facts: review.structuredContent.facts,
      review_key: review.structuredContent.review_key,
      confirmed: true,
    });
    expect(retry.structuredContent).toMatchObject({
      saved: true,
      result: { already_applied: true },
    });
    await reviewedSave("order", {
      ...order(),
      id,
      expected_version: 1,
      reason: "Clarify description",
      lines: [{ ...lines[0], description: "Conduit for raceway rough-in" }, lines[1]],
    });
    const rows = (
      await db.query<{ version: number; status: string; lines: typeof lines }>(
        "SELECT version,status,lines FROM mcp_purchase_order_versions ORDER BY version",
      )
    ).rows;
    expect(rows.map((x) => [x.version, x.status])).toEqual([
      [1, "draft"],
      [2, "draft"],
    ]);
    expect(rows[0].lines).toEqual(lines);
    expect(rows[1].lines.map((x) => [x.quantity, x.unit_price_cents])).toEqual([
      [4000, 200],
      [200, 2200],
    ]);
  });
  it("keeps terms provenance required and persists it on proposals", async () => {
    const proposal = {
      scope: "supplier",
      title: "Supplier Net 30",
      body: "Payment due 30 days after invoice receipt.",
      parent_id: terms,
      party_id: party,
      change_note: "Clarify receipt date",
    };
    const missing = await call({ action: "terms", step: "review", facts: proposal });
    expect(missing.structuredContent.missing).toContain("terms source");
    await reviewedSave("terms", { ...proposal, source: "Supplier's proposed wording" });
    const row = (
      await db.query(
        "SELECT source,state,approved_by FROM mcp_po_terms_versions WHERE scope='supplier'",
      )
    ).rows;
    expect(row).toEqual([
      { source: "Supplier's proposed wording", state: "proposed", approved_by: null },
    ]);
  });
  it("continues to refuse generic company terms save without separate approval", async () => {
    rpc.mockClear();
    const result = await call({
      action: "terms",
      step: "review",
      facts: {
        scope: "company",
        title: "Unapproved draft",
        body: "Draft text",
        source: "Owner draft",
      },
    });
    expect(result.structuredContent).toMatchObject({ saved: false, approval_required: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});
