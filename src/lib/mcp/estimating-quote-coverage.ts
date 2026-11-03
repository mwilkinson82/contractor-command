/** Local foundation for explicit whole-line subcontract coverage. This module
 * does not persist selections or change any existing bid tool by itself. */
export type CoverageLine = {
  ref: string;
  /** Server-derived identity of the reviewed takeoff version and source evidence. */
  scopeKey: string;
  directCents: number | null;
  directConfirmed: boolean;
};

export type CoverageQuote = {
  id: string;
  ref: string;
  amountCents: number | null;
  decision: "carry" | "compare" | null;
  confirmed: boolean;
  /** Exact server-derived scope identity reviewed when this quote was selected. */
  reviewedScopeKey: string | null;
  reviewedAmountCents: number | null;
  reviewedQuoteId: string | null;
  reviewedRef: string | null;
  /** Derived from the exact quote source/revision, coverage, exclusions and terms. */
  quoteFingerprint: string | null;
  reviewedQuoteFingerprint: string | null;
};

export function reconcileQuoteCoverage(lines: CoverageLine[], quotes: CoverageQuote[]) {
  const blockers: string[] = [];
  if (lines.length === 0) blockers.push("Choose at least one scope line.");
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line.ref, (counts.get(line.ref) ?? 0) + 1);
  for (const [ref, count] of counts)
    if (!ref || count !== 1) blockers.push(`Ambiguous scope reference: ${ref || "missing"}.`);
  const quoteIds = new Set<string>();
  for (const quote of quotes) {
    if (!quote.id || quoteIds.has(quote.id)) blockers.push("Quote identities must be unique.");
    quoteIds.add(quote.id);
    if (quote.decision !== "carry" && quote.decision !== "compare")
      blockers.push(`Review quote ${quote.id}: choose carried or comparison.`);
    if (quote.decision === "carry" && counts.get(quote.ref) !== 1)
      blockers.push(`Quote ${quote.id}: choose one current scope line.`);
  }
  const rows = lines.map((line) => {
    const selected = quotes.filter((quote) => quote.decision === "carry" && quote.ref === line.ref);
    if (selected.length > 1) blockers.push(`${line.ref}: more than one quote is selected.`);
    if (selected.length === 1) {
      const quote = selected[0];
      if (!line.scopeKey || quote.reviewedScopeKey !== line.scopeKey)
        blockers.push(`${line.ref}: scope changed; review the quote again.`);
      if (!quote.confirmed) blockers.push(`${line.ref}: confirm the selected quote.`);
      if (quote.reviewedQuoteId !== quote.id || quote.reviewedRef !== quote.ref)
        blockers.push(`${line.ref}: quote selection changed; review it again.`);
      if (!quote.quoteFingerprint || quote.reviewedQuoteFingerprint !== quote.quoteFingerprint)
        blockers.push(`${line.ref}: quote terms or source changed; review it again.`);
      if (quote.reviewedAmountCents !== quote.amountCents)
        blockers.push(`${line.ref}: quote amount changed; review it again.`);
      if (!Number.isSafeInteger(quote.amountCents) || (quote.amountCents as number) < 0)
        blockers.push(`${line.ref}: the selected quote needs a valid amount.`);
      return {
        ref: line.ref,
        basis: "quote" as const,
        amountCents: quote.amountCents,
        quoteId: quote.id,
      };
    }
    if (
      !line.directConfirmed ||
      !Number.isSafeInteger(line.directCents) ||
      (line.directCents as number) < 0
    )
      blockers.push(`${line.ref}: complete and confirm direct pricing.`);
    return {
      ref: line.ref,
      basis: "direct" as const,
      amountCents: line.directCents,
      quoteId: null,
    };
  });
  const sum = rows.reduce((total, row) => total + (row.amountCents ?? 0), 0);
  if (!Number.isSafeInteger(sum)) blockers.push("The combined amount exceeds the supported range.");
  return {
    rows,
    blockers: [...new Set(blockers)],
    totalCents: blockers.length ? null : sum,
    ready: blockers.length === 0,
  };
}
