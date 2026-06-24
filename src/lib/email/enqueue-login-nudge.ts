// Server-side helper to enqueue the dedicated magic-link sign-in email with a
// direct one-tap sign-in URL. Used by the admin "Email sign-in link" action.

import * as React from "react";
import { render } from "@react-email/components";
import { TEMPLATES } from "@/lib/email-templates/registry";

type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

const SITE_NAME = "Contractor Circle";
const SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
const FROM_DOMAIN = "notify.mail.alpcontractorcircle.com";
const TEMPLATE_NAME = "magic-link";

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
  if (existing && existing.used_at) return null;
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
  confirmationUrl: string;
  idempotencyKey: string;
}

export async function enqueueLoginNudge({
  supabaseAdmin,
  email,
  firstName,
  confirmationUrl,
  idempotencyKey,
}: EnqueueOpts): Promise<{ status: "queued" | "suppressed" | "failed"; reason?: string }> {
  const emailLower = email.toLowerCase();

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
    confirmationUrl,
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
