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
  startNoEarlierThan: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  calendarId: z.string().uuid().optional().nullable(),
});

const DependencyInput = z.object({
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  type: DepType.optional(),
  lag: z.number().int().min(-100000).max(100000).optional(),
});

const AnnotationInput = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["milestone", "callout"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1).max(200),
  taskId: z.string().max(64).optional().nullable(),
});

const SaveScheduleInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  projectStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  dataDate: z
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
  annotations: z.array(AnnotationInput).max(200).optional(),
  tasks: z.array(TaskInput).max(2000),
  dependencies: z.array(DependencyInput).max(5000),
});

export const listSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("schedules")
      .select("id, name, project_start_date, data_date, notes, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      schedules: (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        projectStartDate: (row.project_start_date as string | null) ?? undefined,
        dataDate: (row.data_date as string | null) ?? undefined,
        notes: (row.notes as string | null) ?? undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      })),
    };
  });

// ---------------- Projects (rich) ----------------

const ProjectStatus = z.enum(["planning", "active", "on_hold", "closed"]);

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("schedules")
      .select(
        "id, name, client, project_number, status, tags, cover_color, project_start_date, data_date, notes, created_at, updated_at",
      )
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      projects: (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        client: (row.client as string | null) ?? undefined,
        projectNumber: (row.project_number as string | null) ?? undefined,
        status: (row.status as "planning" | "active" | "on_hold" | "closed" | null) ?? "planning",
        tags: ((row.tags as string[] | null) ?? []) as string[],
        coverColor: (row.cover_color as string | null) ?? undefined,
        projectStartDate: (row.project_start_date as string | null) ?? undefined,
        dataDate: (row.data_date as string | null) ?? undefined,
        notes: (row.notes as string | null) ?? undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      })),
    };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        name: z.string().min(1).max(255),
        client: z.string().max(255).optional().nullable(),
        projectNumber: z.string().max(64).optional().nullable(),
        status: ProjectStatus.optional(),
        projectStartDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .nullable(),
        coverColor: z.string().max(32).optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inserted, error } = await supabase
      .from("schedules")
      .insert({
        user_id: userId,
        name: data.name,
        client: data.client ?? null,
        project_number: data.projectNumber ?? null,
        status: data.status ?? "planning",
        project_start_date: data.projectStartDate ?? null,
        cover_color: data.coverColor ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

export const updateProjectMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        client: z.string().max(255).optional().nullable(),
        projectNumber: z.string().max(64).optional().nullable(),
        status: ProjectStatus.optional(),
        tags: z.array(z.string().min(1).max(64)).max(20).optional(),
        coverColor: z.string().max(32).optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const patch: {
      name?: string;
      client?: string | null;
      project_number?: string | null;
      status?: "planning" | "active" | "on_hold" | "closed";
      tags?: string[];
      cover_color?: string | null;
    } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.client !== undefined) patch.client = data.client;
    if (data.projectNumber !== undefined) patch.project_number = data.projectNumber;
    if (data.status !== undefined) patch.status = data.status;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.coverColor !== undefined) patch.cover_color = data.coverColor;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase.from("schedules").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const loadSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: head, error: headErr } = await supabase
      .from("schedules")
      .select(
        "id, name, project_start_date, data_date, notes, work_days, holidays, annotations, created_at, updated_at",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (headErr) throw new Error(headErr.message);
    if (!head) throw new Error("Schedule not found");

    // Idempotently guarantee a project default calendar for this schedule.
    // Safe to call on every load; the helper is a no-op if a default already exists.
    await supabase.rpc("ensure_default_calendar", { _schedule_id: data.id });


    const [{ data: tasks, error: tErr }, { data: deps, error: dErr }, { data: cals, error: cErr }] =
      await Promise.all([
        supabase
          .from("schedule_tasks")
          .select(
            "task_id, name, duration, wbs, description, percent_complete, position, budget_cost, actual_cost, resource_name, resource_units_per_day, start_no_earlier_than, calendar_id",
          )
          .eq("schedule_id", data.id)
          .order("position", { ascending: true }),
        supabase
          .from("schedule_dependencies")
          .select("from_task_id, to_task_id, type, lag")
          .eq("schedule_id", data.id),
        supabase
          .from("schedule_calendars")
          .select("id, name, work_days, holidays, is_default, position")
          .eq("schedule_id", data.id)
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
          data_date: data.dataDate ?? null,
          notes: data.notes ?? null,
          ...(data.workDays !== undefined ? { work_days: data.workDays } : {}),
          ...(data.holidays !== undefined ? { holidays: data.holidays } : {}),
          ...(data.annotations !== undefined ? { annotations: data.annotations } : {}),
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
          data_date: data.dataDate ?? null,
          notes: data.notes ?? null,
          work_days: data.workDays ?? 31,
          holidays: data.holidays ?? [],
          annotations: data.annotations ?? [],
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
          budget_cost: t.budgetCost ?? null,
          actual_cost: t.actualCost ?? null,
          resource_name: t.resourceName ?? null,
          resource_units_per_day: t.resourceUnitsPerDay ?? null,
          start_no_earlier_than: t.startNoEarlierThan ?? null,
          calendar_id: t.calendarId ?? null,
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
        .select(
          "task_id, name, duration, wbs, description, percent_complete, position, budget_cost, actual_cost, resource_name, resource_units_per_day, start_no_earlier_than",
        )
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
      budgetCost: (t.budget_cost as number | null) ?? undefined,
      actualCost: (t.actual_cost as number | null) ?? undefined,
      resourceName: (t.resource_name as string | null) ?? undefined,
      resourceUnitsPerDay: (t.resource_units_per_day as number | null) ?? undefined,
      startNoEarlierThan: (t.start_no_earlier_than as string | null) ?? undefined,
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
    const { error } = await context.supabase.from("schedule_baselines").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
