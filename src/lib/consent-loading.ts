// Bounded steps for the OAuth consent page. Every wait has a timer that is
// cleared when the step settles, and failures carry a safe, stage-specific
// message (no IDs, tokens or URLs).
export const CONSENT_STEP_TIMEOUT_MS = 15_000;

export type ConsentStage = "session" | "details" | "identity";

const STAGE_MESSAGES: Record<ConsentStage, { timeout: string; failed: string }> = {
  session: {
    timeout:
      "Checking your sign-in took too long. Reload this page or start again from the app you're connecting.",
    failed:
      "We couldn't check your sign-in. Reload this page or start again from the app you're connecting.",
  },
  details: {
    timeout: "The connection request timed out. Start again from the app you're connecting.",
    failed: "This connection request is invalid or has expired.",
  },
  identity: {
    timeout:
      "Confirming your account took too long. Reload this page or start again from the app you're connecting.",
    failed: "We couldn't confirm your account. Reload this page or sign in again.",
  },
};

export class ConsentStepError extends Error {
  constructor(
    public stage: ConsentStage,
    public kind: "timeout" | "failed",
  ) {
    super(STAGE_MESSAGES[stage][kind]);
    this.name = "ConsentStepError";
  }
}

export function boundedStep<T>(
  stage: ConsentStage,
  work: () => Promise<T>,
  ms = CONSENT_STEP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConsentStepError(stage, "timeout")), ms);
  });
  let run: Promise<T>;
  try {
    run = Promise.resolve(work());
  } catch {
    run = Promise.reject(new ConsentStepError(stage, "failed"));
  }
  return Promise.race([
    run.catch((e) => {
      throw e instanceof ConsentStepError ? e : new ConsentStepError(stage, "failed");
    }),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

export function consentReturnPath(authorizationId: string): string {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

// ---------- 0.8.11: one-click recovery ----------
// Supabase answers an expired, used, replaced or unknown authorization_id with
// "authorization not found" (404) or "authorization request cannot be
// processed" (400, no longer pending). Neither response carries the client's
// redirect_uri, state or PKCE challenge, so the authorize URL can't be rebuilt
// here; the host must start a new request. We remember the return address of
// the last request we did load so the member gets one "Return to app" click.
export type ConsentFailureReason = "expired" | "used" | "wrong_account" | "unknown";

export function classifyConsentError(message: string | undefined | null): ConsentFailureReason {
  const m = String(message ?? "").toLowerCase();
  if (/not found|expired|invalid/.test(m)) return "expired";
  if (/cannot be processed|not pending|already/.test(m)) return "used";
  if (/another user|different user|belongs to|user mismatch|forbidden/.test(m)) return "wrong_account";
  return "unknown";
}

export const EXPIRED_MESSAGE = "This request expired. Click Connect again in the app you're connecting from.";
export const WRONG_ACCOUNT_MESSAGE = "This request was started by a different account. Switch account, then click Connect again in the app you're connecting from.";

export class ConsentRecoverableError extends Error {
  stage = "details" as const;
  constructor(
    public reason: ConsentFailureReason,
    public authorizationId: string,
    public detail: string,
  ) {
    super(reason === "wrong_account" ? WRONG_ACCOUNT_MESSAGE : EXPIRED_MESSAGE);
    this.name = "ConsentRecoverableError";
  }
}

/** Logs the real Supabase error with the authorization_id (never tokens). */
export function logConsentFailure(authorizationId: string, stage: string, detail: unknown) {
  const msg = detail instanceof Error ? detail.message : typeof detail === "object" && detail && "message" in detail ? String((detail as { message: unknown }).message) : String(detail);
  console.error("[athena oauth consent] request rejected", { authorization_id: authorizationId, stage, error: msg });
  return msg;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const LAST_KEY = "athena.oauth.lastRequest";
export const LAST_REQUEST_TTL_MS = 60 * 60 * 1000;

export type LastRequest = { authorization_id: string; redirect_uri: string; client_name: string; at: number };

export function rememberRequest(store: KV | undefined, r: Omit<LastRequest, "at">, now = Date.now()) {
  if (!store || !r.redirect_uri) return;
  try { store.setItem(LAST_KEY, JSON.stringify({ ...r, at: now })); } catch { /* storage off */ }
}

export function recallRequest(store: KV | undefined, now = Date.now()): LastRequest | null {
  if (!store) return null;
  try {
    const v = JSON.parse(store.getItem(LAST_KEY) ?? "null") as LastRequest | null;
    if (!v?.redirect_uri || now - v.at > LAST_REQUEST_TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}

export function forgetRequest(store: KV | undefined) {
  try { store?.removeItem(LAST_KEY); } catch { /* storage off */ }
}

/** RFC 6749 4.1.2.1 error return to the host so it can start a fresh request. Only http(s) or loopback/custom schemes Supabase already validated for this client. */
export function returnToAppUrl(redirectUri: string): string | null {
  try {
    const u = new URL(redirectUri);
    if (u.protocol === "javascript:" || u.protocol === "data:") return null;
    u.searchParams.set("error", "access_denied");
    u.searchParams.set("error_description", "authorization_expired");
    return u.toString();
  } catch {
    return null;
  }
}
