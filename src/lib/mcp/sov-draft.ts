import { draftBillingFromSchedule, type Activity, type BillingMonth } from "./living";
import { DRAFT_NOT_OFFICIAL } from "./record-copy";
import { SovMismatch, buildSov, money, sovSummaryText, type SovBrand, type SovLineIn } from "./sov";

/** Reuse a saved draft. Copy the official SOV only when no draft exists yet. */
export function nextDraftFacts(
  official: { key: string; value: unknown }[],
  draft: { key: string; value: unknown }[],
  incoming: Record<string, unknown> | null,
): { copy: Record<string, unknown> | null; edits: Record<string, unknown> | null } {
  const copy = draft.length || !official.length ? null : Object.fromEntries(official.map((row) => [row.key, row.value ?? {}]));
  return { copy, edits: incoming && Object.keys(incoming).length ? incoming : null };
}

/** Spread a draft scheduled total across a saved schedule window. Does not read or write the official contract. */
export function draftMonthForecast(total: number, start: string | null, finish: string | null): BillingMonth[] | null {
  if (!start || !finish || !(total > 0)) return null;
  const activity: Activity = {
    id: "draft-sov",
    name: "Draft schedule of values",
    duration: null,
    start,
    finish,
    predecessors: [],
    total_float: null,
    critical: null,
    pct_complete: null,
    value: total,
    sov_line: null,
    cost_code: null,
  };
  return draftBillingFromSchedule([activity], total, 0)?.months ?? null;
}

export function draftSovText(
  lines: SovLineIn[],
  feePct: number | null,
  basis: string | null,
  brand: SovBrand,
  window: { start: string | null; finish: string | null },
): string {
  let body = `${DRAFT_NOT_OFFICIAL}\nNo draft lines yet.`;
  let total = 0;
  try {
    const sov = buildSov(lines, feePct, null);
    total = sov.summary.contract_total;
    body = sovSummaryText("", sov, brand, basis, [], "internal", "lines", "draft");
  } catch (error) {
    if (!(error instanceof SovMismatch)) throw error;
    body = `${DRAFT_NOT_OFFICIAL}\n${error.message}`;
  }
  const months = draftMonthForecast(total, window.start, window.finish);
  const forecast = months?.length
    ? months.map((month) => `${month.month} ${month.kind} ${money(month.amount)}`)
    : ["Monthly forecast needs the saved schedule. Nothing was invented."];
  return `${body}\n\nMonthly forecast\n${DRAFT_NOT_OFFICIAL}\n${forecast.join("\n")}`;
}
