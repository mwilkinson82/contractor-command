import { reconcileQuoteCoverage, type CoverageQuote } from "./estimating-quote-coverage";
import type { EstimatePricing } from "./estimating-pricing";

/** This object must come directly from the guarded atomic snapshot RPC, never
 * from tool arguments or a conversational host's assertions. */
export type CoverageSnapshot = {
  version: number;
  selection: null | {
    version: number;
    current: boolean;
    decisions: Array<{
      quote_index: number;
      ref: string | null;
      decision: "carry" | "compare";
      quote: unknown;
      replace_labor_and_material?: boolean;
      exclusive_to_line?: boolean;
    }>;
  };
};

const sortedJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, sortedJson(v)]),
    );
  return value;
};
const toCents = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const exact = value * 100;
  const rounded = Math.round(exact);
  return Number.isSafeInteger(rounded) && Math.abs(exact - rounded) < 1e-7 ? rounded : null;
};

/** Apply saved, exact-version decisions to the same snapshot's priced lines.
 * A quote replaces its whole direct line; it is never added to that line. */
export function applyReviewedQuoteCoverage(
  pricing: EstimatePricing,
  quotes: unknown[],
  snapshot: CoverageSnapshot | null,
) {
  const rejected = (message: string) => ({
    accepted: false as const,
    direct: pricing.direct,
    directPlaceholder: pricing.placeholder,
    blockers: [...pricing.blockers, message],
    rows: [],
  });
  const saved = snapshot?.selection;
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.version) ||
    !saved ||
    !Number.isSafeInteger(saved.version) ||
    saved.current !== true ||
    saved.version !== snapshot.version ||
    !Array.isArray(saved.decisions) ||
    saved.decisions.length !== quotes.length
  )
    return rejected("Quote coverage has not been reviewed for this saved estimate version.");

  const seen = new Set<number>();
  const scopeKey = String(snapshot.version);
  const decisions: CoverageQuote[] = [];
  for (const decision of saved.decisions) {
    if (
      !decision ||
      !Number.isSafeInteger(decision.quote_index) ||
      decision.quote_index < 0 ||
      decision.quote_index >= quotes.length ||
      seen.has(decision.quote_index) ||
      (decision.decision !== "carry" && decision.decision !== "compare") ||
      (decision.decision === "carry" && (typeof decision.ref !== "string" || !decision.ref)) ||
      (decision.decision === "carry" &&
        (decision.replace_labor_and_material !== true || decision.exclusive_to_line !== true)) ||
      JSON.stringify(sortedJson(decision.quote)) !==
        JSON.stringify(sortedJson(quotes[decision.quote_index]))
    )
      return rejected("Quote coverage no longer matches the saved quote list. Review it again.");
    seen.add(decision.quote_index);
    const quote = decision.quote as { amount?: unknown } | null;
    const amountCents = toCents(quote?.amount);
    // The version binds the exact stored quote JSON and source scope, not a
    // fingerprint or confirmation supplied by the host.
    decisions.push({
      id: String(decision.quote_index),
      ref: decision.ref ?? "",
      amountCents,
      decision: decision.decision,
      confirmed: true,
      reviewedScopeKey: scopeKey,
      reviewedAmountCents: amountCents,
      reviewedQuoteId: String(decision.quote_index),
      reviewedRef: decision.ref ?? "",
      quoteFingerprint: scopeKey,
      reviewedQuoteFingerprint: scopeKey,
    });
  }
  const lineMessages = new Set(pricing.rows.flatMap((row) => row.blockers));
  const globalBlockers = pricing.blockers.filter((message) => !lineMessages.has(message));
  const result = reconcileQuoteCoverage(
    pricing.rows.map((row) => {
      const labor = toCents(row.labor.amount);
      const material = toCents(row.material.amount);
      const directCents = labor == null || material == null ? null : labor + material;
      return {
        ref: row.ref,
        scopeKey,
        directCents: Number.isSafeInteger(directCents) ? directCents : null,
        directConfirmed: row.blockers.length === 0,
      };
    }),
    decisions,
  );
  const carried = new Set(result.rows.filter((row) => row.basis === "quote").map((row) => row.ref));
  const directBlockers = pricing.rows
    .filter((row) => !carried.has(row.ref))
    .flatMap((row) => row.blockers);
  const blockers = [...new Set([...globalBlockers, ...directBlockers, ...result.blockers])];
  return {
    accepted: true as const,
    direct: result.totalCents == null ? null : result.totalCents / 100,
    directPlaceholder: pricing.rows.some(
      (row) => !carried.has(row.ref) && (row.labor.placeholder || row.material.placeholder),
    ),
    blockers,
    rows: result.rows,
  };
}
