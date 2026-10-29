/* eslint-disable @typescript-eslint/no-explicit-any -- actual PostgreSQL RPC fixtures */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";
import {
  readDrawingSets,
  readJobs,
  discoveryCompanies,
  jobsList,
  drawingSetsList,
} from "./tools/discovery-tools";
import { paletteViolations } from "./cards/palette";
import { claudeCardReply } from "./cards/claude-reply";

const owner = "00000000-0000-4000-8000-000000000601";
const outsider = "00000000-0000-4000-8000-000000000602";
const companies = [1, 2, 3, 4, 5].map(
  (n) => `00000000-0000-4000-8000-${String(610 + n).padStart(12, "0")}`,
);
let db: PGlite, sheetJob: string, sourceId: string;
const sb = (who = owner) =>
  fakeClient(db, { sub: who, email: "fictional@example.com", role: "authenticated" }) as any;

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261027130000_athena_drawing_versions.sql", "utf8"),
  );
  for (const uid of [owner, outsider]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [uid, `${uid}@example.com`]);
    await db.query("insert into test_active_members values($1)", [uid]);
  }
  for (let n = 0; n < companies.length; n++) {
    await db.query("insert into mcp_companies(id,name,created_by) values($1,$2,$3)", [
      companies[n],
      ["Fictional AOP", "Fictional ALP", "Fictional Test", "Fictional QA", "Foreign company"][n],
      n === 4 ? outsider : owner,
    ]);
    await db.query(
      "insert into mcp_company_members(company_id,user_id,role,display_name) values($1,$2,'owner','Fictional Owner')",
      [companies[n], n === 4 ? outsider : owner],
    );
    for (let k = 0; k < [2, 13, 4, 1, 1][n]; k++) {
      const number =
        n === 1 && k === 0 ? "2701" : n === 1 && k === 1 ? "CCW-003" : `${n + 1}-${k + 1}`;
      const r = await db.query<any>(
        "insert into mcp_jobs(company_id,user_id,name,job_number) values($1,$2,$3,$4) returning id",
        [companies[n], n === 4 ? outsider : owner, `Fictional ${number}`, number],
      );
      if (number === "CCW-003") sheetJob = r.rows[0].id;
    }
  }
  await db.exec(
    "create table mcp_user_settings(user_id uuid primary key,current_company uuid); alter table mcp_user_settings enable row level security; create policy own on mcp_user_settings to authenticated using(user_id=auth.uid());",
  );
  await db.query("insert into mcp_user_settings values($1,$2)", [owner, companies[0]]);
  const r = await sb().rpc("mcp_drawing_source_save", {
    _job: sheetJob,
    _record: {
      path: `${companies[1]}/${sheetJob}/drawing-fixture/source.pdf`,
      filename: "Fictional plans.pdf",
      source_key: "file:fictional",
      content_hash: "a".repeat(64),
      sheets: ["S-100", "A-200"],
    },
  });
  if (r.error) throw new Error(r.error.message);
  sourceId = r.data.id;
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("read-only portfolio discovery under actual RLS", () => {
  it("lists all 20 accessible jobs despite a two-job saved company", async () => {
    const r = await readJobs(sb());
    expect(r.structuredContent.counts).toEqual({ jobs: 20, companies: 4 });
    expect(r.structuredContent.jobs.map((j) => j.job_number)).toEqual(
      expect.arrayContaining(["2701", "CCW-003"]),
    );
    expect(r.structuredContent.companies.map((c) => c.name)).not.toContain("Foreign company");
    expect(r.structuredContent.companies).toHaveLength(4);
    expect(r.structuredContent.companies.map((c) => c.jobs.length)).toEqual([2, 13, 4, 1]);
  });
  it("filters an explicit company by name without changing the saved company", async () => {
    const r = await readJobs(sb(), "Fictional ALP");
    expect(r.structuredContent.counts.jobs).toBe(13);
    const current = await db.query<any>(
      "select current_company from mcp_user_settings where user_id=$1",
      [owner],
    );
    expect(current.rows[0].current_company).toBe(companies[0]);
  });
  it("refuses a company outside the caller's membership", async () => {
    await expect(readJobs(sb(), companies[4])).rejects.toThrow(/Choose one/);
    const r = await readJobs(sb(outsider));
    expect(r.structuredContent.counts).toEqual({ jobs: 1, companies: 1 });
    expect(r.structuredContent.jobs.every((j) => j.company_id === companies[4])).toBe(true);
  });
  it("does not change jobs, memberships, settings or drawing versions on repeat reads", async () => {
    const snapshot = async () =>
      (
        await db.query<any>(
          "select md5(jsonb_agg(t)::text) hash from (select to_jsonb(j) r from mcp_jobs j union all select to_jsonb(m) from mcp_company_members m union all select to_jsonb(s) from mcp_user_settings s union all select to_jsonb(v) from mcp_drawing_versions v) t",
        )
      ).rows[0].hash;
    const before = await snapshot();
    await readJobs(sb());
    await readJobs(sb());
    await readDrawingSets(sb(), "CCW-003");
    expect(await snapshot()).toBe(before);
  });
});

describe("stored drawing discovery", () => {
  it("survives an expired membership cache without changing the guarded function body or grants", async () => {
    const metadata = async () =>
      (
        await db.query<any>(
          "select provolatile,md5(prosrc) body,proacl::text acl from pg_proc where oid='public.mcp_drawing_records(uuid)'::regprocedure",
        )
      ).rows[0];
    const before = await metadata();
    const postgrestRead = async () => {
      const readOnly = (await metadata()).provolatile !== "v";
      return db.transaction(async (tx) => {
        if (readOnly) await tx.exec("SET TRANSACTION READ ONLY");
        await tx.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: owner, role: "authenticated" }),
        ]);
        await tx.exec("SET LOCAL ROLE authenticated");
        return (await tx.query<any>("select public.mcp_drawing_records($1) data", [sheetJob]))
          .rows[0].data;
      });
    };
    await db.query("delete from mcp_gate_cache where user_id=$1", [owner]);
    await expect(postgrestRead()).rejects.toThrow(/read.only/);
    await db.exec(
      readFileSync(
        "supabase/migrations/20261024114901_athena_drawing_library_read_compatibility.sql",
        "utf8",
      ),
    );
    expect(await metadata()).toEqual({ ...before, provolatile: "v" });
    expect((await postgrestRead()).map((s: { id: string }) => s.id)).toContain(sourceId);
  });
  it("returns IDs, revisions and sheet names without storage URLs, uploads or indexing", async () => {
    const r = await readDrawingSets(sb(), "CCW-003");
    expect(r.structuredContent.sources).toEqual([
      {
        source_id: sourceId,
        filename: "Fictional plans.pdf",
        revision: 1,
        sheets: ["S-100", "A-200"],
        created_at: expect.any(String),
      },
    ]);
    expect(JSON.stringify(r.structuredContent.sources)).not.toMatch(
      /source_url|storage_bucket|content_hash|drawing-fixture/,
    );
    expect(r.structuredContent.html).toContain("S-100");
    // Claude may receive only content text. Its real presentation pass must
    // retain the same usable source reference as the structured response.
    const reply = claudeCardReply(r, "drawing_sets_list") ?? r;
    expect(reply.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining(sourceId) }),
      ]),
    );
    expect(r.structuredContent.html).toContain(`Source ID · ${sourceId}</li>`);
  });
  it("does not substitute another company when an explicit filter lacks that job", async () => {
    await expect(readDrawingSets(sb(), "CCW-003", "Fictional AOP")).rejects.toThrow(
      /selected company/,
    );
    await expect(readDrawingSets(sb(outsider), "CCW-003")).rejects.toThrow();
  });
  it("shows an empty library without opening the import workflow", async () => {
    const r = await readDrawingSets(sb(), "1-1");
    expect(r.structuredContent.sources).toEqual([]);
    expect(r.structuredContent.html).toContain("No drawing set is stored");
  });
  it("declares both registered tools read-only and rejects ambiguous company names", () => {
    for (const t of [jobsList, drawingSetsList])
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    expect(() =>
      discoveryCompanies(
        [
          { id: "1", name: "Same" },
          { id: "2", name: "Same" },
        ],
        "Same",
      ),
    ).toThrow();
  });
});
