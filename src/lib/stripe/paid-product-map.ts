import type { CaptureSegment } from "@/lib/resend/segments";

export type HubTier =
  | "book_buyer"
  | "power_hour"
  | "sm_school"
  | "contractor_school"
  | "intensive"
  | "circle"
  | "aos_only";

export type StripePurchaseIds = {
  priceId?: string | null;
  productId?: string | null;
  metaProduct?: string | null;
  metaKind?: string | null;
};

export type StripePriceEnv = {
  STRIPE_PRICE_ID_CIRCLE?: string;
  STRIPE_PRICE_ID_BOOK?: string;
  STRIPE_PRICE_ID_INTENSIVE?: string;
  STRIPE_PRICE_ID_POWER_HOUR_MONTH?: string;
  STRIPE_PRICE_ID_POWER_HOUR_QUARTER?: string;
  STRIPE_PRICE_ID_SM_SCHOOL_MONTH?: string;
  STRIPE_PRICE_ID_SM_SCHOOL_QUARTER?: string;
  STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_MONTH?: string;
  STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_QUARTER?: string;
};

/** Live Circle monthly sold via Lovable / Vale checkout. */
export const CIRCLE_LIVE_MONTHLY_PRICE_ID = "price_1TVh3TJdDAUSVXbNJRsYFTbp";
export const CIRCLE_LIVE_PRODUCT_ID = "prod_UUgQlHRk9H1ZUS";

/** Older Circle IDs that still appear on the shared Stripe account. */
export const CIRCLE_LEGACY_PRICE_IDS = [
  "price_1TiUlGJdDAUSVXbNQRjv1ntA",
  // Founding Circle import price used before the current STRIPE_PRICE_ID_CIRCLE env var.
  "price_1TDR3aJdDAUSVXbNZOY6EXF3",
  // $497/mo Circle price used for direct Stripe checkouts before the env-managed price.
  "price_1TDR3aJdDAUSVXbNWVzFLblo",
] as const;

export const CIRCLE_LEGACY_PRODUCT_IDS = ["prod_UhuaYXyzDSknXg"] as const;

export const CIRCLE_PRICE_IDS = new Set<string>([
  CIRCLE_LIVE_MONTHLY_PRICE_ID,
  ...CIRCLE_LEGACY_PRICE_IDS,
]);

export const CIRCLE_PRODUCT_IDS = new Set<string>([
  CIRCLE_LIVE_PRODUCT_ID,
  ...CIRCLE_LEGACY_PRODUCT_IDS,
]);

/**
 * Catalog IDs for paid Resend segments other than Circle.
 *
 * This repo does not currently hardcode alphandbook.com / clinic / intensive
 * Stripe price IDs. Runtime still reads:
 *   STRIPE_PRICE_ID_BOOK      → handbook (hub tier book_buyer)
 *   STRIPE_PRICE_ID_INTENSIVE → intensive
 * Portal intensive checkout uses Stripe `price_data` (no catalog price) and
 * is recognized via metadata.kind / metadata.product === "intensive".
 * Handbook one-time is recognized via metadata.product book / book_v2.
 *
 * Add the next catalog IDs here when they exist — do not invent them.
 */
export const HANDBOOK_PRICE_IDS = new Set<string>([
  // e.g. "price_xxx" — alphandbook.com $47 one-time
]);
export const HANDBOOK_PRODUCT_IDS = new Set<string>([
  // e.g. "prod_xxx"
]);
export const INTENSIVE_PRICE_IDS = new Set<string>([
  // e.g. "price_xxx" — $5,000 intensive
]);
export const INTENSIVE_PRODUCT_IDS = new Set<string>([
  // e.g. "prod_xxx"
]);
export const CLINIC_PRICE_IDS = new Set<string>([
  // e.g. "price_xxx" — clinic / event
]);
export const CLINIC_PRODUCT_IDS = new Set<string>([
  // e.g. "prod_xxx"
]);

export function readStripePriceEnv(env: NodeJS.ProcessEnv = process.env): StripePriceEnv {
  return {
    STRIPE_PRICE_ID_CIRCLE: env.STRIPE_PRICE_ID_CIRCLE,
    STRIPE_PRICE_ID_BOOK: env.STRIPE_PRICE_ID_BOOK,
    STRIPE_PRICE_ID_INTENSIVE: env.STRIPE_PRICE_ID_INTENSIVE,
    STRIPE_PRICE_ID_POWER_HOUR_MONTH: env.STRIPE_PRICE_ID_POWER_HOUR_MONTH,
    STRIPE_PRICE_ID_POWER_HOUR_QUARTER: env.STRIPE_PRICE_ID_POWER_HOUR_QUARTER,
    STRIPE_PRICE_ID_SM_SCHOOL_MONTH: env.STRIPE_PRICE_ID_SM_SCHOOL_MONTH,
    STRIPE_PRICE_ID_SM_SCHOOL_QUARTER: env.STRIPE_PRICE_ID_SM_SCHOOL_QUARTER,
    STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_MONTH: env.STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_MONTH,
    STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_QUARTER: env.STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_QUARTER,
  };
}

function idMatches(id: string | null | undefined, known: Set<string>, extra?: string): boolean {
  if (!id) return false;
  if (known.has(id)) return true;
  return Boolean(extra && id === extra);
}

export function hubTierForPurchase(
  input: StripePurchaseIds,
  env: StripePriceEnv = readStripePriceEnv(),
): HubTier | null {
  const product = input.metaProduct ?? input.metaKind ?? null;
  if (product === "book_v2" || product === "book") return "book_buyer";
  if (product === "power_hour") return "power_hour";
  if (product === "sm_school") return "sm_school";
  if (product === "contractor_school") return "contractor_school";
  if (product === "intensive") return "intensive";
  if (product === "circle") return "circle";

  const priceId = input.priceId ?? null;
  const productId = input.productId ?? null;

  if (idMatches(priceId, HANDBOOK_PRICE_IDS, env.STRIPE_PRICE_ID_BOOK)) return "book_buyer";
  if (idMatches(productId, HANDBOOK_PRODUCT_IDS)) return "book_buyer";
  if (idMatches(priceId, INTENSIVE_PRICE_IDS, env.STRIPE_PRICE_ID_INTENSIVE)) return "intensive";
  if (idMatches(productId, INTENSIVE_PRODUCT_IDS)) return "intensive";
  if (idMatches(priceId, CIRCLE_PRICE_IDS, env.STRIPE_PRICE_ID_CIRCLE)) return "circle";
  if (idMatches(productId, CIRCLE_PRODUCT_IDS)) return "circle";

  if (
    priceId &&
    (priceId === env.STRIPE_PRICE_ID_POWER_HOUR_MONTH ||
      priceId === env.STRIPE_PRICE_ID_POWER_HOUR_QUARTER)
  ) {
    return "power_hour";
  }
  if (
    priceId &&
    (priceId === env.STRIPE_PRICE_ID_SM_SCHOOL_MONTH || priceId === env.STRIPE_PRICE_ID_SM_SCHOOL_QUARTER)
  ) {
    return "sm_school";
  }
  if (
    priceId &&
    (priceId === env.STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_MONTH ||
      priceId === env.STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_QUARTER)
  ) {
    return "contractor_school";
  }
  return null;
}

export function resendSegmentForHubTier(tier: HubTier | null): CaptureSegment | null {
  if (tier === "circle") return "circle";
  if (tier === "book_buyer") return "handbook";
  if (tier === "intensive") return "intensive";
  return null;
}

export function resendSegmentForPurchase(
  input: StripePurchaseIds,
  env: StripePriceEnv = readStripePriceEnv(),
): CaptureSegment | null {
  const priceId = input.priceId ?? null;
  const productId = input.productId ?? null;
  const product = input.metaProduct ?? input.metaKind ?? null;

  if (product === "circle") return "circle";
  if (idMatches(priceId, CIRCLE_PRICE_IDS, env.STRIPE_PRICE_ID_CIRCLE)) return "circle";
  if (idMatches(productId, CIRCLE_PRODUCT_IDS)) return "circle";

  if (product === "book_v2" || product === "book") return "handbook";
  if (idMatches(priceId, HANDBOOK_PRICE_IDS, env.STRIPE_PRICE_ID_BOOK)) return "handbook";
  if (idMatches(productId, HANDBOOK_PRODUCT_IDS)) return "handbook";

  if (product === "intensive") return "intensive";
  if (idMatches(priceId, INTENSIVE_PRICE_IDS, env.STRIPE_PRICE_ID_INTENSIVE)) return "intensive";
  if (idMatches(productId, INTENSIVE_PRODUCT_IDS)) return "intensive";

  if (product === "clinic") return "clinic";
  if (idMatches(priceId, CLINIC_PRICE_IDS)) return "clinic";
  if (idMatches(productId, CLINIC_PRODUCT_IDS)) return "clinic";

  return resendSegmentForHubTier(hubTierForPurchase(input, env));
}
