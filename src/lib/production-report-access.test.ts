import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeDb } from "../../tests/mcp-roles/db";
import { fakeClient } from "../../tests/mcp-roles/fake-supabase";
import {
  productionClient,
  productionDailyPath,
  productionReportPath,
  readProductionDaily,
  readProductionReport,
} from "./production-report";

const id = (n: number) => `73000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1),
  superUser = id(2),
  estimator = id(3),
  outsider = id(4),
  inactive = id(5),
  company = id(10),
  job = id(11),
  d1 = id(12),
  d2 = id(13);
let db: Awaited<ReturnType<typeof makeDb>>;
const client = (user = owner) =>
  productionClient(
    fakeClient(db, { sub: user, email: "fixture@example.invalid", role: "authenticated" }),
  );
const options = { from_date: "2026-10-28", to_date: "2026-10-29" };
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
  );
  for (const file of [
    "20261020213000_athena_living_reports",
    "20261021000000_athena_file_shares",
    "20261021120000_athena_report_pages",
    "20261021210000_athena_report_pages_lookahead_payapp_briefing",
    "20261022200000_athena_estimating",
    "20261023020000_athena_superintendent",
    "20261023220000_athena_submittal_log",
  ]) {
    let sql = readFileSync(`supabase/migrations/${file}.sql`, "utf8");
    if (file.endsWith("submittal_log"))
      sql = sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.mcp_board_link_open"));
    await db.exec(sql);
  }
  await db.exec(readFileSync("release-proposals/report-read-compatibility.sql", "utf8"));
  for (const user of [owner, superUser, estimator, outsider, inactive])
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'fixture@example.invalid')", [
      user,
    ]);
  for (const user of [owner, superUser, estimator, outsider])
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'ALP Construction',$2)",
    [company, owner],
  );
  for (const [user, role] of [
    [owner, "owner"],
    [superUser, "super"],
    [estimator, "estimating"],
    [inactive, "owner"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,$3,'Member')",
      [company, user, role],
    );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES ($1,$2,$3,'2708','Cedar Grove','America/Chicago')",
    [job, owner, company],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
    job,
    superUser,
    owner,
  ]);
  for (const [daily, date] of [
    [d1, "2026-10-28"],
    [d2, "2026-10-29"],
  ])
    await db.query(
      "INSERT INTO mcp_daily_reports(id,job_id,company_id,report_date,weather,manpower,subs_on_site,deliveries,issues,delays,safety) VALUES ($1,$2,$3,$4,'Clear','Crew on site','None','None','None','None','No incidents')",
      [daily, job, company, date],
    );
  for (const [daily, n, qty, crew, hours, unit, work] of [
    [d1, 1, 180, 4, 7.5, "LF", "West wing conduit"],
    [d1, 2, 24, 2, 3, "EA", "Outlet boxes"],
    [d2, 1, 210, 6, 7, "LF", "East wing conduit"],
  ] as const) {
    await db.query(
      "INSERT INTO mcp_daily_work_lines(daily_id,job_id,company_id,line_no,work,sov_item,activity_id,qty,unit,crew,hours) VALUES ($1,$2,$3,$4,$5,'26.04','E090',$6,$7,$8,$9)",
      [daily, job, company, n, work, qty, unit, crew, hours],
    );
    await db.query(
      "INSERT INTO mcp_production_rates(job_id,company_id,daily_id,work,sov_item,activity_id,qty,unit,crew,hours,man_hours,qty_per_man_hour) VALUES ($1,$2,$3,$4,'26.04','E090',$5,$6,$7,$8,$7::numeric*$8::numeric,$5::numeric/($7::numeric*$8::numeric))",
      [job, company, daily, work, qty, unit, crew, hours],
    );
  }
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("authenticated dated production report", () => {
  it("reads real scoped daily rows and preserves weighted rates, separate units and source dates", async () => {
    const before = await db.query(
      "SELECT jsonb_agg(to_jsonb(r) ORDER BY id) data FROM mcp_production_rates r",
    );
    const report = await readProductionReport(client(), job, options);
    expect(report).toMatchObject({
      company: "ALP Construction",
      job_number: "2708",
      time_zone_used: "America/Chicago",
      complete: true,
      reports_count: 2,
      planned_rate: null,
      earned_value: null,
    });
    expect(report.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          quantity: 390,
          reported_person_hours: 72,
          actual_rate: 390 / 72,
          unit: "LF",
        }),
        expect.objectContaining({
          quantity: 24,
          reported_person_hours: 6,
          actual_rate: 4,
          unit: "EA",
        }),
      ]),
    );
    expect(report.rows.map((r) => r.report_date)).toEqual([
      "2026-10-28",
      "2026-10-28",
      "2026-10-29",
    ]);
    expect(
      await db.query("SELECT jsonb_agg(to_jsonb(r) ORDER BY id) data FROM mcp_production_rates r"),
    ).toEqual(before);
  });
  it("keeps the date-specific source daily distinct from the latest daily", async () => {
    const day = await readProductionDaily(client(), job, "2026-10-28");
    expect(day).toMatchObject({ found: true, report_date: "2026-10-28", job_number: "2708" });
    expect(day.lines?.map((r) => Number(r.qty))).toEqual([180, 24]);
    expect(day.lines?.some((r) => r.work?.includes("East"))).toBe(false);
    expect(productionDailyPath(job, "2026-10-28")).toBe(`/r/job/${job}/daily?date=2026-10-28`);
  });
  it("keeps empty production and a missing daily explicit without inventing rates", async () => {
    expect(
      await readProductionReport(client(), job, { from_date: "2026-10-01", to_date: "2026-10-02" }),
    ).toMatchObject({ complete: true, reports_count: 0, rows: [], groups: [], planned_rate: null });
    expect(await readProductionDaily(client(), job, "2026-10-01")).toMatchObject({
      found: false,
      report_date: "2026-10-01",
    });
  });
  it("permits an assigned superintendent but rejects estimating, other-company and inactive members", async () => {
    expect((await readProductionReport(client(superUser), job, options)).rows).toHaveLength(3);
    for (const user of [estimator, outsider, inactive]) {
      await expect(readProductionReport(client(user), job, options)).rejects.toThrow(
        "currently unavailable",
      );
      await expect(readProductionDaily(client(user), job, "2026-10-28")).rejects.toThrow(
        "currently unavailable",
      );
    }
  });
  it("opens after cold and expired membership cache through the existing 0042 entry point", async () => {
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    expect((await readProductionReport(client(), job, options)).rows).toHaveLength(3);
    await db.query(
      "UPDATE mcp_gate_cache SET checked_at=now()-interval '10 minutes' WHERE user_id=$1",
      [owner],
    );
    expect((await readProductionReport(client(), job, options)).rows).toHaveLength(3);
  });
  it("uses job-local dates and rejects invalid, incomplete and excessive periods", async () => {
    expect(
      (await readProductionReport(client(), job, {}, new Date("2026-10-30T02:00:00Z"))).period,
    ).toEqual({ from: "2026-10-23", to: "2026-10-29" });
    expect(
      (
        await readProductionReport(
          client(),
          job,
          { range: "this_week" },
          new Date("2026-10-30T02:00:00Z"),
        )
      ).period,
    ).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    await expect(readProductionReport(client(), job, { from_date: "2026-10-28" })).rejects.toThrow(
      "both dates",
    );
    await expect(
      readProductionReport(client(), job, { from_date: "2026-10-01", to_date: "2026-11-01" }),
    ).rejects.toThrow("31 days");
    await expect(readProductionDaily(client(), job, "2026-02-30")).rejects.toThrow(
      "valid production dates",
    );
    expect(() => productionReportPath(job, { from: "2026-02-30", to: "2026-03-01" })).toThrow();
  });
  it("never reads source tables after the member/job gate fails", async () => {
    let tableReads = 0;
    const denied = productionClient({
      rpc: async () => ({ data: null, error: { message: "denied", code: "P0001" } }),
      from: () => {
        tableReads++;
        throw new Error("should not read");
      },
    });
    await expect(readProductionReport(denied, job, options)).rejects.toMatchObject({
      code: "P0001",
    });
    expect(tableReads).toBe(0);
  });
});
