import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WeeklyMove = {
  id: string;
  headline: string;
  body: string;
  cta_label: string;
  cta_to: string | null;
  cta_href: string | null;
  source: string | null;
  active_from: string;
  active_to: string | null;
  created_at: string;
  updated_at: string;
};

const UpsertSchema = z.object({
  id: z.string().uuid().optional(),
  headline: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),

  ctaLabel: z.string().min(1).max(60),
  ctaTo: z.string().max(200).nullable().optional(),
  ctaHref: z.string().url().max(500).nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  activeFrom: z.string().datetime().optional(),
  activeTo: z.string().datetime().nullable().optional(),
});

export const getActiveWeeklyMove = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WeeklyMove | null> => {
    const { supabase } = context;
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("weekly_moves")
      .select(
        "id,headline,body,cta_label,cta_to,cta_href,source,active_from,active_to,created_at,updated_at",
      )
      .lte("active_from", nowIso)
      .or(`active_to.is.null,active_to.gt.${nowIso}`)
      .order("active_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as WeeklyMove | null) ?? null;
  });




export const listWeeklyMoves = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WeeklyMove[]> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data, error } = await supabase
      .from("weekly_moves")
      .select(
        "id,headline,body,cta_label,cta_to,cta_href,source,active_from,active_to,created_at,updated_at",
      )
      .order("active_from", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as WeeklyMove[];
  });

export const upsertWeeklyMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpsertSchema.parse(input))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const row = {
      headline: data.headline,
      body: data.body,
      cta_label: data.ctaLabel,
      cta_to: data.ctaTo ?? null,
      cta_href: data.ctaHref ?? null,
      source: data.source ?? null,
      active_from: data.activeFrom ?? new Date().toISOString(),
      active_to: data.activeTo ?? null,
      created_by: userId,
    };

    if (data.id) {
      const { error } = await supabase
        .from("weekly_moves")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: inserted, error } = await supabase
      .from("weekly_moves")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

export const archiveWeeklyMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await supabase
      .from("weekly_moves")
      .update({ active_to: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// keep these helpers referenced to avoid TS unused warnings in some configs
void assertAdmin;
void assertCallerIsAdmin;
