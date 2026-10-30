import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeDb } from "../mcp-roles/db";
export const poIds = {
  owner: randomUUID(),
  pm: randomUUID(),
  ap: randomUUID(),
  contracts: randomUUID(),
  super: randomUUID(),
  outsider: randomUUID(),
  inactive: randomUUID(),
  company: randomUUID(),
  company2: randomUUID(),
  job: randomUUID(),
  job2: randomUUID(),
  party: randomUUID(),
  party2: randomUUID(),
  terms: randomUUID(),
  po: randomUUID(),
  po2: randomUUID(),
};
export async function makePurchaseOrderDb() {
  const db = await makeDb();
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
  );
  for (const p of [
    "supabase/migrations/20261021190000_athena_team_invites.sql",
    "supabase/migrations/20261022120000_athena_account_team_privacy_terms.sql",
    "drizzle/migrations/0035_accounting_purchase_orders.sql",
    "drizzle/migrations/0041_po_company_approval.sql",
  ])
    await db.exec(readFileSync(p, "utf8"));
  for (const u of [
    poIds.owner,
    poIds.pm,
    poIds.ap,
    poIds.contracts,
    poIds.super,
    poIds.outsider,
    poIds.inactive,
  ]) {
    await db.query("INSERT INTO auth.users VALUES($1,'synthetic@example.invalid')", [u]);
    if (u !== poIds.inactive) await db.query("INSERT INTO test_active_members VALUES($1)", [u]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by)VALUES($1,'ALP Construction - Synthetic local only',$3),($2,'Other company - Synthetic local only',$4)",
    [poIds.company, poIds.company2, poIds.owner, poIds.outsider],
  );
  for (const [u, r] of [
    [poIds.owner, "owner"],
    [poIds.pm, "pm"],
    [poIds.ap, "ap"],
    [poIds.contracts, "contracts"],
    [poIds.super, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name)VALUES($1,$2,$3,'Synthetic')",
      [poIds.company, u, r],
    );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name)VALUES($1,$2,'owner','Other owner')",
    [poIds.company2, poIds.outsider],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name)VALUES($1,$3,$4,'2810','Willow Creek Community Center - Electrical'),($2,$3,$4,'2811','Second synthetic job')",
    [poIds.job, poIds.job2, poIds.owner, poIds.company],
  );
  await db.query(
    "INSERT INTO mcp_job_access(job_id,user_id,granted_by)VALUES($1,$2,$4),($1,$3,$4)",
    [poIds.job, poIds.pm, poIds.super, poIds.owner],
  );
  for (const [p, name, trade, contact] of [
    [poIds.party, "Summit Electrical Supply", "Electrical materials", "Taylor Morgan"],
    [poIds.party2, "Valley Mechanical Services", "Mechanical subcontract", "Jordan Chen"],
  ])
    await db.query(
      "INSERT INTO mcp_project_parties(id,job_id,company_id,name,kind,trade,contact_name,contact_email,contract_reference,version,created_by)VALUES($1,$2,$3,$4,'both',$5,$6,'synthetic@example.invalid','WC-2810-MAT',1,$7)",
      [p, poIds.job, poIds.company, name, trade, contact, poIds.owner],
    );
  await db.query(
    "INSERT INTO mcp_po_terms_versions(id,company_id,scope,state,title,body,source,approved_by,created_by)VALUES($1,$2,'company','approved','ALP Construction - Net 30 Base','Payment is due 30 calendar days after the invoice date.','Synthetic owner-approved base',$3,$3)",
    [poIds.terms, poIds.company, poIds.owner],
  );
  for (const [po, party, number] of [
    [poIds.po, poIds.party, "WC-2810-PO01"],
    [poIds.po2, poIds.party2, "WC-2810-PO02"],
  ])
    await db.query(
      "INSERT INTO mcp_purchase_orders(id,job_id,company_id,party_id,number,created_by)VALUES($1,$2,$3,$4,$5,$6)",
      [po, poIds.job, poIds.company, party, number, poIds.owner],
    );
  const [partySnapshot] = (
    await db.query("SELECT to_jsonb(p) AS s FROM mcp_project_parties p WHERE id=$1", [poIds.party])
  ).rows as Array<{ s: Record<string, unknown> }>;
  const lines = [
    {
      description: "Conduit materials for raceway rough-in",
      quantity: 4000,
      unit: "LF",
      unit_price_cents: 200,
    },
    { description: "Distribution materials", quantity: 200, unit: "EA", unit_price_cents: 2200 },
  ];
  for (const [n, status, reason] of [
    [1, "approved", "Synthetic prior approved version"],
    [2, "draft", "Clarify conduit material description; quantities and prices unchanged."],
  ])
    await db.query(
      "INSERT INTO mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,reason,created_by)VALUES($1,$2,$3,$4,$5,$6,'2026-10-30','2026-11-02',$7,$8)",
      [
        poIds.po,
        n,
        status,
        poIds.terms,
        partySnapshot.s,
        n === 1 ? [{ ...lines[0], description: "Conduit materials" }, lines[1]] : lines,
        reason,
        poIds.owner,
      ],
    );
  const second = (
    await db.query("SELECT to_jsonb(p) AS s FROM mcp_project_parties p WHERE id=$1", [poIds.party2])
  ).rows[0] as { s: Record<string, unknown> };
  await db.query(
    "INSERT INTO mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,reason,created_by)VALUES($1,1,'reviewed',$2,$3,$4,'2026-10-29','2026-11-12','Synthetic scope review',$5)",
    [
      poIds.po2,
      poIds.terms,
      second.s,
      [
        {
          description: "Mechanical equipment installation scope",
          quantity: 1,
          unit: "LS",
          unit_price_cents: 2875000,
        },
      ],
      poIds.owner,
    ],
  );
  return db;
}
