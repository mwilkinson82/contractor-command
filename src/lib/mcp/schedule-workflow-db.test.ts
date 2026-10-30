// Synthetic local users/jobs only. Real OAuth handler, real membership/job scope,
// real tools and existing versioned-save SQL; no production connection.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("./supabase", async () => ({
  supabaseForUser: (await import("../../../tests/mcp-roles/harness")).mockedSupabaseForUser,
}));
vi.mock("./allowlist", async () => {
  const h = await import("../../../tests/mcp-roles/harness");
  return {
    MCP_ALLOWED_EMAILS: new Set(
      ["owner", "pm", "super", "estimating", "outsider"].map((r) => h.user(r as never).email),
    ),
  };
});
vi.mock("../../integrations/supabase/client.server", async () => {
  const h = await import("../../../tests/mcp-roles/harness"),
    f = await import("../../../tests/mcp-roles/fake-supabase");
  return {
    get supabaseAdmin() {
      const u = h.user("owner");
      return f.fakeClient(h.state.db!, { sub: u.id, email: u.email, role: "service_role" });
    },
  };
});
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import {
  bootDb,
  setupKeysAndFetch,
  callTool,
  state,
  user,
  type Role,
} from "../../../tests/mcp-roles/harness";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";
import { prepareSchedule, readScheduleControl } from "./schedule-control";
import type { Activity } from "./living";
import type { ScheduleRequest, ScheduleSettings } from "./schedule-schema";

const company = "00000000-0000-4000-8000-000000000811",
  otherCompany = "00000000-0000-4000-8000-000000000812";
const job = "00000000-0000-4000-8000-000000000813",
  otherJob = "00000000-0000-4000-8000-000000000814";
const settings: ScheduleSettings = {
  project_start: "2026-10-05",
  default_calendar_id: "work",
  calendars: [{ id: "work", name: "Mon–Fri", work_days: 62, holidays: [], hours_per_day: 8 }],
  finish_convention: "inclusive-last-work-day",
  out_of_sequence: "retained-logic",
};
const activity = (id: string, value: number, extra: Partial<Activity> = {}): Activity => ({
  id,
  name: `Synthetic ${id}`,
  duration: 5,
  start: null,
  finish: null,
  total_float: null,
  critical: null,
  predecessors: [],
  pct_complete: 0,
  value,
  sov_line: "26.01",
  cost_code: "26-010",
  ...extra,
});
const initial: ScheduleRequest = {
  operation: "recalculate",
  data_date: "2026-10-05",
  settings,
  starter_wbs: true,
  initial_activities: [
    activity("A", 1000),
    activity("B", 0, { predecessors: [{ id: "A" }] }),
    activity("M", 0, { duration: 0, predecessors: [{ id: "B" }] }),
  ],
};
let handler: ReturnType<typeof createTanStackMcpHandler>,
  token: Awaited<ReturnType<typeof setupKeysAndFetch>>;
const call = async (
  name: string,
  args: Record<string, unknown>,
  who: Role | "outsider" = "owner",
) =>
  callTool(handler, await token(who), name, { job_number: "SYN-1", company_id: company, ...args });
const saved = async (version?: number) => {
  const u = user("owner"),
    sb = fakeClient(state.db!, { sub: u.id, email: u.email, role: "authenticated" });
  const r = await sb.rpc("mcp_living_report_get", {
    _job: job,
    _type: "cpm",
    _version: version ?? null,
  });
  if (r.error) throw new Error(r.error.message);
  return r.data as any;
};
beforeAll(async () => {
  vi.stubEnv("VITE_SUPABASE_PROJECT_ID", "qcbbjjjxcacrscfhgfmf");
  token = await setupKeysAndFetch();
  const db = await bootDb();
  await db.exec(
    readFileSync("supabase/migrations/20261020213000_athena_living_reports.sql", "utf8"),
  );
  const beforePrivacy = (
    await db.query(
      "SELECT proacl::text acl,provolatile volatility,prosecdef definer,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid='public.mcp_living_strip_money(jsonb)'::regprocedure",
    )
  ).rows;
  await db.exec(readFileSync("drizzle/migrations/0048_schedule_control_privacy.sql", "utf8"));
  expect(
    (
      await db.query(
        "SELECT proacl::text acl,provolatile volatility,prosecdef definer,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid='public.mcp_living_strip_money(jsonb)'::regprocedure",
      )
    ).rows,
  ).toEqual(beforePrivacy);
  for (const [co, owner] of [
    [company, user("owner").id],
    [otherCompany, user("pm2").id],
  ]) {
    await db.query("INSERT INTO mcp_companies(id,name,created_by,is_test) VALUES($1,$2,$3,true)", [
      co,
      co === company ? "Synthetic primary" : "Synthetic other",
      owner,
    ]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Synthetic owner')",
      [co, owner],
    );
  }
  for (const role of ["pm", "super", "estimating"] as const)
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic member')",
      [company, user(role).id, role],
    );
  for (const [j, co, owner] of [
    [job, company, user("owner").id],
    [otherJob, otherCompany, user("pm2").id],
  ]) {
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone,sov_fee_pct) VALUES($1,$2,$3,'SYN-1','Synthetic schedule','Etc/UTC',0)",
      [j, owner, co],
    );
    await db.query(
      "INSERT INTO mcp_job_facts(job_id,module,key,value,source,updated_by) VALUES($1,'sov','26.01',$2::jsonb,'member_answer',$3)",
      [j, JSON.stringify({ description: "Synthetic electrical", billable_value: 1000 }), owner],
    );
  }
  for (const role of ["pm", "super"] as const)
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job,
      user(role).id,
      user("owner").id,
    ]);
  const mcp = (await import("./index")).default;
  handler = createTanStackMcpHandler(mcp, {
    resourcePath: "/mcp",
    metadataPath: "/.well-known/oauth-protected-resource",
  });
}, 120000);
afterAll(async () => {
  await state.db?.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("schedule customer journey through real OAuth and local SQL", () => {
  it("discovers the new read-only workflow and rejects unauthenticated/no-client-claim access", async () => {
    const noAuth = await callTool(handler, null, "schedule_workflow", {
      job_number: "SYN-1",
      action: "inspect",
    });
    expect(noAuth.isError || noAuth.status === 401).toBe(true);
    const noClaim = await callTool(
      handler,
      await token("owner", { clientId: null }),
      "schedule_workflow",
      { job_number: "SYN-1", action: "inspect" },
    );
    expect(noClaim.isError || noClaim.status === 401).toBe(true);
  });
  it("prepares without writing a report, saves once, and refuses stale/repeated requests", async () => {
    const preview = await call("schedule_workflow", {
      action: "prepare",
      base_version: 0,
      request: initial,
    });
    expect(preview.isError, preview.text).toBe(false);
    expect(preview.structured).toMatchObject({
      saved: false,
      base_version: 0,
      prepared: { control: { calculation: { status: "calculated" } } },
    });
    expect((await saved()).found).toBe(false);
    const args = {
      report_type: "cpm",
      base_version: 0,
      approved: true,
      what_changed: "Synthetic first calculated schedule",
      schedule_request: initial,
    };
    const result = await call("living_report_save", args);
    expect(result.isError, result.text).toBe(false);
    expect(result.structured.version).toBe(1);
    const replay = await call("living_report_save", args);
    expect(replay.isError).toBe(true);
    expect(replay.text).toContain("changed since you loaded");
    expect((await saved()).version).toBe(1);
  });
  it("captures baseline and preserves prior versions while organizing/revising", async () => {
    const baseline = await call("living_report_save", {
      report_type: "cpm",
      base_version: 1,
      approved: true,
      what_changed: "Capture synthetic baseline",
      schedule_request: {
        operation: "baseline",
        data_date: "2026-10-05",
        baseline: { id: "BL", name: "Synthetic baseline", status: "accepted" },
      },
    });
    expect(baseline.isError, baseline.text).toBe(false);
    const before = await saved(1);
    const change = await call("living_report_save", {
      report_type: "cpm",
      base_version: 2,
      approved: true,
      what_changed: "Organize electrical work",
      schedule_request: {
        operation: "organize",
        data_date: "2026-10-05",
        assignments: [{ activity_id: "B", wbs_id: "construction" }],
      },
    });
    expect(change.isError, change.text).toBe(false);
    expect((await saved(1)).data).toEqual(before.data);
    expect((await saved()).data.activities[1].wbs_id).toBe("construction");
    expect(readScheduleControl((await saved()).data)!.baselines[0].source_version).toBe(1);
    const stale = await call("living_report_save", {
      report_type: "cpm",
      base_version: 2,
      approved: true,
      what_changed: "Stale",
      schedule_request: { operation: "organize", data_date: "2026-10-05" },
    });
    expect(stale.isError).toBe(true);
    expect((await saved()).version).toBe(3);
  });
  it("rejects identity loss, actual-history changes, raw bypass and conflicting overrides", async () => {
    const raw = await call("living_report_save", {
      report_type: "cpm",
      base_version: 3,
      approved: true,
      what_changed: "Raw replacement",
      data_date: "2026-10-05",
      activities: (await saved()).data.activities,
    });
    expect(raw.isError).toBe(true);
    expect(raw.text).toContain("controlled scheduling");
    const bad = await call("living_report_save", {
      report_type: "cpm",
      base_version: 3,
      approved: true,
      what_changed: "Unknown ID",
      schedule_request: {
        operation: "recalculate",
        data_date: "2026-10-05",
        updates: [{ id: "OTHER-JOB-A", duration: 1 }],
      },
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Unknown activity");
    const mixed = await call("living_report_save", {
      report_type: "cpm",
      base_version: 3,
      approved: true,
      what_changed: "Conflicting date",
      data_date: "2026-10-06",
      schedule_request: { operation: "organize", data_date: "2026-10-05" },
    });
    expect(mixed.isError).toBe(true);
    expect((await saved()).version).toBe(3);
  });
  it("enforces the existing SOV reconciliation rather than treating schedule progress as billing", async () => {
    const result = await call("living_report_save", {
      report_type: "cpm",
      base_version: 3,
      approved: true,
      what_changed: "Unreconciled value",
      schedule_request: {
        operation: "recalculate",
        data_date: "2026-10-05",
        updates: [{ id: "A", value: 900 }],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Doesn't tie");
    expect((await saved()).version).toBe(3);
  });
  it("isolates companies/jobs with the same job number and keeps restricted roles from preparing/saving", async () => {
    const cross = await call("schedule_workflow", { action: "inspect", company_id: otherCompany });
    expect(cross.structured?.found).not.toBe(true);
    expect(cross.text).not.toContain("Synthetic other");
    for (const role of ["super", "estimating", "outsider"] as const) {
      expect((await call("schedule_workflow", { action: "inspect" }, role)).isError).toBe(true);
      expect(
        (
          await call(
            "living_report_save",
            {
              report_type: "cpm",
              base_version: 3,
              approved: true,
              what_changed: "Not authorized",
              schedule_request: { operation: "organize", data_date: "2026-10-05" },
            },
            role,
          )
        ).isError,
      ).toBe(true);
    }
    const count = await state.db!.query<{ n: number }>(
      "SELECT count(*)::int n FROM mcp_living_reports WHERE job_id=$1",
      [otherJob],
    );
    expect(count.rows[0].n).toBe(0);
  });
  it("keeps baseline financial values out of the database superintendent schedule response", async () => {
    const u = user("super"),
      sb = fakeClient(state.db!, { sub: u.id, email: u.email, role: "authenticated" });
    const result = await sb.rpc("mcp_living_report_get", {
      _job: job,
      _type: "cpm",
      _version: null,
    });
    expect(result.error).toBeNull();
    const d = result.data as any;
    expect(d.contract_total).toBeNull();
    expect(JSON.stringify(d.data)).not.toContain('"value":1000');
    expect(readScheduleControl(d.data)!.baselines[0].activities.every((a) => a.value == null)).toBe(
      true,
    );
  });
  it("retains the native version-check protection when two calculated writes race", async () => {
    const d = await saved(),
      prepared = prepareSchedule(d.data, 3, {
        operation: "organize",
        data_date: "2026-10-05",
        assignments: [{ activity_id: "M", wbs_id: "general-requirements" }],
      });
    const u = user("owner"),
      sb = fakeClient(state.db!, { sub: u.id, email: u.email, role: "authenticated" });
    const args = {
      _job: job,
      _type: "cpm",
      _base_version: 3,
      _data: prepared.data,
      _data_date: "2026-10-05",
      _activity_count: 3,
      _contract_total: 1000,
      _forecast_total: 1000,
      _what: "Synthetic race",
      _why: null,
      _who: "Synthetic owner",
      _completion: null,
      _replace_completion: false,
    };
    const results = await Promise.all([
      sb.rpc("mcp_living_report_save", args),
      sb.rpc("mcp_living_report_save", args),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error)).toHaveLength(1);
    expect((await saved()).version).toBe(4);
    expect((await saved(1)).data.activities[1].wbs_id).toBeUndefined();
  });
  it("saves actuals and a calculated scenario while preserving historical and financial evidence", async () => {
    const actuals = await call("living_report_save", {
      report_type: "cpm",
      base_version: 4,
      approved: true,
      what_changed: "Record evidenced actuals",
      schedule_request: {
        operation: "recalculate",
        data_date: "2026-10-08",
        updates: [{ id: "A", actual_start: "2026-10-05", remaining_duration: 3, pct_complete: 40 }],
      },
    });
    expect(actuals.isError, actuals.text).toBe(false);
    const correction = await call("living_report_save", {
      report_type: "cpm",
      base_version: 5,
      approved: true,
      what_changed: "Rewrite actual history",
      schedule_request: {
        operation: "recalculate",
        data_date: "2026-10-08",
        updates: [{ id: "A", actual_start: "2026-10-06" }],
      },
    });
    expect(correction.isError).toBe(true);
    expect(correction.text).toContain("actual history");
    const scenario = await call("living_report_save", {
      report_type: "cpm",
      base_version: 5,
      approved: true,
      what_changed: "Model one sourced delay",
      schedule_request: {
        operation: "tia",
        data_date: "2026-10-08",
        delay: {
          event_id: "E1",
          description: "Synthetic redesign",
          event_date: "2026-10-08",
          source_refs: ["synthetic event"],
          assumptions: ["Two working days; fictional fixture"],
          add_activities: [activity("D", 0, { duration: 2, predecessors: [{ id: "A" }] })],
          replace_predecessors: [{ activity_id: "B", predecessors: [{ id: "D" }] }],
        },
      },
    });
    expect(scenario.isError, scenario.text).toBe(false);
    const d = await saved();
    expect(d.version).toBe(6);
    expect(readScheduleControl(d.data)!.analysis).toMatchObject({
      event_id: "E1",
      base_version: 5,
      affected_activity_ids: ["B"],
    });
    expect((await saved(5)).data.activities).toHaveLength(3);
    expect(d.data.activities).toHaveLength(4);
    const u = user("super"),
      sb = fakeClient(state.db!, { sub: u.id, email: u.email, role: "authenticated" });
    const superResult = await sb.rpc("mcp_living_report_get", {
      _job: job,
      _type: "cpm",
      _version: null,
    });
    expect(JSON.stringify(superResult.data)).not.toContain('"value":1000');
    const publicControl = readScheduleControl((superResult.data as any).data)!;
    expect(publicControl.analysis).not.toHaveProperty("source_refs");
    expect(publicControl.analysis).not.toHaveProperty("description");
    expect(publicControl.analysis).not.toHaveProperty("assumptions");
    expect(publicControl.analysis).not.toHaveProperty("before_activities");
    expect(publicControl.analysis!.impact_calendar_days).toBe(
      readScheduleControl(d.data)!.analysis!.impact_calendar_days,
    );
    expect(readScheduleControl(d.data)!.baselines[0].activities[0].duration).toBe(5);
  });
});
