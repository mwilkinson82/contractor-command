/**
 * Phase 3.6c — seed real smoke schedules, run persisted dry-run, then cleanup.
 *
 * Creates two scratch schedules in the live DB:
 *   1. "[3.6c smoke] eligible FS chain"   — 5 tasks, FS chain, no actuals/resources
 *   2. "[3.6c smoke] ineligible progress" — 3 tasks with progress + resource on one
 *
 * Then loads each through the same helper used in 3.6b, prints the report,
 * and deletes the seeded schedules. Existing schedules are listed but not
 * re-exercised here (3.6b already covered them).
 *
 * Run: bun scripts/phase-3-6c-smoke.ts
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

const OWNER_USER_ID = "ffc8331a-1790-4a8e-a423-50c4bf850aa1";

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

async function seedEligible(): Promise<string> {
  const { data: head, error } = await admin
    .from("schedules")
    .insert({
      user_id: OWNER_USER_ID,
      name: "[3.6c smoke] eligible FS chain",
      project_start_date: "2026-06-01",
      work_days: 31,
      holidays: [],
      annotations: [],
    })
    .select("id")
    .single();
  if (error) throw error;
  const id = head.id as string;
  await admin.from("schedule_calendars").insert({
    schedule_id: id,
    name: "Project default",
    work_days: 31,
    holidays: [],
    is_default: true,
    position: 0,
  });
  const tasks = [
    { task_id: "A", name: "Site prep",   duration: 3, position: 0 },
    { task_id: "B", name: "Foundations", duration: 5, position: 1 },
    { task_id: "C", name: "Framing",     duration: 7, position: 2 },
    { task_id: "D", name: "Roofing",     duration: 4, position: 3 },
    { task_id: "E", name: "Closeout",    duration: 2, position: 4 },
  ];
  await admin.from("schedule_tasks").insert(tasks.map((t) => ({ schedule_id: id, ...t })));
  const deps = [
    { from_task_id: "A", to_task_id: "B" },
    { from_task_id: "B", to_task_id: "C" },
    { from_task_id: "C", to_task_id: "D" },
    { from_task_id: "D", to_task_id: "E" },
  ];
  await admin.from("schedule_dependencies").insert(deps.map((d) => ({ schedule_id: id, ...d, type: "FS", lag: 0 })));
  return id;
}

async function seedIneligible(): Promise<string> {
  const { data: head, error } = await admin
    .from("schedules")
    .insert({
      user_id: OWNER_USER_ID,
      name: "[3.6c smoke] ineligible progress",
      project_start_date: "2026-06-01",
      work_days: 31,
      holidays: [],
      annotations: [],
    })
    .select("id")
    .single();
  if (error) throw error;
  const id = head.id as string;
  await admin.from("schedule_calendars").insert({
    schedule_id: id,
    name: "Project default",
    work_days: 31,
    holidays: [],
    is_default: true,
    position: 0,
  });
  const tasks = [
    { task_id: "A", name: "Mobilize", duration: 3, position: 0, percent_complete: 50, resource_name: "Crew 1", resource_units_per_day: 2 },
    { task_id: "B", name: "Install",  duration: 5, position: 1 },
    { task_id: "C", name: "Test",     duration: 2, position: 2 },
  ];
  await admin.from("schedule_tasks").insert(tasks.map((t) => ({ schedule_id: id, ...t })));
  const deps = [
    { from_task_id: "A", to_task_id: "B" },
    { from_task_id: "B", to_task_id: "C" },
  ];
  await admin.from("schedule_dependencies").insert(deps.map((d) => ({ schedule_id: id, ...d, type: "FS", lag: 0 })));
  return id;
}

async function cleanup(id: string): Promise<void> {
  await admin.from("schedule_dependencies").delete().eq("schedule_id", id);
  await admin.from("schedule_tasks").delete().eq("schedule_id", id);
  await admin.from("schedule_calendars").delete().eq("schedule_id", id);
  await admin.from("schedules").delete().eq("id", id);
}

async function runFor(id: string, label: string): Promise<PersistedDryRunReport | null> {
  const before = await snapshot(id);
  const schedule = await loadSchedule(id);
  if (!schedule) {
    console.log(`[${label}] schedule not found`);
    return null;
  }
  let report: PersistedDryRunReport;
  try {
    report = summarizePersistedDryRun({ scheduleId: id, projectName: schedule.name, schedule });
  } catch (err) {
    console.log(`[${label}] ERROR: ${(err as Error).message}`);
    return null;
  }
  const after = await snapshot(id);
  const unchanged =
    before.tasks === after.tasks &&
    before.deps === after.deps &&
    before.cals === after.cals &&
    before.headJson === after.headJson;

  console.log(`=== ${label} — ${report.projectName} (${report.scheduleId}) ===`);
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
  return report;
}

async function main() {
  const keep = process.argv.includes("--keep");
  const eligibleId = await seedEligible();
  const ineligibleId = await seedIneligible();
  console.log(`Seeded eligible=${eligibleId} ineligible=${ineligibleId}\n`);

  try {
    await runFor(eligibleId, "ELIGIBLE");
    await runFor(ineligibleId, "INELIGIBLE");
  } finally {
    if (keep) {
      console.log(`Kept smoke schedules (pass --keep). IDs above.`);
    } else {
      await cleanup(eligibleId);
      await cleanup(ineligibleId);
      console.log(`Cleaned up smoke schedules.`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
