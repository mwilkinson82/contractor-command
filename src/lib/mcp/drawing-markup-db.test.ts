import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherJob = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const owner = "00000000-0000-4000-8000-000000000010";
const outsider = "00000000-0000-4000-8000-000000000011";
const estimator = "00000000-0000-4000-8000-000000000012";
const superId = "00000000-0000-4000-8000-000000000013";
const claims = (sub = owner) => ({
  sub,
  email: `test-${sub.slice(-2)}@example.com`,
  role: "authenticated" as const,
});
let db: PGlite;
const query = async (sql: string, args: unknown[] = [], who = owner) =>
  asUser(db, claims(who), async (tx) => (await tx.query(sql, args)).rows);
const path = (name = "drawing-hash/source.pdf", j = job) => `${company}/${j}/${name}`;
const src = (hash = "a".repeat(64), key = "drive:test") => ({
  path: path(),
  filename: "set.pdf",
  source_key: key,
  source_url: "https://drive.google.com/file/d/test/view",
  content_hash: hash,
  sheets: ["Cover", "S-100"],
});
const save = async (record = src(), j = job, who = owner) =>
  (
    await query(
      "SELECT public.mcp_drawing_source_save($1,$2::jsonb) AS data",
      [j, JSON.stringify(record)],
      who,
    )
  )[0].data;
beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/20261027120000_athena_drawing_versions.sql", "utf8"),
  );
  for (const id of [owner, outsider, estimator, superId]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [id, claims(id).email]);
    await db.query("INSERT INTO public.test_active_members VALUES ($1)", [id]);
  }
  await db.query(
    "INSERT INTO public.mcp_companies(id,name,created_by) VALUES ($1,'Test Construction',$2)",
    [company, owner],
  );
  for (const [id, role] of [
    [owner, "owner"],
    [estimator, "estimating"],
    [superId, "super"],
  ])
    await db.query(
      "INSERT INTO public.mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,$3,'Test Person')",
      [company, id, role],
    );
  for (const j of [job, otherJob])
    await db.query(
      "INSERT INTO public.mcp_jobs(id,user_id,name,job_number,company_id) VALUES ($1,$2,'Test Job',$3,$4)",
      [j, owner, j === job ? "2701" : "OTHER", company],
    );
  await db.query("INSERT INTO public.mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
    job,
    superId,
    owner,
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("drawing version migration, real Postgres permissions", () => {
  it("deduplicates source identity, revisions changed bytes, keeps all originals and source links", async () => {
    const first = await save();
    const repeat = await save();
    expect(first.id).toBe(repeat.id);
    expect(first.version).toBe(1);
    const second = await save({ ...src("b".repeat(64)), path: path("drawing-revised/source.pdf") });
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
    const rows = (await query("SELECT public.mcp_drawing_records($1) AS data", [job]))[0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(second.id);
    expect(rows[1].path).toBe(first.path);
    expect(rows[1].source_url).toContain("drive.google.com");
  });
  it("numbers dated markup copies per original sheet, preserves source hash, and denies cross-job parents", async () => {
    const source = await save();
    const record = {
      path: path("drawing-markup-one/S-100.pdf"),
      filename: "S-100.pdf",
      content_hash: "c".repeat(64),
      sheet: "S-100",
      page: 2,
      annotations: [{ label: "1", text: "Test finding", severity: "callout" }],
    };
    const first = (
      await query("SELECT public.mcp_drawing_markup_save($1,$2,$3::jsonb) AS data", [
        job,
        source.id,
        JSON.stringify(record),
      ])
    )[0].data;
    const next = (
      await query("SELECT public.mcp_drawing_markup_save($1,$2,$3::jsonb) AS data", [
        job,
        source.id,
        JSON.stringify({ ...record, path: path("drawing-markup-two/S-100.pdf") }),
      ])
    )[0].data;
    expect(first.version).toBe(1);
    expect(next.version).toBe(2);
    expect(next.created_at).toMatch(/^\d{4}-/);
    expect(next.parent_id).toBe(source.id);
    expect(next.path).not.toBe(source.path);
    expect(
      (
        await db.query<{ content_hash: string }>(
          "SELECT content_hash FROM public.mcp_drawing_versions WHERE id=$1",
          [source.id],
        )
      ).rows[0].content_hash,
    ).toBe("a".repeat(64));
    await expect(
      query("SELECT public.mcp_drawing_markup_save($1,$2,$3::jsonb)", [
        otherJob,
        source.id,
        JSON.stringify(record),
      ]),
    ).rejects.toThrow(/not found/);
    await expect(
      query("SELECT public.mcp_drawing_markup_save($1,$2,$3::jsonb)", [
        job,
        source.id,
        JSON.stringify({ ...record, page: 1 }),
      ]),
    ).rejects.toThrow(/Sheet does not match/);
  });
  it("records a changed-back source as a new revision while reusing its original object", async () => {
    const first = await save(src("1".repeat(64), "drive:reverted"));
    await save({
      ...src("2".repeat(64), "drive:reverted"),
      path: path("drawing-revision-two/source.pdf"),
    });
    const third = await save(src("1".repeat(64), "drive:reverted"));
    expect(third.version).toBe(3);
    expect(third.path).toBe(first.path);
    expect(third.id).not.toBe(first.id);
  });
  it("enforces active membership and job roles at every function; contract scope is allowed, supers and outsiders denied", async () => {
    await expect(save(src(), job, outsider)).rejects.toThrow(/MCP_NO_JOB/);
    await expect(save(src(), job, superId)).rejects.toThrow(/access to the estimate/);
    const read = await query("SELECT public.mcp_drawing_records($1) AS data", [job], estimator);
    expect(read[0].data.length).toBeGreaterThan(0);
    const source = await save(src("e".repeat(64), "file:estimator.pdf"), job, estimator);
    expect(source.created_by).toBe(estimator);
    await db.query("DELETE FROM public.test_active_members WHERE user_id=$1", [estimator]);
    await db.query("DELETE FROM public.mcp_gate_cache WHERE user_id=$1", [estimator]);
    await expect(
      query("SELECT public.mcp_drawing_records($1)", [job], estimator),
    ).rejects.toThrow();
  });
  it("revokes direct reads and all member mutations, including sources and saved markups", async () => {
    await expect(query("SELECT * FROM public.mcp_drawing_versions")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      query("UPDATE public.mcp_drawing_versions SET filename='changed.pdf'"),
    ).rejects.toThrow(/permission denied/);
    await expect(query("DELETE FROM public.mcp_drawing_versions")).rejects.toThrow(
      /permission denied/,
    );
    const flags = await db.query<{
      rls: boolean;
      insert: boolean;
      update: boolean;
      delete: boolean;
    }>(
      "SELECT relrowsecurity AS rls, has_table_privilege('authenticated',oid,'INSERT') AS insert, has_table_privilege('authenticated',oid,'UPDATE') AS update, has_table_privilege('authenticated',oid,'DELETE') AS delete FROM pg_class WHERE oid='public.mcp_drawing_versions'::regclass",
    );
    expect(flags.rows[0]).toEqual({ rls: true, insert: false, update: false, delete: false });
  });
  it("rejects foreign/traversal paths and has no anonymous function access", async () => {
    await expect(save({ ...src(), path: `other/${job}/drawing-hash/source.pdf` })).rejects.toThrow(
      /Invalid drawing path/,
    );
    await expect(save({ ...src(), path: path("drawing-../source.pdf") })).rejects.toThrow(
      /Invalid drawing path/,
    );
    const p = await db.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('anon','public.mcp_drawing_records(uuid)','execute') AS allowed",
    );
    expect(p.rows[0].allowed).toBe(false);
  });
});
