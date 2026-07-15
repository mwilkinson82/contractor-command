export const CIRCLE_MEMBER_TIERS = new Set(["circle", "hardcore"]);

export function isCircleMemberTier(tier: string | null | undefined): boolean {
  return Boolean(tier && CIRCLE_MEMBER_TIERS.has(tier));
}

export function isCircleBaselineRecipient(row: {
  tier: string | null | undefined;
  baselineState: "missing" | "needs_refresh" | "current";
}): boolean {
  return isCircleMemberTier(row.tier) && row.baselineState !== "current";
}
