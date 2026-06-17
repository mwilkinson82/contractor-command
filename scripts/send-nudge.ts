import * as React from "react";
import { render } from "@react-email/components";
import { createClient } from "@supabase/supabase-js";
import { template as discordNudge } from "../src/lib/email-templates/discord-nudge";
import { DISCORD_URL } from "../src/lib/program";

const SITE_NAME = "Contractor Circle";
const SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
const FROM_DOMAIN = "notify.mail.alpcontractorcircle.com";
const TEMPLATE_NAME = "discord-nudge";

const SUPABASE_URL = `https://${process.env.PROJECT_REF || "qcbbjjjxcacrscfhgfmf"}.supabase.co`;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function tok() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function ensureUnsub(email: string) {
  const { data: existing } = await supa
    .from("email_unsubscribe_tokens")
    .select("token,used_at").eq("email", email).maybeSingle();
  if (existing?.used_at) return null;
  if (existing) return existing.token;
  const t = tok();
  await supa.from("email_unsubscribe_tokens")
    .upsert({ token: t, email }, { onConflict: "email", ignoreDuplicates: true });
  const { data } = await supa.from("email_unsubscribe_tokens")
    .select("token").eq("email", email).maybeSingle();
  return data?.token ?? null;
}

const recipients: Array<{ email: string; firstName?: string }> = JSON.parse(
  process.env.RECIPIENTS_JSON!
);

const results: Record<string, number> = { queued: 0, duplicate: 0, suppressed: 0, failed: 0 };

for (const r of recipients) {
  const emailLower = r.email.toLowerCase();
  const idempotencyKey = `discord-nudge-2026-06-17-${emailLower}`;

  const { data: prior } = await supa.from("email_send_log")
    .select("id").eq("template_name", TEMPLATE_NAME)
    .contains("metadata", { idempotency_key: idempotencyKey })
    .limit(1).maybeSingle();
  if (prior) { results.duplicate++; console.log("dup", r.email); continue; }

  const { data: supp } = await supa.from("suppressed_emails")
    .select("email").eq("email", emailLower).maybeSingle();
  if (supp) { results.suppressed++; console.log("suppressed", r.email); continue; }

  const unsub = await ensureUnsub(emailLower);
  if (!unsub) { results.suppressed++; console.log("unsubscribed", r.email); continue; }

  const props = {
    firstName: r.firstName,
    siteName: SITE_NAME,
    discordUrl: DISCORD_URL,
  };
  const el = React.createElement(discordNudge.component as any, props);
  const html = await render(el);
  const plainText = await render(el, { plainText: true });
  const subject = typeof discordNudge.subject === "function"
    ? (discordNudge.subject as any)(props) : discordNudge.subject;

  const messageId = crypto.randomUUID();

  await supa.from("email_send_log").insert({
    message_id: messageId, template_name: TEMPLATE_NAME,
    recipient_email: r.email, status: "pending",
    metadata: { idempotency_key: idempotencyKey, bulk: "discord-nudge-2026-06" },
  });

  const { error } = await supa.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId, to: r.email,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject, html, text: plainText,
      purpose: "transactional", label: TEMPLATE_NAME,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsub,
      queued_at: new Date().toISOString(),
    },
  });

  if (error) {
    results.failed++;
    console.log("fail", r.email, error.message);
    await supa.from("email_send_log").insert({
      message_id: messageId, template_name: TEMPLATE_NAME,
      recipient_email: r.email, status: "failed",
      error_message: error.message,
      metadata: { idempotency_key: idempotencyKey },
    });
  } else {
    results.queued++;
    console.log("queued", r.email);
  }
}

console.log("RESULTS", JSON.stringify(results));
