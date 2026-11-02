// Athena password sign-in is one account. Everyone else stays on the emailed code.
// The allowlist is this constant. ATHENA_REVIEWER_EMAIL may repeat it; any other
// value turns the password path off. The password is never stored here.
import { athenaCodeSignInDestination } from "./athena-code-sign-in";
import { isAthenaHost } from "./site-icons";

export const ATHENA_REVIEWER_EMAIL = "athena-reviewer@meetathena.io";

export const REVIEWER_USE_CODE_MESSAGE = "Use the emailed sign-in code for this account.";
export const REVIEWER_REJECTED_MESSAGE = "That password didn't work. Try again.";

const PASSWORD_MAX = 200;

/** Fields the auth client needs in storage. No index signature: the server return must stay serializable. */
export type ReviewerSessionUser = {
  id: string;
  aud: string;
  role: string;
  email: string | null;
  app_metadata: { provider: string | null; providers: string[] };
  user_metadata: { full_name: string | null };
};

export type ReviewerSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: ReviewerSessionUser;
};

export type ReviewerPasswordResult =
  | ({ ok: true } & ReviewerSession)
  | { ok: false; code: "use_email_code" | "rejected" };

type SignInResult = {
  error: { message?: string } | null;
  session: {
    access_token: string;
    refresh_token: string;
    expires_in?: number | null;
    expires_at?: number | null;
    token_type?: string | null;
    user: ReviewerSessionUser;
  } | null;
};

export function reviewerSessionUser(user: {
  id: string;
  aud?: string | null;
  role?: string | null;
  email?: string | null;
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
  user_metadata?: { full_name?: unknown } | null;
}): ReviewerSessionUser {
  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers.filter((item): item is string => typeof item === "string")
    : [];
  const provider = user.app_metadata?.provider;
  const fullName = user.user_metadata?.full_name;
  return {
    id: user.id,
    aud: user.aud || "authenticated",
    role: user.role || "authenticated",
    email: user.email ?? null,
    app_metadata: {
      provider: typeof provider === "string" ? provider : null,
      providers,
    },
    user_metadata: { full_name: typeof fullName === "string" ? fullName : null },
  };
}

export function normalizeReviewerEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The one address that may use a password, or null when the env lock does not match it. */
export function configuredReviewerEmail(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const fromEnv = env.ATHENA_REVIEWER_EMAIL?.trim().toLowerCase() ?? "";
  if (fromEnv && fromEnv !== ATHENA_REVIEWER_EMAIL) return null;
  return ATHENA_REVIEWER_EMAIL;
}

export function isAthenaReviewerEmail(
  email: string,
  env?: Record<string, string | undefined>,
): boolean {
  const allowed = configuredReviewerEmail(env);
  if (!allowed) return false;
  return normalizeReviewerEmail(email) === allowed;
}

/** `?reviewer=1` on the Athena sign-in page. Anything else stays on the code form. */
export function reviewerSearchFlag(value: unknown): 1 | undefined {
  return value === 1 || value === "1" ? 1 : undefined;
}

function sameOriginPath(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
    return undefined;
  return value;
}

/** Password form, keeping the OAuth return path when there is one. */
export function reviewerSignInHref(redirectTo: string | undefined): string {
  const params = new URLSearchParams();
  const redirect = sameOriginPath(redirectTo);
  if (redirect) params.set("redirect", redirect);
  params.set("reviewer", "1");
  return `/login?${params.toString()}`;
}

/** Code form. Drops `reviewer` so a refresh does not bring the password form back. */
export function memberCodeSignInHref(redirectTo: string | undefined): string {
  const redirect = sameOriginPath(redirectTo);
  if (!redirect) return "/login";
  const params = new URLSearchParams();
  params.set("redirect", redirect);
  return `/login?${params.toString()}`;
}

function hostnameFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.split(",")[0]?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * First host we can read decides. A browser call sends Origin. A proxied call
 * may only have the forwarded host. The Hub host is not Athena, so this
 * endpoint does not run there.
 */
export function athenaReviewerRequestAllowed(input: {
  origin?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  url?: string | null;
}): boolean {
  for (const value of [input.origin, input.forwardedHost, input.host, input.url]) {
    const host = hostnameFrom(value);
    if (!host) continue;
    return isAthenaHost(host);
  }
  return false;
}

export function supabaseAuthStorageKey(supabaseUrl: string): string {
  let ref = "auth";
  try {
    const host = new URL(supabaseUrl).hostname;
    ref = host.split(".")[0] || ref;
  } catch {
    /* keep the fallback key */
  }
  return `sb-${ref}-auth-token`;
}

/**
 * The JSON the auth client reads from storage on the next page load.
 * A browser setSession would call /user, and this host cannot do that
 * without changing the Auth Site URL. A future expires_at is used as stored.
 */
export function reviewerSessionRecord(session: ReviewerSession): string {
  return JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
  });
}

export function installReviewerSession(
  session: ReviewerSession,
  deps: { supabaseUrl: string; setItem: (key: string, value: string) => void },
): void {
  deps.setItem(supabaseAuthStorageKey(deps.supabaseUrl), reviewerSessionRecord(session));
}

function sessionFromSignIn(session: NonNullable<SignInResult["session"]>): ReviewerSession | null {
  if (!session.access_token || !session.refresh_token || !session.user?.id) return null;
  const expiresIn =
    typeof session.expires_in === "number" && session.expires_in > 0 ? session.expires_in : 3600;
  const expiresAt =
    typeof session.expires_at === "number" && session.expires_at > 0
      ? session.expires_at
      : Math.floor(Date.now() / 1000) + expiresIn;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: session.token_type || "bearer",
    user: session.user,
  };
}

/**
 * Allowlist first. signInWithPassword runs only for that one address, and only
 * on an Athena host. Any other email is sent back to the code flow and the
 * password is not checked.
 */
export async function attemptAthenaReviewerPassword(args: {
  email: string;
  password: string;
  onAthenaHost: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  env?: Record<string, string | undefined>;
}): Promise<ReviewerPasswordResult> {
  if (!args.onAthenaHost || !isAthenaReviewerEmail(args.email, args.env)) {
    return { ok: false, code: "use_email_code" };
  }
  if (!args.password || args.password.length > PASSWORD_MAX) {
    return { ok: false, code: "rejected" };
  }
  let signed: SignInResult;
  try {
    signed = await args.signIn(normalizeReviewerEmail(args.email), args.password);
  } catch {
    return { ok: false, code: "rejected" };
  }
  if (signed.error || !signed.session) return { ok: false, code: "rejected" };
  const session = sessionFromSignIn(signed.session);
  if (!session) return { ok: false, code: "rejected" };
  return { ok: true, ...session };
}

/**
 * Client half of the reviewer path. The server already decided. A non-allowlisted
 * email returns to the code form. A good password is stored, then the same
 * same-origin redirect the code flow uses (including OAuth consent).
 */
export async function submitAthenaReviewerPassword(args: {
  email: string;
  password: string;
  redirectTo: string | undefined;
  onAthenaHost: boolean;
  request: (input: { email: string; password: string }) => Promise<ReviewerPasswordResult>;
  install: (session: ReviewerSession) => void;
  assign: (url: string) => void;
}): Promise<{ ok: true; destination: string } | { ok: false; showCode: boolean; message: string }> {
  let result: ReviewerPasswordResult;
  try {
    result = await args.request({ email: args.email.trim(), password: args.password });
  } catch {
    return { ok: false, showCode: false, message: REVIEWER_REJECTED_MESSAGE };
  }
  if (!result.ok) {
    return result.code === "use_email_code"
      ? { ok: false, showCode: true, message: REVIEWER_USE_CODE_MESSAGE }
      : { ok: false, showCode: false, message: REVIEWER_REJECTED_MESSAGE };
  }
  try {
    args.install({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_in: result.expires_in,
      expires_at: result.expires_at,
      token_type: result.token_type,
      user: result.user,
    });
  } catch {
    return { ok: false, showCode: false, message: REVIEWER_REJECTED_MESSAGE };
  }
  const destination = athenaCodeSignInDestination(args.redirectTo, args.onAthenaHost);
  args.assign(destination);
  return { ok: true, destination };
}
