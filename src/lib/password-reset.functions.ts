// Public password-reset entry point.
//
// The default supabase.auth.resetPasswordForEmail() silently no-ops when the
// email isn't in auth.users — which is true for ~27/29 of our migrated
// members. So "forgot password" appeared broken: the UI said "check your
// inbox" but Supabase never sent anything.
//
// This server fn:
//   1. Looks up the email in auth.users (admin).
//   2. If the user exists → sends a normal recovery email.
//   3. If not, but they have a subscription → sends an invite (welcome flow),
//      which lets them set a password for the first time.
//   4. Otherwise → returns ok without leaking existence.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import * as React from "react";
import { render } from "@react-email/components";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ATHENA_ORIGIN, hubOrigin } from "@/lib/auth-origins";
import { buildTokenHashAuthUrl } from "@/lib/auth-link-url";
import { AthenaAuthEmail, athenaAuthSubject } from "@/lib/email-templates/athena-auth-email";
import { ATHENA_FROM, ATHENA_SENDER_DOMAIN } from "@/lib/email/athena-sender";
import { MEMBER_REPLY_TO } from "@/lib/email/reply-to";
import { isAthenaHost } from "@/lib/site-icons";

const Input = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

function appOrigin(): string {
  return hubOrigin();
}

/** True when the reset was requested from an Athena page (presentation only: brand and landing host). */
function requestedFromAthena(): boolean {
  try {
    const headers = getRequest()?.headers;
    const raw = headers?.get("origin") || headers?.get("referer") || "";
    if (raw) return isAthenaHost(new URL(raw).hostname);
    const host = (headers?.get("x-forwarded-host") || headers?.get("host") || "")
      .split(",")[0]
      .trim();
    return isAthenaHost(host.replace(/:\d+$/, ""));
  } catch {
    return false;
  }
}

/**
 * Athena recovery: mint the recovery token ourselves and send the Athena email,
 * so the link lands on app.meetathena.io/auth/callback (token_hash, verified in
 * the page) and never depends on the Auth redirect allow-list or Site URL.
 */
async function sendAthenaRecovery(email: string): Promise<boolean> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("[password-reset] LOVABLE_API_KEY not configured");
    return false;
  }
  const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("[password-reset] athena recovery link failed", error?.message ?? "no token");
    return false;
  }
  const { data: suppressed } = await supabaseAdmin
    .from("suppressed_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (suppressed) return false;
  const confirmationUrl = buildTokenHashAuthUrl({
    origin: ATHENA_ORIGIN,
    tokenHash,
    type: "recovery",
  });
  const element = React.createElement(AthenaAuthEmail, { kind: "recovery", confirmationUrl });
  const messageId = crypto.randomUUID();
  const meta = {
    channel: "password_reset",
    send_method: "direct_lovable",
    sender_domain: ATHENA_SENDER_DOMAIN,
  };
  try {
    await sendLovableEmail(
      {
        to: email,
        from: ATHENA_FROM,
        reply_to: MEMBER_REPLY_TO,
        sender_domain: ATHENA_SENDER_DOMAIN,
        subject: athenaAuthSubject("recovery"),
        html: await render(element),
        text: await render(element, { plainText: true }),
        purpose: "transactional",
        label: "athena-recovery",
        idempotency_key: `athena-recovery-${email}-${Date.now()}`,
        message_id: messageId,
      },
      { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
    );
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: "athena-recovery",
      recipient_email: email,
      status: "sent",
      metadata: meta,
    });
    return true;
  } catch (err) {
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: "athena-recovery",
      recipient_email: email,
      status: "failed",
      error_message: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
      metadata: meta,
    });
    console.error("[password-reset] athena recovery send failed");
    return false;
  }
}

async function findAuthUserByEmail(email: string) {
  // listUsers doesn't support filtering by email server-side, so we page.
  // Capped to keep this snappy; we only have ~hundreds of users.
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

export type ResetResult = {
  ok: true;
  // Always "sent" to unauthenticated callers — do NOT branch UI on this.
  // The real action taken (recovery / invite / noop) is logged server-side only
  // to prevent email/subscriber enumeration.
  action: "sent";
};

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator(Input.parse)
  .handler(async ({ data }): Promise<ResetResult> => {
    const email = data.email;
    const origin = appOrigin();

    // Uniform delay neutralises timing side-channels between the three paths
    // (recovery / invite / noop). Tuned to comfortably exceed the slow path
    // (admin listUsers paging + Supabase email send).
    const minDelay = new Promise((r) => setTimeout(r, 600));

    let internalAction: "recovery_sent" | "invite_sent" | "noop" = "noop";

    try {
      const existing = await findAuthUserByEmail(email);

      if (existing && requestedFromAthena()) {
        if (await sendAthenaRecovery(email)) internalAction = "recovery_sent";
      } else if (existing) {
        const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/reset-password`,
        });
        if (error) {
          console.error("[password-reset] recovery send failed", error.message);
        } else {
          internalAction = "recovery_sent";
        }
      } else {
        // No auth account — check if they're an active paid/comped member we migrated.
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("email")
          .ilike("email", email)
          .or("status.in.(active,trialing),is_comped.eq.true")
          .limit(1)
          .maybeSingle();

        if (sub) {
          const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            data: { migrated_from: "manus", migrated_at: new Date().toISOString() },
            redirectTo: `${origin}/welcome`,
          });
          if (error) {
            console.error("[password-reset] invite send failed", error.message);
          } else {
            internalAction = "invite_sent";
          }
        }
      }
    } catch (err) {
      // Swallow errors to avoid leaking which path threw. Log server-side.
      console.error("[password-reset] internal error", err);
    }

    console.info("[password-reset]", { email, action: internalAction });

    await minDelay;
    return { ok: true, action: "sent" };
  });
