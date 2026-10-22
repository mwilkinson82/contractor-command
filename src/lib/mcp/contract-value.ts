// Contract value for a plain "what's the contract worth" question.
// Job setup wins, then the SOV total, then the IOR's contract or budget basis.
import { SovMismatch, buildSov, money, retainagePct, type SovLineIn } from "./sov";

export type ValueSource = "job setup" | "SOV" | "IOR";

const SETUP_KEYS = new Set(["contract_value", "contract_amount", "original_contract", "contract_sum", "contract"]);
const SETUP_MODULES = new Set(["contract", "budget", "job", "setup"]);
const IOR_KEYS = ["contract_value", "contract_total", "contract_sum", "contract", "budget_basis"];
const COMPLETION_KEYS = ["substantial_completion", "contract_completion", "contract_completion_date"];

export function asMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0 && /\d/.test(value)) return n;
  }
  return null;
}

export function setupContractValue(facts: { module: string; key: string; value: unknown; status?: string }[]): number | null {
  for (const fact of facts) {
    if (fact.status === "unknown" || fact.status === "na") continue;
    if (!SETUP_MODULES.has(fact.module) || !SETUP_KEYS.has(fact.key)) continue;
    const amount = asMoney(fact.value);
    if (amount != null) return amount;
  }
  return null;
}

export function sovContractValue(lines: SovLineIn[], feePct: number | null, retainage: unknown): number | null {
  if (!lines.length) return null;
  try {
    return buildSov(lines, feePct, retainagePct(retainage)).summary.contract_total;
  } catch (e) {
    if (e instanceof SovMismatch) return null;
    return null;
  }
}

function keyedAmount(value: unknown, depth = 0): number | null {
  if (depth > 6 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const row of value) {
      const found = keyedAmount(row, depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of IOR_KEYS) {
    if (key in record) {
      const amount = asMoney(record[key]);
      if (amount != null && amount >= 1000) return amount;
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "kpis" || key === "activities" || /version|gross_profit|margin/.test(key)) continue;
    const found = keyedAmount(child, depth + 1);
    if (found != null) return found;
  }
  return null;
}

export function iorContractValue(report: { contract_total?: number | null; data?: unknown } | null | undefined): number | null {
  const top = asMoney(report?.contract_total);
  if (top != null && top >= 1000) return top;
  return keyedAmount(report?.data);
}

export function pickContractValue(input: { setup: number | null; sov: number | null; ior: number | null }): { amount: number | null; source: ValueSource | null } {
  if (input.setup != null) return { amount: input.setup, source: "job setup" };
  if (input.sov != null) return { amount: input.sov, source: "SOV" };
  if (input.ior != null) return { amount: input.ior, source: "IOR" };
  return { amount: null, source: null };
}

export function completionDate(jobDate: string | null | undefined, facts: { key: string; value: unknown; status?: string }[]): string | null {
  if (jobDate && /^\d{4}-\d{2}-\d{2}/.test(jobDate)) return jobDate.slice(0, 10);
  for (const key of COMPLETION_KEYS) {
    const fact = facts.find((row) => row.key === key && row.status !== "unknown" && row.status !== "na");
    if (typeof fact?.value === "string" && /^\d{4}-\d{2}-\d{2}/.test(fact.value)) return fact.value.slice(0, 10);
  }
  return null;
}

export function contractValueLine(amount: number | null, source: ValueSource | null, showMoney: boolean): string {
  if (!showMoney) return "Contract value: hidden for this role";
  if (amount == null) return "Contract value: Needed";
  return `Contract value: ${money(amount)}${source ? ` (${source})` : ""}`;
}
