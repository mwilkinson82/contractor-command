import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const owner = "00000000-0000-4000-8000-000000000201",
  pm = "00000000-0000-4000-8000-000000000202",
  ap = "00000000-0000-4000-8000-000000000206",
  contracts = "00000000-0000-4000-8000-000000000207",
  outsider = "00000000-0000-4000-8000-000000000208",
  company = "00000000-0000-4000-8000-000000000203",
  job = "00000000-0000-4000-8000-000000000204",
  otherJob = "00000000-0000-4000-8000-000000000205";
let db: PGlite;
const query = (sql: string, values: unknown[] = [], user = owner) =>
  asUser(
    db,
    { sub: user, role: "authenticated", email: "fixture@example.test" },
    (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const request = (p: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  request_id: crypto.randomUUID(),
  ...p,
});
const prepare = async (
  action: string,
  p: Record<string, unknown>,
  j = job,
  user = owner,
  id = crypto.randomUUID(),
) => {
  await query(
    "select public.mcp_project_purchase_orders_review($1,$2,$3::jsonb,$4)",
    [j, action, JSON.stringify(p), id],
    user,
  );
  return id;
};
const save = async (
  action: string,
  p: Record<string, unknown>,
  review: string | null,
  j = job,
  user = owner,
  confirmed = true,
) =>
  (
    await query(
      "select public.mcp_project_purchase_orders_record($1,$2,$3::jsonb,$4,$5) data",
      [j, action, JSON.stringify(p), review, confirmed],
      user,
    )
  ).rows[0].data as Record<string, unknown>;
const rec = async (action: string, p: Record<string, unknown>, j = job, user = owner) =>
  save(action, p, await prepare(action, p, j, user), j, user);
type Ledger = {
  default_terms_id: string | null;
  default_version: number | null;
  default_history: Array<{ version: number; terms_id: string }>;
  terms: Array<{ id: string; scope: string; job_id: string | null }>;
};
const read = async (j = job, user = owner) =>
  (await query("select public.mcp_project_purchase_orders_get($1) data", [j], user)).rows[0]
    .data as Ledger;
let companyA: Record<string, unknown>, companyB: Record<string, unknown>;
beforeAll(async () => {
  db = await makeDb();
  // Load the repository's current job-scope definition with a synthetic allow-all plan gate.
  await db.exec(
    "ALTER TABLE public.mcp_company_members DROP CONSTRAINT mcp_company_members_role_check; ALTER TABLE public.mcp_company_members ADD CONSTRAINT mcp_company_members_role_check CHECK(role IN ('owner','pm','all_access','ap','estimating','contracts','super')); CREATE FUNCTION public.mcp_role_allowed(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;",
  );
  const scopeSource = readFileSync(
    "supabase/migrations/20261022120000_athena_account_team_privacy_terms.sql",
    "utf8",
  );
  const scopeDefinition = scopeSource.match(
    /CREATE OR REPLACE FUNCTION public\.mcp_job_scope\(_job uuid\) RETURNS text[\s\S]*?\$\$;/,
  )?.[0];
  if (!scopeDefinition) throw new Error("missing scope fixture");
  await db.exec(scopeDefinition);
  for (const id of [owner, pm, ap, contracts, outsider]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${id.slice(-3)}@example.test`,
    ]);
    await db.query("insert into test_active_members values($1)", [id]);
  }
  await db.query("insert into mcp_companies(id,name,created_by) values($1,'Synthetic',$2)", [
    company,
    owner,
  ]);
  for (const [id, role] of [
    [owner, "owner"],
    [pm, "pm"],
    [ap, "ap"],
    [contracts, "contracts"],
  ])
    await db.query(
      "insert into mcp_company_members(company_id,user_id,role,display_name) values($1,$2,$3,'Synthetic')",
      [company, id, role],
    );
  for (const [id, num] of [
    [job, "A"],
    [otherJob, "B"],
  ]) {
    await db.query(
      "insert into mcp_jobs(id,user_id,company_id,job_number,name) values($1,$2,$3,$4,'Synthetic')",
      [id, owner, company, num],
    );
    for (const user of [pm, contracts])
      await db.query("insert into mcp_job_access(job_id,user_id,granted_by) values($1,$2,$3)", [
        id,
        user,
        owner,
      ]);
  }
  await db.exec(
    readFileSync("supabase/migrations/20261028143924_athena_project_purchase_orders.sql", "utf8"),
  );
}, 30000);
afterAll(async () => db.close());
describe("review, defaults and fail-closed terms", () => {
  it("binds reviews to actor, project, action and exact payload, expires unused reviews, and retries applied writes", async () => {
    const p = request({ name: "Synthetic Party", kind: "supplier" });
    const token = await prepare("party", p);
    expect(await prepare("party", p, job, owner, token)).toBe(token);
    await expect(prepare("party", { ...p, name: "Changed" }, job, owner, token)).rejects.toThrow(
      /different facts/,
    );
    await expect(prepare("party", p, job, pm, token)).rejects.toThrow(/different facts/);
    await expect(save("party", p, null)).rejects.toThrow(/Review and confirm/);
    await expect(save("party", p, token, job, owner, false)).rejects.toThrow(/Review and confirm/);
    await expect(save("party", { ...p, name: "Changed" }, token)).rejects.toThrow(/does not match/);
    await expect(save("party", p, token, job, pm)).rejects.toThrow(/does not match/);
    await expect(save("party", p, token, otherJob)).rejects.toThrow(/does not match/);
    await expect(save("terms", p, token)).rejects.toThrow(/does not match/);
    expect(await save("party", p, token)).toMatchObject({ id: p.id });
    await db.query(
      "update public.mcp_po_reviews set expires_at=now()-interval '1 second' where id=$1",
      [token],
    );
    // Another review opportunistically removes the expired review row. The applied
    // operation must remain retryable using its original actor, payload and review ID.
    await prepare("party", request({ name: "Cleanup trigger", kind: "supplier" }));
    const cleaned = await db.query("select id from public.mcp_po_reviews where id=$1", [token]);
    expect(cleaned.rows).toHaveLength(0);
    expect(await save("party", p, token)).toMatchObject({ already_applied: true });
    await expect(save("party", p, crypto.randomUUID())).rejects.toThrow(/different content/);
    const expired = request({ name: "Expired", kind: "supplier" });
    const old = await prepare("party", expired);
    await db.query(
      "update public.mcp_po_reviews set expires_at=now()-interval '1 second' where id=$1",
      [old],
    );
    await expect(save("party", expired, old)).rejects.toThrow(/expired/);
    await expect(query("select * from public.mcp_po_reviews")).rejects.toThrow();
  });
  it("rejects stale defaults across jobs and preserves a unique immutable event for each version", async () => {
    companyA = request({
      scope: "company",
      title: "Synthetic A",
      body: "Payment 30 days",
      source: "Policy A",
    });
    companyB = request({
      scope: "company",
      title: "Synthetic B",
      body: "Payment 45 days",
      source: "Policy B",
    });
    await rec("terms", companyA);
    await rec("terms", companyB, otherJob);
    const a = { id: companyA.id, request_id: crypto.randomUUID(), expected_default_version: 0 };
    const b = { id: companyB.id, request_id: crypto.randomUUID(), expected_default_version: 0 };
    const tokenA = await prepare("default_terms", a);
    const tokenB = await prepare("default_terms", b, otherJob);
    expect(await save("default_terms", a, tokenA)).toMatchObject({ version: 1 });
    await expect(save("default_terms", b, tokenB, otherJob)).rejects.toThrow(/default changed/);
    expect(await save("default_terms", a, tokenA)).toMatchObject({
      already_applied: true,
      version: 1,
    });
    const fresh = { ...b, request_id: crypto.randomUUID(), expected_default_version: 1 };
    expect(await rec("default_terms", fresh, otherJob)).toMatchObject({ version: 2 });
    const state = await read();
    expect(state.default_terms_id).toBe(companyB.id);
    expect(state.default_version).toBe(2);
    expect(state.default_history.map((e) => e.version)).toEqual([2, 1]);
    await expect(
      db.query(
        "update public.mcp_po_default_events set version=3 where company_id=$1 and version=1",
        [company],
      ),
    ).rejects.toThrow(/append-only/);
    const parallelA = {
      id: companyA.id,
      request_id: crypto.randomUUID(),
      expected_default_version: 2,
    };
    const parallelB = {
      id: companyB.id,
      request_id: crypto.randomUUID(),
      expected_default_version: 2,
    };
    const [reviewA, reviewB] = await Promise.all([
      prepare("default_terms", parallelA, job),
      prepare("default_terms", parallelB, otherJob),
    ]);
    const outcomes = await Promise.allSettled([
      save("default_terms", parallelA, reviewA, job),
      save("default_terms", parallelB, reviewB, otherJob),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect((await read()).default_history.map((e) => e.version)).toEqual([3, 2, 1]);
    await expect(
      rec(
        "default_terms",
        { id: companyA.id, request_id: crypto.randomUUID(), expected_default_version: 2 },
        job,
        pm,
      ),
    ).rejects.toThrow(/Only a company owner/);
  });
  it("permits only owner-approved PO terms to PM/AP, and contracts proposals do not open the financial ledger", async () => {
    const readTerms = async (j = job, user = contracts) =>
      (await query("select public.mcp_project_po_terms_get($1) data", [j], user)).rows[0].data as {
        terms: Array<{ id: string; state: string; body: string; proposal_id: string | null }>;
        parties: Array<Record<string, unknown>>;
        orders: Array<Record<string, unknown>>;
      };
    for (const user of [pm, ap]) {
      const state = await read(job, user);
      expect(state.terms).toEqual([]);
      expect(state.default_terms_id).toBeNull();
    }
    await expect(read(job, contracts)).rejects.toThrow(/full project access/);
    await expect(query("select public.mcp_project_po_terms_get($1)", [job], pm)).rejects.toThrow(
      /owner or contracts/,
    );
    await expect(
      query("select public.mcp_project_po_terms_get($1)", [job], outsider),
    ).rejects.toThrow(/owner or contracts/);
    const party = request({
      name: "Job A supplier",
      kind: "supplier",
      contact_email: "private@example.test",
    });
    await rec("party", party);
    const po = request({
      expected_version: 0,
      number: "A-1",
      party_id: party.id,
      party_version: 1,
      terms_id: companyA.id,
      status: "draft",
      lines: [{ description: "Material", quantity: 1, unit: "lot", unit_price_cents: 100 }],
      order_date: "2026-11-01",
      needed_by: "2026-12-01",
    });
    await rec("order", po);
    const variant = request({
      scope: "supplier",
      party_id: party.id,
      party_version: 1,
      parent_id: companyA.id,
      title: "Project redline",
      body: "Revised terms",
      source: "Synthetic redline",
      change_note: "Change",
    });
    await expect(prepare("terms", variant, job, pm)).rejects.toThrow(/owner or contracts/);
    await expect(rec("terms", variant, job, contracts)).rejects.toThrow(/base terms/);
    const reviewed = {
      ...po,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      status: "reviewed",
      reason: "Reviewed",
    };
    await rec("order", reviewed);
    const proposedApproval = {
      ...po,
      request_id: crypto.randomUUID(),
      expected_version: 2,
      status: "approved",
      reason: "Internal approval",
    };
    await expect(rec("order", proposedApproval, job, pm)).rejects.toThrow(/Only the owner/);
    const changed = {
      ...proposedApproval,
      request_id: crypto.randomUUID(),
      lines: [{ description: "Changed", quantity: 1, unit: "lot", unit_price_cents: 100 }],
    };
    await expect(rec("order", changed)).rejects.toThrow(/reviewed order changed/);
    await rec("order", proposedApproval);
    for (const user of [pm, ap]) {
      const state = await read(job, user);
      expect(state.terms.map((x) => x.id)).toContain(companyA.id);
      expect(state.terms.map((x) => x.id)).not.toContain(companyB.id);
      expect(state.default_terms_id).toBeNull();
    }
    const narrow = await readTerms();
    expect(narrow.terms.map((x) => x.id)).toContain(companyA.id);
    expect(narrow.terms.map((x) => x.id)).not.toContain(companyB.id);
    expect(JSON.stringify(narrow.orders)).not.toMatch(/lines|unit_price|100/);
    expect(JSON.stringify(narrow.parties)).not.toContain("private@example.test");
    expect(await rec("terms", variant, job, contracts)).toMatchObject({ state: "proposed" });
    expect((await readTerms()).terms.find((x) => x.id === variant.id)?.state).toBe("proposed");
    expect((await read(job, pm)).terms.map((x) => x.id)).not.toContain(variant.id);
    const proposedOrder = {
      ...po,
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      number: "A-PROPOSED",
      terms_id: variant.id,
    };
    await expect(rec("order", proposedOrder)).rejects.toThrow(/applicable terms/);
    const approval = request({ proposal_id: variant.id });
    await expect(prepare("approve_terms", approval, job, contracts)).rejects.toThrow(
      /project access/,
    );
    await expect(prepare("approve_terms", approval, job, pm)).rejects.toThrow(/company owner/);
    await expect(rec("approve_terms", { ...approval, body: "Altered" })).rejects.toThrow(
      /Field does not apply/,
    );
    expect(await rec("approve_terms", approval)).toMatchObject({
      state: "approved",
      proposal_id: variant.id,
    });
    const approved = (await readTerms(job, owner)).terms.find((x) => x.id === approval.id);
    expect(approved).toMatchObject({
      state: "approved",
      body: "Revised terms",
      proposal_id: variant.id,
    });
    await expect(
      db.query("update public.mcp_po_terms_versions set body='changed' where id=$1", [approval.id]),
    ).rejects.toThrow(/append-only/);
    const revision = {
      ...po,
      request_id: crypto.randomUUID(),
      expected_version: 3,
      terms_id: approval.id,
      status: "draft",
      reason: "New terms proposal approved",
    };
    await rec("order", revision);
    await rec("order", {
      ...revision,
      request_id: crypto.randomUUID(),
      expected_version: 4,
      status: "reviewed",
      reason: "Reviewed",
    });
    await rec("order", {
      ...revision,
      request_id: crypto.randomUUID(),
      expected_version: 5,
      status: "approved",
      reason: "Internal approval",
    });
    for (const user of [pm, ap]) {
      const state = await read(job, user);
      expect(state.terms.map((x) => x.id)).toContain(approval.id);
      expect(state.terms.map((x) => x.id)).not.toContain(variant.id);
    }
    const oldVersion = (
      await query("select public.mcp_project_purchase_orders_get($1) data", [job])
    ).rows[0].data as {
      orders: Array<{
        id: string;
        versions: Array<{ version: number; status: string; terms_id: string }>;
      }>;
    };
    expect(
      oldVersion.orders.find((x) => x.id === po.id)?.versions.find((x) => x.version === 3),
    ).toMatchObject({ status: "approved", terms_id: companyA.id });
    const otherParty = request({ name: "Job B supplier", kind: "supplier" });
    await rec("party", otherParty, otherJob);
    const otherVariant = request({
      scope: "supplier",
      party_id: otherParty.id,
      party_version: 1,
      parent_id: companyB.id,
      title: "B negotiation",
      body: "Terms for B",
      source: "Synthetic",
      change_note: "B change",
    });
    await rec("terms", otherVariant, otherJob);
    expect((await readTerms(job, contracts)).terms.map((x) => x.id)).not.toContain(otherVariant.id);
    expect((await readTerms(otherJob, contracts)).terms.map((x) => x.id)).toContain(
      otherVariant.id,
    );
    expect((await read(otherJob, pm)).terms.map((x) => x.id)).not.toContain(otherVariant.id);
  });
  it("keeps review and ledger tables private to ordinary roles", async () => {
    const tables = [
      "mcp_project_parties",
      "mcp_project_party_versions",
      "mcp_po_terms_versions",
      "mcp_po_company_defaults",
      "mcp_purchase_orders",
      "mcp_purchase_order_versions",
      "mcp_po_default_events",
      "mcp_po_operations",
      "mcp_po_reviews",
    ];
    for (const name of tables) {
      const check = await db.query(
        "select c.relrowsecurity, has_table_privilege('authenticated',c.oid,'SELECT') ar,has_table_privilege('authenticated',c.oid,'INSERT') ai,has_table_privilege('authenticated',c.oid,'UPDATE') au,has_table_privilege('authenticated',c.oid,'DELETE') ad,has_table_privilege('anon',c.oid,'SELECT') nr,has_table_privilege('anon',c.oid,'INSERT') ni,has_table_privilege('service_role',c.oid,'INSERT') si from pg_class c where c.oid=to_regclass($1)",
        ["public." + name],
      );
      expect(check.rows[0]).toMatchObject({
        relrowsecurity: true,
        ar: false,
        ai: false,
        nr: false,
      });
    }
    for (const fn of [
      "public.mcp_project_po_terms_get(uuid)",
      "public.mcp_project_purchase_orders_review(uuid,text,jsonb,uuid)",
      "public.mcp_project_purchase_orders_record(uuid,text,jsonb,uuid,boolean)",
    ]) {
      const check = await db.query(
        "select has_function_privilege('authenticated',$1,'EXECUTE') ae,has_function_privilege('anon',$1,'EXECUTE') ne",
        [fn],
      );
      expect(check.rows[0]).toMatchObject({ ae: true, ne: false });
    }
  });
  it("rejects malformed direct RPC fields without saving", async () => {
    for (const bad of [
      request({ name: 42, kind: "supplier" }),
      request({ name: "Bad", kind: "supplier", trade: "x".repeat(201) }),
      request({ name: "Bad", kind: "supplier", status: "draft" }),
    ]) {
      const token = await prepare("party", bad);
      await expect(save("party", bad, token)).rejects.toThrow(
        /Invalid text|Invalid party detail|Field does not apply/,
      );
    }
    const party = request({ name: "Date fixture", kind: "supplier" });
    await rec("party", party);
    const invalidOrder = request({
      expected_version: 0,
      number: "DATE-1",
      party_id: party.id,
      party_version: 1,
      terms_id: companyA.id,
      status: "draft",
      lines: [{ description: "Fixture", quantity: 1, unit: "lot", unit_price_cents: 100 }],
      order_date: "2026-02-30",
      needed_by: "2026-12-01",
    });
    await expect(save("order", invalidOrder, await prepare("order", invalidOrder))).rejects.toThrow(
      /valid order/,
    );
    const invalidPrice = {
      ...invalidOrder,
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      order_date: "2026-11-01",
      lines: [{ description: "Fixture", quantity: 1, unit: "lot", unit_price_cents: 0.1 }],
    };
    await expect(save("order", invalidPrice, await prepare("order", invalidPrice))).rejects.toThrow(
      /unit price/,
    );
  });
});
