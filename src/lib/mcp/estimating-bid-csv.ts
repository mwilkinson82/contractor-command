import type { BidBreakdown } from "./estimating-bid";
import { validBidProvenance, type BidProvenance } from "./estimating-bid-provenance";

/** Export the calculator's ready result as-is. The version identifies the
 * coherent snapshot, not a promise that later edits haven't occurred. */
export function canonicalBidCsv(input: {
  job: string;
  version: number | string;
  ready: boolean;
  breakdown: BidBreakdown | null;
  provenance?: BidProvenance;
}): string | null {
  const { breakdown: b } = input;
  const version = String(input.version);
  if (
    !input.ready ||
    !b ||
    !/^\d+$/.test(version) ||
    (typeof input.version === "number" && !Number.isSafeInteger(input.version))
  )
    return null;
  if (input.provenance && !validBidProvenance(input.provenance, b)) return null;
  const cents = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  const sums = (rows: { amountCents: number }[]) =>
    rows.reduce((sum, row) => sum + row.amountCents, 0);
  const amounts = [
    ...b.direct.map((row) => row.amountCents),
    ...b.generalConditions.map((row) => row.amountCents),
    ...b.requirements.map((row) => row.amountCents),
    b.directCents,
    b.generalConditionsCents,
    b.requirementsCents,
    b.overheadCents,
    b.profitCents,
    b.totalCents,
  ];
  const refs = new Set(b.direct.map((row) => row.ref));
  const selectedQuotes = b.direct.filter((row) => row.basis === "quote");
  const direct = b.directCents;
  const expected =
    direct + b.generalConditionsCents + b.requirementsCents + b.overheadCents + b.profitCents;
  if (
    !amounts.every(cents) ||
    !cents(direct) ||
    !cents(expected) ||
    b.direct.length === 0 ||
    refs.size !== b.direct.length ||
    sums(b.direct) !== direct ||
    new Set(selectedQuotes.map((row) => row.quoteId)).size !== selectedQuotes.length ||
    b.direct.some(
      (row) =>
        !row.ref ||
        (row.basis === "quote" && !row.quoteId) ||
        (row.basis === "direct" && row.quoteId != null),
    ) ||
    sums(b.generalConditions) !== b.generalConditionsCents ||
    sums(b.requirements) !== b.requirementsCents ||
    expected !== b.totalCents
  )
    return null;

  const text = (value: string | null) => {
    const normalized = (value ?? "").replace(/[\r\n]+/g, " ");
    // Spreadsheet programs interpret leading formula tokens in CSV fields.
    const safe = /^[\s]*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const money = (value: number) =>
    `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;
  const row = (
    section: string,
    ref: string | null,
    description: string,
    basis: string,
    quoteId: string | null,
    amount?: number,
  ) =>
    [
      text(section),
      text(ref),
      text(description),
      text(basis),
      text(quoteId),
      amount == null ? "" : money(amount),
    ].join(",");
  return [
    "section,reference,description,basis,quote_id,amount_usd",
    row("snapshot", version, input.job, "", null),
    ...(input.provenance
      ? [
          row("company", input.provenance.companyId, "Stable source company", "", null),
          row("job", input.provenance.jobId, "Stable source job", "", null),
          row(
            "source_sha256",
            input.provenance.sourceSha256,
            "Canonical source and bid payload schema 1",
            "",
            null,
          ),
          ...input.provenance.selectedQuotes.map((q) =>
            row("selected_quote", q.ref, `${q.sub}: ${q.description}`, "quote", q.quoteId),
          ),
        ]
      : []),
    ...b.direct.map((entry) =>
      row("scope", entry.ref, "", entry.basis, entry.quoteId, entry.amountCents),
    ),
    row("subtotal", null, "Direct and selected subcontract cost", "", null, direct),
    ...b.generalConditions.map((entry) =>
      row("general_conditions", entry.ref, entry.label, entry.placement, null, entry.amountCents),
    ),
    row("subtotal", null, "General conditions", "", null, b.generalConditionsCents),
    ...b.requirements.map((entry) =>
      row("requirement", entry.ref, entry.label, entry.placement, null, entry.amountCents),
    ),
    row("subtotal", null, "Requirements", "", null, b.requirementsCents),
    row("markup", null, "Overhead", "", null, b.overheadCents),
    row("markup", null, "Profit", "", null, b.profitCents),
    row("total", null, "Bid total", "", null, b.totalCents),
  ].join("\n");
}
