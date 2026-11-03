import { z } from "zod";
import type { BidBreakdown } from "./estimating-bid";
import { canonicalBidCsv } from "./estimating-bid-csv";
import { bidComponents } from "./estimating-handoff-preview";
import { buildSov, sovItemProblems, sovTotalChangeRefusal, type SovLineIn } from "./sov";

const key = z.string().trim().min(1).max(40);
const description = z.string().trim().min(1).max(200);
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const STORED_CENTS_MAX = 999_999_999_999_999;
const fourDecimalPlaces = (value: number) => {
  const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
  return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent)) <= 4;
};
const split = z.object({ target_key: key, amount_cents: cents }).strict();
const allocation = {
  component_id: z.string().trim().min(1).max(200),
  splits: z.array(split).max(300),
};
export const budgetDestinationPlanSchema = z
  .object({
    kind: z.literal("budget"),
    lines: z
      .array(z.object({ cost_code: key, description, zero: z.literal(true).optional() }).strict())
      .min(1)
      .max(300),
    allocations: z
      .array(
        z
          .object({
            ...allocation,
            excluded_cents: cents,
            exclusion_reason: z.string().trim().min(1).max(1000).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();
export const sovDestinationPlanSchema = z
  .object({
    kind: z.literal("sov"),
    copy: z.enum(["official", "draft"]),
    source_basis: z.literal("base_contract"),
    fee_pct: z
      .number()
      .finite()
      .min(0)
      .lt(100)
      .refine(
        fourDecimalPlaces,
        "Fee percent must be exactly representable to four decimal places.",
      ),
    billing_basis: z.string().trim().min(1).max(200),
    lines: z
      .array(
        z
          .object({
            line: key,
            description,
            cost_codes: z.array(key).min(1).max(50),
            spec_section: z.string().trim().min(1).max(40).nullable().optional(),
            zero: z.literal(true).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(300),
    allocations: z
      .array(z.object({ ...allocation, fee_cents: cents }).strict())
      .min(1)
      .max(2000),
  })
  .strict();
export const destinationPlanSchema = z.discriminatedUnion("kind", [
  budgetDestinationPlanSchema,
  sovDestinationPlanSchema,
]);
export type DestinationPlan = z.infer<typeof destinationPlanSchema>;
export type DestinationSnapshot = {
  company_id: string;
  job_id: string;
  version: string | number;
  facts: { module: string; key: string; value: unknown; status?: string }[];
  fee_pct: number | null;
  basis: string | null;
  draft_fee_pct: number | null;
  draft_basis: string | null;
};
type Fact = Record<string, unknown>;
const object = (value: unknown): Fact | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Fact) : null;
const add = (a: number, b: number) => {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error("Destination totals exceed safe cent precision.");
  return sum;
};
function moneyCents(value: unknown, credit = false): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.round(value * 100);
  return Number.isSafeInteger(n) && (credit || n >= 0) && Math.abs(value * 100 - n) <= 1e-6
    ? n
    : null;
}
const dollars = (amount: number) => {
  // JSON numeric text becomes an exact PostgreSQL decimal. Beyond 15 cent
  // digits, JS float multiplication can round-trip while that text loses cents.
  if (amount > STORED_CENTS_MAX)
    throw new Error("A destination amount exceeds exact serialized cent precision.");
  const value = amount / 100;
  if (moneyCents(value) !== amount)
    throw new Error("A destination amount cannot retain its exact cents.");
  return value;
};
const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    object(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
function change(value: unknown): boolean {
  const v = object(value);
  if (!v || !Object.hasOwn(v, "executed_change_order")) return false;
  if (
    typeof v.executed_change_order !== "string" ||
    !v.executed_change_order.trim() ||
    v.fee_included !== true ||
    moneyCents(v.billable_value, true) === null
  )
    throw new Error("An existing executed change-order row needs review.");
  return true;
}

function recordedContract(destination: DestinationSnapshot) {
  const canonical = destination.facts.filter(
    (f) => f.module === "contract" && ["contract_value", "contract_value_basis"].includes(f.key),
  );
  if (new Set(canonical.map((f) => f.key)).size !== canonical.length)
    throw new Error("Conflicting canonical recorded contract facts need review.");
  for (const f of canonical) {
    if (
      f.status !== undefined &&
      (!["known", "unknown", "na"].includes(f.status) ||
        (f.status !== "known" && f.value !== null && f.value !== undefined))
    )
      throw new Error("Malformed canonical recorded contract facts need review.");
  }
  const known = (key: string) =>
    canonical.find(
      (f) =>
        f.key === key &&
        (f.status === "known" ||
          (f.status === undefined && f.value !== null && f.value !== undefined)),
    );
  const value = known("contract_value");
  const basisFact = known("contract_value_basis");
  const originalCents = value ? moneyCents(value.value) : null;
  if (value && (originalCents === null || originalCents > 9_000_000_000_000))
    throw new Error(
      "The canonical recorded original contract value needs an exact nonnegative USD amount.",
    );
  const basis = basisFact ? object(basisFact.value) : null;
  // 0058 stores provenance beside the numeric USD contract_value. Legacy
  // matching numeric values may have no basis; never invent or write one.
  if (
    basisFact &&
    (!basis ||
      typeof basis.reference !== "string" ||
      !basis.reference.trim() ||
      basis.reference.trim().length > 2000 ||
      !z.uuid().safeParse(basis.provided_by).success ||
      !z.iso.datetime({ offset: true }).safeParse(basis.provided_at).success ||
      originalCents === null)
  )
    throw new Error(
      "The canonical recorded contract basis needs its reference, member and timestamp.",
    );
  return { originalCents, basis };
}

/** Pure proposal only. The caller must bind canonical source and guarded
 * destination identities, compare versions, review and atomically save it. */
export function mapEstimateDestination(input: {
  breakdown: BidBreakdown;
  destination: DestinationSnapshot;
  plan: DestinationPlan;
}) {
  const { breakdown: bid, destination } = input;
  const plan = destinationPlanSchema.parse(input.plan);
  if (plan.kind === "sov") {
    const invalid = sovItemProblems(plan.lines.map((line) => line.line));
    if (invalid.length) throw new Error(invalid.join("\n"));
  }
  if (
    !destination.company_id?.trim() ||
    !destination.job_id?.trim() ||
    destination.version === null ||
    destination.version === undefined ||
    !Array.isArray(destination.facts)
  )
    throw new Error("A guarded company, job and destination version are required.");
  if (!canonicalBidCsv({ job: destination.job_id, version: 0, ready: true, breakdown: bid }))
    throw new Error("The canonical source bid does not reconcile.");
  const components = bidComponents(bid);
  const amounts = new Map(components.map((c) => [c.id, c.amountCents]));
  if (amounts.size !== components.length || plan.allocations.length !== components.length)
    throw new Error("Choose every source component exactly once.");
  const modules = new Map<string, Map<string, unknown>>();
  for (const f of destination.facts) {
    if (!["budget", "sov", "sov_draft"].includes(f.module)) continue;
    if (
      f.status !== undefined &&
      (!["known", "unknown", "na"].includes(f.status) ||
        (f.status !== "known" && f.value !== null && f.value !== undefined))
    )
      throw new Error("A destination fact status conflicts with its saved value.");
    const rows = modules.get(f.module) ?? new Map<string, unknown>();
    if (rows.has(f.key)) throw new Error("The destination contains duplicate fact identities.");
    rows.set(f.key, f.value);
    modules.set(f.module, rows);
  }
  const budget = modules.get("budget") ?? new Map<string, unknown>();
  const targetModule =
    plan.kind === "budget" ? "budget" : plan.copy === "draft" ? "sov_draft" : "sov";
  const targets = new Map<string, number>();
  const zeroTargets = new Set<string>();
  const targetUses = new Set<string>();
  for (const line of plan.lines) {
    const id = "cost_code" in line ? line.cost_code : line.line;
    if (targets.has(id)) throw new Error("Destination target identities must be unique.");
    targets.set(id, 0);
    if (line.zero) zeroTargets.add(id);
  }
  const seen = new Set<string>();
  let mapped = 0,
    excluded = 0,
    fee = 0;
  const allocationTotals = plan.allocations.map((a) => {
    const source = amounts.get(a.component_id);
    if (source === undefined || seen.has(a.component_id))
      throw new Error("Choose every source component exactly once.");
    seen.add(a.component_id);
    let rowMapped = 0;
    const rowTargets = new Set<string>();
    for (const s of a.splits) {
      if (!targets.has(s.target_key) || rowTargets.has(s.target_key))
        throw new Error("A split needs one known, unambiguous destination target.");
      rowTargets.add(s.target_key);
      targetUses.add(s.target_key);
      targets.set(s.target_key, add(targets.get(s.target_key)!, s.amount_cents));
      rowMapped = add(rowMapped, s.amount_cents);
    }
    const rowExcluded = "excluded_cents" in a ? a.excluded_cents : 0;
    const rowFee = "fee_cents" in a ? a.fee_cents : 0;
    if (rowExcluded > 0 && !("exclusion_reason" in a && a.exclusion_reason?.trim()))
      throw new Error("Every excluded amount needs an explicit reason.");
    if (add(add(rowMapped, rowExcluded), rowFee) !== source)
      throw new Error(`Allocation for ${a.component_id} does not match its exact source cents.`);
    mapped = add(mapped, rowMapped);
    excluded = add(excluded, rowExcluded);
    fee = add(fee, rowFee);
    return {
      component_id: a.component_id,
      mapped_cents: rowMapped,
      excluded_cents: rowExcluded,
      fee_cents: rowFee,
    };
  });
  if (seen.size !== amounts.size || add(add(mapped, excluded), fee) !== bid.totalCents)
    throw new Error("Source allocations do not reconcile.");
  for (const [id, amount] of targets) {
    if (!targetUses.has(id) && !zeroTargets.has(id))
      throw new Error(`Unused target ${id} requires an explicit zero decision.`);
    if (zeroTargets.has(id) && amount !== 0)
      throw new Error(`Target ${id} is marked zero but has allocated cents.`);
  }
  const patch: Record<string, unknown> = Object.create(null);
  const existing = modules.get(targetModule) ?? new Map<string, unknown>();
  let previous = existing;
  const terms: Record<string, number | string> = {};
  let baseCents = mapped,
    feeCents = fee,
    retainedChangeCents = 0,
    finalTotal: number | null = null;
  let officialLocked = false;
  let contract: ReturnType<typeof recordedContract> | null = null;
  let billingStructure: {
    work_line_count: number;
    max_work_lines: number;
    work_line_limit_ok: boolean;
    amount_range_ok: boolean;
    requires_official_acceptance: boolean;
  } | null = null;
  if (plan.kind === "budget") {
    for (const line of plan.lines)
      patch[line.cost_code] = {
        ...(object(existing.get(line.cost_code)) ?? {}),
        description: line.description,
        amount: dollars(targets.get(line.cost_code)!),
      };
    const result = new Map(existing);
    for (const [k, v] of Object.entries(patch)) result.set(k, v);
    finalTotal = 0;
    for (const v of result.values()) {
      const n = moneyCents(object(v)?.amount);
      if (n === null) {
        finalTotal = null;
        break;
      }
      finalTotal = add(finalTotal, n);
    }
  } else {
    contract = recordedContract(destination);
    if (plan.copy === "official") {
      if (contract.originalCents !== null && contract.originalCents !== bid.totalCents)
        throw new Error(
          "The frozen base bid does not match the canonical recorded original contract value. Review the contract basis; no award was changed.",
        );
    }
    const official = modules.get("sov") ?? new Map<string, unknown>();
    // Existing draft base rows remain authoritative; the initial draft copies
    // official rows. Newly executed official changes are also retained.
    previous = plan.copy === "draft" && existing.size === 0 ? new Map(official) : new Map(existing);
    if (plan.copy === "draft") {
      for (const [k, v] of official)
        if (change(v)) {
          if (previous.has(k) && stable(previous.get(k)) !== stable(v))
            throw new Error("A draft target conflicts with an executed change-order row.");
          if (!previous.has(k)) previous.set(k, v);
        }
      for (const [k, v] of previous)
        if (change(v) && (!official.has(k) || stable(official.get(k)) !== stable(v)))
          throw new Error("A draft contains an unmatched executed change-order row.");
      for (const [k, v] of previous) if (!existing.has(k)) patch[k] = v;
    }
    for (const line of plan.lines) {
      if (change(previous.get(line.line)) || change(official.get(line.line)))
        throw new Error("Executed change-order targets cannot be replaced by an estimate handoff.");
      if (
        new Set(line.cost_codes).size !== line.cost_codes.length ||
        line.cost_codes.some((code) => !budget.has(code))
      )
        throw new Error(`SOV line ${line.line} needs existing, unique guarded budget cost codes.`);
      patch[line.line] = {
        ...(object(previous.get(line.line)) ?? {}),
        description: line.description,
        billable_value: dollars(targets.get(line.line)!),
        cost_codes: line.cost_codes,
        ...(line.spec_section !== undefined ? { spec_section: line.spec_section } : {}),
      };
    }
    const result = new Map(previous);
    for (const [k, v] of Object.entries(patch)) result.set(k, v);
    baseCents = 0;
    const rows: SovLineIn[] = [];
    for (const [id, raw] of result) {
      const v = object(raw);
      const isChange = change(raw);
      const amount = moneyCents(v?.billable_value, isChange);
      if (amount === null)
        throw new Error(`Existing SOV line ${id} needs an explicit amount before handoff.`);
      if (isChange) retainedChangeCents = add(retainedChangeCents, amount);
      else baseCents = add(baseCents, amount);
      rows.push({
        item_no: id,
        description: typeof v!.description === "string" ? v!.description : null,
        scheduled_value: amount / 100,
        ...(isChange
          ? { executed_change_order: String(v!.executed_change_order), fee_included: true }
          : {}),
      });
    }
    if (baseCents !== mapped)
      throw new Error(
        "Retained numeric base lines break the frozen bid total. Explicitly map or zero every affected base target.",
      );
    const countOkay = rows.length >= 1 && rows.length <= 99;
    const grandTotal = add(bid.totalCents, retainedChangeCents);
    const rangeOkay =
      bid.totalCents <= 9_000_000_000_000 &&
      grandTotal >= 0 &&
      grandTotal <= 9_000_000_000_000 &&
      rows.every((row) => Math.abs(moneyCents(row.scheduled_value, true)!) <= 9_000_000_000_000);
    billingStructure = {
      work_line_count: rows.length,
      max_work_lines: 99,
      work_line_limit_ok: countOkay,
      amount_range_ok: rangeOkay,
      requires_official_acceptance: plan.copy === "draft",
    };
    if (plan.copy === "official" && !countOkay)
      throw new Error(
        "Official billing supports at most 99 stored work lines. Choose an explicit mapping into allowed line identities; retained changes are preserved.",
      );
    if (plan.copy === "official" && !rangeOkay)
      throw new Error(
        "Official SOV line or contract amounts exceed the supported billing range. Review the explicit values.",
      );
    const calculatedBaseTotal = Math.round(baseCents / (1 - plan.fee_pct / 100));
    if (
      !Number.isSafeInteger(calculatedBaseTotal) ||
      calculatedBaseTotal !== bid.totalCents ||
      calculatedBaseTotal - baseCents !== fee
    )
      throw new Error(
        "Explicit SOV base splits and fee do not reconcile to the exact frozen bid total.",
      );
    if (bid.totalCents > STORED_CENTS_MAX)
      throw new Error("The SOV total exceeds exact serialized cent precision.");
    const report = buildSov(rows, plan.fee_pct, null);
    feeCents = fee;
    finalTotal = add(bid.totalCents, retainedChangeCents);
    if (moneyCents(report.summary.contract_total) !== finalTotal)
      throw new Error(
        "The canonical SOV report does not tie to the frozen base plus retained changes.",
      );
    if (plan.copy === "official") {
      officialLocked = [...official.values()].some(
        (v) => moneyCents(object(v)?.billable_value, change(v)) !== null,
      );
      if (
        sovTotalChangeRefusal(
          [...official].map(([key, value]) => ({ key, value })),
          destination.fee_pct,
          patch,
          plan.fee_pct,
        )
      )
        throw new Error(
          "Official SOV dollars are locked. Use the existing draft copy or an approved change-order workflow.",
        );
      if (destination.fee_pct !== plan.fee_pct) terms.sov_fee_pct = plan.fee_pct;
      if (destination.basis !== plan.billing_basis) terms.sov_basis = plan.billing_basis;
    } else {
      if (destination.draft_fee_pct !== plan.fee_pct) terms.sov_draft_fee_pct = plan.fee_pct;
      if (destination.draft_basis !== plan.billing_basis)
        terms.sov_draft_basis = plan.billing_basis;
    }
  }
  if (finalTotal !== null && finalTotal > STORED_CENTS_MAX)
    throw new Error("The resulting destination total exceeds exact serialized cent precision.");
  const beforeAmount = (key: string) =>
    moneyCents(object(previous.get(key))?.[plan.kind === "budget" ? "amount" : "billable_value"]);
  return {
    kind: plan.kind,
    copy: plan.kind === "sov" ? plan.copy : null,
    plan,
    facts: { [targetModule]: patch },
    terms,
    target_keys: [...targets.keys()].map((key) => ({ module: targetModule, key })),
    components,
    allocated_components: allocationTotals
      .filter((a) => a.mapped_cents > 0 || a.fee_cents > 0)
      .map((a) => a.component_id),
    allocation_totals: allocationTotals,
    review: {
      source_total_cents: bid.totalCents,
      mapped_cents: mapped,
      excluded_cents: excluded,
      fee_cents: feeCents,
      resulting_base_cents: baseCents,
      retained_change_cents: retainedChangeCents,
      resulting_total_cents: finalTotal,
      official_locked: officialLocked,
      recorded_contract_original_cents: contract?.originalCents ?? null,
      recorded_contract_basis: contract?.basis ?? null,
      billing_structure: billingStructure,
      source_basis: plan.kind === "sov" ? plan.source_basis : null,
      billing_basis: plan.kind === "sov" ? plan.billing_basis : null,
      fee_pct: plan.kind === "sov" ? plan.fee_pct : null,
      targets: [...targets].map(([key, amount]) => ({
        module: targetModule,
        key,
        previous_cents: beforeAmount(key),
        proposed_cents: amount,
      })),
      retained_keys: [...previous.keys()].filter((k) => !targets.has(k)),
      retained_rows: [...previous]
        .filter(([key]) => !targets.has(key))
        .map(([key, value]) => ({
          module: targetModule,
          key,
          value,
          amount_cents: moneyCents(
            object(value)?.[plan.kind === "budget" ? "amount" : "billable_value"],
            plan.kind === "sov" && change(value),
          ),
        })),
      terms,
    },
  };
}
