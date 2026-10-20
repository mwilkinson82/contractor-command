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

/**
 * v0.8.10: true when the approve/deny target hands off to a desktop app
 * (custom scheme like codex:// or cursor://, or a loopback http listener).
 * Browsers may show an "Open <app>?" prompt for these and keep the tab on our
 * page, so the consent page keeps a visible "Return to <app>" link.
 */
export function isAppHandoff(target: string): boolean {
  try {
    const u = new URL(target);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  } catch {
    return false;
  }
}
