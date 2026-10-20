// Claim notices and claim deadlines are internal strategy: client-facing output never shows them.
type ItemLike = { id?: string; check_key?: string | null; commercial_type?: string | null; category?: string | null; action?: string | null };
type DeadlineLike = { label?: string | null; clause_key?: string | null; trigger_desc?: string | null };

const CLAIM_TEXT = /\bclaims?\b/i;

/** Claim items, and the delivery-confirm items hanging off them (check_key "delivery:<claim item id>"). */
export function claimItemIds<T extends ItemLike>(items: T[]): Set<string> {
  const ids = new Set<string>();
  for (const i of items)
    if (i.id && ((i.check_key ?? "").startsWith("delay_claim:") || i.commercial_type === "claim" || /^delay claim$/i.test(i.category ?? "") || /^(Confirm start date — )?(Submit claim notice|Claim notice requirement)/.test(i.action ?? "")))
      ids.add(i.id);
  for (const i of items) {
    const k = i.check_key ?? "";
    if (i.id && k.startsWith("delivery:") && ids.has(k.slice("delivery:".length))) ids.add(i.id);
  }
  return ids;
}

export function withoutClaims<T extends ItemLike>(items: T[]): T[] {
  const ids = claimItemIds(items);
  return items.filter((i) => !(i.id && ids.has(i.id)) && !/^Confirm delivery method and recipient for: .*claim notice/i.test(i.action ?? ""));
}

export const isClaimDeadline = (d: DeadlineLike) => CLAIM_TEXT.test(`${d.label ?? ""} ${d.clause_key ?? ""}`);

/** Client text: drop the claim parts of a combined contract term (split on ";" or sentence ends), keep the rest. */
export function stripClaimText(v: string): string {
  const parts = v.split(/(?<=;)\s*|(?<=\.)\s+(?=§|[A-Z])/);
  const kept = parts.filter((p) => !CLAIM_TEXT.test(p));
  if (kept.length === parts.length) return v;
  return kept.join(" ").trim().replace(/;\s*$/, ".").replace(/\s{2,}/g, " ");
}
