// Presentation-only rollup of one explicit E-hold detail list. Never combine a saved
// summary with its details, infer missing holds, or use cost/billing as evidence.
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const E_LIST = new Set(["e_holds", "exposure_holds"]);
const E_TOTAL = new Set([
  "e_hold_total",
  "e_holds_total",
  "exposure_hold_total",
  "exposure_holds_total",
]);
const C_TOTAL = new Set([
  "c_hold_total",
  "c_holds_total",
  "contingency_hold_total",
  "contingency_holds_total",
]);
export const isExposureHoldTotal = (key: string) => E_TOTAL.has(key);
export const isContingencyHoldTotal = (key: string) => C_TOTAL.has(key);

function amount(value: unknown): number | null {
  if (typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value.trim())) value = Number(value);
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-6
  )
    return null;
  return Math.round(value * 100);
}

export function iorHoldSummary(data: RecordValue): {
  exposureCents: number;
  count: number;
  contingencyCents: number | null;
  detailKey: string;
  rows: RecordValue[];
} | null {
  const lists = Object.entries(data).filter(
    ([key, value]) => E_LIST.has(key) && Array.isArray(value),
  );
  if (lists.length !== 1) return null;
  const rows = lists[0][1] as unknown[];
  if (!rows.length || !rows.every(record)) return null;
  const ids = rows
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((id): id is string => !!id);
  if (new Set(ids).size !== ids.length) return null;
  const amounts = rows.map((row) => {
    const fields = ["amount", "hold_amount", "exposure"].filter((key) => row[key] != null);
    return fields.length === 1 ? amount(row[fields[0]]) : null;
  });
  if (amounts.some((value) => value === null)) return null;
  const exposureCents = (amounts as number[]).reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(exposureCents)) return null;
  const sources = [data, ...(record(data.kpis) ? [data.kpis] : [])];
  const eValues = sources.flatMap((source) =>
    Object.entries(source)
      .filter(([key, value]) => E_TOTAL.has(key) && value != null)
      .map(([, value]) => value),
  );
  if (eValues.length > 1 || (eValues.length === 1 && amount(eValues[0]) !== exposureCents))
    return null;
  const cValues = sources.flatMap((source) =>
    Object.entries(source)
      .filter(([key, value]) => C_TOTAL.has(key) && value != null)
      .map(([, value]) => value),
  );
  const c = cValues.length === 1 ? amount(cValues[0]) : null;
  return {
    exposureCents,
    count: rows.length,
    contingencyCents: c,
    detailKey: lists[0][0],
    rows: rows as RecordValue[],
  };
}
