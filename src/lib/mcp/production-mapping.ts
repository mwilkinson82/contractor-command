// Pure calculations for a proposed SOV/CPM mapping. Persistence and approval must
// validate the same invariants transactionally against authoritative source rows.
export type ProjectRef = { companyId: string; jobId: string };
export type SovSource = ProjectRef & {
  factId: string;
  item: string;
  valueCents: number | null;
  recordedAt: string;
};
export type CpmSource = ProjectRef & { reportId: string; version: number; activityIds: string[] };
export type Allocation = {
  id: string;
  sovFactId: string;
  activityId: string;
  valueCents: number;
  plannedQuantity: number | null;
  unit: string | null;
  plannedManHours: number | null;
  plannedBasisSource: string | null;
};
export type MappingProposal = ProjectRef & {
  cpm: CpmSource;
  sov: SovSource[];
  allocations: Allocation[];
};

const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;
const sameProject = (a: ProjectRef, b: ProjectRef) =>
  a.companyId === b.companyId && a.jobId === b.jobId;

/** Returns all reasons a proposal cannot be approved. Amounts are integer cents. */
export function validateMapping(p: MappingProposal): string[] {
  const errors: string[] = [];
  if (
    !p.companyId ||
    !p.jobId ||
    !sameProject(p, p.cpm) ||
    !p.cpm.reportId ||
    !Number.isInteger(p.cpm.version) ||
    p.cpm.version < 1
  )
    errors.push("A saved CPM version from this project is required.");
  if (!p.sov.length || !p.allocations.length)
    errors.push("SOV lines and allocations are required.");
  const lines = new Map<string, SovSource>();
  const items = new Set<string>();
  for (const line of p.sov) {
    if (
      !sameProject(p, line) ||
      !line.factId ||
      !line.item ||
      !line.recordedAt ||
      lines.has(line.factId) ||
      items.has(line.item)
    )
      errors.push(`Invalid or duplicate SOV source: ${line.item}.`);
    if (line.valueCents === null || !Number.isSafeInteger(line.valueCents) || line.valueCents < 0)
      errors.push(`SOV ${line.item} needs a supported nonnegative value in cents.`);
    lines.set(line.factId, line);
    items.add(line.item);
  }
  const activities = new Set(p.cpm.activityIds);
  if (activities.size !== p.cpm.activityIds.length || p.cpm.activityIds.some((id) => !id))
    errors.push("CPM activity IDs must be unique and nonempty.");
  const pairs = new Set<string>();
  const ids = new Set<string>();
  const totals = new Map<string, number>();
  for (const a of p.allocations) {
    const pair = JSON.stringify([a.sovFactId, a.activityId]);
    if (!a.id || ids.has(a.id) || pairs.has(pair))
      errors.push("Allocation IDs and SOV/activity pairs must be unique.");
    ids.add(a.id);
    pairs.add(pair);
    if (!lines.has(a.sovFactId) || !activities.has(a.activityId))
      errors.push("Each allocation must reference the supplied SOV and CPM sources.");
    if (!Number.isSafeInteger(a.valueCents) || a.valueCents < 0)
      errors.push("Allocation value must be nonnegative integer cents.");
    else totals.set(a.sovFactId, (totals.get(a.sovFactId) ?? 0) + a.valueCents);
    if (a.plannedQuantity !== null && !positive(a.plannedQuantity))
      errors.push("Planned quantity must be positive when provided.");
    if (a.plannedManHours !== null && !positive(a.plannedManHours))
      errors.push("Planned man-hours must be positive when provided.");
    if (
      (a.plannedQuantity !== null || a.plannedManHours !== null) &&
      (!a.plannedBasisSource?.trim() || !a.unit?.trim())
    )
      errors.push("Planned inputs require a unit and source.");
  }
  for (const line of p.sov) {
    if (!totals.has(line.factId) || totals.get(line.factId) !== line.valueCents)
      errors.push(`Allocations do not reconcile to SOV ${line.item}.`);
  }
  return errors;
}

/** Missing input is unknown, including a quantity without a labor basis. */
export function plannedRate(a: Allocation): number | null {
  return positive(a.plannedQuantity) &&
    positive(a.plannedManHours) &&
    !!a.unit?.trim() &&
    !!a.plannedBasisSource?.trim()
    ? a.plannedQuantity / a.plannedManHours
    : null;
}

export type ProductionFact = ProjectRef & {
  logicalLineId: string;
  revision: number;
  allocationId: string;
  reportDate: string;
  quantity: number;
  unit: string;
  manHours: number;
};

/** A caller supplies current, already-authorized revisions pinned to one mapping allocation.
 * This deliberately does not calculate earned value or touch billing. */
export function productionTotals(
  project: ProjectRef,
  allocation: Allocation,
  facts: ProductionFact[],
): {
  quantity: number | null;
  manHours: number | null;
  actualRate: number | null;
  plannedRate: number | null;
} {
  const seen = new Set<string>();
  const unit = allocation.unit ?? facts[0]?.unit;
  for (const f of facts) {
    if (
      !sameProject(project, f) ||
      f.allocationId !== allocation.id ||
      !f.logicalLineId ||
      seen.has(f.logicalLineId) ||
      !Number.isInteger(f.revision) ||
      f.revision < 1 ||
      !positive(f.quantity) ||
      !positive(f.manHours) ||
      !f.unit ||
      f.unit !== unit
    ) {
      throw new Error(
        "Production facts must be current, unique, same-project records with matching units and positive quantities and hours.",
      );
    }
    seen.add(f.logicalLineId);
  }
  if (!facts.length)
    return {
      quantity: null,
      manHours: null,
      actualRate: null,
      plannedRate: plannedRate(allocation),
    };
  const quantity = facts.reduce((sum, f) => sum + f.quantity, 0);
  const manHours = facts.reduce((sum, f) => sum + f.manHours, 0);
  return {
    quantity,
    manHours,
    actualRate: quantity / manHours,
    plannedRate: plannedRate(allocation),
  };
}
