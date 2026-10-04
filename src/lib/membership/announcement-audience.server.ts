import { createHash } from "node:crypto";
import { circleDecision, loadCircleIdentities } from "./circle.server";
import { circleMarketingAllowed } from "./announcement-guard.server";

export type CircleAnnouncementAudience = "circle" | "circle_inactive" | "control_baseline";
export function isCircleAnnouncementAudience(
  audience: string,
): audience is CircleAnnouncementAudience {
  return ["circle", "circle_inactive", "control_baseline"].includes(audience);
}

export type CircleAudienceReview = { snapshotHash: string; excludedReviewEmails: string[] };

/** A preview never updates membership, suppressions, tokens, or the email queue. */
export async function previewCircleAnnouncementAudience(
  db: unknown,
  audience: CircleAnnouncementAudience,
  options: {
    apiKey: string;
    fetch?: typeof fetch;
    paceMs?: number;
    includeRecipient?: (email: string) => boolean;
  },
) {
  const recipients: { email: string; userId: string | null; firstName: string | null }[] = [];
  const reviewHolds: { email: string; userId: string | null; reason: string }[] = [];
  const suppressions: { email: string; userId: string | null; reason: string }[] = [];
  const identities = (await loadCircleIdentities(db)).sort((a, b) =>
    a.email.localeCompare(b.email),
  );
  for (const identity of identities) {
    const decision = await circleDecision(db, identity);
    // Preserve visibility of every unresolved Circle hold, even for a filtered campaign.
    if (decision.state === "review") {
      reviewHolds.push({ email: identity.email, userId: identity.userId, reason: decision.reason });
      continue;
    }
    if (decision.state !== "eligible" || options.includeRecipient?.(identity.email) === false)
      continue;
    const permission = await circleMarketingAllowed(db, identity, options);
    if (!permission.allowed) {
      suppressions.push({
        email: identity.email,
        userId: identity.userId,
        reason: permission.reason,
      });
      continue;
    }
    recipients.push({
      email: identity.email,
      userId: identity.userId,
      firstName: identity.firstName,
    });
  }
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify({ version: 1, audience, recipients, reviewHolds, suppressions }))
    .digest("hex");
  return { count: recipients.length, recipients, reviewHolds, suppressions, snapshotHash };
}

export function assertCircleAudienceReviewed(
  snapshot: Awaited<ReturnType<typeof previewCircleAnnouncementAudience>>,
  review: CircleAudienceReview,
) {
  const actual = snapshot.reviewHolds.map((hold) => hold.email).sort();
  const submitted = review.excludedReviewEmails.map((email) => email.trim().toLowerCase()).sort();
  if (
    review.snapshotHash !== snapshot.snapshotHash ||
    new Set(submitted).size !== submitted.length ||
    JSON.stringify(submitted) !== JSON.stringify(actual)
  ) {
    throw new Error(
      "Circle audience changed or exclusions were not reviewed. Refresh and review the audience again.",
    );
  }
}
