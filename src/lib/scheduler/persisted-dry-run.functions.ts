/**
 * Phase 3.6 — internal-only server function that runs a dry-run
 * comparison against a persisted schedule by ID.
 *
 * INVARIANTS:
 *   - Admin-gated. Non-admin callers receive `Forbidden`.
 *   - Returns a `PersistedDryRunReport` (engine2 output is NEVER persisted
 *     and NEVER returned as the authoritative schedule result).
 *   - Schedule state is never mutated.
 *   - Not wired into any production UI route. Internal/dev use only —
 *     callable from an admin shell, an internal debug drawer, or scripts.
 *
 * See ARCHITECTURE.md §37.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Schedule } from "../types";
import {
  summarizePersistedDryRun,
  type PersistedDryRunReport,
} from "../engine2/persisted-dry-run";

export const runPersistedScheduleDryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { scheduleId: string }) =>
    z.object({ scheduleId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<PersistedDryRunReport> => {
    const { userId } = context;

    // Admin gate — dry-run comparison is internal-only.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const scheduleId = data.scheduleId;

    // Load schedule via admin client (bypasses RLS — admin-gated above).
    const { data: head, error: headErr } = await supabaseAdmin
      .from("schedules")
      .select(
        "id, name, project_start_date, data_date, work_days, holidays, annotations",
      )
      .eq("id", scheduleId)
      .maybeSingle();
    if (headErr) throw new Error(headErr.message);
    if (!head) throw new Error("Schedule not found");

    const [
      { data: tasks, error: tErr },
      { data: deps, error: dErr },
      { data: cals, error: cErr },
    ] = await Promise.all([
      supabaseAdmin
        .from("schedule_tasks")
        .select(
          "task_id, name, duration, wbs, description, percent_complete, position, budget_cost, actual_cost, resource_name, resource_units_per_day, start_no_earlier_than, calendar_id",
        )
        .eq("schedule_id", scheduleId)
        .order("position", { ascending: true }),
      supabaseAdmin
        .from("schedule_dependencies")
        .select("from_task_id, to_task_id, type, lag")
        .eq("schedule_id", scheduleId),
      supabaseAdmin
        .from("schedule_calendars")
        .select("id, name, work_days, holidays, is_default, position")
        .eq("schedule_id", scheduleId)
        .order("position", { ascending: true }),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (dErr) throw new Error(dErr.message);
    if (cErr) throw new Error(cErr.message);

    const schedule: Schedule = {
      id: head.id as string,
      name: head.name as string,
      projectStartDate: (head.project_start_date as string | null) ?? undefined,
      dataDate: (head.data_date as string | null) ?? undefined,
      calendar: {
        workDays: (head.work_days as number | null) ?? 31,
        holidays: (
          (head.holidays as unknown as string[] | null) ?? []
        ).filter((h): h is string => typeof h === "string"),
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
        resourceUnitsPerDay:
          (t.resource_units_per_day as number | null) ?? undefined,
        startNoEarlierThan:
          (t.start_no_earlier_than as string | null) ?? undefined,
        calendarId: (t.calendar_id as string | null) ?? undefined,
      })),
      dependencies: (deps ?? []).map((d) => ({
        from: d.from_task_id as string,
        to: d.to_task_id as string,
        type: d.type as "FS" | "SS" | "FF" | "SF",
        lag: d.lag as number,
      })),
      annotations: Array.isArray(head.annotations)
        ? (head.annotations as unknown as Schedule["annotations"])
        : [],
      calendars: (cals ?? []).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        workDays: (c.work_days as number | null) ?? 31,
        holidays: ((c.holidays as unknown as string[] | null) ?? []).filter(
          (h): h is string => typeof h === "string",
        ),
        isDefault: !!c.is_default,
      })),
    };

    return summarizePersistedDryRun({
      scheduleId,
      projectName: schedule.name,
      schedule,
    });
  });
