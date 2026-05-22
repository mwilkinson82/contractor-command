import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CalendarInput = z.object({
  id: z.string().uuid().optional(),
  scheduleId: z.string().uuid(),
  name: z.string().min(1).max(80),
  workDays: z.number().int().min(0).max(127),
  holidays: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(365)
    .default([]),
});

export const listCalendars = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { scheduleId: string }) =>
    z.object({ scheduleId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("schedule_calendars")
      .select("id, name, work_days, holidays, is_default, position")
      .eq("schedule_id", data.scheduleId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      calendars: (rows ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        workDays: (r.work_days as number | null) ?? 31,
        holidays: ((r.holidays as unknown as string[] | null) ?? []) as string[],
        isDefault: !!r.is_default,
      })),
    };
  });

export const saveCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => CalendarInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.id) {
      const { error } = await supabase
        .from("schedule_calendars")
        .update({
          name: data.name,
          work_days: data.workDays,
          holidays: data.holidays,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    // Position = max + 1
    const { data: max } = await supabase
      .from("schedule_calendars")
      .select("position")
      .eq("schedule_id", data.scheduleId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = (max?.[0]?.position as number | undefined) ?? -1;
    const { data: inserted, error } = await supabase
      .from("schedule_calendars")
      .insert({
        schedule_id: data.scheduleId,
        name: data.name,
        work_days: data.workDays,
        holidays: data.holidays,
        position: nextPos + 1,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

export const deleteCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Don't allow deleting the default calendar
    const { data: row, error: rErr } = await supabase
      .from("schedule_calendars")
      .select("is_default, schedule_id")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!row) throw new Error("Calendar not found");
    if (row.is_default) throw new Error("Cannot delete the project default calendar");
    // Null out task assignments using this calendar
    await supabase
      .from("schedule_tasks")
      .update({ calendar_id: null })
      .eq("calendar_id", data.id);
    const { error } = await supabase.from("schedule_calendars").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Promote a calendar to project default. Also writes its workDays/holidays onto the schedule row so the engine picks them up. */
export const setDefaultCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: cal, error: cErr } = await supabase
      .from("schedule_calendars")
      .select("id, schedule_id, work_days, holidays")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cal) throw new Error("Calendar not found");

    // Clear other defaults on this schedule (avoids unique-index conflict during swap).
    const { error: clearErr } = await supabase
      .from("schedule_calendars")
      .update({ is_default: false })
      .eq("schedule_id", cal.schedule_id)
      .neq("id", cal.id);
    if (clearErr) throw new Error(clearErr.message);

    const { error: setErr } = await supabase
      .from("schedule_calendars")
      .update({ is_default: true })
      .eq("id", cal.id);
    if (setErr) throw new Error(setErr.message);

    // Mirror onto schedules.work_days / holidays so the engine (which reads from there) follows.
    const { error: schedErr } = await supabase
      .from("schedules")
      .update({
        work_days: cal.work_days,
        holidays: cal.holidays,
      })
      .eq("id", cal.schedule_id);
    if (schedErr) throw new Error(schedErr.message);

    return { ok: true };
  });

export const assignTaskCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        scheduleId: z.string().uuid(),
        taskId: z.string().min(1).max(64),
        calendarId: z.string().uuid().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("schedule_tasks")
      .update({ calendar_id: data.calendarId })
      .eq("schedule_id", data.scheduleId)
      .eq("task_id", data.taskId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
