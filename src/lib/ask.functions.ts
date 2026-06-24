import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AskThread = {
  id: string;
  title: string;
  updated_at: string;
};

export type AskMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

function isMissingSourceColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.message?.toLowerCase().includes("source") === true
  );
}

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AskThread[]> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("ask_threads")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        title: z.string().min(1).max(120).optional(),
        source: z
          .enum(["dashboard_hero", "ask_index", "ask_new", "operating_playbook"])
          .optional(),
      })
      .parse,
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    const insert = {
      user_id: userId,
      title: data.title ?? "New conversation",
      source: data.source ?? "unknown",
    };
    let result = await supabase
      .from("ask_threads")
      .insert(insert)
      .select("id")
      .single();

    if (isMissingSourceColumnError(result.error)) {
      result = await supabase
        .from("ask_threads")
        .insert({ user_id: insert.user_id, title: insert.title })
        .select("id")
        .single();
    }

    const { data: row, error } = result;
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const getThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ threadId: z.string().uuid() }).parse)
  .handler(
    async ({
      data,
      context,
    }): Promise<{ thread: AskThread; messages: AskMessage[] } | null> => {
      const { supabase } = context;
      const { data: thread, error: tErr } = await supabase
        .from("ask_threads")
        .select("id,title,updated_at")
        .eq("id", data.threadId)
        .maybeSingle();
      if (tErr) throw new Error(tErr.message);
      if (!thread) return null;

      const { data: messages, error: mErr } = await supabase
        .from("ask_messages")
        .select("id,role,content,created_at")
        .eq("thread_id", data.threadId)
        .order("created_at", { ascending: true });
      if (mErr) throw new Error(mErr.message);
      return {
        thread: thread as AskThread,
        messages: (messages ?? []) as AskMessage[],
      };
    },
  );

export const renameThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ threadId: z.string().uuid(), title: z.string().min(1).max(120) })
      .parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("ask_threads")
      .update({ title: data.title })
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const expressIntensiveInterest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      threadId: z.string().uuid(),
      note: z.string().max(2000).optional(),
    }).parse,
  )
  .handler(async ({ data, context }): Promise<{ ok: true; alreadyOpen: boolean }> => {
    const { supabase, userId, claims } = context;

    // Avoid duplicate open leads per thread
    const { data: existing } = await supabase
      .from("vault_packets")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", "intensive_lead")
      .eq("status", "Open")
      .contains("payload", { thread_id: data.threadId })
      .maybeSingle();

    if (existing) return { ok: true, alreadyOpen: true };

    // Pull thread + last few messages for context
    const { data: thread } = await supabase
      .from("ask_threads")
      .select("id,title,company_id")
      .eq("id", data.threadId)
      .maybeSingle();

    const { data: recent } = await supabase
      .from("ask_messages")
      .select("role,content,created_at")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: false })
      .limit(8);

    const { error } = await supabase.from("vault_packets").insert({
      user_id: userId,
      company_id: thread?.company_id ?? null,
      kind: "intensive_lead",
      source: "ask_marshall",
      status: "Open",
      title: `Intensive interest — ${thread?.title ?? "Ask Marshall"}`,
      payload: {
        thread_id: data.threadId,
        thread_title: thread?.title ?? null,
        note: data.note ?? null,
        recent_messages: (recent ?? []).reverse(),
        captured_at: new Date().toISOString(),
      },
    });
    if (error) throw new Error(error.message);

    // Internal notify — bypasses approval queue (template has fixed `to`)
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", userId)
        .maybeSingle();
      const req = getRequest();
      const authHeader = req?.headers.get("authorization") ?? "";
      const origin =
        req?.headers.get("origin") ||
        (req?.url ? new URL(req.url).origin : "");
      if (origin) {
        await fetch(`${origin}/lovable/email/transactional/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: JSON.stringify({
            templateName: "admin-activity-notice",
            recipientEmail: "wilkinson.marshall@gmail.com",
            idempotencyKey: `intensive-lead-${data.threadId}-${userId}`,
            templateData: {
              event: "New intensive lead",
              memberEmail: prof?.email ?? (claims.email as string) ?? "—",
              memberName: prof?.full_name ?? null,
              occurredAt: new Date().toISOString(),
            },
          }),
        }).catch((e) => console.error("[ask] intensive notify failed", e));
      }
    } catch (e) {
      console.error("[ask] intensive notify threw", e);
    }

    return { ok: true, alreadyOpen: false };
  });

export const DAILY_ASK_LIMIT = 30;
export const DAILY_ASK_LIMIT_BOOK_BUYER = 15;

export const getDailyAskUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ used: number; limit: number; remaining: number }> => {
      const { supabase, userId } = context;
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      // Tier-aware cap: book buyers (and aos_only) get 15/day; everyone
      // else gets 30/day. Mirrors src/routes/api/ask.ts.
      const { data: tierRow } = await supabase.rpc("get_user_tier", {
        _user_id: userId,
      });
      const userTier = (tierRow as string | null) ?? null;
      const limit =
        userTier === "book_buyer" || userTier === "aos_only" || userTier === null
          ? DAILY_ASK_LIMIT_BOOK_BUYER
          : DAILY_ASK_LIMIT;

      const { count } = await supabase
        .from("ask_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("role", "user")
        .gte("created_at", startOfDay.toISOString());
      const used = count ?? 0;
      return { used, limit, remaining: Math.max(0, limit - used) };
    },
  );

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ threadId: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("ask_threads")
      .delete()
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
