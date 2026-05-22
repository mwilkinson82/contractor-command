import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Schedule } from "./types";

const DepType = z.enum(["FS", "SS", "FF", "SF"]);

const TaskInput = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  duration: z.number().int().min(0).max(100000),
  wbs: z.string().max(128).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  percentComplete: z.number().min(0).max(100).optional().nullable(),
  budgetCost: z.number().min(0).max(1e12).optional().nullable(),
  actualCost: z.number().min(0).max(1e12).optional().nullable(),
  resourceName: z.string().max(128).optional().nullable(),
  resourceUnitsPerDay: z.number().min(0).max(10000).optional().nullable(),
});

const DependencyInput = z.object({
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  type: DepType.optional(),
  lag: z.number().int().min(-100000).max(100000).optional(),
});

const SaveScheduleInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  projectStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  notes: z.string().max(5000).optional().nullable(),
  workDays: z.number().int().min(0).max(127).optional(),
  holidays: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(365)
    .optional(),
  tasks: z.array(TaskInput).max(2000),
  dependencies: z.array(DependencyInput).max(5000),
});

export const listSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("schedules")
      .select("id, name, project_start_date, notes, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      schedules: (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        projectStartDate: (row.project_start_date as string | null) ?? undefined,
        notes: (row.notes as string | null) ?? undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      })),
    };
  });

export const loadSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: head, error: headErr } = await supabase
      .from("schedules")
      .select(
        "id, name, project_start_date, notes, work_days, holidays, created_at, updated_at",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (headErr) throw new Error(headErr.message);
    if (!head) throw new Error("Schedule not found");

    const [{ data: tasks, error: tErr }, { data: deps, error: dErr }] = await Promise.all([
      supabase
        .from("schedule_tasks")
        .select("task_id, name, duration, wbs, description, percent_complete, position")
        .eq("schedule_id", data.id)
        .order("position", { ascending: true }),
      supabase
        .from("schedule_dependencies")
        .select("from_task_id, to_task_id, type, lag")
        .eq("schedule_id", data.id),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (dErr) throw new Error(dErr.message);

    const schedule: Schedule = {
      id: head.id as string,
      name: head.name as string,
      projectStartDate: (head.project_start_date as string | null) ?? undefined,
      calendar: {
        workDays: (head.work_days as number | null) ?? 31,
        holidays: ((head.holidays as unknown as string[] | null) ?? []).filter(
          (h): h is string => typeof h === "string",
        ),
      },
      tasks: (tasks ?? []).map((t) => ({
        id: t.task_id as string,
        name: t.name as string,
        duration: t.duration as number,
        wbs: (t.wbs as string | null) ?? undefined,
        description: (t.description as string | null) ?? undefined,
        percentComplete: (t.percent_complete as number | null) ?? undefined,
      })),
      dependencies: (deps ?? []).map((d) => ({
        from: d.from_task_id as string,
        to: d.to_task_id as string,
        type: d.type as "FS" | "SS" | "FF" | "SF",
        lag: d.lag as number,
      })),
    };

    return {
      schedule,
      notes: (head.notes as string | null) ?? undefined,
      createdAt: head.created_at as string,
      updatedAt: head.updated_at as string,
    };
  });

export const saveSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => SaveScheduleInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Validate dependencies reference known tasks
    const taskIds = new Set(data.tasks.map((t) => t.id));
    for (const d of data.dependencies) {
      if (!taskIds.has(d.from) || !taskIds.has(d.to)) {
        throw new Error(`Dependency references missing task: ${d.from} -> ${d.to}`);
      }
    }

    let scheduleId = data.id;

    if (scheduleId) {
      const { error } = await supabase
        .from("schedules")
        .update({
          name: data.name,
          project_start_date: data.projectStartDate ?? null,
          notes: data.notes ?? null,
          ...(data.workDays !== undefined ? { work_days: data.workDays } : {}),
          ...(data.holidays !== undefined ? { holidays: data.holidays } : {}),
        })
        .eq("id", scheduleId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabase
        .from("schedules")
        .insert({
          user_id: userId,
          name: data.name,
          project_start_date: data.projectStartDate ?? null,
          notes: data.notes ?? null,
          work_days: data.workDays ?? 31,
          holidays: data.holidays ?? [],
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      scheduleId = inserted.id as string;
    }

    // Replace tasks + dependencies (simple, atomic-enough for v1).
    const [delDeps, delTasks] = await Promise.all([
      supabase.from("schedule_dependencies").delete().eq("schedule_id", scheduleId),
      supabase.from("schedule_tasks").delete().eq("schedule_id", scheduleId),
    ]);
    if (delDeps.error) throw new Error(delDeps.error.message);
    if (delTasks.error) throw new Error(delTasks.error.message);

    if (data.tasks.length > 0) {
      const { error } = await supabase.from("schedule_tasks").insert(
        data.tasks.map((t, i) => ({
          schedule_id: scheduleId!,
          task_id: t.id,
          name: t.name,
          duration: t.duration,
          wbs: t.wbs ?? null,
          description: t.description ?? null,
          percent_complete: t.percentComplete ?? null,
          position: i,
        })),
      );
      if (error) throw new Error(error.message);
    }

    if (data.dependencies.length > 0) {
      const { error } = await supabase.from("schedule_dependencies").insert(
        data.dependencies.map((d) => ({
          schedule_id: scheduleId!,
          from_task_id: d.from,
          to_task_id: d.to,
          type: d.type ?? "FS",
          lag: d.lag ?? 0,
        })),
      );
      if (error) throw new Error(error.message);
    }

    return { id: scheduleId! };
  });

export const deleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("schedules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Baselines ----------------

export const listBaselines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { scheduleId: string }) =>
    z.object({ scheduleId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("schedule_baselines")
      .select("id, name, notes, project_start_date, created_at")
      .eq("schedule_id", data.scheduleId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      baselines: (rows ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        notes: (r.notes as string | null) ?? undefined,
        projectStartDate: (r.project_start_date as string | null) ?? undefined,
        createdAt: r.created_at as string,
      })),
    };
  });

export const captureBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        scheduleId: z.string().uuid(),
        name: z.string().min(1).max(255),
        notes: z.string().max(2000).optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: head, error: hErr } = await supabase
      .from("schedules")
      .select("project_start_date, work_days, holidays")
      .eq("id", data.scheduleId)
      .maybeSingle();
    if (hErr) throw new Error(hErr.message);
    if (!head) throw new Error("Schedule not found");

    const [{ data: tasks, error: tErr }, { data: deps, error: dErr }] = await Promise.all([
      supabase
        .from("schedule_tasks")
        .select("task_id, name, duration, wbs, description, percent_complete, position")
        .eq("schedule_id", data.scheduleId)
        .order("position", { ascending: true }),
      supabase
        .from("schedule_dependencies")
        .select("from_task_id, to_task_id, type, lag")
        .eq("schedule_id", data.scheduleId),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (dErr) throw new Error(dErr.message);

    const tasksJson = (tasks ?? []).map((t) => ({
      id: t.task_id as string,
      name: t.name as string,
      duration: t.duration as number,
      wbs: (t.wbs as string | null) ?? undefined,
      description: (t.description as string | null) ?? undefined,
      percentComplete: (t.percent_complete as number | null) ?? undefined,
    }));
    const depsJson = (deps ?? []).map((d) => ({
      from: d.from_task_id as string,
      to: d.to_task_id as string,
      type: d.type as "FS" | "SS" | "FF" | "SF",
      lag: d.lag as number,
    }));

    const { data: inserted, error: iErr } = await supabase
      .from("schedule_baselines")
      .insert({
        schedule_id: data.scheduleId,
        name: data.name,
        notes: data.notes ?? null,
        project_start_date: (head.project_start_date as string | null) ?? null,
        work_days: (head.work_days as number | null) ?? 31,
        holidays: ((head.holidays as string[] | null) ?? []) as string[],
        tasks: tasksJson,
        dependencies: depsJson,
      })
      .select("id")
      .single();
    if (iErr) throw new Error(iErr.message);
    return { id: inserted.id as string };
  });

export const loadBaseline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("schedule_baselines")
      .select(
        "id, name, notes, project_start_date, work_days, holidays, tasks, dependencies, created_at",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Baseline not found");
    const schedule: Schedule = {
      id: row.id as string,
      name: row.name as string,
      projectStartDate: (row.project_start_date as string | null) ?? undefined,
      calendar: {
        workDays: (row.work_days as number | null) ?? 31,
        holidays: ((row.holidays as unknown as string[] | null) ?? []).filter(
          (h): h is string => typeof h === "string",
        ),
      },
      tasks: (row.tasks as unknown as Schedule["tasks"]) ?? [],
      dependencies: (row.dependencies as unknown as Schedule["dependencies"]) ?? [],
    };
    return {
      schedule,
      notes: (row.notes as string | null) ?? undefined,
      createdAt: row.created_at as string,
    };
  });

export const deleteBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("schedule_baselines")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

