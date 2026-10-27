// House-style IOR page. Labels come from the map. Numbers are typed, so a version is not currency
// and a margin ratio is a percent. Names replace item, user, and job ids. Raw JSON is never printed.
import { ALERT_HEX } from "./mcp/alert-color";
import { asReportNumber, formatBillingText, formatMoneyPhrase, formatReportNumber, isIdentifierKey, isMoneyKey, isPercentKey, isPlainKey, money } from "./report-format";
import { iorHoldSummary, isContingencyHoldTotal, isExposureHoldTotal } from "./ior-hold-summary";
import { cedarOutcome } from "./ior-outcome";

export type ReportNames = {
  job_id?: string | null;
  job_name?: string | null;
  items?: { id?: string | null; action?: string | null }[];
  people?: { id?: string | null; name?: string | null }[];
};

const NAVY = "#1E3A5F";
const BLUE = "#1E5FED";
const GRAY = "#6B7280";
const LINE = "#D1D5DB";
const RED = ALERT_HEX;

/** Explicit labels for the saved IOR fields. Unknown keys are title-cased, never left as snake_case. */
export const IOR_LABELS: Record<string, string> = {
  title: "Title",
  audience: "Audience",
  open_item: "Open item",
  open_item_ref: "Open item",
  ref: "Item",
  schedule_caveat: "Schedule caveat",
  risk_allocations: "Risk allocations",
  top_three_actions: "Top three actions",
  source_cpm_version: "Source CPM version",
  cpm_version: "CPM version",
  version: "Version",
  budget_profit_basis: "Budget and profit basis",
  owner_allocation_basis: "Owner allocation basis",
  billing_timing_exposure: "Billing timing exposure",
  total_cost_risk_allocation: "Total cost at risk",
  risk_adjusted_budget_profit: "Risk-adjusted budget profit",
  acceleration_incremental_cost_planned: "Planned acceleration cost",
  owner_allocated_redesign_supplier_cost_exposure: "Owner redesign cost",
  source: "Source",
  gross_profit: "Gross profit",
  budgeted_gross_profit: "Budgeted gross profit",
  amount: "Amount",
  activity: "Activity",
  name: "Name",
  note: "Note",
  owner: "Owner",
  action: "Action",
  basis: "Basis",
  contract: "Contract",
  gp_pct: "GP percent",
  budgeted_margin: "Budgeted margin",
  margin_if_fully_incurred: "Margin if fully incurred",
  probability: "Probability",
  pct_complete: "Percent complete",
  percent_complete: "Percent complete",
  fee_pct: "Fee percent",
  pct_billed: "Percent billed",
  percent_billed: "Percent billed",
  weighted_margin: "Weighted margin",
  description: "Description",
};

/** Not shown to the member. The saved report still keeps them. */
const HIDDEN = new Set(["audience", "source_cpm_version", "cpm_version", "allocation_status", "id"]);
const SKIP = new Set(["kpis", "risks", "activities", "tia", "billing"]);
const LEAD_KEYS = ["description", "risk", "action", "title", "name"];
const COL_ORDER = ["description", "risk", "action", "title", "name", "owner", "amount", "exposure", "probability", "due", "needed_by", "status", "note"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVITY = /^[A-Z]{1,4}\d{2,5}[a-z]?$/;
const HEX = /^#?[0-9A-Fa-f]{5,8}$/;

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function humanLabel(key: string): string {
  return IOR_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function codeOf(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

export function nameForToken(token: string, names?: ReportNames | null): string | null {
  const raw = token.trim().replace(/^#/, "");
  if (UUID.test(raw)) {
    const id = raw.toLowerCase();
    const item = names?.items?.find((row) => (row.id ?? "").toLowerCase() === id);
    if (item?.action) return item.action;
    const person = names?.people?.find((row) => (row.id ?? "").toLowerCase() === id);
    if (person?.name) return person.name;
    if (names?.job_id && names.job_id.toLowerCase() === id && names.job_name) return names.job_name;
    return null;
  }
  if (!HEX.test(raw)) return null;
  const prefix = raw.toLowerCase();
  const item = names?.items?.find((row) => codeOf(row.id ?? "").startsWith(prefix));
  return item?.action?.trim() || null;
}

/** Visible words. A hash or id becomes the item, person, or job name. Unresolved hashes drop out. Activity codes stay. */
export function plainReportText(value: string, names?: ReportNames | null): string {
  let text = value.replace(UUID, (id) => nameForToken(id, names) ?? "");
  text = text.replace(/(?<![A-Za-z0-9])#?[0-9A-Fa-f]{5,8}\b/g, (token) => {
    const named = nameForToken(token, names);
    if (named) return named;
    const bare = token.replace(/^#/, "");
    if (ACTIVITY.test(bare)) return bare;
    if (HEX.test(token) && !ACTIVITY.test(bare)) return "";
    return token;
  });
  return text.replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").trim();
}

function isHidden(key: string): boolean {
  return HIDDEN.has(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function recordList(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || !value.length || !value.every(isRecord)) return null;
  return value;
}

function leadOf(record: Record<string, unknown>, names?: ReportNames | null): string {
  for (const key of LEAD_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      const text = plainReportText(value, names);
      if (text) return text;
    }
  }
  return "";
}

/** A row is red only when that row is a risk, a delay, or overdue. The section around it stays navy. */
function actualRisk(record: Record<string, unknown>): boolean {
  const status = [record.status, record.kind, record.flag, record.level, record.type].map((v) => String(v ?? "")).join(" ");
  return /\b(risk|delay|overdue)\b/i.test(status);
}

function formatValue(key: string, value: unknown, moneyOk: boolean, names?: ReportNames | null, depth = 0): string {
  if (isHidden(key) || value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return formatReportNumber(key, value, moneyOk);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    if (isIdentifierKey(key)) return esc(value);
    const phrase = isMoneyKey(key) ? formatMoneyPhrase(value) : null;
    if (phrase) return moneyOk ? phrase : "—";
    const numeric = asReportNumber(value);
    const rawFloat = numeric != null && !Number.isInteger(numeric) && value.trim().length > 8;
    if (numeric != null && (isPercentKey(key) || isMoneyKey(key) || isPlainKey(key) || rawFloat)) return formatReportNumber(key, numeric, moneyOk);
    if (/bill|plan|realistic/i.test(key)) return esc(formatBillingText(plainReportText(value, names)));
    return esc(plainReportText(value, names));
  }
  if (depth > 4) return "";
  if (Array.isArray(value)) {
    const records = recordList(value);
    if (records) return renderTable(records, moneyOk, names);
    return value.map((row) => formatValue(key, row, moneyOk, names, depth + 1)).filter(Boolean).join("<br>");
  }
  if (isRecord(value)) return renderFacts(value, moneyOk, names);
  return "";
}

function columnsFor(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) if (!isHidden(key) && !LEAD_KEYS.includes(key)) keys.add(key);
  const lead = LEAD_KEYS.find((key) => rows.some((row) => typeof row[key] === "string" && String(row[key]).trim()));
  const ordered = COL_ORDER.filter((key) => keys.has(key));
  for (const key of keys) if (!ordered.includes(key)) ordered.push(key);
  return lead ? [lead, ...ordered] : ordered;
}

function renderTable(rows: Record<string, unknown>[], moneyOk: boolean, names?: ReportNames | null): string {
  const cols = columnsFor(rows);
  if (!cols.length) return "";
  const head = cols.map((key) => `<th style="text-align:left;padding:8px 10px;font-size:12px;color:${GRAY};font-weight:600;border-bottom:1px solid ${LINE}">${esc(key === cols[0] && LEAD_KEYS.includes(key) ? "Description" : humanLabel(key))}</th>`).join("");
  const body = rows.map((record) => {
    const risk = actualRisk(record);
    const cells = cols.map((key, index) => {
      const shown = index === 0 && LEAD_KEYS.includes(key) ? esc(leadOf(record, names) || "—") : formatValue(key, record[key], moneyOk, names) || "—";
      return `<td style="padding:8px 10px;font-size:13px;color:${risk ? RED : NAVY};border-top:1px solid #F3F4F6;vertical-align:top">${shown}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table style="border-collapse:collapse;width:100%"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function tile(label: string, value: string, risk = false): string {
  return `<div style="flex:1 1 160px;background:#F9FAFB;border:1px solid ${risk ? RED : LINE};border-radius:10px;padding:12px"><div style="font-size:12px;color:${GRAY}">${esc(label)}</div><div style="font-size:20px;font-weight:600;color:${risk ? RED : NAVY}">${value}</div></div>`;
}

function renderFacts(record: Record<string, unknown>, moneyOk: boolean, names?: ReportNames | null): string {
  const tiles: string[] = [];
  const notes: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (isHidden(key) || value == null || value === "") continue;
    if (recordList(value)) {
      notes.push(renderTable(recordList(value)!, moneyOk, names));
      continue;
    }
    const shown = formatValue(key, value, moneyOk, names);
    if (!shown) continue;
    if (isFigure(key, value)) tiles.push(tile(humanLabel(key), shown, actualRisk({ status: key })));
    else notes.push(`<p style="margin:8px 0 0;font-size:13px;color:${NAVY}"><span style="color:${GRAY}">${esc(humanLabel(key))}</span> ${shown}</p>`);
  }
  return `${tiles.length ? `<div style="display:flex;flex-wrap:wrap;gap:12px">${tiles.join("")}</div>` : ""}${notes.join("")}`;
}

const card = (title: string, inner: string) =>
  `<section style="background:#fff;border:1px solid ${LINE};border-left:4px solid ${BLUE};border-radius:12px;padding:16px;margin:0 0 16px"><h2 style="margin:0 0 12px;font-size:15px;color:${NAVY}">${esc(title)}</h2>${inner}</section>`;

function riskCards(rows: Record<string, unknown>[], moneyOk: boolean, names?: ReportNames | null): string {
  return rows.map((record) => {
    const title = leadOf(record, names) || "Risk";
    const facts = Object.entries(record)
      .filter(([key]) => !isHidden(key) && !LEAD_KEYS.includes(key))
      .map(([key, value]) => {
        const shown = formatValue(key, value, moneyOk, names);
        return shown ? `<span style="color:${GRAY}">${esc(humanLabel(key))}</span> <span style="color:${NAVY}">${shown}</span>` : "";
      })
      .filter(Boolean)
      .join(` <span style="color:${LINE}">·</span> `);
    return `<article style="background:#fff;border:1px solid ${RED};border-left:4px solid ${RED};border-radius:10px;padding:12px;margin:0 0 8px"><h3 style="margin:0;font-size:15px;color:${RED}">${esc(title)}</h3>${facts ? `<p style="margin:6px 0 0;font-size:13px">${facts}</p>` : ""}</article>`;
  }).join("");
}

function isFigure(key: string, value: unknown): boolean {
  if (isIdentifierKey(key)) return false;
  if (typeof value === "number") return true;
  if (typeof value !== "string") return false;
  return ((isPercentKey(key) || isMoneyKey(key)) && asReportNumber(value) != null) || formatMoneyPhrase(value) != null;
}

export function renderIorLayout(input: {
  report: { scope?: string; version?: number; contract_total?: number | null; forecast_total?: number | null; data?: Record<string, unknown> };
  names?: ReportNames | null;
  jobId?: string | null;
}): string {
  const report = input.report;
  const data = report.data ?? {};
  const moneyOk = report.scope === "full";
  const names = input.names;
  const outcome = moneyOk ? cedarOutcome(input.jobId, report) : null;
  const holds = moneyOk && !outcome ? iorHoldSummary(data) : null;
  const summarized = (key: string) => !!holds && (isExposureHoldTotal(key) || (holds.contingencyCents != null && isContingencyHoldTotal(key)));
  const out: string[] = [];
  if (outcome) {
    const show = (v: number | null) => v == null ? "Not available" : esc(money(v / 100));
    const gp = (v: number | null) => `${show(v)}${v != null && outcome.contract ? ` · ${(v / outcome.contract * 100).toFixed(2)}%` : ""}`;
    const basis = outcome.indicated == null ? "Calculation unavailable: review the current report basis and inputs." : "Owner-confirmed report v3 basis: planned profit after allocated overhead less active E- and C-holds. Actual cost and billing are not supplied; no actuals are assumed.";
    out.push(card("Indicated outcome", `<div style="display:flex;flex-wrap:wrap;gap:12px">${tile("Contract value", show(outcome.contract))}${tile("Planned gross profit · margin", gp(outcome.planned))}${tile("Current indicated gross profit · margin", gp(outcome.indicated))}</div><p style="margin:12px 0 0;font-size:13px;color:${GRAY}">${esc(basis)}</p>`));
    if (outcome.eHolds != null && outcome.cHolds != null && isRecord(data.holds)) {
      const { e_holds: _e, c_holds: _c, c_hold_total: _total, ...sourceNotes } = data.holds;
      void _e; void _c; void _total;
      const note = outcome.indicated == null ? "Saved hold notes:" : "The saved notes below describe the earlier sensitivity basis; the owner-confirmed outcome above deducts the active holds.";
      out.push(card("E-holds and C-holds", `<div style="display:flex;flex-wrap:wrap;gap:12px">${tile("E-holds", show(outcome.eHolds))}${tile("C-holds", show(outcome.cHolds))}</div>${renderTable(outcome.eRows, moneyOk, names)}${outcome.cRows.length ? renderTable(outcome.cRows, moneyOk, names) : ""}<p style="font-size:12px;color:${GRAY}">${esc(note)}</p>${renderFacts(sourceNotes, moneyOk, names)}`));
    } else out.push(card("Holds", `<p style="margin:0;font-size:13px;color:${GRAY}">Hold summary: Not available</p>`));
  }
  if (moneyOk && typeof report.contract_total === "number" && typeof report.forecast_total === "number") {
    const ties = Math.round(report.contract_total * 100) === Math.round(report.forecast_total * 100);
    const line = ties
      ? `Forecast ${money(report.forecast_total)} = contract ${money(report.contract_total)}`
      : `Doesn't tie: off by ${money(Math.abs(report.forecast_total - report.contract_total))}`;
    out.push(`<p style="margin:0 0 12px;font-weight:600;color:${ties ? NAVY : RED}">${esc(line)}</p>`);
  }
  const kpis = isRecord(data.kpis) ? data.kpis : {};
  const figures: string[] = [];
  const notes: string[] = [];
  let title = "";
  for (const [key, value] of Object.entries(kpis)) {
    if (isHidden(key) || summarized(key)) continue;
    const shown = formatValue(key, value, moneyOk, names);
    if (!shown) continue;
    if (isFigure(key, value)) figures.push(tile(humanLabel(key), shown, actualRisk({ status: key })));
    else notes.push(`<p style="margin:8px 0 0;font-size:13px;color:${NAVY}"><span style="color:${GRAY}">${esc(humanLabel(key))}</span> ${shown}</p>`);
  }
  const sections: string[] = [];
  const lists: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (isHidden(key) || summarized(key) || key === "kpis" || key === "risks" || key === "activities" || key === "tia" || key === holds?.detailKey || (key === "holds" && outcome?.eHolds != null && outcome.cHolds != null)) continue;
    if (key === "billing" && value != null && typeof value === "object") continue;
    if (key === "title" && typeof value === "string") {
      title = plainReportText(value, names);
      continue;
    }
    if (isFigure(key, value)) {
      const shown = formatValue(key, value, moneyOk, names);
      if (shown) figures.push(tile(humanLabel(key), shown, actualRisk({ status: key })));
      continue;
    }
    const records = recordList(value);
    if (records) {
      lists.push(card(humanLabel(key), renderTable(records, moneyOk, names)));
      continue;
    }
    if (typeof value === "string" || (typeof value === "number" && isIdentifierKey(key))) {
      const shown = formatValue(key, value, moneyOk, names);
      if (shown) notes.push(`<p style="margin:8px 0 0;font-size:13px;color:${NAVY}"><span style="color:${GRAY}">${esc(humanLabel(key))}</span> ${shown}</p>`);
      continue;
    }
    if (isRecord(value)) {
      const inner = renderFacts(value, moneyOk, names);
      if (inner) sections.push(card(humanLabel(key), inner));
    }
  }
  if (title) out.push(`<h2 style="margin:0 0 12px;font-size:18px;color:${NAVY}">${esc(title)}</h2>`);
  if (figures.length || notes.length) out.push(card("Job health", `${figures.length ? `<div style="display:flex;flex-wrap:wrap;gap:12px">${figures.join("")}</div>` : ""}${notes.join("")}`));
  if (holds) {
    const c = tile("C-holds", holds.contingencyCents == null ? "Not available" : esc(money(holds.contingencyCents / 100)));
    out.push(card("Holds", `<div style="display:flex;flex-wrap:wrap;gap:12px">${tile("Listed E-holds", `${esc(money(holds.exposureCents / 100))} · ${holds.count} listed`)}${c}</div>${renderTable(holds.rows, moneyOk, names)}`));
  } else if (moneyOk && !outcome) {
    out.push(card("Holds", `<p style="margin:0;font-size:13px;color:${GRAY}">Hold summary: Not available</p>`));
  }
  out.push(...lists, ...sections);
  const risks = Array.isArray(data.risks) ? data.risks : [];
  const riskRows = risks.map((entry) => (isRecord(entry) ? entry : { description: entry }));
  if (riskRows.length) out.push(card("Risks", riskCards(riskRows, moneyOk, names)));
  if (!out.length) out.push(card("IOR", `<p style="margin:0;color:${GRAY}">The saved IOR has no items yet.</p>`));
  return out.join("");
}
