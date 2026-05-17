import { createServerFn } from "@tanstack/react-start";
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
    z.object({ title: z.string().min(1).max(120).optional() }).parse,
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("ask_threads")
      .insert({ user_id: userId, title: data.title ?? "New conversation" })
      .select("id")
      .single();
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
