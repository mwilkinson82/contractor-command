import type { BidBreakdown } from "./estimating-bid";

export type BidProvenance = {
  companyId: string;
  jobId: string;
  sourceSha256: string;
  selectedQuotes: { quoteId: string; ref: string; sub: string; description: string }[];
};

/** Source checksum is the schema-1 canonical handoff payload digest. It is a
 * content reference, not a signature or financial approval. */
export function validBidProvenance(value: BidProvenance, bid: BidBreakdown): boolean {
  if (
    !value ||
    typeof value.companyId !== "string" ||
    !value.companyId.trim() ||
    typeof value.jobId !== "string" ||
    !value.jobId.trim() ||
    !/^[a-f0-9]{64}$/.test(value.sourceSha256) ||
    !Array.isArray(value.selectedQuotes)
  )
    return false;
  const carried = bid.direct.filter((row) => row.basis === "quote");
  const ids = new Set(value.selectedQuotes.map((q) => q.quoteId));
  return (
    ids.size === value.selectedQuotes.length &&
    carried.length === value.selectedQuotes.length &&
    value.selectedQuotes.every(
      (q) =>
        typeof q.sub === "string" &&
        q.sub.trim().length > 0 &&
        typeof q.description === "string" &&
        q.description.trim().length > 0 &&
        carried.some((row) => row.quoteId === q.quoteId && row.ref === q.ref),
    )
  );
}
