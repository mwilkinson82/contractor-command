// Server-side helper to enqueue the Circle welcome email.
// Safe to call from the Stripe webhook (no Supabase JWT required — uses the
// service role admin client + enqueue_email RPC directly).
//
// Idempotent: keys on `circle-welcome-{stripe_subscription_id}` via
// email_send_log.idempotency_key-style metadata + checking for prior sends.

import * as React from "react";
import { render } from "@react-email/components";
import { TEMPLATES } from "@/lib/email-templates/registry";

type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

const SITE_NAME = "Contractor Circle";
const SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
const FROM_DOMAIN = "notify.mail.alpcontractorcircle.com";
const TEMPLATE_NAME = "circle-welcome";

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureUnsubscribeToken(
  supabaseAdmin: SupabaseAdminClient,
  emailLower: string,
): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token,used_at")
    .eq("email", emailLower)
    .maybeSingle();
  if (existing && !existing.used_at) return existing.token;
  if (existing && existing.used_at) return null; // user unsubscribed
  const newToken = generateToken();
  await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .upsert({ token: newToken, email: emailLower }, { onConflict: "email", ignoreDuplicates: true });
  const { data: stored } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", emailLower)
    .maybeSingle();
  return stored?.token ?? null;
}

interface EnqueueOpts {
  supabaseAdmin: SupabaseAdminClient;
  email: string;
  firstName?: string | null;
  loginUrl?: string | null;
  idempotencyKey: string;
}

export async function enqueueCircleWelcome({
  supabaseAdmin,
  email,
  firstName,
  loginUrl,
  idempotencyKey,
}: EnqueueOpts): Promise<{ status: "queued" | "duplicate" | "suppressed" | "failed"; reason?: string }> {
  const emailLower = email.toLowerCase();

  // Dedup: skip if we've already logged this idempotency key.
  const { data: priorLog } = await supabaseAdmin
    .from("email_send_log")
    .select("id")
    .eq("template_name", TEMPLATE_NAME)
    .contains("metadata", { idempotency_key: idempotencyKey })
    .limit(1)
    .maybeSingle();
  if (priorLog) return { status: "duplicate" };

  // Suppression check
  const { data: suppressed } = await supabaseAdmin
    .from("suppressed_emails")
    .select("email")
    .eq("email", emailLower)
    .maybeSingle();
  if (suppressed) {
    await supabaseAdmin.from("email_send_log").insert({
      message_id: crypto.randomUUID(),
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "suppressed",
      metadata: { idempotency_key: idempotencyKey },
    });
    return { status: "suppressed" };
  }

  const unsubscribeToken = await ensureUnsubscribeToken(supabaseAdmin, emailLower);
  if (!unsubscribeToken) return { status: "suppressed", reason: "unsubscribed" };

  const entry = TEMPLATES[TEMPLATE_NAME];
  if (!entry) return { status: "failed", reason: "template_not_registered" };

  const props = {
    firstName: firstName ?? undefined,
    siteName: SITE_NAME,
    siteUrl: "https://app.alpcontractorcircle.com",
    loginUrl: loginUrl ?? undefined,
  };
  const element = React.createElement(entry.component, props);
  const html = await render(element);
  const plainText = await render(element, { plainText: true });
  const subject =
    typeof entry.subject === "function" ? entry.subject(props) : entry.subject;

  const messageId = crypto.randomUUID();

  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: TEMPLATE_NAME,
    recipient_email: email,
    status: "pending",
    metadata: { idempotency_key: idempotencyKey },
  });

  const { error: enqueueError } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      to: email,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text: plainText,
      purpose: "transactional",
      label: TEMPLATE_NAME,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  });

  if (enqueueError) {
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "failed",
      error_message: enqueueError.message,
      metadata: { idempotency_key: idempotencyKey },
    });
    return { status: "failed", reason: enqueueError.message };
  }

  return { status: "queued" };
}
