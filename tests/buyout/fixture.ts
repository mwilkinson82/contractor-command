import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeDb } from "../mcp-roles/db";
export const ids = {
  owner: randomUUID(),
  pm: randomUUID(),
  ap: randomUUID(),
  other: randomUUID(),
  super: randomUUID(),
  contracts: randomUUID(),
  locked: randomUUID(),
  company: randomUUID(),
  company2: randomUUID(),
  job: randomUUID(),
  job2: randomUUID(),
  job3: randomUUID(),
  party: randomUUID(),
  party2: randomUUID(),
  doc: randomUUID(),
  doc2: randomUUID(),
  doc3: randomUUID(),
  po: randomUUID(),
  terms: randomUUID(),
  sub: randomUUID(),
};
export async function makeBuyoutDb(createDb: typeof makeDb = makeDb) {
  const db = await createDb();
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
  );
  for (const path of [
    "supabase/migrations/20261021190000_athena_team_invites.sql",
    "supabase/migrations/20261022120000_athena_account_team_privacy_terms.sql",
    "drizzle/migrations/0035_accounting_purchase_orders.sql",
    "drizzle/migrations/0041_po_company_approval.sql",
    "drizzle/migrations/0036_accounting_ap.sql",
  ])
    await db.exec(readFileSync(path, "utf8"));
  // External document/submittal/schedule fixtures expose only the existing columns used by this proposal.
  // Storage and byte verification are unchanged; their dedicated suites remain release dependencies.
  await db.exec(
    "CREATE TABLE mcp_billing_documents(id uuid PRIMARY KEY,company_id uuid,job_id uuid,filename text,sha256 text);CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer);CREATE TABLE mcp_living_reports(job_id uuid,report_type text,version integer,data jsonb);",
  );
  await db.exec(readFileSync("drizzle/migrations/0049_supplier_buyout_workflows.sql", "utf8"));
  for (const user of [ids.owner, ids.pm, ids.ap, ids.other, ids.super, ids.contracts, ids.locked]) {
    await db.query("INSERT INTO auth.users VALUES($1,'synthetic@example.invalid')", [user]);
    if (user !== ids.locked) await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  for (const co of [ids.company, ids.company2])
    await db.query(
      "INSERT INTO mcp_companies(id,name,created_by)VALUES($1,'Synthetic buyout only',$2)",
      [co, ids.owner],
    );
  for (const [u, r] of [
    [ids.owner, "owner"],
    [ids.pm, "pm"],
    [ids.ap, "ap"],
    [ids.super, "super"],
    [ids.contracts, "contracts"],
    [ids.locked, "pm"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name)VALUES($1,$2,$3,'Synthetic')",
      [ids.company, u, r],
    );
  for (const [job, co] of [
    [ids.job, ids.company],
    [ids.job2, ids.company],
    [ids.job3, ids.company2],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name)VALUES($1,$2,$3,$4,'Synthetic job')",
      [job, ids.owner, co, job],
    );
  await db.query(
    "INSERT INTO mcp_job_access(job_id,user_id,granted_by)VALUES($1,$2,$5),($1,$3,$5),($1,$4,$5)",
    [ids.job, ids.pm, ids.super, ids.locked, ids.owner],
  );
  for (const [p, j] of [
    [ids.party, ids.job],
    [ids.party2, ids.job2],
  ])
    await db.query(
      "INSERT INTO mcp_project_parties(id,company_id,job_id,name,kind,version,created_by)VALUES($1,$2,$3,'Synthetic Supplier','both',1,$4)",
      [p, ids.company, j, ids.owner],
    );
  await db.query(
    "INSERT INTO mcp_billing_documents VALUES($1,$2,$3,'Agreement.pdf',$4),($5,$2,$6,'Other job.pdf',$4)",
    [ids.doc, ids.company, ids.job, "a".repeat(64), ids.doc2, ids.job2],
  );
  await db.query("INSERT INTO mcp_billing_documents VALUES($1,$2,$3,'Replacement.pdf',$4)", [
    ids.doc3,
    ids.company,
    ids.job,
    "b".repeat(64),
  ]);
  await db.query(
    "INSERT INTO mcp_po_terms_versions(id,company_id,scope,state,title,body,source,approved_by,created_by)VALUES($1,$2,'company','approved','Base','Base text','Owner',$3,$3)",
    [ids.terms, ids.company, ids.owner],
  );
  await db.query(
    "INSERT INTO mcp_purchase_orders(id,job_id,company_id,party_id,number,created_by)VALUES($1,$2,$3,$4,'PO1',$5)",
    [ids.po, ids.job, ids.company, ids.party, ids.owner],
  );
  await db.query(
    "INSERT INTO mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,created_by)VALUES($1,1,'approved',$2,$3,$4,'2026-10-30','2026-12-01',$5)",
    [
      ids.po,
      ids.terms,
      { id: ids.party, name: "Synthetic Supplier" },
      JSON.stringify([{ quantity: 2, unit_price_cents: 20000 }]),
      ids.owner,
    ],
  );
  await db.query("INSERT INTO mcp_submittals VALUES($1,$2,'26-001',0)", [ids.sub, ids.job]);
  await db.query("INSERT INTO mcp_living_reports VALUES($1,'cpm',1,$2)", [
    ids.job,
    { activities: [{ id: "PROC-1" }] },
  ]);

  return db;
}
