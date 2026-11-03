import type { BidBreakdown } from "./estimating-bid";
import { canonicalBidCsv } from "./estimating-bid-csv";

export function bidComponents(b: BidBreakdown) {
  return [
    ...b.direct.map((row) => ({ id: `direct:${row.ref}`, amountCents: row.amountCents })),
    ...b.generalConditions.map((row) => ({
      id: `gc:${row.ref ?? row.label}`,
      amountCents: row.amountCents,
    })),
    ...b.requirements.map((row) => ({
      id: `requirement:${row.ref}`,
      amountCents: row.amountCents,
    })),
    { id: "overhead", amountCents: b.overheadCents },
    { id: "profit", amountCents: b.profitCents },
  ];
}

/** Internal preview only. The caller must load the frozen source and destination
 * version through guarded server reads and recompute the bid from that source.
 * A checksum, this preview, or client-supplied versions do not authorize a write. */
export function previewDestination(input: {
  source: {
    companyId: string;
    jobId: string;
    snapshotId: string;
    sha256: string;
    sourceVersion: number;
    breakdown: BidBreakdown;
  };
  destination: {
    companyId: string;
    jobId: string;
    kind: "budget" | "sov" | "buyout";
    id: string;
    expectedVersion: number;
    observedVersion: number;
  };
  allocations: { componentId: string; targetKey: string | null; exclusionReason: string | null }[];
}) {
  const { source, destination } = input;
  if (
    !source.companyId.trim() ||
    !source.jobId.trim() ||
    !source.snapshotId.trim() ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.sourceVersion) ||
    source.sourceVersion < 0 ||
    source.companyId !== destination.companyId ||
    source.jobId !== destination.jobId ||
    !destination.id.trim() ||
    !["budget", "sov", "buyout"].includes(destination.kind)
  )
    throw new Error("A matching company, job, frozen source and destination are required.");
  if (
    !Number.isSafeInteger(destination.expectedVersion) ||
    destination.expectedVersion < 0 ||
    !Number.isSafeInteger(destination.observedVersion) ||
    destination.expectedVersion !== destination.observedVersion
  )
    throw new Error(
      "The destination changed or its version is unavailable. Refresh before review.",
    );
  const b = source.breakdown;
  if (
    !canonicalBidCsv({
      job: source.jobId,
      version: source.sourceVersion,
      ready: true,
      breakdown: b,
    })
  )
    throw new Error("The source bid is incomplete or does not reconcile.");
  const components = bidComponents(b);
  const expected = new Map(components.map((component) => [component.id, component]));
  if (
    expected.size !== components.length ||
    !Array.isArray(input.allocations) ||
    input.allocations.length !== components.length
  )
    throw new Error("Each source component needs one explicit allocation or exclusion.");
  const seen = new Set<string>();
  let mappedCents = 0;
  let excludedCents = 0;
  const rows = input.allocations.map((decision) => {
    const item = expected.get(decision.componentId);
    const target = typeof decision.targetKey === "string" ? decision.targetKey.trim() : "";
    const reason =
      typeof decision.exclusionReason === "string" ? decision.exclusionReason.trim() : "";
    if (!item || seen.has(decision.componentId) || Boolean(target) === Boolean(reason))
      throw new Error("Each source component needs one destination or an exclusion reason.");
    seen.add(decision.componentId);
    if (target) mappedCents += item.amountCents;
    else excludedCents += item.amountCents;
    return {
      componentId: item.id,
      amountCents: item.amountCents,
      targetKey: target || null,
      exclusionReason: reason || null,
    };
  });
  if (
    !Number.isSafeInteger(mappedCents) ||
    !Number.isSafeInteger(excludedCents) ||
    mappedCents + excludedCents !== b.totalCents
  )
    throw new Error("The proposed allocation does not reconcile to the source bid.");
  return {
    status: "preview" as const,
    posting_permitted: false as const,
    source: {
      companyId: source.companyId,
      jobId: source.jobId,
      snapshotId: source.snapshotId,
      sha256: source.sha256,
      version: source.sourceVersion,
    },
    destination: {
      kind: destination.kind,
      id: destination.id,
      version: destination.observedVersion,
    },
    rows,
    mappedCents,
    excludedCents,
    totalCents: b.totalCents,
  };
}
