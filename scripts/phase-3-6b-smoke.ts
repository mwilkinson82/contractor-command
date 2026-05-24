/**
 * Phase 3.6b — live smoke for runPersistedScheduleDryRun.
 *
 * Loads every persisted schedule via the admin client and runs the
 * Phase 3.6 helper directly (same code path the server function uses
 * after its admin gate). Prints a one-line per-schedule report plus
 * before/after row counts proving no schedule state mutated.
 *
 * Run: bun scripts/phase-3-6b-smoke.ts
 */
import { createClient } from "@supabase/supabase-js";
import {
  summarizePersistedDryRun,
  type PersistedDryRunReport,
} from "@/lib/scheduler/engine2/persisted-dry-run";
import type { Schedule } from "@/lib/scheduler/types";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

interface SnapshotCounts {
  tasks: number;
  deps: number;
  cals: number;
  headJson: string;
}

async function snapshot(scheduleId: string): Promise<SnapshotCounts> {
  const [{ data: head }, { count: tasks }, { count: deps }, { count: cals }] =
    await Promise.all([
      admin.from("schedules").select("*").eq("id", scheduleId).maybeSingle(),
      admin.from("schedule_tasks").select("*", { count: "exact", head: true }).eq("schedule_id", scheduleId),
      admin.from("schedule_dependencies").select("*", { count: "exact", head: true }).eq("schedule_id", scheduleId),
      admin.from("schedule_calendars").select("*", { count: "exact", head: true }).eq("schedule_id", scheduleId),
    ]);
  return {
    tasks: tasks ?? 0,
    deps: deps ?? 0,
    cals: cals ?? 0,
    headJson: JSON.stringify(head),
  };
}

async function loadSchedule(scheduleId: string): Promise<Schedule | null> {
  const { data: head } = await admin
    .from("schedules")
    .select("id, name, project_start_date, data_date, work_days, holidays, annotations")
    .eq("id", scheduleId)
    .maybeSingle();
  if (!head) return null;
  const [{ data: tasks }, { data: deps }, { data: cals }] = await Promise.all([
    admin
      .from("schedule_tasks")
      .select(
        "task_id, name, duration, wbs, description, percent_complete, position, budget_cost, actual_cost, resource_name, resource_units_per_day, start_no_earlier_than, calendar_id",
      )
      .eq("schedule_id", scheduleId)
      .order("position", { ascending: true }),
    admin.from("schedule_dependencies").select("from_task_id, to_task_id, type, lag").eq("schedule_id", scheduleId),
    admin
      .from("schedule_calendars")
      .select("id, name, work_days, holidays, is_default, position")
      .eq("schedule_id", scheduleId)
      .order("position", { ascending: true }),
  ]);
  return {
    id: head.id as string,
    name: head.name as string,
    projectStartDate: (head.project_start_date as string | null) ?? undefined,
    dataDate: (head.data_date as string | null) ?? undefined,
    calendar: {
      workDays: (head.work_days as number | null) ?? 31,
      holidays: ((head.holidays as unknown as string[] | null) ?? []).filter((h): h is string => typeof h === "string"),
    },
    tasks: (tasks ?? []).map((t) => ({
      id: t.task_id as string,
      name: t.name as string,
      duration: t.duration as number,
      wbs: (t.wbs as string | null) ?? undefined,
      description: (t.description as string | null) ?? undefined,
      percentComplete: (t.percent_complete as number | null) ?? undefined,
      budgetCost: (t.budget_cost as number | null) ?? undefined,
      actualCost: (t.actual_cost as number | null) ?? undefined,
      resourceName: (t.resource_name as string | null) ?? undefined,
      resourceUnitsPerDay: (t.resource_units_per_day as number | null) ?? undefined,
      startNoEarlierThan: (t.start_no_earlier_than as string | null) ?? undefined,
      calendarId: (t.calendar_id as string | null) ?? undefined,
    })),
    dependencies: (deps ?? []).map((d) => ({
      from: d.from_task_id as string,
      to: d.to_task_id as string,
      type: d.type as "FS" | "SS" | "FF" | "SF",
      lag: d.lag as number,
    })),
    annotations: Array.isArray(head.annotations) ? (head.annotations as unknown as Schedule["annotations"]) : [],
    calendars: (cals ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      workDays: (c.work_days as number | null) ?? 31,
      holidays: ((c.holidays as unknown as string[] | null) ?? []).filter((h): h is string => typeof h === "string"),
      isDefault: !!c.is_default,
    })),
  };
}

async function main() {
  const { data: schedules } = await admin.from("schedules").select("id, name").order("updated_at", { ascending: false });
  if (!schedules?.length) {
    console.log("No persisted schedules found.");
    return;
  }
  console.log(`Found ${schedules.length} persisted schedule(s).\n`);
  for (const s of schedules) {
    const before = await snapshot(s.id);
    const schedule = await loadSchedule(s.id);
    if (!schedule) continue;
    let report: PersistedDryRunReport;
    try {
      report = summarizePersistedDryRun({ scheduleId: s.id, projectName: s.name, schedule });
    } catch (err) {
      console.log(`[${s.name}] ERROR: ${(err as Error).message}`);
      continue;
    }
    const after = await snapshot(s.id);
    const unchanged =
      before.tasks === after.tasks &&
      before.deps === after.deps &&
      before.cals === after.cals &&
      before.headJson === after.headJson;

    console.log(`=== ${report.projectName} (${report.scheduleId}) ===`);
    console.log(`  rows: tasks=${before.tasks} deps=${before.deps} cals=${before.cals}`);
    console.log(`  engine2Ran=${report.engine2Ran}  skippedReason=${report.skippedReason ?? "—"}`);
    console.log(`  matching=${report.matchingCount}  differing=${report.differingCount}`);
    console.log(`  maxDateΔ=${report.maxDateDeltaDays}d  maxFloatΔ=${report.maxFloatDeltaDays}d`);
    console.log(`  projectFinish: legacy=${report.projectFinish.legacy ?? "—"} engine2=${report.projectFinish.engine2 ?? "—"} match=${report.projectFinish.match}`);
    console.log(`  eligibilityBlockers=[${report.eligibilityBlockers.join(", ")}]`);
    console.log(`  eligibilityWarnings=[${report.eligibilityWarnings.join(", ")}]`);
    console.log(`  provenance: mode=${report.provenance.effectiveMode} engineUsed=${report.provenance.engineUsed} legacyAuthoritative=${report.provenance.legacyAuthoritative} gate=${report.provenance.gateDecision} eligible=${report.provenance.scheduleEligible}`);
    console.log(`  engine2Diagnostics=${report.engine2DiagnosticsCount} engine2Error=${report.engine2Error ?? "—"}`);
    console.log(`  state unchanged after run: ${unchanged}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
