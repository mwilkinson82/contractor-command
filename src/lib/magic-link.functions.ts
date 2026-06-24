// Public magic-link entry point.
//
// The browser-side Supabase OTP call can report success without giving us
// control over whether a member actually receives an email. This server
// function owns the flow end-to-end: confirm/create the auth user for a live
// member, mint the one-time link, and send the branded login email directly.

import * as React from "react";
import { render } from "@react-email/components";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { buildTokenHashAuthUrl } from "@/lib/auth-link-url";

const Input = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

const SITE_NAME = "Contractor Circle";
const SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
const FROM_DOMAIN = "notify.mail.alpcontractorcircle.com";
const TEMPLATE_NAME = "magic-link";
const RECENT_SEND_WINDOW_MS = 60 * 1000;
const HOURLY_SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_LOGIN_EMAILS_PER_HOUR = 3;

function appOrigin(): string {
  return (
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com"
  ).replace(/\/$/, "");
}

function redactEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function findAuthUserByEmail(email: string) {
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (users.length < perPage) return null;
  }
  return null;
}

async function hasLiveSubscription(email: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("id,status,is_comped")
    .ilike("email", email)
    .or("status.in.(active,trialing),status.eq.comped,is_comped.eq.true")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function ensureAuthUserForMember(email: string): Promise<boolean> {
  const existing = await findAuthUserByEmail(email);
  if (existing) return true;

  if (!(await hasLiveSubscription(email))) return false;

  const { error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      source: "public_magic_link_request",
      created_at: new Date().toISOString(),
    },
  });

  if (error && !/already|registered|exists/i.test(error.message ?? "")) {
    throw error;
  }

  return true;
}

async function resolveFirstName(email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .ilike("email", email)
    .maybeSingle();

  const fullName = data?.full_name?.trim();
  return fullName ? fullName.split(/\s+/)[0] : null;
}

async function getLoginEmailThrottle(
  email: string,
): Promise<"ok" | "recent_duplicate" | "hourly_cap"> {
  const recentSince = new Date(Date.now() - RECENT_SEND_WINDOW_MS).toISOString();
  const hourlySince = new Date(Date.now() - HOURLY_SEND_WINDOW_MS).toISOString();

  const [{ data: recent }, { count: hourlyCount }] = await Promise.all([
    supabaseAdmin
      .from("email_send_log")
      .select("id")
      .ilike("recipient_email", email)
      .eq("template_name", TEMPLATE_NAME)
      .in("status", ["pending", "sent"])
      .gte("created_at", recentSince)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("email_send_log")
      .select("id", { count: "exact", head: true })
      .ilike("recipient_email", email)
      .eq("template_name", TEMPLATE_NAME)
      .in("status", ["pending", "sent", "suppressed", "failed"])
      .gte("created_at", hourlySince),
  ]);

  if (recent) return "recent_duplicate";
  if ((hourlyCount ?? 0) >= MAX_LOGIN_EMAILS_PER_HOUR) return "hourly_cap";
  return "ok";
}

async function ensureUnsubscribeToken(emailLower: string): Promise<string | null> {
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
    .upsert(
      { token: newToken, email: emailLower },
      { onConflict: "email", ignoreDuplicates: true },
    );

  const { data: stored } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", emailLower)
    .maybeSingle();

  return stored?.token ?? null;
}

async function sendLoginNudgeNow({
  email,
  firstName,
  confirmationUrl,
  idempotencyKey,
}: {
  email: string;
  firstName: string | null;
  confirmationUrl: string;
  idempotencyKey: string;
}): Promise<"sent" | "suppressed" | "failed"> {
  const apiKey = process.env.LOVABLE_API_KEY;
  const emailLower = email.toLowerCase();
  const messageId = crypto.randomUUID();

  const { data: suppressed } = await supabaseAdmin
    .from("suppressed_emails")
    .select("email")
    .eq("email", emailLower)
    .maybeSingle();

  if (suppressed) {
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "suppressed",
      metadata: {
        idempotency_key: idempotencyKey,
        channel: "public_magic_link",
        reason: "suppressed_email",
        send_method: "direct_lovable",
      },
    });
    return "suppressed";
  }

  const unsubscribeToken = await ensureUnsubscribeToken(emailLower);
  if (!unsubscribeToken) {
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "suppressed",
      error_message: "Unsubscribe token used",
      metadata: {
        idempotency_key: idempotencyKey,
        channel: "public_magic_link",
        reason: "unsubscribe_token_used",
        send_method: "direct_lovable",
      },
    });
    return "suppressed";
  }

  const entry = TEMPLATES[TEMPLATE_NAME];
  if (!entry || !apiKey) {
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "failed",
      error_message: !entry ? "Template not registered" : "LOVABLE_API_KEY missing",
      metadata: {
        idempotency_key: idempotencyKey,
        channel: "public_magic_link",
        reason: !entry ? "template_missing" : "lovable_api_key_missing",
        send_method: "direct_lovable",
      },
    });
    return "failed";
  }

  const props = {
    firstName: firstName ?? undefined,
    siteName: SITE_NAME,
    siteUrl: appOrigin(),
    confirmationUrl,
  };
  const element = React.createElement(entry.component, props);
  const html = await render(element);
  const plainText = await render(element, { plainText: true });
  const subject = typeof entry.subject === "function" ? entry.subject(props) : entry.subject;

  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: TEMPLATE_NAME,
    recipient_email: email,
    status: "pending",
    metadata: {
      idempotency_key: idempotencyKey,
      channel: "public_magic_link",
      send_method: "direct_lovable",
    },
  });

  try {
    await sendLovableEmail(
      {
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
        message_id: messageId,
      },
      { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
    );

    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "sent",
      metadata: {
        idempotency_key: idempotencyKey,
        channel: "public_magic_link",
        send_method: "direct_lovable",
      },
    });

    return "sent";
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "failed",
      error_message: errorMessage.slice(0, 1000),
      metadata: {
        idempotency_key: idempotencyKey,
        channel: "public_magic_link",
        send_method: "direct_lovable",
      },
    });
    console.error("[magic-link] direct send failed", {
      email: redactEmail(email),
      error: errorMessage,
    });
    return "failed";
  }
}

export type MagicLinkResult = {
  ok: true;
  // Always "sent" to unauthenticated callers. The actual action is logged
  // server-side only so the UI cannot enumerate member emails.
  action: "sent";
};

export const requestMemberMagicLink = createServerFn({ method: "POST" })
  .inputValidator(Input.parse)
  .handler(async ({ data }): Promise<MagicLinkResult> => {
    const email = data.email;
    const origin = appOrigin();
    const minDelay = new Promise((resolve) => setTimeout(resolve, 600));
    let internalAction:
      | "sent"
      | "rate_limited"
      | "suppressed"
      | "send_failed"
      | "not_a_live_member"
      | "link_failed" = "not_a_live_member";

    try {
      if (await ensureAuthUserForMember(email)) {
        const throttle = await getLoginEmailThrottle(email);
        if (throttle !== "ok") {
          internalAction = "rate_limited";
          console.warn("[magic-link] throttled", {
            email: redactEmail(email),
            reason: throttle,
          });
        } else {
          const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: { redirectTo: `${origin}/auth/callback` },
          });

          const tokenHash = link?.properties?.hashed_token;
          if (error || !tokenHash) {
            internalAction = "link_failed";
            console.error("[magic-link] generateLink failed", {
              email: redactEmail(email),
              error: error?.message ?? "No hashed_token returned from Supabase",
            });
          } else {
            const confirmationUrl = buildTokenHashAuthUrl({
              origin,
              tokenHash,
              type: "magiclink",
            });
            const firstName = await resolveFirstName(email);
            const sendStatus = await sendLoginNudgeNow({
              email,
              firstName,
              confirmationUrl,
              idempotencyKey: `public-signin-${email}-${Date.now()}`,
            });
            internalAction =
              sendStatus === "sent"
                ? "sent"
                : sendStatus === "suppressed"
                  ? "suppressed"
                  : "send_failed";
          }
        }
      }
    } catch (err) {
      console.error("[magic-link] internal error", {
        email: redactEmail(email),
        err,
      });
    }

    console.info("[magic-link]", { email: redactEmail(email), action: internalAction });

    await minDelay;
    return { ok: true, action: "sent" };
  });
