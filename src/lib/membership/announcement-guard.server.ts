import { circleDecision, loadCircleIdentities, membershipDb } from "./circle.server";
import type { CircleIdentity } from "./circle.server";
import { shouldSkipResendCapture } from "@/lib/resend/never-email";

/** Recheck at delivery. Membership and marketing suppression are separate decisions. */
export async function circleAnnouncementAllowed(
  db: unknown,
  email: string,
): Promise<{ allowed: boolean; reason: string }> {
  const normalized = email.trim().toLowerCase();
  const identity = (await loadCircleIdentities(db)).find((i) => i.email === normalized);
  if (!identity) return { allowed: false, reason: "unmapped_circle_identity" };
  const decision = await circleDecision(db, identity);
  if (decision.state !== "eligible") return { allowed: false, reason: decision.reason };
  return circleMarketingAllowed(db, identity);
}

/** Native suppression is authoritative; imported external opt-outs are deny-only rows. */
export async function circleMarketingAllowed(
  db: unknown,
  identity: CircleIdentity,
): Promise<{ allowed: boolean; reason: string }> {
  const normalized = identity.email.trim().toLowerCase();
  if (
    shouldSkipResendCapture({
      email: normalized,
      firstName: identity.firstName,
      lastName: identity.lastName,
      company: identity.company,
    })
  )
    return { allowed: false, reason: "never_email" };
  const client = membershipDb(db);
  const [suppression, unsubscribe] = await Promise.all([
    client.from("suppressed_emails").select("email").eq("email", normalized),
    client
      .from("email_unsubscribe_tokens")
      .select("used_at")
      .eq("email", normalized)
      .not("used_at", "is", null),
  ]);
  if (suppression.error || unsubscribe.error)
    throw new Error("Cannot verify Circle marketing suppression");
  if (suppression.data?.length || unsubscribe.data?.length)
    return { allowed: false, reason: "hub_suppressed" };
  return { allowed: true, reason: "eligible" };
}

/** Older queue entries predate the marker; resolve their saved audience rather than guessing. */
export async function queuedAnnouncementNeedsCircle(
  db: unknown,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (payload.label !== "member-announcement") return false;
  if (typeof payload.circle_membership_required === "boolean")
    return payload.circle_membership_required;
  const client = membershipDb(db);
  const { data: logs, error } = await client
    .from("email_send_log")
    .select("metadata")
    .eq("message_id", payload.message_id)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Cannot determine queued announcement audience");
  const announcementId = logs?.map((log) => log.metadata?.announcement_id).find(Boolean);
  if (!announcementId) throw new Error("Legacy queued announcement requires audience review");
  const { data, error: lookupError } = await client
    .from("member_announcements")
    .select("audience")
    .eq("announcement_id", announcementId)
    .maybeSingle();
  if (lookupError || !data) throw new Error("Cannot determine queued announcement audience");
  return ["circle", "circle_inactive", "control_baseline"].includes(data.audience);
}
