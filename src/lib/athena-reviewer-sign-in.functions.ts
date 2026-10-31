// Server gate for the one Athena reviewer password. The browser never calls
// signInWithPassword: this host's Origin is not the Auth Site URL, and that
// Site URL stays unchanged. The password is checked here and is not logged.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  attemptAthenaReviewerPassword,
  athenaReviewerRequestAllowed,
  reviewerSessionUser,
  type ReviewerPasswordResult,
} from "./athena-reviewer-sign-in";

const Email = z.string().trim().toLowerCase().email().max(255);

function envValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseBody(value: unknown): { email: string; password: string } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { email?: unknown; password?: unknown };
  const email = Email.safeParse(body.email);
  if (!email.success) return null;
  const password = typeof body.password === "string" ? body.password : "";
  return { email: email.data, password };
}

async function signInReviewer(email: string, password: string) {
  const url = envValue(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = envValue([
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  ]);
  if (!url || !key) return { error: { message: "unavailable" }, session: null };
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (
    error ||
    !data.session?.access_token ||
    !data.session.refresh_token ||
    !data.session.user?.id
  ) {
    return { error: { message: "rejected" }, session: null };
  }
  const session = data.session;
  return {
    error: null,
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type,
      user: reviewerSessionUser(session.user),
    },
  };
}

export const reviewerPasswordSignIn = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => value)
  .handler(async ({ data }): Promise<ReviewerPasswordResult> => {
    const parsed = parseBody(data);
    if (!parsed) return { ok: false, code: "use_email_code" };
    const request = getRequest();
    const onAthenaHost = request
      ? athenaReviewerRequestAllowed({
          origin: request.headers.get("origin"),
          forwardedHost: request.headers.get("x-forwarded-host"),
          host: request.headers.get("host"),
          url: request.url,
        })
      : false;
    return attemptAthenaReviewerPassword({
      email: parsed.email,
      password: parsed.password,
      onAthenaHost,
      signIn: signInReviewer,
    });
  });
