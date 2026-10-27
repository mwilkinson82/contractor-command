// Real MCP handler and authorization over isolated in-process Postgres fixtures.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("./supabase", async () => ({
  supabaseForUser: (await import("../../../tests/mcp-roles/harness")).mockedSupabaseForUser,
}));
vi.mock("./allowlist", async () => {
  const h = await import("../../../tests/mcp-roles/harness");
  return { MCP_ALLOWED_EMAILS: new Set([h.user("owner").email, h.user("super").email]) };
});
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { setLogLevel } from "@lovable.dev/mcp-js";
import mcp from "./index";
import { bootDb, callTool, setupKeysAndFetch, state, user } from "../../../tests/mcp-roles/harness";
setLogLevel("error");
const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
let tok: Awaited<ReturnType<typeof setupKeysAndFetch>>;
const job = "20000000-0000-4000-8000-000000000001";
const company = "20000000-0000-4000-8000-000000000002";
const sov = "20000000-0000-4000-8000-000000000003";
const cpm = "20000000-0000-4000-8000-000000000004";
const call = async (role: "owner" | "super", name: string, args: Record<string, unknown>) =>
  callTool(handler, await tok(role), name, args);
beforeAll(async () => {
  tok = await setupKeysAndFetch();
  const db = await bootDb();
  await db.exec(`CREATE TABLE public.mcp_living_reports(id uuid PRIMARY KEY,job_id uuid,report_type text,version integer,status text,data jsonb);
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.mcp_file_path_scope(text) RETURNS text LANGUAGE sql AS $$ SELECT 'full'::text $$;`);
  await db.exec(
    readFileSync("supabase/migrations/20261023020000_athena_superintendent.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261101120002_athena_approved_production_mapping.sql",
      "utf8",
    ),
  );
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'TEST production',$2)", [
    company,
    user("owner").id,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','TEST owner'),($1,$3,'super','TEST super')",
    [company, user("owner").id, user("super").id],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES ($1,$2,$3,'TEST-P','TEST production')",
    [job, user("owner").id, company],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
    job,
    user("super").id,
    user("owner").id,
  ]);
  await db.query(
    "INSERT INTO mcp_job_facts(id,job_id,module,key,value,status,source,updated_by) VALUES ($1,$2,'sov','26.04',$3::jsonb,'known','member_answer',$4)",
    [
      sov,
      job,
      JSON.stringify({ description: "TEST conduit", billable_value: 100000 }),
      user("owner").id,
    ],
  );
  await db.query("INSERT INTO mcp_living_reports VALUES ($1,$2,'cpm',1,'approved',$3::jsonb)", [
    cpm,
    job,
    JSON.stringify({ activities: [{ id: "E090", name: "TEST conduit" }] }),
  ]);
});
describe("approved production MCP workflow", () => {
  it("reviews, approves and records work through the authenticated tools", async () => {
    const sources = await call("owner", "production_mapping_sources", { job_number: "TEST-P" });
    expect(sources.isError, sources.text).toBe(false);
    expect(sources.structured?.cpm_id).toBe(cpm);
    const alloc = [
      {
        sov_fact_id: sov,
        activity_id: "E090",
        allocated_cents: 10000000,
        planned_quantity: 1000,
        unit: "LF",
        planned_man_hours: 250,
        planned_source: "TEST plan",
      },
    ];
    const draft = await call("owner", "production_mapping_preview", {
      job_number: "TEST-P",
      cpm_id: cpm,
      effective_date: "2026-10-26",
      reason: "TEST plan",
      allocations: alloc,
    });
    expect(draft.isError, draft.text).toBe(false);
    const reviewed = draft.structured!;
    expect(draft.text).toContain("SOV 26.04 (TEST conduit)");
    const approve = await call("owner", "production_mapping_approve", {
      job_number: "TEST-P",
      cpm_id: cpm,
      base_version: reviewed.base_version,
      effective_date: reviewed.effective_date,
      reason: reviewed.reason,
      request_key: reviewed.request_key,
      preview: reviewed.preview,
      allocations: alloc,
      confirmed: true,
    });
    expect(approve.isError, approve.text).toBe(false);
    const work = [
      {
        work: "TEST conduit",
        sov_item: "26.04",
        activity_id: "E090",
        qty: 300,
        unit: "LF",
        crew: 4,
        hours: 20,
      },
    ];
    const fields = {
      job_number: "TEST-P",
      report_date: "2026-10-26",
      weather: "clear",
      manpower: "crew",
      subs_on_site: "none",
      deliveries: "none",
      issues: "none",
      delays: "none",
      safety: "none",
      work,
    };
    const daily = await call("super", "daily_report_draft", fields);
    expect(daily.isError, daily.text).toBe(false);
    expect(daily.structured?.ready).toBe(true);
    const assembled = daily.structured!.draft as { work: unknown[] };
    const saved = await call("super", "daily_report_save", {
      ...fields,
      work: assembled.work,
      confirmed: true,
      expected_revision: daily.structured!.expected_revision,
      request_key: daily.structured!.request_key,
    });
    expect(saved.isError, saved.text).toBe(false);
    const replay = await call("super", "daily_report_save", {
      ...fields,
      work: assembled.work,
      confirmed: true,
      expected_revision: daily.structured!.expected_revision,
      request_key: daily.structured!.request_key,
    });
    expect(replay.isError, replay.text).toBe(false);
    expect(replay.structured?.replayed).toBe(true);
    const secondFields = {
      ...fields,
      report_date: "2026-10-27",
      work: [{ ...work[0], qty: 700, crew: 5, hours: 35 }],
    };
    const secondDraft = await call("super", "daily_report_draft", secondFields);
    expect(secondDraft.isError, secondDraft.text).toBe(false);
    const secondWork = (secondDraft.structured!.draft as { work: unknown[] }).work;
    const secondSaved = await call("super", "daily_report_save", {
      ...secondFields,
      work: secondWork,
      confirmed: true,
      expected_revision: secondDraft.structured!.expected_revision,
      request_key: secondDraft.structured!.request_key,
    });
    expect(secondSaved.isError, secondSaved.text).toBe(false);
    const weekly = await call("super", "weekly_production", {
      job_number: "TEST-P",
      from: "2026-10-26",
      to: "2026-11-01",
    });
    expect(weekly.isError, weekly.text).toBe(false);
    expect(weekly.text).toContain(
      "period 1000 LF, 255 person-hours, actual 3.92 LF/person-hour; planned 4.00 LF/person-hour",
    );
    expect(weekly.text).not.toContain("$100,000");
    const correctionFields = { ...fields, work: [{ ...work[0], qty: 320 }] };
    const correction = await call("super", "daily_report_draft", correctionFields);
    const correctionWork = (correction.structured!.draft as { work: unknown[] }).work;
    const revised = await call("super", "daily_report_save", {
      ...correctionFields,
      work: correctionWork,
      confirmed: true,
      expected_revision: correction.structured!.expected_revision,
      request_key: correction.structured!.request_key,
      correction_reason: "TEST correction",
    });
    expect(revised.isError, revised.text).toBe(false);
    const got = await call("super", "daily_report_get", {
      job_number: "TEST-P",
      report_date: "2026-10-26",
    });
    expect(got.isError, got.text).toBe(false);
    const revision = got.structured!.revision as { lines: { revision_line_id: string }[] };
    const photo = "20000000-0000-4000-8000-000000000005";
    await state.db!.query(
      "INSERT INTO mcp_progress_photos(id,job_id,company_id,taken_on,area,storage_path,mime_type,size_bytes) VALUES ($1,$2,$3,'2026-10-26','TEST','test/path','image/jpeg',1)",
      [photo, job, company],
    );
    const link = await call("super", "production_photo_associate", {
      job_number: "TEST-P",
      photo_id: photo,
      revision_line_id: revision.lines[0].revision_line_id,
      request_key: got.structured!.photo_association_request_key,
    });
    expect(link.isError, link.text).toBe(false);
  });
});
