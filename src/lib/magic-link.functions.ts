// Public magic-link entry point.
//
// The browser-side Supabase OTP call can report success without giving us
// control over whether a member actually receives an email. This server
// function owns the flow end-to-end: confirm/create the auth user for a live
// member, mint the one-time link, and send the branded login email directly.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { buildTokenHashAuthUrl } from "@/lib/auth-link-url";

type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

const Input = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

function fallbackAppOrigin(): string {
  return (
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com"
  ).replace(/\/$/, "");
}

function allowedRequestOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const allowed =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "app.alpcontractorcircle.com" ||
      host === "contractor-command.lovable.app" ||
      (host.endsWith(".lovable.app") && host.startsWith("id-preview--"));

    return allowed ? url.origin : null;
  } catch {
    return null;
  }
}

function originFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function appOrigin(): string {
  const request = getRequest();
  const requestOrigin =
    allowedRequestOrigin(request?.headers.get("origin")) ||
    allowedRequestOrigin(originFromUrl(request?.headers.get("referer"))) ||
    allowedRequestOrigin(originFromUrl(request?.url));

  return requestOrigin ?? fallbackAppOrigin();
}

function redactEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

async function findAuthUserByEmail(supabaseAdmin: SupabaseAdminClient, email: string) {
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

async function hasLiveSubscription(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
): Promise<boolean> {
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

async function ensureAuthUserForMember(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
): Promise<boolean> {
  const existing = await findAuthUserByEmail(supabaseAdmin, email);
  if (existing) return true;

  if (!(await hasLiveSubscription(supabaseAdmin, email))) return false;

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

async function resolveFirstName(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .ilike("email", email)
    .maybeSingle();

  const fullName = data?.full_name?.trim();
  return fullName ? fullName.split(/\s+/)[0] : null;
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
      | "suppressed"
      | "send_failed"
      | "not_a_live_member"
      | "link_failed" = "not_a_live_member";

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      if (await ensureAuthUserForMember(supabaseAdmin, email)) {
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
          const firstName = await resolveFirstName(supabaseAdmin, email);
          const { sendLoginNudgeNow } = await import("@/lib/email/send-login-nudge-now");
          const sendResult = await sendLoginNudgeNow({
            supabaseAdmin,
            email,
            firstName,
            confirmationUrl,
            idempotencyKey: `public-signin-${email}-${Date.now()}`,
            channel: "public_magic_link",
            siteUrl: origin,
          });
          internalAction =
            sendResult.status === "sent"
              ? "sent"
              : sendResult.status === "suppressed"
                ? "suppressed"
                : "send_failed";
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
