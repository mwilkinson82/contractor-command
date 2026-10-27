// The owner confirmed this calculation for this specific saved report version.
// It does not authorize reinterpreting other jobs or future report revisions.
const CEDAR_JOB = "289ca2cd-b585-419a-8c09-3501d1be48c3";
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
function cents(v: unknown): number | null {
  if (typeof v === "string" && /^-?\d+(?:\.\d{1,2})?$/.test(v.trim())) v = Number(v);
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v * 100);
  return Number.isSafeInteger(n) && Math.abs(v * 100 - n) < 1e-6 ? n : null;
}
function holdRows(value: unknown): { cents: number; rows: Obj[] } | null {
  if (!Array.isArray(value) || !value.every(obj)) return null;
  const ids = new Set<string>();
  let sum = 0;
  for (const row of value) {
    // Unknown/released/realized statuses require a new decision, not an assumed treatment.
    if (typeof row.id !== "string" || !row.id || ids.has(row.id) || row.status !== "Open")
      return null;
    ids.add(row.id);
    const n = cents(row.amount);
    if (n == null || n < 0) return null;
    sum += n;
  }
  return Number.isSafeInteger(sum) ? { cents: sum, rows: value } : null;
}
export type IorOutcome = {
  contract: number | null;
  planned: number | null;
  indicated: number | null;
  eHolds: number | null;
  cHolds: number | null;
  eRows: Obj[];
  cRows: Obj[];
};
export function cedarOutcome(
  jobId: string | undefined | null,
  report: { version?: number; contract_total?: unknown; forecast_total?: unknown; data?: unknown },
): IorOutcome | null {
  if (jobId?.toLowerCase() !== CEDAR_JOB) return null;
  const data = obj(report.data) ? report.data : {};
  const contract = cents(report.contract_total);
  const validContract = contract != null && contract > 0 ? contract : null;
  const result: IorOutcome = {
    contract: validContract,
    planned: null,
    indicated: null,
    eHolds: null,
    cHolds: null,
    eRows: [],
    cRows: [],
  };
  // Version 3 is the owner-confirmed basis. Newer report versions need their own basis.
  if (report.version !== 3 || !validContract || !obj(data.direct_budget)) return result;
  const budget = data.direct_budget;
  if (!obj(budget.totals)) return result;
  const total = budget.totals;
  const billed = cents(total.billing),
    direct = cents(total.direct_budget),
    overhead = cents(total.overhead),
    profit = cents(total.profit);
  if (
    billed !== validContract ||
    direct == null ||
    overhead == null ||
    profit == null ||
    direct < 0 ||
    overhead < 0 ||
    direct + overhead + profit !== validContract
  )
    return result;
  result.planned = profit;
  if (!obj(data.holds)) return result;
  const holds = data.holds;
  const e = holdRows(holds.e_holds),
    c = holdRows(holds.c_holds),
    cTotal = cents(holds.c_hold_total);
  if (!e || !c || cTotal == null || c.cents !== cTotal) return result;
  const ids = [...e.rows, ...c.rows].map((r) => r.id);
  if (new Set(ids).size !== ids.length) return result;
  result.eHolds = e.cents;
  result.cHolds = c.cents;
  result.eRows = e.rows;
  result.cRows = c.rows;
  // This particular report says actual cost and billing are not supplied; never hide later facts.
  if (
    data.actual_cost_to_date !== null ||
    data.actual_gross_billed_to_date !== null ||
    report.forecast_total != null
  )
    return result;
  if (
    Array.isArray(budget.activities) &&
    budget.activities.some((a) => obj(a) && a.actual_cost != null)
  )
    return result;
  result.indicated = profit - e.cents - c.cents;
  return result;
}
