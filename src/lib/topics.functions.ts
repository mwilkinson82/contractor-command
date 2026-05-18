import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ADMIN_EMAIL = "marshall@marshallwilkinson.com";

const SubmitInput = z.object({
  kind: z.enum(["Biweekly Call", "Monthly Bootcamp"]),
  title: z.string().trim().min(1).max(200),
  needsPressure: z.string().trim().max(2000).optional().default(""),
  alreadyTried: z.string().trim().max(2000).optional().default(""),
  decisionAvoided: z.string().trim().max(2000).optional().default(""),
  financialConsequence: z.string().trim().max(2000).optional().default(""),
  winLooksLike: z.string().trim().max(2000).optional().default(""),
});

async function sendInternal(
  templateName: string,
  recipientEmail: string,
  templateData: Record<string, unknown>,
  idempotencyKey: string,
) {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization") ?? "";
  const origin =
    request?.headers.get("origin") ||
    (request?.url ? new URL(request.url).origin : "");
  if (!origin) {
    console.warn("[topics] No origin to call send endpoint");
    return;
  }
  try {
    const res = await fetch(`${origin}/lovable/email/transactional/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        templateName,
        recipientEmail,
        templateData,
        idempotencyKey,
      }),
    });
    if (!res.ok) {
      console.error("[topics] send failed", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[topics] send threw", err);
  }
}

export const submitCallTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SubmitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const userEmail = (claims.email as string) || "";

    // Look up profile for display name
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();

    const resolvedEmail = profile?.email || userEmail;
    const userName = profile?.full_name || null;

    const insert = await supabase
      .from("call_topics")
      .insert({
        user_id: userId,
        user_email: resolvedEmail,
        user_name: userName,
        kind: data.kind,
        title: data.title,
        needs_pressure: data.needsPressure || null,
        already_tried: data.alreadyTried || null,
        decision_avoided: data.decisionAvoided || null,
        financial_consequence: data.financialConsequence || null,
        win_looks_like: data.winLooksLike || null,
      })
      .select("id")
      .single();

    if (insert.error || !insert.data) {
      console.error("[topics] insert failed", insert.error);
      return { ok: false as const, error: "Could not save topic." };
    }

    const topicId = insert.data.id;

    // Determine admin URL from request origin
    const request = getRequest();
    const origin = request?.url ? new URL(request.url).origin : "";

    // Email admin (fire-and-forget; success returned to user either way)
    sendInternal(
      "topic-submitted",
      ADMIN_EMAIL,
      {
        submitterName: userName,
        submitterEmail: resolvedEmail,
        kind: data.kind,
        title: data.title,
        needsPressure: data.needsPressure,
        alreadyTried: data.alreadyTried,
        decisionAvoided: data.decisionAvoided,
        financialConsequence: data.financialConsequence,
        winLooksLike: data.winLooksLike,
        adminUrl: origin ? `${origin}/admin/topics` : undefined,
      },
      `topic-submitted-${topicId}`,
    ).catch(() => {});

    return { ok: true as const, id: topicId };
  });

const SelectInput = z.object({
  topicId: z.string().uuid(),
  sessionDate: z.string().optional(),
  zoomUrl: z.string().url().optional(),
});

export const selectCallTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SelectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify admin role
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roles) {
      return { ok: false as const, error: "Admin only." };
    }

    const { data: updated, error } = await supabase
      .from("call_topics")
      .update({
        status: "selected",
        selected_at: new Date().toISOString(),
        selected_for_session_date: data.sessionDate ?? null,
      })
      .eq("id", data.topicId)
      .select("id, user_email, user_name, kind, title")
      .single();

    if (error || !updated) {
      console.error("[topics] select update failed", error);
      return { ok: false as const, error: "Could not update topic." };
    }

    // Email submitter
    await sendInternal(
      "topic-selected",
      updated.user_email,
      {
        submitterName: updated.user_name?.split(" ")[0] || null,
        kind: updated.kind,
        title: updated.title,
        sessionDate: data.sessionDate,
        zoomUrl: data.zoomUrl,
      },
      `topic-selected-${updated.id}`,
    );

    await supabase
      .from("call_topics")
      .update({ notified_user_at: new Date().toISOString() })
      .eq("id", updated.id);

    return { ok: true as const };
  });

const UnselectInput = z.object({ topicId: z.string().uuid() });

export const unselectCallTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UnselectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roles) return { ok: false as const, error: "Admin only." };

    await supabase
      .from("call_topics")
      .update({ status: "pending", selected_at: null, selected_for_session_date: null })
      .eq("id", data.topicId);
    return { ok: true as const };
  });
