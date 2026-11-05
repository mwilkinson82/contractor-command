// Job contracts on a local database: the real migration chain, then 20261105170000_athena_job_contracts.
// Members act through their own role; nothing writes the tables directly.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000e01";
const contracts = "00000000-0000-4000-8000-000000000e02";
const superUser = "00000000-0000-4000-8000-000000000e03";
const outsider = "00000000-0000-4000-8000-000000000e04";
const company = "00000000-0000-4000-8000-000000000e10";
const otherCompany = "00000000-0000-4000-8000-000000000e11";
const job = "00000000-0000-4000-8000-000000000e20";
const job2 = "00000000-0000-4000-8000-000000000e21";
const party = "00000000-0000-4000-8000-000000000e30";
const party2 = "00000000-0000-4000-8000-000000000e31";
const otherJobParty = "00000000-0000-4000-8000-000000000e32";
const po = "00000000-0000-4000-8000-000000000e40";
const doc = "00000000-0000-4000-8000-000000000e50";
let db: PGlite;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read field by field
type J = any;
const query = (user: string, sql: string, values: unknown[] = []) =>
  asUser(
    db,
    { sub: user, role: "authenticated", email: `${user.slice(-2)}@example.com` },
    (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const save = async (p: Record<string, unknown>, user = owner, onJob = job) =>
  (
    await query(user, "SELECT public.mcp_job_contract_save($1,$2) AS data", [
      onJob,
      JSON.stringify(p),
    ])
  ).rows[0].data as J;
const rows = async (user = owner, onJob = job) =>
  (await query(user, "SELECT public.mcp_job_contract_rows($1) AS data", [onJob])).rows[0].data as J;

beforeAll(async () => {
  db = await makeDb();
  const load = (f: string) => db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  await db.exec(
    "CREATE TABLE test_company_plans(company_id uuid PRIMARY KEY,plan text); CREATE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT plan FROM test_company_plans WHERE company_id=_company $$; CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
  );
  const pages = readFileSync("supabase/migrations/20261021120000_athena_report_pages.sql", "utf8");
  const leaderStart = pages.indexOf("CREATE OR REPLACE FUNCTION public.mcp_is_company_leader");
  await db.exec(
    pages.slice(
      leaderStart,
      pages.indexOf("TO authenticated;", leaderStart) + "TO authenticated;".length,
    ),
  );
  await load("20261021190000_athena_team_invites");
  await load("20261022120000_athena_account_team_privacy_terms");
  await load("20261023070000_athena_board_links");
  await load("20261023220000_athena_submittal_log");
  await load("20261024010000_athena_submittal_chase");
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated;",
  );
  await load("20261021000000_athena_file_shares");
  await load("20261028120000_athena_submittal_packages");
  await load("20261029120000_athena_submittal_record_page");
  await load("20261031120000_athena_file_upload");
  await db.exec(readFileSync("drizzle/migrations/0035_accounting_purchase_orders.sql", "utf8"));
  await load("20261105170000_athena_job_contracts");

  for (const user of [owner, contracts, superUser, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Fictional Electric',$2),($3,'Other Builder',$4)",
    [company, owner, otherCompany, outsider],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','QA Owner'),($1,$3,'contracts','QA Contracts'),($1,$4,'super','QA Super'),($5,$6,'owner','Other Owner')",
    [company, owner, contracts, superUser, otherCompany, outsider],
  );
  await db.query("INSERT INTO test_company_plans VALUES($1,'circle'),($2,'circle')", [
    company,
    otherCompany,
  ]);
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,'2810','Willow Creek'),($4,$2,$3,'2811','Pine Hall')",
    [job, owner, company, job2],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    superUser,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_project_parties(id,job_id,company_id,name,kind,created_by) VALUES($1,$4,$5,'Bright Wire Co','subcontractor',$6),($2,$4,$5,'Volt Supply','supplier',$6),($3,$7,$5,'Elsewhere Electric','subcontractor',$6)",
    [party, party2, otherJobParty, job, company, owner, job2],
  );
  await db.query(
    "INSERT INTO mcp_purchase_orders(id,job_id,company_id,party_id,number,created_by) VALUES($1,$2,$3,$4,'PO-101',$5)",
    [po, job, company, party2, owner],
  );
  await db.query(
    "INSERT INTO mcp_contract_documents(id,job_id,company_id,name,body,body_sha256) VALUES($1,$2,$3,'Prime agreement.pdf','Agreement text',$4)",
    [doc, job, company, "a".repeat(64)],
  );
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("job contracts", () => {
  let primeId = "";
  let subId = "";

  it("creates the prime contract and keeps version 1", async () => {
    const saved = await save({
      kind: "prime",
      counterparty: "  Willow Creek HOA  ",
      title: "Owner agreement",
      value_cents: 125_000_000,
      status: "draft",
      source: "upload",
      document_id: doc,
    });
    expect(saved).toMatchObject({
      kind: "prime",
      counterparty: "Willow Creek HOA",
      value_cents: 125_000_000,
      status: "draft",
      version: 1,
      changed: true,
      previous_status: null,
      status_changed: true,
    });
    expect(saved.company_id).toBeUndefined();
    primeId = saved.id;
    const v = await query(
      owner,
      "SELECT version, reason, snapshot->>'counterparty' AS who FROM mcp_job_contract_versions WHERE contract_id=$1",
      [primeId],
    );
    expect(v.rows).toEqual([{ version: 1, reason: null, who: "Willow Creek HOA" }]);
  });

  it("allows one live prime per job", async () => {
    await expect(save({ kind: "prime", counterparty: "Someone else" })).rejects.toThrow(
      /already has a prime contract with Willow Creek HOA/,
    );
  });

  it("updates against the loaded version, with a reason, and refuses a stale one", async () => {
    await expect(
      save({ contract_id: primeId, expected_version: 1, value_cents: 1 }),
    ).rejects.toThrow(/Say why the contract is changing/);
    await expect(save({ contract_id: primeId, value_cents: 1, reason: "x" })).rejects.toThrow(
      /needs the version you loaded \(now v1\)/,
    );
    const saved = await save({
      contract_id: primeId,
      expected_version: 1,
      value_cents: 126_000_000,
      reason: "Value corrected to the executed agreement",
    });
    expect(saved).toMatchObject({ version: 2, value_cents: 126_000_000, title: "Owner agreement" });
    await expect(
      save({ contract_id: primeId, expected_version: 1, value_cents: 5, reason: "stale" }),
    ).rejects.toThrow(/changed since you loaded it \(now v2\)/);
    const same = await save({
      contract_id: primeId,
      expected_version: 2,
      value_cents: 126_000_000,
      reason: "No real change",
    });
    expect(same).toMatchObject({ version: 2, changed: false });
    const v = await query(
      owner,
      "SELECT version, reason FROM mcp_job_contract_versions WHERE contract_id=$1 ORDER BY version",
      [primeId],
    );
    expect(v.rows.map((r) => r.version)).toEqual([1, 2]);
    expect(v.rows[1].reason).toBe("Value corrected to the executed agreement");
  });

  it("keeps the version history immutable and the tables closed to direct writes", async () => {
    await expect(db.query("UPDATE mcp_job_contract_versions SET reason='x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(
      query(owner, "UPDATE mcp_job_contracts SET value_cents=0 WHERE id=$1", [primeId]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      query(
        owner,
        "INSERT INTO mcp_job_contracts(job_id,company_id,kind,counterparty,status,source) VALUES($1,$2,'other','X','draft','chat')",
        [job, company],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets contract scope save and read, and refuses a Super and an outsider", async () => {
    const saved = await save(
      {
        kind: "subcontract",
        counterparty: "Bright Wire Co",
        party_id: party,
        tag: "Lighting rough-in",
        cost_code: "26-0500",
        value_cents: 8_400_000,
        status: "sent",
        sent_on: "2026-11-02",
      },
      contracts,
    );
    expect(saved).toMatchObject({
      kind: "subcontract",
      status: "sent",
      previous_status: null,
      status_changed: true,
    });
    subId = saved.id;
    expect((await rows(contracts)).contracts).toHaveLength(2);
    await expect(save({ kind: "other", counterparty: "X" }, superUser)).rejects.toThrow(
      /full or contract access/,
    );
    await expect(rows(superUser)).rejects.toThrow(/full or contract access/);
    expect(
      (await query(superUser, "SELECT count(*)::int AS n FROM mcp_job_contracts")).rows[0].n,
    ).toBe(0);
    await expect(rows(outsider)).rejects.toThrow(/MCP_NO_JOB/);
    expect(
      (await query(outsider, "SELECT count(*)::int AS n FROM mcp_job_contract_versions")).rows[0].n,
    ).toBe(0);
  });

  it("refuses a subcontractor, purchase order or document from another job or the wrong kind", async () => {
    await expect(
      save({ kind: "subcontract", counterparty: "Elsewhere Electric", party_id: otherJobParty }),
    ).rejects.toThrow(/subcontractor or supplier isn't on this job/);
    await expect(
      save({ kind: "subcontract", counterparty: "Elsewhere", po_id: po }, owner, job2),
    ).rejects.toThrow(/purchase order isn't on this job/);
    await expect(
      save({ kind: "supplier", counterparty: "Bright Wire", party_id: party, po_id: po }),
    ).rejects.toThrow(/different subcontractor or supplier/);
    await expect(
      save({ kind: "subcontract", counterparty: "Bright Wire Co", document_id: doc }),
    ).rejects.toThrow(/Link it to the prime contract only/);
    await expect(
      save({ kind: "prime", counterparty: "HOA", party_id: party, status: "void" }),
    ).rejects.toThrow(/prime contract is with the client/);
  });

  it("checks status, dates and value in plain words", async () => {
    await expect(save({ kind: "other", counterparty: "X", status: "executed" })).rejects.toThrow(
      /draft, sent, signed or void/,
    );
    await expect(
      save({ kind: "other", counterparty: "X", status: "draft", sent_on: "2026-11-01" }),
    ).rejects.toThrow(/A draft has no sent or signed date/);
    await expect(
      save({ kind: "other", counterparty: "X", status: "signed", signed_on: "2999-01-01" }),
    ).rejects.toThrow(/can't be in the future/);
    await expect(
      save({ kind: "other", counterparty: "X", status: "signed", signed_on: "2026-02-30" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    await expect(save({ kind: "other", counterparty: "X", value_cents: 1.5 })).rejects.toThrow(
      /whole number of cents/,
    );
    await expect(save({ kind: "other", counterparty: " " })).rejects.toThrow(
      /Say who the contract is with/,
    );
    await expect(save({ kind: "other", counterparty: "X", signer: "Y" })).rejects.toThrow(
      /doesn't keep signer/,
    );
  });

  it("returns the previous and new status for a server-side notice, and writes no project record", async () => {
    const signed = await save({
      contract_id: subId,
      expected_version: 1,
      status: "signed",
      signed_on: "2026-11-04",
      reason: "Signed copy came back",
    });
    expect(signed).toMatchObject({
      contract_id: subId,
      id: subId,
      version: 2,
      previous_status: "sent",
      status: "signed",
      status_changed: true,
      changed: true,
    });
    const tagged = await save({
      contract_id: subId,
      expected_version: 2,
      cost_code: "26-0510",
      reason: "Cost code fixed",
    });
    expect(tagged).toMatchObject({
      version: 3,
      previous_status: "signed",
      status: "signed",
      status_changed: false,
    });
    await expect(
      save({ contract_id: subId, expected_version: 3, reason: "x", host: "claude" }),
    ).rejects.toThrow(/doesn't keep host/);
    const events = await query(owner, "SELECT count(*)::int AS n FROM mcp_project_record_events");
    expect(events.rows[0].n).toBe(0);
  });

  it("allows a second subcontract with the same sub, a PO-backed supplier contract and a new prime after a void", async () => {
    await save({
      kind: "other",
      counterparty: "City of Willow Creek",
      title: "Encroachment permit",
    });
    const second = await save({
      kind: "subcontract",
      counterparty: "Bright Wire Co",
      party_id: party,
      tag: "Site lighting",
    });
    expect(second.id).not.toBe(subId);
    const supplier = await save({
      kind: "supplier",
      counterparty: "Volt Supply",
      po_id: po,
      source: "purchase_order",
      status: "signed",
    });
    expect(supplier.party_id).toBe(party2);
    await save({ contract_id: primeId, expected_version: 2, status: "void", reason: "Replaced" });
    const prime2 = await save({
      kind: "prime",
      counterparty: "Willow Creek HOA",
      title: "Restated agreement",
    });
    expect(prime2.version).toBe(1);
    await expect(
      save({ contract_id: primeId, expected_version: 3, status: "draft", reason: "Undo void" }),
    ).rejects.toThrow(/already has a prime contract/);
  });

  it("lists prime first, then subcontracts, supplier contracts and other, oldest first", async () => {
    const list = await rows();
    expect(list).toMatchObject({ job_id: job, job_number: "2810", job_name: "Willow Creek" });
    expect(
      list.contracts.map(
        (c: J) => `${c.kind}:${c.counterparty}:${c.status}${c.title ? `:${c.title}` : ""}`,
      ),
    ).toEqual([
      "prime:Willow Creek HOA:void:Owner agreement",
      "prime:Willow Creek HOA:draft:Restated agreement",
      "subcontract:Bright Wire Co:signed",
      "subcontract:Bright Wire Co:draft",
      "supplier:Volt Supply:signed",
      "other:City of Willow Creek:draft:Encroachment permit",
    ]);
    const supplier = list.contracts.find((c: J) => c.kind === "supplier");
    expect(supplier).toMatchObject({ party_name: "Volt Supply", po_number: "PO-101" });
    expect((await rows(owner, job2)).contracts).toEqual([]);
  });
});
