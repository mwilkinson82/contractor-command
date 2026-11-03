import type { BidBreakdown } from "./estimating-bid";
import { canonicalBidCsv } from "./estimating-bid-csv";

/** Internal draft only. This function does not authenticate, persist, confirm,
 * or apply anything to a budget, schedule of values, or buyout. The caller
 * must supply the guarded snapshot and the canonical calculation together.
 * The checksum is not a signature or proof of storage or human confirmation. */
export async function prepareHandoffDraft(input: {
  companyId: string;
  jobId: string;
  snapshot: {
    version: number;
    estimate: unknown;
    takeoff: unknown;
    bid: unknown;
    selection: unknown;
  };
  ready: boolean;
  breakdown: BidBreakdown | null;
}) {
  if (
    !input.companyId.trim() ||
    !input.jobId.trim() ||
    !Number.isSafeInteger(input.snapshot.version) ||
    input.snapshot.version < 0
  )
    throw new Error("A specific company, job, and exact saved version are required.");
  const csv = canonicalBidCsv({
    job: input.jobId,
    version: input.snapshot.version,
    ready: input.ready,
    breakdown: input.breakdown,
  });
  if (!csv || !input.breakdown) throw new Error("A complete reconciled bid is required.");
  const bid = input.snapshot.bid as { pricing?: { quotes?: unknown[] } | null } | null;
  const quotes = bid?.pricing?.quotes ?? [];
  if (!Array.isArray(quotes)) throw new Error("Saved quotes need review.");
  const selection = input.snapshot.selection as {
    version?: number;
    current?: boolean;
    decisions?: Array<{
      quote_index?: number;
      decision?: string;
      ref?: string;
      quote?: unknown;
      replace_labor_and_material?: boolean;
      exclusive_to_line?: boolean;
    }>;
  } | null;
  if (quotes.length) {
    if (
      !selection ||
      selection.current !== true ||
      selection.version !== input.snapshot.version ||
      !Array.isArray(selection.decisions) ||
      selection.decisions.length !== quotes.length
    )
      throw new Error("Quote coverage is not current for this version.");
    const indices = new Set<number>();
    for (const d of selection.decisions) {
      if (
        !Number.isInteger(d.quote_index) ||
        d.quote_index! < 0 ||
        d.quote_index! >= quotes.length ||
        indices.has(d.quote_index!) ||
        !["carry", "compare"].includes(d.decision ?? "") ||
        (d.decision === "carry" &&
          (d.replace_labor_and_material !== true || d.exclusive_to_line !== true)) ||
        stable(d.quote) !== stable(quotes[d.quote_index!])
      )
        throw new Error("Quote coverage does not match the saved quote list.");
      indices.add(d.quote_index!);
    }
    const carried = selection.decisions.filter((d) => d.decision === "carry");
    const rows = input.breakdown.direct.filter((r) => r.basis === "quote");
    if (
      carried.length !== rows.length ||
      carried.some((d) => {
        const row = rows.find((r) => r.quoteId === String(d.quote_index));
        const amount = (d.quote as { amount?: unknown } | null)?.amount;
        return (
          !row ||
          row.ref !== d.ref ||
          typeof amount !== "number" ||
          !Number.isSafeInteger(Math.round(amount * 100)) ||
          Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7 ||
          row.amountCents !== Math.round(amount * 100)
        );
      })
    )
      throw new Error("Selected quotes do not match the priced bid lines.");
  } else if (input.breakdown.direct.some((r) => r.basis === "quote")) {
    throw new Error("Selected quotes are missing from the saved snapshot.");
  }
  const payload = JSON.parse(
    stable({
      schema: 1,
      companyId: input.companyId,
      jobId: input.jobId,
      snapshot: input.snapshot,
      breakdown: input.breakdown,
      csv,
    }),
  ) as Record<string, unknown>;
  const bytes = new TextEncoder().encode(stable(payload));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
  return {
    status: "draft" as const,
    sha256: hash,
    payload,
    warnings: [
      "Review and confirmation are required before any downstream use.",
      "Budget, schedule of values and buyout allocations have not been selected.",
    ],
  };
}

function stable(value: unknown): string {
  const seen = new Set<object>();
  const copy = (v: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || seen.has(v))
      throw new Error("Snapshot contains unsupported or cyclic data.");
    seen.add(v);
    const out = Array.isArray(v)
      ? v.map(copy)
      : Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, copy(x)]),
        );
    seen.delete(v);
    return out;
  };
  return JSON.stringify(copy(value));
}
