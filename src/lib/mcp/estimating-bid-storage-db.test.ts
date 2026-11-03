/* Real repository RLS policies on a synthetic Storage schema. This does not
 * exercise Supabase's HTTP signing service or a host browser download. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const users = {
  owner: "00000000-0000-4000-8000-000000000601",
  pm: "00000000-0000-4000-8000-000000000602",
  estimator: "00000000-0000-4000-8000-000000000603",
  contracts: "00000000-0000-4000-8000-000000000604",
  super: "00000000-0000-4000-8000-000000000605",
  outsider: "00000000-0000-4000-8000-000000000606",
};
const company = "00000000-0000-4000-8000-000000000610";
const otherCompany = "00000000-0000-4000-8000-000000000611";
const job = "00000000-0000-4000-8000-000000000620";
const otherJob = "00000000-0000-4000-8000-000000000621";
const path = `${company}/${job}/export-fixture/Bid.pdf`;
const bucket = "athena-estimate-exports";
let db: PGlite;
const query = (user: string, sql: string, args: unknown[] = []) =>
  asUser(
    db,
    { sub: user, email: "fixture@example.invalid", role: "authenticated" },
    async (tx) => (await tx.query(sql, args)).rows,
  );
const insert = (user: string, name: string, target = bucket) =>
  query(user, "INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)", [target, name]);
const read = (user: string, name = path, target = bucket) =>
  query(user, "SELECT name FROM storage.objects WHERE bucket_id=$1 AND name=$2", [target, name]);

beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;",
  );
  for (const name of [
    "20261021190000_athena_team_invites.sql",
    "20261022120000_athena_account_team_privacy_terms.sql",
    "20261021000000_athena_file_shares.sql",
    "20261026120000_athena_drawing_sets.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  for (const id of Object.values(users)) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.invalid')", [id]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [id]);
  }
  for (const [id, owner] of [
    [company, users.owner],
    [otherCompany, users.outsider],
  ])
    await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
      id,
      owner,
    ]);
  for (const [id, c, owner] of [
    [job, company, users.owner],
    [otherJob, otherCompany, users.outsider],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,job_number,name,user_id) VALUES($1,$2,'900071','Synthetic Example',$3)",
      [id, c, owner],
    );
  for (const [user, role] of [
    [users.owner, "owner"],
    [users.pm, "pm"],
    [users.estimator, "estimating"],
    [users.contracts, "contracts"],
    [users.super, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Fixture')",
      [company, user, role],
    );
  for (const user of [users.pm, users.super])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job,
      user,
      users.owner,
    ]);
  // UI provisioning is simulated solely for this isolated database fixture.
  await db.query(
    "INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES($1,$1,false,10485760,$2)",
    [
      bucket,
      ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ],
  );
  await db.exec(readFileSync("release-proposals/estimating-bid-artifact-storage.sql", "utf8"));
});
afterAll(async () => db.close());

describe.sequential("monetary bid artifact storage scope", () => {
  it("proves why the existing drawing bucket cannot hold monetary bids", async () => {
    const oldPath = `${company}/${job}/drawing-markup-fixture/Bid.pdf`;
    await insert(users.owner, oldPath, "athena-files");
    expect(await read(users.super, oldPath, "athena-files")).toEqual([{ name: oldPath }]);
    await insert(users.owner, path);
    expect(await read(users.super)).toEqual([]);
    await expect(insert(users.super, path + ".new")).rejects.toThrow(/row-level security/i);
  });
  it("retains full and contract estimating scope on the matching company/job", async () => {
    for (const user of [users.owner, users.pm, users.estimator, users.contracts]) {
      const name = `${company}/${job}/export-${user}/Bid.xlsx`;
      await insert(user, name);
      expect(await read(user, name)).toEqual([{ name }]);
      expect(await read(user)).toEqual([{ name: path }]);
    }
  });
  it("rejects other tenants, mismatched company paths and outsiders", async () => {
    for (const name of [
      `${otherCompany}/${otherJob}/export-fixture/Bid.pdf`,
      `${otherCompany}/${job}/export-fixture/Bid.pdf`,
      `${company}/${otherJob}/export-fixture/Bid.pdf`,
    ])
      await expect(insert(users.estimator, name)).rejects.toThrow(/row-level security/i);
    expect(await read(users.outsider)).toEqual([]);
    await expect(insert(users.outsider, path + ".new")).rejects.toThrow(/row-level security/i);
  });
  it("denies fresh storage access after membership removal", async () => {
    await db.query("DELETE FROM mcp_company_members WHERE company_id=$1 AND user_id=$2", [
      company,
      users.contracts,
    ]);
    expect(await read(users.contracts)).toEqual([]);
    await expect(insert(users.contracts, path + ".new")).rejects.toThrow(/row-level security/i);
  });
  it("does not permit authenticated replacement or deletion of emitted bytes", async () => {
    expect(
      await query(users.owner, "DELETE FROM storage.objects WHERE bucket_id=$1 RETURNING name", [
        bucket,
      ]),
    ).toEqual([]);
    expect(
      await query(
        users.owner,
        "UPDATE storage.objects SET name='replacement' WHERE bucket_id=$1 RETURNING name",
        [bucket],
      ),
    ).toEqual([]);
    expect(await read(users.owner)).toEqual([{ name: path }]);
  });
});
