// Public magic-link entry point.
//
// The browser-side Supabase OTP call can report success without giving us
// control over whether a member actually receives an email. This server
// function owns the flow end-to-end: confirm/create the auth user for a live
// member, mint the one-time link, and send the branded login email directly.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { athenaPageReturn } from "@/lib/athena-page-return";
import { signInReturn } from "@/lib/board-sign-in";
import { oauthConsentReturn } from "@/lib/oauth-return-path";
import { buildTokenHashAuthUrl } from "@/lib/auth-link-url";
import { hubOrigin } from "@/lib/auth-origins";
import { isAthenaHost } from "@/lib/site-icons";

type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

const Input = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  continuation: z.string().max(512).optional(),
  return_to: z.string().max(512).optional(),
});

function fallbackAppOrigin(): string {
  return hubOrigin();
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
      host === "app.meetathena.io" ||
      host === "contractor-command.lovable.app" ||
      host === "id-preview--362c776b-68ab-4871-bedb-c42cb9843c1b.lovable.app";

    return allowed &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(host)))
      ? url.origin
      : null;
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

function isAthenaOrigin(origin: string): boolean {
  try {
    return isAthenaHost(new URL(origin).hostname);
  } catch {
    return false;
  }
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
  // Always "accepted" to unauthenticated callers. The actual action is logged
  // server-side only so the UI cannot enumerate member emails.
  action: "accepted";
};

export const requestMemberMagicLink = createServerFn({ method: "POST" })
  .inputValidator(Input.parse)
  .handler(async ({ data }): Promise<MagicLinkResult> => {
    const email = data.email;
    // Athena sign-ins (an OAuth consent continuation is present) always land on
    // the Athena app, whatever page the request came from. Hub sign-ins keep
    // the request-derived origin. Identity and the live-member check below are
    // the same for both.
    // v0.8.19: the link lands on the same host that started the connect. Forcing
    // app.meetathena.io moved phones to a second host mid-connect, and the auth
    // server rejects consent calls from that origin ("unauthorized request
    // origin") while the Site URL is elsewhere, so the authorization never got a user.
    const origin = appOrigin();
    const minDelay = new Promise((resolve) => setTimeout(resolve, 600));
    let internalAction:
      | "sent"
      | "suppressed"
      | "send_failed"
      | "not_a_live_member"
      | "link_failed"
      | "error" = "not_a_live_member";

    try {
      const path = oauthConsentReturn(data.continuation);
      if (data.continuation && !path) throw new Error("Invalid continuation");
      // A job board return is limited to /r/job and drops the token and utm params.
      // Other Athena pages (a file link, the account page) keep their own allowlist.
      const pageReturn = path
        ? undefined
        : (signInReturn(data.return_to) ?? athenaPageReturn(data.return_to));
      const { createOAuthContinuation, assertOAuthContinuationConfigured } =
        await import("./oauth-continuation.server");
      // Check configuration before identity lookup or token minting. An outage
      // is observable to operators regardless of whether this email is eligible.
      if (path) assertOAuthContinuationConfigured();
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
            reason: "link_generation_failed",
          });
        } else {
          const continuation = path
            ? createOAuthContinuation(path, link.user.id, tokenHash)
            : undefined;
          const confirmationUrl = buildTokenHashAuthUrl({
            origin,
            tokenHash,
            type: "magiclink",
            continuation,
            redirect: pageReturn,
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
            // v0.8.19: the same one-time code, typed in the tab that started the
            // connect, so a phone never has to switch tabs or browsers.
            ...((continuation || isAthenaOrigin(origin)) && link.properties?.email_otp
              ? { otpCode: String(link.properties.email_otp) }
              : {}),
            // Presentation only: a validated consent continuation, or a sign-in
            // started on the Athena host, gets the Athena email. Not proof of
            // client identity; the link and checks are the same for both.
            ...(continuation || isAthenaOrigin(origin) ? { variant: "athena" as const } : {}),
            ...(continuation ? { connecting: true } : {}),
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
      internalAction = "error";
      console.error("[magic-link] internal error", {
        email: redactEmail(email),
        reason: "request_failed",
      });
    }

    console.info("[magic-link]", { email: redactEmail(email), action: internalAction });

    await minDelay;
    return { ok: true, action: "accepted" };
  });
