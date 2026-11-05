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
    /** What the critical flag means. Default longest-path: the driving chain to completion. */
    critical_definition: z.enum(["longest-path", "total-float"]).optional(),
    /** Float paths to rank after the longest path (P6 multiple float paths). Default 3. */
    float_path_count: z.number().int().min(1).max(10).optional(),
  })
  .strict();
/** A P6-style activity code: a named dictionary of values, assigned one value per activity. */
export const activityCode = z
  .object({
    id,
    name: z.string().trim().min(1).max(60),
    values: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(80),
            color: z
              .string()
              .regex(/^#[0-9A-Fa-f]{6}$/)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
/** Table columns a layout can show. Code columns are `code:<code id>`. */
export const LAYOUT_COLUMNS = ["od", "rd", "pc", "st", "fi", "tf", "ff"] as const;
export const LAYOUT_SORT_KEYS = ["id", "name", ...LAYOUT_COLUMNS] as const;
const layoutColumn = z.union([z.enum(LAYOUT_COLUMNS), z.string().regex(/^code:[^\s]{1,80}$/)]);
export const scheduleLayout = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    /** wbs: WBS bands. cascade: every activity in date order, no bands. */
    group: z.enum(["wbs", "cascade"]),
    columns: z.array(layoutColumn).max(20),
    sort: z
      .object({
        key: z.union([z.enum(LAYOUT_SORT_KEYS), z.string().regex(/^code:[^\s]{1,80}$/)]),
        dir: z.enum(["asc", "desc"]),
      })
      .strict()
      .nullable()
      .optional(),
    filter: z
      .object({
        /** Activities under any of these WBS nodes (children included). */
        wbs_ids: z.array(id).max(100).optional(),
        /** Every listed code must match one of its values. */
        codes: z
          .array(z.object({ code_id: id, value_ids: z.array(id).min(1).max(200) }).strict())
          .max(20)
          .optional(),
        cost_codes: z.array(z.string().trim().min(1).max(20)).max(100).optional(),
        activity_ids: z.array(z.string().trim().min(1).max(20)).max(400).optional(),
        /** Only remaining activities on the longest path or with total float of zero or less. */
        critical_only: z.boolean().optional(),
        /** Hide complete activities. */
        remaining_only: z.boolean().optional(),
      })
      .strict()
      .optional(),
    timescale: z.enum(["week", "month", "quarter"]).optional(),
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
    /** Add or replace activity codes by ID. */
    activity_codes: z.array(activityCode).max(30).optional(),
    remove_code_ids: z.array(id).max(30).optional(),
    /** One value per activity and code; value_id null clears it. */
    code_assignments: z
      .array(
        z
          .object({ activity_id: z.string().max(20), code_id: id, value_id: id.nullable() })
          .strict(),
      )
      .max(4000)
      .optional(),
    /** Add or replace saved layouts by ID. */
    layouts: z.array(scheduleLayout).max(30).optional(),
    remove_layout_ids: z.array(id).max(30).optional(),
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
export type ActivityCode = z.infer<typeof activityCode>;
export type ScheduleLayout = z.infer<typeof scheduleLayout>;
