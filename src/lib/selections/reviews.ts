import { optionNames, type Board, type Option, type OptionName } from "./model";
import { TIER_LABEL } from "./proposal";

/** JSON with object keys sorted, so equal content always compares equal. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

// What a reviewed unit price covers: the product, its customer content, cost
// and price. Assumptions are notes and can change freely.
const optionKey = (o: Option) => canonical({ ...o, price_reviewed_on: null, assumptions: null });

/**
 * The base basis Athena writes when a contracted job's board starts from the contract value.
 * That base is the signed contract, so repricing the base tier's options doesn't change it.
 */
export const CONTRACT_VALUE_BASIS = "Current contract value";

// What the reviewed base price covers: it already includes the base tier's
// option on every selection, so any change to those changes the base. A base
// that is the contract value covers only the amount and the base tier.
const baseKey = (b: Board) =>
  b.proposal.base_basis === CONTRACT_VALUE_BASIS
    ? canonical({ price: b.proposal.base_price_cents, tier: b.proposal.base_tier, contract: true })
    : canonical({
        price: b.proposal.base_price_cents,
        tier: b.proposal.base_tier,
        selections: b.selections
          .map((s) => [s.id.toLowerCase(), s.quantity, s.options[b.proposal.base_tier].price_cents])
          .sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1)),
      });

export type ReviewGrant = {
  option?: { id: string; tier: OptionName };
  /** Several options reviewed together in one confirmed call (one markup applied to many). */
  options?: { id: string; tier: OptionName }[];
  base?: boolean;
  /** The member confirmed each package's extra time and added cost in this call. */
  terms?: boolean;
};

// What the confirmed time and added cost cover: the terms themselves and the packages they sit on
// (which product and price each package holds, the quantities and the base package). A change to
// any of these can change the time or cost a package needs, so the member confirms them again.
const termsKey = (b: Board) =>
  canonical({
    terms: b.proposal.change_terms ? { ...b.proposal.change_terms, reviewed_on: null } : null,
    base: b.proposal.base_tier,
    selections: b.selections
      .map((s) => [
        s.id.toLowerCase(),
        s.quantity,
        optionNames.map((t) => [
          s.options[t].manufacturer,
          s.options[t].model,
          s.options[t].price_cents,
        ]),
      ])
      .sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1)),
  });
const granted = (grant: ReviewGrant, id: string, tier: OptionName) =>
  [...(grant.option ? [grant.option] : []), ...(grant.options ?? [])].some(
    (g) => g.id.toLowerCase() === id.toLowerCase() && g.tier === tier,
  );

/**
 * A review date stands only when the member confirmed it in this call (the
 * grant) or nothing it covers changed since it was set. Anything else is
 * marked not reviewed again, so neither a full save nor a later edit can make
 * an unconfirmed price look reviewed.
 */
export function enforceReviews(
  prev: Board,
  next: Board,
  grant: ReviewGrant = {},
): { board: Board; cleared: string[] } {
  const board = structuredClone(next);
  const cleared: string[] = [];
  // Setting the currency the first time keeps reviews; changing it clears them all.
  const currencyChanged = prev.currency !== null && prev.currency !== next.currency;
  const before = new Map(prev.selections.map((s) => [s.id.toLowerCase(), s]));
  for (const s of board.selections)
    for (const tier of optionNames) {
      const o = s.options[tier];
      if (o.price_reviewed_on === null) continue;
      if (granted(grant, s.id, tier)) continue;
      const p = before.get(s.id.toLowerCase())?.options[tier];
      if (
        p &&
        !currencyChanged &&
        p.price_reviewed_on === o.price_reviewed_on &&
        optionKey(p) === optionKey(o)
      )
        continue;
      o.price_reviewed_on = null;
      cleared.push(`${s.title} (${TIER_LABEL[tier]}) price`);
    }
  const proposal = board.proposal;
  if (
    proposal.base_reviewed_on !== null &&
    !grant.base &&
    !(
      !currencyChanged &&
      prev.proposal.base_reviewed_on === proposal.base_reviewed_on &&
      baseKey(prev) === baseKey(board)
    )
  ) {
    proposal.base_reviewed_on = null;
    cleared.push("base proposal price");
  }
  const terms = proposal.change_terms;
  if (
    terms &&
    terms.reviewed_on !== null &&
    !grant.terms &&
    !(
      !currencyChanged &&
      prev.proposal.change_terms?.reviewed_on === terms.reviewed_on &&
      termsKey(prev) === termsKey(board)
    )
  ) {
    terms.reviewed_on = null;
    cleared.push("extra time and added cost");
  }
  return { board, cleared };
}
