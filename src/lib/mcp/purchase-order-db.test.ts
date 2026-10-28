import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const owner = "00000000-0000-4000-8000-000000000091",
  outsider = "00000000-0000-4000-8000-000000000092",
  company = "00000000-0000-4000-8000-000000000093",
  job = "00000000-0000-4000-8000-000000000094",
  otherJob = "00000000-0000-4000-8000-000000000095",
  pm = "00000000-0000-4000-8000-000000000096",
  estimator = "00000000-0000-4000-8000-000000000097",
  inactive = "00000000-0000-4000-8000-000000000098",
  company2 = "00000000-0000-4000-8000-000000000099",
  job2 = "00000000-0000-4000-8000-000000000100";
let db: PGlite;
const query = (sql: string, values: unknown[] = [], user = owner) =>
  asUser(
    db,
    { sub: user, role: "authenticated", email: "synthetic@example.test" },
    (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const reviewed = new Map<string, string>();
const prepare = async (action: string, p: Record<string, unknown>, j = job, user = owner) => {
  const key = `${j}:${user}:${p.request_id}`;
  const id = reviewed.get(key) ?? crypto.randomUUID();
  await query(
    "select public.mcp_project_purchase_orders_review($1,$2,$3::jsonb,$4)",
    [j, action, JSON.stringify(p), id],
    user,
  );
  reviewed.set(key, id);
  return id;
};
const save = async (
  action: string,
  p: Record<string, unknown>,
  review: string,
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
const read = async (j = job, user = owner) =>
  (await query("select public.mcp_project_purchase_orders_get($1) data", [j], user)).rows[0]
    .data as {
    parties: Array<{ id: string }>;
    terms: Array<{ id: string; body: string; parent_id: string | null }>;
    orders: Array<{
      id: string;
      versions: Array<{ version: number; status: string; party_snapshot: { name: string } }>;
    }>;
    default_terms_id: string | null;
  };
const request = () => ({ id: crypto.randomUUID(), request_id: crypto.randomUUID() });
beforeAll(async () => {
  db = await makeDb();
  for (const user of [owner, outsider, pm, estimator, inactive]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      user,
      `${user.slice(-2)}@example.test`,
    ]);
    if (user !== inactive) await db.query("insert into test_active_members values($1)", [user]);
  }
  await db.query("insert into mcp_companies(id,name,created_by) values($1,'Synthetic',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "insert into mcp_company_members(company_id,user_id,role,display_name) values($1,$2,'owner','Owner')",
    [company, owner],
  );
  for (const [user, role] of [
    [pm, "pm"],
    [estimator, "estimating"],
    [inactive, "pm"],
  ])
    await db.query(
      "insert into mcp_company_members(company_id,user_id,role,display_name) values($1,$2,$3,'Synthetic')",
      [company, user, role],
    );
  for (const [id, num] of [
    [job, "SYN-1"],
    [otherJob, "SYN-2"],
  ])
    await db.query(
      "insert into mcp_jobs(id,user_id,company_id,job_number,name) values($1,$2,$3,$4,'Synthetic')",
      [id, owner, company, num],
    );
  await db.query("insert into mcp_companies(id,name,created_by) values($1,'Other synthetic',$2)", [
    company2,
    owner,
  ]);
  await db.query(
    "insert into mcp_company_members(company_id,user_id,role,display_name) values($1,$2,'owner','Owner')",
    [company2, owner],
  );
  await db.query(
    "insert into mcp_jobs(id,user_id,company_id,job_number,name) values($1,$2,$3,'OTHER','Other')",
    [job2, owner, company2],
  );
  await db.query("insert into mcp_job_access(job_id,user_id,granted_by) values($1,$2,$3)", [
    job,
    pm,
    owner,
  ]);
  await db.exec(
    readFileSync("supabase/migrations/20261028143924_athena_project_purchase_orders.sql", "utf8"),
  );
}, 30000);
afterAll(async () => db.close());
describe("project purchase order persistence", () => {
  it("enforces active membership, full job scope and owner-only company approval", async () => {
    await expect(read(job, outsider)).rejects.toThrow();
    await expect(read(job, estimator)).rejects.toThrow(/full project access/);
    await expect(read(job, inactive)).rejects.toThrow();
    await expect(
      rec(
        "terms",
        { ...request(), scope: "company", title: "Standard", body: "Terms", source: "Source" },
        job,
        pm,
      ),
    ).rejects.toThrow(/Only a company owner/);
    expect((await read(job, pm)).orders).toEqual([]);
  });
  it("keeps terms history, applies idempotency, protects references and issued versions", async () => {
    const party = {
      ...request(),
      name: "Synthetic Supply",
      kind: "supplier",
      insurance_reference: "Policy QA",
      contract_reference: "Contract QA",
    };
    await rec("party", party);
    expect(await rec("party", party)).toMatchObject({ id: party.id, already_applied: true });
    await expect(rec("party", { ...party, name: "Different" })).rejects.toThrow(/different facts/);
    await expect(
      rec("party", { ...request(), name: "synthetic supply", kind: "supplier" }),
    ).rejects.toThrow(/already exists/);
    const companyTerms = {
      ...request(),
      scope: "company",
      title: "Standard",
      body: "Payment 30 days",
      source: "Approved synthetic policy",
    };
    await rec("terms", companyTerms);
    await rec("default_terms", {
      id: companyTerms.id,
      request_id: crypto.randomUUID(),
      expected_default_version: 0,
    });
    const foreignTerms = {
      ...request(),
      scope: "company",
      title: "Other company",
      body: "Other terms",
      source: "Other synthetic policy",
    };
    await rec("terms", foreignTerms, job2);
    const variant = {
      ...request(),
      scope: "supplier",
      party_id: party.id,
      party_version: 1,
      parent_id: companyTerms.id,
      title: "Negotiated",
      body: "Payment 45 days",
      source: "Synthetic redline",
      change_note: "Payment term changed",
    };
    await rec("terms", variant);
    const order = {
      ...request(),
      expected_version: 0,
      number: "PO-1",
      party_id: party.id,
      party_version: 1,
      terms_id: variant.id,
      status: "draft",
      lines: [
        { description: "Fictional material", quantity: 2, unit: "each", unit_price_cents: 1200 },
      ],
      order_date: "2026-11-01",
      needed_by: "2026-12-01",
    };
    await expect(
      rec("order", {
        ...order,
        id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        number: "FOREIGN",
        terms_id: foreignTerms.id,
      }),
    ).rejects.toThrow(/applicable terms/);
    await expect(
      rec("order", {
        ...order,
        id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        number: "ISSUE",
        status: "issued",
      }),
    ).rejects.toThrow(/Invalid order status|drafts/);
    await rec("order", order);
    expect(await rec("order", order)).toMatchObject({ already_applied: true });
    await rec("order", {
      ...order,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      status: "reviewed",
      reason: "Reviewed",
    });
    const poTerms = {
      ...request(),
      scope: "po",
      party_id: party.id,
      party_version: 1,
      po_id: order.id,
      parent_id: variant.id,
      title: "PO exception",
      body: "Payment 60 days",
      source: "Synthetic redline",
      change_note: "Payment term changed",
    };
    await rec("terms", poTerms);
    const otherOrder = {
      ...order,
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      number: "PO-2",
      terms_id: poTerms.id,
    };
    await expect(rec("order", otherOrder)).rejects.toThrow(/applicable terms/);
    await rec("order", {
      ...order,
      request_id: crypto.randomUUID(),
      expected_version: 2,
      terms_id: poTerms.id,
      status: "draft",
      reason: "Negotiated revision",
    });
    await expect(
      rec("party", {
        id: party.id,
        kind: party.kind,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        name: "Renamed Supply",
        reason: "Correct spelling",
      }),
    ).resolves.toBeDefined();
    await expect(
      rec("order", {
        ...order,
        request_id: crypto.randomUUID(),
        expected_version: 3,
        reason: "stale party",
      }),
    ).rejects.toThrow(/Party details changed/);
    const ledger = await read();
    expect(ledger.default_terms_id).toBe(companyTerms.id);
    expect(
      (ledger.parties[0] as unknown as { insurance_reference: string }).insurance_reference,
    ).toBe("Policy QA");
    expect(ledger.terms.find((x) => x.id === variant.id)?.parent_id).toBe(companyTerms.id);
    expect(ledger.orders[0].versions.map((x) => x.status)).toEqual(["draft", "reviewed", "draft"]);
    expect(ledger.orders[0].versions[0].party_snapshot.name).toBe("Synthetic Supply");
    await expect(
      rec("order", { ...order, id: crypto.randomUUID(), request_id: crypto.randomUUID() }),
    ).rejects.toThrow(/already exists/);
    await expect(
      rec(
        "order",
        { ...order, id: crypto.randomUUID(), request_id: crypto.randomUUID(), number: "PO-2" },
        otherJob,
      ),
    ).rejects.toThrow(/party on this project/);
    await expect(read(job, outsider)).rejects.toThrow();
    await expect(query("select * from public.mcp_purchase_orders", [], owner)).rejects.toThrow();
    await db.query(
      "insert into public.mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,created_by) values($1,4,'issued',$2,'{}'::jsonb,$3::jsonb,'2026-11-01','2026-12-01',$4)",
      [order.id, variant.id, JSON.stringify(order.lines), owner],
    );
    await expect(
      rec("order", {
        ...order,
        request_id: crypto.randomUUID(),
        expected_version: 4,
        reason: "change",
      }),
    ).rejects.toThrow(/cannot be revised/);
    await expect(
      db.query(
        "update public.mcp_purchase_order_versions set status='draft' where po_id=$1 and version=4",
        [order.id],
      ),
    ).rejects.toThrow(/append-only/);
  });
});
