import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IntensiveLeadMessage = {
  role: string;
  content: string;
  created_at: string;
};

export type IntensiveLead = {
  id: string;
  user_id: string;
  status: string;
  title: string;
  created_at: string;
  email: string | null;
  full_name: string | null;
  thread_id: string | null;
  thread_title: string | null;
  note: string | null;
  captured_at: string | null;
  recent_messages: IntensiveLeadMessage[];
};

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const listIntensiveLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntensiveLead[]> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabaseAdmin, userId);

    const { data: packets, error } = await supabaseAdmin
      .from("vault_packets")
      .select("id, user_id, status, title, created_at, payload")
      .eq("kind", "intensive_lead")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((packets ?? []).map((p) => p.user_id)));
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

    return (packets ?? []).map((p) => {
      const payload = (p.payload ?? {}) as Record<string, any>;
      const prof = byId.get(p.user_id);
      return {
        id: p.id,
        user_id: p.user_id,
        status: p.status,
        title: p.title,
        created_at: p.created_at,
        email: prof?.email ?? null,
        full_name: prof?.full_name ?? null,
        thread_id: payload.thread_id ?? null,
        thread_title: payload.thread_title ?? null,
        note: payload.note ?? null,
        captured_at: payload.captured_at ?? null,
        recent_messages: Array.isArray(payload.recent_messages)
          ? payload.recent_messages
          : [],
      };
    });
  });

export const setIntensiveLeadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: string }) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["Open", "Contacted", "Won", "Lost"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabaseAdmin, context.userId);
    const { error } = await supabaseAdmin
      .from("vault_packets")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("kind", "intensive_lead");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
