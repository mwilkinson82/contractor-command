// Accounting phase 1, decision D1 (Marshall, 2026-10-20): there is NO global retainage default.
// Retainage is set per job from the contract. At job setup Athena directs the host to read the rate and the reduction
// rules (threshold, what the threshold is measured against, reduced rate, prospective or whole balance, release terms)
// with the clause quoted exactly, or to ask the PM when the contract is silent. The rule is saved on the job, and the
// pay app math checks enforce that saved rule to the cent and block on any mismatch.
import { applyBp, divHalfUp, fmt, fmtBp, sum } from "./cents";

/**
 * How a reduced rate applies once the threshold is reached:
 * - prospective: payments after the threshold is crossed are held at the reduced rate; the period that crosses it is split.
 * - whole_balance: once at the threshold, retainage on the whole amount completed to date drops to the reduced rate.
 * - period_start_status: the rate for the whole period is set by where the job stood at the start of the period.
 * - none: one flat rate, no reduction.
 */
export const REDUCTION_METHODS = ["prospective", "whole_balance", "period_start_status", "none"] as const;
export type ReductionMethod = (typeof REDUCTION_METHODS)[number];
export const THRESHOLD_BASES = ["contract_sum_to_date", "original_contract"] as const;
export type ThresholdBasis = (typeof THRESHOLD_BASES)[number];

export type RetainageRule = {
  base_rate_bp: number; // 1000 = 10%. 0 = the contract holds no retainage.
  reduction: ReductionMethod;
  threshold_bp: number | null; // 5000 = 50% complete
  threshold_basis: ThresholdBasis | null;
  reduced_rate_bp: number | null;
  release_terms: string | null;
  source: "contract" | "pm_answer";
  clause_section: string | null; // "4.1"
  clause_text: string | null; // exact contract words
  answered_by: string | null; // pm_answer: who answered
  // D2 (Marshall, 2026-10-20): stored materials are held at the same rate as completed work unless the contract says
  // otherwise. null = same rule as completed work; a number = the contract's separate stored-materials rate.
  stored_rate_bp?: number | null;
};

/** Problems with a rule as given; empty when it can be saved. Nothing is filled in that the contract or the PM didn't say. */
export function ruleProblems(r: RetainageRule, contractText?: string | null): string[] {
  const p: string[] = [];
  if (!Number.isInteger(r.base_rate_bp) || r.base_rate_bp < 0 || r.base_rate_bp > 10000) p.push("The retainage rate must be between 0% and 100%.");
  if (r.reduction === "none") {
    if (r.threshold_bp !== null || r.reduced_rate_bp !== null) p.push("A flat rule has no threshold or reduced rate. Pick how the reduction applies, or clear them.");
  } else {
    if (r.threshold_bp === null || r.threshold_bp <= 0 || r.threshold_bp > 10000) p.push("A reduction needs the threshold (the % complete where it starts).");
    if (!r.threshold_basis) p.push("Say what the threshold is measured against: the contract sum to date or the original contract.");
    if (r.reduced_rate_bp === null || r.reduced_rate_bp < 0 || r.reduced_rate_bp > r.base_rate_bp) p.push("A reduction needs the reduced rate, no higher than the starting rate.");
  }
  if (r.stored_rate_bp != null && (!Number.isInteger(r.stored_rate_bp) || r.stored_rate_bp < 0 || r.stored_rate_bp > 10000)) p.push("The stored-materials rate must be between 0% and 100%.");
  if (r.source === "contract") {
    if (!r.clause_text?.trim() || !r.clause_section?.trim()) p.push("Quote the retainage clause exactly, with its section number.");
    else if (contractText && !norm(contractText).includes(norm(r.clause_text))) p.push(`The clause text for §${r.clause_section} isn't found word for word in the contract. Copy it exactly.`);
  } else if (!r.answered_by?.trim()) {
    p.push("The contract is silent, so the rule comes from the PM. Say who answered.");
  }
  return p;
}
const norm = (s: string) => s.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** "10% until 50% complete (measured on the contract sum to date), then 5% on later payments. Release: ..." */
export function ruleLine(r: RetainageRule): string {
  const basis = r.threshold_basis === "original_contract" ? "the original contract" : "the contract sum to date";
  const how =
    r.reduction === "none"
      ? `${fmtBp(r.base_rate_bp)} on every payment, no reduction`
      : r.reduction === "prospective"
        ? `${fmtBp(r.base_rate_bp)} until ${fmtBp(r.threshold_bp!)} complete (measured on ${basis}), then ${fmtBp(r.reduced_rate_bp!)} on later payments`
        : r.reduction === "whole_balance"
          ? `${fmtBp(r.base_rate_bp)} until ${fmtBp(r.threshold_bp!)} complete (measured on ${basis}), then ${fmtBp(r.reduced_rate_bp!)} on the whole balance held`
          : `${fmtBp(r.base_rate_bp)} until ${fmtBp(r.threshold_bp!)} complete (measured on ${basis}) at the start of a period, then ${fmtBp(r.reduced_rate_bp!)} for the whole period`;
  const src = r.source === "contract" ? `§${r.clause_section} ‹${r.clause_text}› (document)` : `the contract is silent; per ${r.answered_by} (PM answer)`;
  const stored = r.stored_rate_bp == null ? "" : ` Stored materials: ${fmtBp(r.stored_rate_bp)} (contract).`;
  return `${how}.${stored} Release: ${r.release_terms?.trim() || "Needed"}. Source: ${src}.`;
}

export type RetLineIn = { id: string; c: number; prev_g: number; g: number; f: number; prev_i: number; prev_f?: number; prev_i_stored?: number };
export type RetResult = {
  threshold_amount: number | null;
  below: number; // part of the period amount held at the base rate
  above: number; // part held at the reduced rate
  period_amount: number;
  period_retainage: number;
  total_retainage: number;
  lines: { id: string; period_amount: number; period_retainage: number; i: number; i_stored: number }[];
  note: string; // the one-line retainage note for the pay app view
};

/** Threshold in cents: the % of the contract sum to date (or the original contract), half up. */
export function thresholdAmount(r: RetainageRule, contractSumToDate: number, originalContract: number): number | null {
  if (r.reduction === "none" || r.threshold_bp === null) return null;
  return applyBp(r.threshold_basis === "original_contract" ? originalContract : contractSumToDate, r.threshold_bp);
}

/**
 * Expected retainage for one pay app under the saved rule. All integer cents.
 * Line period amount = G this app − G last certified app. The period total is computed by tier (each tier half up);
 * it is spread over the lines in proportion to their period amounts, half up, and any leftover cent goes to the lines
 * with the largest remainders, so the lines always sum to the tier total exactly. I = I last certified + period retainage.
 */
export function computeRetainage(r: RetainageRule, lines: RetLineIn[], contractSumToDate: number, originalContract: number): RetResult {
  if (r.stored_rate_bp == null) return computeRule(r, lines, contractSumToDate, originalContract);
  // D2 with a separate contract rate: completed work follows the rule (the threshold still counts work plus stored, G);
  // stored materials still in F are held at the stored rate on their whole balance.
  const offPrev = sum(lines.map((l) => l.prev_f ?? 0));
  const offNew = sum(lines.map((l) => l.f));
  const work = computeRule(r, lines.map((l) => ({ ...l, prev_g: l.prev_g - (l.prev_f ?? 0), g: l.g - l.f, prev_i: l.prev_i - (l.prev_i_stored ?? 0) })), contractSumToDate, originalContract, { prev: offPrev, next: offNew });
  const st = lines.map((l) => applyBp(l.f, r.stored_rate_bp!));
  const out = work.lines.map((w, k) => ({ id: w.id, period_amount: lines[k].g - lines[k].prev_g, period_retainage: w.period_retainage + st[k] - (lines[k].prev_i_stored ?? 0), i: w.i + st[k], i_stored: st[k] }));
  const total = sum(out.map((o) => o.i));
  const prevI = sum(lines.map((l) => l.prev_i));
  return { ...work, period_amount: sum(out.map((o) => o.period_amount)), period_retainage: total - prevI, total_retainage: total, lines: out,
    note: `${work.note.replace(/ This period: .*$/, "")} Stored materials at ${fmtBp(r.stored_rate_bp)}. This period: ${fmt(total - prevI)}.` };
}

function computeRule(r: RetainageRule, lines: RetLineIn[], contractSumToDate: number, originalContract: number, off: { prev: number; next: number } = { prev: 0, next: 0 }): RetResult {
  // The threshold is measured on G (work plus stored); with a separate stored rate the work-only amounts are shifted by stored.
  const T = thresholdAmount(r, contractSumToDate, originalContract);
  const prevG = sum(lines.map((l) => l.prev_g)) + off.prev;
  const newG = sum(lines.map((l) => l.g)) + off.next;
  const period = newG - prevG - (off.next - off.prev);
  const prevI = sum(lines.map((l) => l.prev_i));
  const base = r.base_rate_bp;
  const reduced = r.reduced_rate_bp ?? base;

  if (r.reduction === "whole_balance" && T !== null && newG >= T) {
    // Whole balance at the reduced rate: each line's I is its G at the reduced rate.
    const out = lines.map((l) => { const i = applyBp(l.g, reduced); return { id: l.id, period_amount: l.g - l.prev_g, period_retainage: i - l.prev_i, i, i_stored: 0 }; });
    const total = sum(out.map((o) => o.i));
    return { threshold_amount: T, below: 0, above: period, period_amount: period, period_retainage: total - prevI, total_retainage: total, lines: out,
      note: `Held at ${fmtBp(reduced)} on the whole ${fmt(newG)} completed (at or above ${fmt(T)}). This period: ${fmt(total - prevI)}.` };
  }

  let below = period, above = 0;
  if (T !== null && r.reduction === "prospective") {
    // Work crosses the threshold in G terms: the work slice sits between prevG and prevG + period.
    below = Math.max(0, Math.min(prevG + period, T) - Math.min(prevG, T));
    if (period < 0) below = period; // a reversal comes back at the starting rate
    above = period - below;
  } else if (T !== null && r.reduction === "period_start_status" && prevG >= T) {
    below = 0; above = period;
  } else if (T !== null && r.reduction === "whole_balance") {
    below = period; above = 0; // still under the threshold
  }
  const periodRet = applyBp(below, base) + applyBp(above, reduced);
  const out = spread(lines, period, periodRet);
  const total = prevI + periodRet;
  const note = T === null || r.reduction === "none"
    ? `Held at ${fmtBp(base)}. This period: ${fmt(periodRet)}.`
    : `Held at ${fmtBp(base)} up to ${fmt(T)} (${fmtBp(r.threshold_bp!)} of ${r.threshold_basis === "original_contract" ? "the original contract" : "contract sum to date"}), ${fmtBp(reduced)} above. This period: ${fmt(periodRet)}.`;
  return { threshold_amount: T, below, above, period_amount: period, period_retainage: periodRet, total_retainage: total, lines: out, note };
}

function spread(lines: RetLineIn[], period: number, periodRet: number) {
  const amts = lines.map((l) => l.g - l.prev_g);
  if (period === 0) return lines.map((l, k) => ({ id: l.id, period_amount: amts[k], period_retainage: 0, i: l.prev_i, i_stored: 0 }));
  const raw = amts.map((a) => (a * periodRet) / period);
  const shares = amts.map((a) => (period > 0 ? divHalfUp(a * periodRet, period) : divHalfUp(-a * periodRet, -period)));
  let diff = periodRet - sum(shares);
  const order = raw.map((x, k) => ({ k, rem: x - Math.trunc(x) })).sort((a, b) => (diff > 0 ? b.rem - a.rem : a.rem - b.rem));
  for (let n = 0; diff !== 0 && n < order.length * 2; n++) {
    const k = order[n % order.length].k;
    if (amts[k] === 0) continue;
    shares[k] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
  return lines.map((l, k) => ({ id: l.id, period_amount: amts[k], period_retainage: shares[k], i: l.prev_i + shares[k], i_stored: 0 }));
}

/** How the host is directed to set the rule at job setup (D1). Athena directs; the host does the reading. */
export const RETAINAGE_SETUP_RULE =
  "Retainage is set per job from the contract; there is no default rate. At job setup, read the contract's retainage clause and save it with retainage_rule_save: the rate, any reduction (the % complete where it starts, whether that is measured on the contract sum to date or the original contract, the reduced rate, and whether the reduced rate applies only to later payments or to the whole balance held), and the release terms, with the clause copied exactly and its section number. If the contract says nothing about retainage, ask the PM for the rule and save their answer with source pm_answer. Never assume a rate.";
