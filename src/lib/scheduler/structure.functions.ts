import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ScheduleId = z.object({ scheduleId: z.string().uuid() });

export type WbsNode = {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  position: number;
};

export type ActivityCodeType = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  values: ActivityCodeValue[];
};

export type ActivityCodeValue = {
  id: string;
  typeId: string;
  code: string;
  description: string | null;
  color: string | null;
  position: number;
};

export type TaskCodeAssignment = {
  taskId: string;
  typeId: string;
  valueId: string;
};

/** ---------------- Read all structure for a schedule ---------------- */
export const loadStructure = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scheduleId: string }) => ScheduleId.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { scheduleId } = data;

    const [wbsRes, typesRes, valsRes, assignRes] = await Promise.all([
      supabase
        .from("wbs_nodes")
        .select("id, parent_id, code, name, position")
        .eq("schedule_id", scheduleId)
        .order("position", { ascending: true }),
      supabase
        .from("activity_code_types")
        .select("id, name, description, position")
        .eq("schedule_id", scheduleId)
        .order("position", { ascending: true }),
      supabase
        .from("activity_code_values")
        .select("id, type_id, code, description, color, position")
        .order("position", { ascending: true }),
      supabase
        .from("task_activity_codes")
        .select("task_id, type_id, value_id")
        .eq("schedule_id", scheduleId),
    ]);

    if (wbsRes.error) throw new Error(wbsRes.error.message);
    if (typesRes.error) throw new Error(typesRes.error.message);
    if (valsRes.error) throw new Error(valsRes.error.message);
    if (assignRes.error) throw new Error(assignRes.error.message);

    const typeIds = new Set((typesRes.data ?? []).map((t) => t.id as string));
    const values: ActivityCodeValue[] = (valsRes.data ?? [])
      .filter((v) => typeIds.has(v.type_id as string))
      .map((v) => ({
        id: v.id as string,
        typeId: v.type_id as string,
        code: v.code as string,
        description: (v.description as string | null) ?? null,
        color: (v.color as string | null) ?? null,
        position: (v.position as number) ?? 0,
      }));

    const types: ActivityCodeType[] = (typesRes.data ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      description: (t.description as string | null) ?? null,
      position: (t.position as number) ?? 0,
      values: values.filter((v) => v.typeId === (t.id as string)),
    }));

    return {
      wbs: (wbsRes.data ?? []).map((n) => ({
        id: n.id as string,
        parentId: (n.parent_id as string | null) ?? null,
        code: n.code as string,
        name: n.name as string,
        position: (n.position as number) ?? 0,
      })) as WbsNode[],
      codeTypes: types,
      assignments: (assignRes.data ?? []).map((a) => ({
        taskId: a.task_id as string,
        typeId: a.type_id as string,
        valueId: a.value_id as string,
      })) as TaskCodeAssignment[],
    };
  });

/** ---------------- WBS CRUD ---------------- */
export const upsertWbsNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    scheduleId: string;
    id?: string;
    parentId?: string | null;
    code: string;
    name: string;
    position?: number;
  }) =>
    z
      .object({
        scheduleId: z.string().uuid(),
        id: z.string().uuid().optional(),
        parentId: z.string().uuid().nullable().optional(),
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        position: z.number().int().min(0).max(100000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const payload = {
      schedule_id: data.scheduleId,
      parent_id: data.parentId ?? null,
      code: data.code,
      name: data.name,
      position: data.position ?? 0,
    };
    if (data.id) {
      const { error } = await supabase.from("wbs_nodes").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("wbs_nodes")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const deleteWbsNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("wbs_nodes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** ---------------- Code type CRUD ---------------- */
export const upsertCodeType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    scheduleId: string;
    id?: string;
    name: string;
    description?: string | null;
    position?: number;
  }) =>
    z
      .object({
        scheduleId: z.string().uuid(),
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(64),
        description: z.string().max(500).nullable().optional(),
        position: z.number().int().min(0).max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const payload = {
      schedule_id: data.scheduleId,
      name: data.name,
      description: data.description ?? null,
      position: data.position ?? 0,
    };
    if (data.id) {
      const { error } = await supabase
        .from("activity_code_types")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("activity_code_types")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const deleteCodeType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("activity_code_types")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** ---------------- Code value CRUD ---------------- */
export const upsertCodeValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    typeId: string;
    id?: string;
    code: string;
    description?: string | null;
    color?: string | null;
    position?: number;
  }) =>
    z
      .object({
        typeId: z.string().uuid(),
        id: z.string().uuid().optional(),
        code: z.string().min(1).max(32),
        description: z.string().max(500).nullable().optional(),
        color: z
          .string()
          .regex(/^#?[0-9a-fA-F]{3,8}$/)
          .nullable()
          .optional(),
        position: z.number().int().min(0).max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const payload = {
      type_id: data.typeId,
      code: data.code,
      description: data.description ?? null,
      color: data.color ?? null,
      position: data.position ?? 0,
    };
    if (data.id) {
      const { error } = await supabase
        .from("activity_code_values")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("activity_code_values")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const deleteCodeValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("activity_code_values")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** ---------------- Task code assignment ---------------- */
export const assignTaskCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    scheduleId: string;
    taskId: string;
    typeId: string;
    valueId: string | null;
  }) =>
    z
      .object({
        scheduleId: z.string().uuid(),
        taskId: z.string().min(1).max(64),
        typeId: z.string().uuid(),
        valueId: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.valueId === null) {
      const { error } = await supabase
        .from("task_activity_codes")
        .delete()
        .eq("schedule_id", data.scheduleId)
        .eq("task_id", data.taskId)
        .eq("type_id", data.typeId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabase.from("task_activity_codes").upsert(
      {
        schedule_id: data.scheduleId,
        task_id: data.taskId,
        type_id: data.typeId,
        value_id: data.valueId,
      },
      { onConflict: "schedule_id,task_id,type_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
