import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../tests/mcp-roles/db";
import { asUser } from "../../tests/mcp-roles/fake-supabase";
import {
  AP_REPORT_CURRENCIES,
  buildVersionedApReport,
  attachVersionedAp,
  apMoney,
} from "./accounting-ap-versioned";
import { accountingCsv, buildAccountingReport } from "./accounting-report";
import { sources } from "../../tests/fixtures/accounting-evidence";
const directory = process.env.ATHENA_AP_CONTRACT_DIR;
const suite = directory ? describe : describe.skip;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(940),
  outsider = id(941),
  company = id(942),
  job = id(943);
let db: PGlite;
const read = async (user = owner) =>
  asUser(
    db,
    { sub: user, email: "synthetic@example.test", role: "authenticated" },
    async (tx) =>
      (await tx.query("SELECT public.mcp_cost_reconciliation_snapshot($1) AS data", [job])).rows[0]
        .data,
  );
async function seed(
  record: number,
  currency: string | null,
  effective: string | null,
  amount = 3000,
  code = "03-100",
  v = 1,
) {
  const key = id(record);
  if (v === 1)
    await db.query(
      "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
      [key, company, job, owner],
    );
  const facts = {
    kind: "supplier_bill",
    description: "Synthetic producer cost",
    counterparty_name: "Synthetic supplier",
    incurred_on: "2026-10-01",
    ...(currency ? { currency_code: currency } : {}),
    amount_cents: amount,
    original: "missing",
    allocations: [{ job_id: job, cost_code: code, amount_cents: amount }],
  };
  await db.query(
    "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,$2,$3::jsonb,$4)",
    [key, v, JSON.stringify(facts), owner],
  );
  await db.query("INSERT INTO mcp_cost_approvals(record_id,version,approved_by) VALUES($1,$2,$3)", [
    key,
    v,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_cost_posting_events(record_id,version,posted_by,accounting_effective_on) VALUES($1,$2,$3,$4)",
    [key, v, owner, effective],
  );
  return key;
}
suite("exact pinned AP producer to reporting consumer", () => {
  beforeAll(async () => {
    db = await makeDb();
    await db.exec(
      "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
    );
    for (const f of [
      "20261021190000_athena_team_invites.sql",
      "20261022120000_athena_account_team_privacy_terms.sql",
    ])
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    for (const [file, hash] of [
      ["submissions.sql", "ba37b300a41e8e4f44e0a16c672faa1875389bb6cd4d91659ca9c43070f876ea"],
      ["snapshot.sql", "a25517349efbc2f301341af41e54adcc4ee71fd7df061a20e6c1e9b50dc76f33"],
    ]) {
      const sql = readFileSync(join(directory!, file), "utf8");
      expect(createHash("sha256").update(sql).digest("hex")).toBe(hash);
      await db.exec(sql);
    }
    for (const u of [owner, outsider]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.test')", [u]);
      await db.query("INSERT INTO test_active_members VALUES($1)", [u]);
    }
    await db.query(
      "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic reporting',$2)",
      [company, owner],
    );
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Synthetic owner')",
      [company, owner],
    );
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,'SYN-PRODUCER','Synthetic')",
      [job, company, owner],
    );
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  it("matches every pinned producer currency and rejects unsupported exponents", async () => {
    const functionBody = (
      await db.query<{ prosrc: string }>(
        "SELECT prosrc FROM pg_proc WHERE proname='mcp_cost_currency_supported'",
      )
    ).rows[0].prosrc;
    const pinnedCodes = [...functionBody.matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]);
    expect([...AP_REPORT_CURRENCIES].sort()).toEqual(pinnedCodes.sort());
    for (const code of AP_REPORT_CURRENCIES)
      expect(
        (
          await db.query<{ ok: boolean }>("SELECT public.mcp_cost_currency_supported($1) AS ok", [
            code,
          ])
        ).rows[0].ok,
      ).toBe(true);
    expect(
      (await db.query<{ ok: boolean }>("SELECT public.mcp_cost_currency_supported('JPY') AS ok"))
        .rows[0].ok,
    ).toBe(false);
  });
  it("reports reviewed USD actual postings and budget comparison using explicit effective dates", async () => {
    await seed(950, "USD", "2026-10-02");
    const raw = await read();
    const ap = buildVersionedApReport(raw, job, "2026-10-28", null, company)!;
    expect(ap.groups).toMatchObject([
      { currency: "USD", postedCents: "3000", selectedPeriodCents: "3000", unpaidCents: null },
    ]);
    const s = sources();
    s.jobId = job;
    s.companyId = company;
    s.billing.invoices.forEach((i) => (i.job_id = job));
    s.billing.receipts.forEach((i) => (i.job_id = job));
    s.billing.allocations.forEach((i) => (i.job_id = job));
    s.budgets.forEach((i) => (i.job_id = job));
    s.orders = { available: false, reason: "No synthetic PO" };
    s.costs = { available: false, reason: "AP separate" };
    const report = attachVersionedAp(buildAccountingReport(s, { asOf: "2026-10-28" }), ap);
    expect(report.metrics.find((m) => m.key === "actual_costs")?.cents).toBe(3000);
    expect(report.costCodes[0].remainingCents).toBe(7000);
    expect(accountingCsv(report)).toContain("ap_posted_cost");
  });
  it("separates mixed currencies and preserves missing legacy dates/currency", async () => {
    await seed(951, "EUR", "2026-10-03", 4000);
    await seed(952, null, null, 5000, "legacy");
    const ap = buildVersionedApReport(await read(), job, "2026-10-28", null, company)!;
    expect(ap.groups.find((g) => g.currency === "USD")?.postedCents).toBe("3000");
    expect(ap.groups.find((g) => g.currency === "EUR")?.postedCents).toBe("4000");
    expect(ap.groups.find((g) => g.currency === null)?.postedCents).toBeNull();
    expect(ap.hasUnknown).toBe(true);
    expect(apMoney("9000000000000000", "EUR")).toBe("EUR 90,000,000,000,000.00");
  });
  it("replaces a corrected posted version, honors historical cutoff and never inherits settlement currency", async () => {
    const key = await seed(953, "USD", "2026-10-04", 6000, "corrected");
    await db.query(
      "INSERT INTO mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,1000,'2026-10-05','synthetic-paid',$3)",
      [id(954), key, owner],
    );
    await seed(953, "EUR", "2026-10-20", 7000, "corrected", 2);
    const raw = await read();
    const current = buildVersionedApReport(raw, job, "2026-10-28", null, company)!;
    expect(current.rows.find((r) => r.recordId === key)).toMatchObject({
      version: 2,
      currency: "EUR",
      amountCents: "7000",
    });
    expect(current.rows.find((r) => r.recordId === key)?.source).toContain(
      "prior settlement is not carried",
    );
    expect(current.groups.every((g) => g.unpaidCents === null)).toBe(true);
    const past = buildVersionedApReport(raw, job, "2026-10-10", null, company)!;
    expect(past.rows.find((r) => r.recordId === key)).toMatchObject({
      version: 1,
      currency: "USD",
      amountCents: "6000",
    });
  });
  it("preserves source role denial without a partial fallback", async () => {
    expect(
      buildVersionedApReport(await read(outsider), job, "2026-10-28", null, company),
    ).toBeNull();
  });
});
