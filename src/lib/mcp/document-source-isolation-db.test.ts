import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const users = {
  owner: "00000000-0000-4000-8000-000000000081",
  pm: "00000000-0000-4000-8000-000000000082",
  otherPm: "00000000-0000-4000-8000-000000000083",
  contract: "00000000-0000-4000-8000-000000000084",
  super: "00000000-0000-4000-8000-000000000085",
  outsider: "00000000-0000-4000-8000-000000000086",
};
const companyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81",
  companyB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82";
const jobA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81",
  jobB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb82",
  restricted = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb83";
const uploadA = "cccccccc-cccc-4ccc-8ccc-cccccccccc81";
const paths = {
  a: `${companyA}/${jobA}/${uploadA}/Source.txt`,
  b: `${companyB}/${jobB}/cccccccc-cccc-4ccc-8ccc-cccccccccc82/Other.txt`,
  restricted: `${companyA}/${restricted}/cccccccc-cccc-4ccc-8ccc-cccccccccc83/Restricted.txt`,
};
let db: PGlite;
const query = (user: string, sql: string, args: unknown[] = []) =>
  asUser(
    db,
    { sub: user, email: "fixture@example.com", role: "authenticated" },
    async (tx) => (await tx.query(sql, args)).rows,
  );
beforeAll(async () => {
  db = await makeDb();
  // Fixture for the external billing tier dependency only. All job/row/storage
  // access predicates below are loaded unchanged from their actual migrations.
  await db.exec("CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;");
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;",
  );
  for (const filename of [
    "20261021190000_athena_team_invites.sql",
    "20261022120000_athena_account_team_privacy_terms.sql",
    "20261031120000_athena_file_upload.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${filename}`, "utf8"));
  for (const id of Object.values(users)) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'fixture@example.com')", [id]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [id]);
  }
  for (const [id, owner] of [
    [companyA, users.owner],
    [companyB, users.outsider],
  ])
    await db.query(
      "INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Fixture Company',$2)",
      [id, owner],
    );
  for (const [id, c, number, owner, isRestricted] of [
    [jobA, companyA, "2710", users.owner, false],
    [jobB, companyB, "2710", users.outsider, false],
    [restricted, companyA, "2711", users.owner, true],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,job_number,name,user_id,restricted) VALUES ($1,$2,$3,'Fixture Job',$4,$5)",
      [id, c, number, owner, isRestricted],
    );
  for (const [id, role] of [
    [users.owner, "owner"],
    [users.pm, "pm"],
    [users.otherPm, "pm"],
    [users.contract, "contracts"],
    [users.super, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,$3,'Fixture Member')",
      [companyA, id, role],
    );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','Other Owner')",
    [companyB, users.outsider],
  );
  for (const [j, u] of [
    [jobA, users.pm],
    [jobA, users.super],
    [restricted, users.otherPm],
  ])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
      j,
      u,
      users.owner,
    ]);
  for (const [j, c, path, u] of [
    [jobA, companyA, paths.a, users.owner],
    [jobB, companyB, paths.b, users.outsider],
    [restricted, companyA, paths.restricted, users.owner],
  ]) {
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-documents',$1)", [
      path,
    ]);
    await db.query(
      "INSERT INTO mcp_spec_documents(job_id,company_id,name,body,body_sha256,storage_bucket,storage_path,created_by) VALUES ($1,$2,'Source.txt','Source text','fixture-body-hash','athena-documents',$3,$4)",
      [j, c, path, u],
    );
  }
}, 30000);
afterAll(() => db.close());
describe("document ownership and isolation using existing RLS", () => {
  it("resolves the same job number inside the authorized company only", async () => {
    const row = await query(users.owner, "SELECT mcp_resolve_job($1,'2710') AS data", [companyA]);
    expect(row[0].data).toMatchObject({ job_id: jobA, company_id: companyA, scope: "full" });
    await expect(
      query(users.owner, "SELECT mcp_resolve_job($1,'2710')", [companyB]),
    ).rejects.toThrow(/MCP_NO_COMPANY/);
  });
  it("permits another assigned member and contract scope to read the uploader's source", async () => {
    for (const user of [users.pm, users.contract]) {
      expect(
        await query(
          user,
          "SELECT created_by,job_id,company_id FROM mcp_spec_documents WHERE job_id=$1",
          [jobA],
        ),
      ).toEqual([{ created_by: users.owner, job_id: jobA, company_id: companyA }]);
      expect(
        await query(user, "SELECT name FROM storage.objects WHERE name=$1", [paths.a]),
      ).toEqual([{ name: paths.a }]);
    }
  });
  it("hides rows and original storage keys from other companies, unassigned PMs and limited Supers", async () => {
    for (const user of [users.outsider, users.otherPm, users.super]) {
      expect(
        await query(user, "SELECT id FROM mcp_spec_documents WHERE job_id=$1", [jobA]),
      ).toEqual([]);
      expect(
        await query(user, "SELECT name FROM storage.objects WHERE name=$1", [paths.a]),
      ).toEqual([]);
    }
    expect(
      await query(users.contract, "SELECT id FROM mcp_spec_documents WHERE job_id=$1", [
        restricted,
      ]),
    ).toEqual([]);
    expect(
      await query(users.contract, "SELECT name FROM storage.objects WHERE name=$1", [
        paths.restricted,
      ]),
    ).toEqual([]);
  });
  it("rejects fabricated company/job path combinations and cross-job source attachment", async () => {
    const malformed = `${companyB}/${jobA}/${uploadA}/Source.txt`;
    expect(
      (await query(users.owner, "SELECT mcp_document_path_scope($1) AS scope", [malformed]))[0]
        .scope,
    ).toBeNull();
    await expect(
      query(users.owner, "SELECT mcp_contract_document_save($1,$2::jsonb)", [
        jobA,
        JSON.stringify({
          kind: "spec",
          name: "Other.txt",
          body: "Wrong job",
          bucket: "athena-documents",
          path: paths.b,
          file_sha256: "ab".repeat(32),
          size_bytes: 10,
        }),
      ]),
    ).rejects.toThrow(/not stored on this job/);
  });
});
