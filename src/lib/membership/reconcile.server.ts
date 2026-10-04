import { createHash } from "node:crypto";
import {
  circleDecision,
  loadCircleIdentities,
  membershipDb,
  type CircleIdentity,
} from "./circle.server";
import { circleResendClient, circleSegmentAction } from "@/lib/resend/circle-sync";

/** No sends. Preview is the default; callers must be authenticated admins. */
export async function reconcileCircleAudience(
  db: unknown,
  options: {
    apply?: boolean;
    reviewedPlanHash?: string;
    apiKey: string;
    fetch?: typeof fetch;
    paceMs?: number;
  },
) {
  const client = circleResendClient(options.apiKey, options.fetch, options.paceMs);
  const [identities, contacts] = await Promise.all([loadCircleIdentities(db), client.list()]);
  const byEmail = new Map(identities.map((i) => [i.email, i]));
  const inSegment = new Map(contacts.map((c) => [c.email.trim().toLowerCase(), c]));
  const plan: { email: string; action: string; reason: string }[] = [];
  // Resend-only identities need explicit review; never infer cancellations from absence.
  for (const email of inSegment.keys())
    if (!byEmail.has(email))
      plan.push({ email, action: "review", reason: "unmapped_resend_identity" });
  for (const identity of identities) {
    const input = await loadSyncInput(db, identity);
    const contact =
      inSegment.get(identity.email) ??
      (input.decision.state === "eligible" ? await client.contact(identity.email) : null);
    if (contact?.unsubscribed) input.suppressed = true;
    const action = circleSegmentAction(input);
    if (action === "review") {
      plan.push({ email: identity.email, action, reason: input.decision.reason });
      continue;
    }
    const existing = inSegment.get(identity.email);
    if (action === "remove" && !existing) continue;
    plan.push({
      email: identity.email,
      action,
      reason: input.suppressed ? "marketing_suppressed" : input.decision.reason,
    });
  }
  plan.sort((a, b) => a.email.localeCompare(b.email));
  const planHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  if (options.apply && options.reviewedPlanHash !== planHash)
    throw new Error("Circle plan changed; preview and review the current plan before applying");
  // Review before any bulk change; no partially-applied surprise when an ambiguity exists.
  if (options.apply && plan.some((p) => p.action === "review"))
    throw new Error("Resolve Circle membership review cases before applying reconciliation");
  let sync: { processed: number; failed: number; review: number } | undefined;
  if (options.apply) {
    for (const item of plan) {
      const { error } = await membershipDb(db).rpc("queue_circle_audience_sync", {
        _email: item.email,
      });
      if (error) throw new Error(error.message);
    }
    sync = await drainCircleAudienceSync(db, options);
  }
  return { plan, planHash, ...(sync ? { sync } : {}) };
}

async function loadSyncInput(db: unknown, identity: CircleIdentity) {
  const client = membershipDb(db);
  const [decision, suppression, unsubscribe] = await Promise.all([
    circleDecision(db, identity),
    client.from("suppressed_emails").select("email").eq("email", identity.email),
    client
      .from("email_unsubscribe_tokens")
      .select("used_at")
      .eq("email", identity.email)
      .not("used_at", "is", null),
  ]);
  if (suppression.error || unsubscribe.error)
    throw new Error("Cannot verify marketing suppression");
  return {
    ...identity,
    decision,
    suppressed: !!(suppression.data?.length || unsubscribe.data?.length),
  };
}

/** Durable retry, with a lease and revision CAS. Missing credentials is a visible failure. */
export async function drainCircleAudienceSync(
  db: unknown,
  options: { apiKey: string; fetch?: typeof fetch; paceMs?: number; email?: string },
) {
  const client = membershipDb(db);
  const { data: jobs, error } = await client.rpc("claim_circle_audience_sync", {
    _email: options.email ?? null,
  });
  if (error) throw new Error(error.message);
  const identities = new Map((await loadCircleIdentities(db)).map((i) => [i.email, i]));
  let failed = 0,
    review = 0;
  let provider: ReturnType<typeof circleResendClient> | undefined;
  for (const job of jobs ?? []) {
    let status = "synced",
      lastError: string | null = null;
    try {
      const identity = identities.get(job.email);
      if (!identity) throw new Error("Unmapped Circle identity requires review");
      const input = await loadSyncInput(db, identity);
      if (circleSegmentAction(input) === "review") {
        status = "review";
        review++;
        lastError = input.decision.reason;
      } else {
        provider ??= circleResendClient(options.apiKey, options.fetch, options.paceMs);
        await provider.apply(input);
      }
    } catch (error) {
      status = "failed";
      failed++;
      lastError = error instanceof Error ? error.message : String(error);
    }
    const { error: finishError } = await client.rpc("finish_circle_audience_sync", {
      _email: job.email,
      _revision: job.revision,
      _attempt: job.attempts,
      _status: status,
      _error: lastError,
    });
    if (finishError) throw new Error(finishError.message);
  }
  return { processed: jobs?.length ?? 0, failed, review };
}
