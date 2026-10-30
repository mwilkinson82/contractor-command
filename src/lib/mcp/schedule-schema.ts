import { z } from "zod";

export const scheduleDate = z
  .string()
  .refine(
    (s) =>
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      Number.isFinite(Date.parse(`${s}T00:00:00Z`)) &&
      new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s,
    "Use a real YYYY-MM-DD date",
  );
const id = z.string().trim().min(1).max(80);
export const scheduleLogic = z
  .object({
    id: z.string().trim().min(1).max(20),
    type: z.enum(["FS", "SS", "FF", "SF"]).optional(),
    lag: z.number().int().min(-999).max(999).optional(),
    lag_calendar_basis: z.enum(["predecessor", "successor", "project", "24h"]).optional(),
  })
  .strict();
export const scheduleActivity = z
  .object({
    id: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(160),
    duration: z.number().int().min(0).max(5000).nullable(),
    start: scheduleDate.nullable(),
    finish: scheduleDate.nullable(),
    predecessors: z.array(scheduleLogic).max(20),
    total_float: z.number().min(-5000).max(5000).nullable(),
    critical: z.boolean().nullable(),
    pct_complete: z.number().min(0).max(100).nullable(),
    value: z.number().min(0).nullable(),
    sov_line: z.string().trim().max(20).nullable(),
    cost_code: z.string().trim().max(20).nullable(),
    owner_furnished: z.boolean().optional(),
    wbs_id: id.nullable().optional(),
    calendar_id: id.optional(),
    activity_type: z.enum(["task", "milestone-start", "milestone-finish"]).optional(),
    actual_start: scheduleDate.nullable().optional(),
    actual_finish: scheduleDate.nullable().optional(),
    remaining_duration: z.number().int().min(0).max(5000).nullable().optional(),
    start_no_earlier_than: scheduleDate.nullable().optional(),
    finish_no_later_than: scheduleDate.nullable().optional(),
  })
  .strict();
export const wbsNode = z
  .object({
    id,
    name: z.string().trim().min(1).max(160),
    parent_id: id.nullable(),
    order: z.number().int().min(0).max(10000),
  })
  .strict();
export const scheduleCalendar = z
  .object({
    id,
    name: z.string().trim().min(1).max(160),
    work_days: z.number().int().min(1).max(127),
    holidays: z.array(scheduleDate).max(1000),
    hours_per_day: z.number().int().min(1).max(24),
  })
  .strict();
export const scheduleSettings = z
  .object({
    project_start: scheduleDate,
    default_calendar_id: id,
    calendars: z.array(scheduleCalendar).min(1).max(50),
    finish_convention: z.literal("inclusive-last-work-day"),
    out_of_sequence: z.literal("retained-logic"),
  })
  .strict();
export const scheduleRequest = z
  .object({
    operation: z.enum(["organize", "recalculate", "baseline", "tia"]),
    data_date: scheduleDate,
    settings: scheduleSettings.optional(),
    // A first import is explicit; subsequent updates use stable IDs and patches.
    initial_activities: z.array(scheduleActivity).min(1).max(400).optional(),
    add_activities: z.array(scheduleActivity).max(400).optional(),
    starter_wbs: z.boolean().optional(),
    wbs: z.array(wbsNode).max(400).optional(),
    assignments: z
      .array(z.object({ activity_id: z.string().max(20), wbs_id: id.nullable() }).strict())
      .max(400)
      .optional(),
    updates: z
      .array(scheduleActivity.partial().required({ id: true }).strict())
      .max(400)
      .optional(),
    baseline: z
      .object({
        id,
        name: z.string().trim().min(1).max(160),
        status: z.enum(["draft", "accepted"]),
      })
      .strict()
      .optional(),
    delay: z
      .object({
        event_id: id,
        description: z.string().trim().min(1).max(2000),
        event_date: scheduleDate.nullable(),
        source_refs: z.array(z.string().trim().min(1).max(300)).max(30),
        assumptions: z.array(z.string().trim().min(1).max(500)).max(30),
        add_activities: z.array(scheduleActivity).min(1).max(100),
        replace_predecessors: z
          .array(
            z
              .object({
                activity_id: z.string().max(20),
                predecessors: z.array(scheduleLogic).max(20),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ScheduleRequest = z.infer<typeof scheduleRequest>;
export type ScheduleSettings = z.infer<typeof scheduleSettings>;
export type WbsNode = z.infer<typeof wbsNode>;
