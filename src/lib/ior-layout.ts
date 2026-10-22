// House-style IOR page. Labels come from the map. Numbers are typed, so a version is not currency.
// Names replace item, user, and job ids. Raw JSON is never printed.
import { ALERT_HEX } from "./mcp/alert-color";
import { money } from "./mcp/sov";

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
};

const SKIP = new Set(["kpis", "risks", "activities", "tia", "billing"]);
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
  text = text.replace(/#?[0-9A-Fa-f]{5,8}\b/g, (token) => {
    const named = nameForToken(token, names);
    if (named) return named;
    const bare = token.replace(/^#/, "");
    if (ACTIVITY.test(bare)) return bare;
    if (HEX.test(token) && !ACTIVITY.test(bare)) return "";
    return token;
  });
  return text.replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").trim();
}

function isVersionKey(key: string): boolean {
  return /version|count|pct|percent/i.test(key);
}

function isMoneyKey(key: string): boolean {
  return /amount|cost|profit|budget|billing|exposure|allowance|contingency|contract|total|fee|price/i.test(key) && !isVersionKey(key);
}

function formatNumber(key: string, value: number, moneyOk: boolean): string {
  if (isVersionKey(key) || (Number.isInteger(value) && Math.abs(value) < 1000 && !isMoneyKey(key))) return String(value);
  if (!moneyOk) return "—";
  if (isMoneyKey(key) || Math.abs(value) >= 1000) return money(value);
  return String(value);
}

function formatValue(key: string, value: unknown, moneyOk: boolean, names?: ReportNames | null, depth = 0): string {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return formatNumber(key, value, moneyOk);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return esc(plainReportText(value, names));
  if (depth > 4) return "";
  if (Array.isArray(value)) {
    return value.map((row) => formatValue(key, row, moneyOk, names, depth + 1)).filter(Boolean).join("<br>");
  }
  if (typeof value === "object") {
    const rows = Object.entries(value as Record<string, unknown>)
      .map(([child, inner]) => {
        const shown = formatValue(child, inner, moneyOk, names, depth + 1);
        return shown ? `<div><span style="color:${GRAY}">${esc(humanLabel(child))}:</span> ${shown}</div>` : "";
      })
      .filter(Boolean);
    return rows.join("");
  }
  return "";
}

const row = (label: string, value: string, risk = false) =>
  `<tr><td style="padding:8px 12px;color:${GRAY};font-size:13px;vertical-align:top;width:34%">${esc(label)}</td><td style="padding:8px 12px;color:${risk ? RED : NAVY};font-size:13px">${value}</td></tr>`;

export function renderIorLayout(input: {
  report: { scope?: string; contract_total?: number | null; forecast_total?: number | null; data?: Record<string, unknown> };
  names?: ReportNames | null;
}): string {
  const report = input.report;
  const data = report.data ?? {};
  const moneyOk = report.scope === "full";
  const names = input.names;
  const out: string[] = [];
  if (typeof report.contract_total === "number" && typeof report.forecast_total === "number") {
    const ties = Math.round(report.contract_total * 100) === Math.round(report.forecast_total * 100);
    const line = ties
      ? `Forecast ${money(report.forecast_total)} = contract ${money(report.contract_total)}`
      : `Doesn't tie: off by ${money(Math.abs(report.forecast_total - report.contract_total))}`;
    out.push(`<p style="margin:0 0 12px;font-weight:600;color:${ties ? NAVY : RED}">${esc(line)}</p>`);
  }
  const kpis = data.kpis && typeof data.kpis === "object" ? (data.kpis as Record<string, unknown>) : {};
  const tiles = Object.entries(kpis).slice(0, 8).map(([key, value]) => {
    const risk = /risk|delay|overdue/i.test(key);
    const shown = formatValue(key, value, moneyOk, names) || "—";
    return `<div style="flex:1 1 160px;background:#fff;border:1px solid ${risk ? RED : LINE};border-radius:10px;padding:12px"><div style="font-size:12px;color:${GRAY}">${esc(humanLabel(key))}</div><div style="font-size:20px;font-weight:600;color:${risk ? RED : NAVY}">${shown}</div></div>`;
  });
  if (tiles.length) out.push(`<div style="display:flex;flex-wrap:wrap;gap:12px;margin:0 0 16px">${tiles.join("")}</div>`);
  const risks = Array.isArray(data.risks) ? data.risks : [];
  if (risks.length) {
    const lines = risks.map((entry, i) => {
      const record = (entry && typeof entry === "object" ? entry : { risk: entry }) as Record<string, unknown>;
      const title = plainReportText(String(record.risk ?? record.title ?? record.name ?? "Risk"), names) || "Risk";
      const exposure = typeof record.exposure === "number" && moneyOk ? ` <span style="color:${GRAY}">${esc(money(record.exposure))}</span>` : "";
      return `<div style="padding:8px 0;border-top:1px solid #F3F4F6"><span style="color:${RED};font-weight:700">R${i + 1}</span> <span style="color:${NAVY}">${esc(title)}</span>${exposure}</div>`;
    }).join("");
    out.push(`<section style="background:#fff;border:1px solid ${RED};border-radius:12px;padding:16px;margin:0 0 16px"><h2 style="margin:0 0 8px;font-size:15px;color:${RED}">Risk register</h2>${lines}</section>`);
  }
  const rest = Object.entries(data).filter(([key]) => !SKIP.has(key));
  const body = rest.map(([key, value]) => {
    const shown = formatValue(key, value, moneyOk, names);
    if (!shown) return "";
    const risk = /risk|delay|overdue/i.test(key);
    return row(humanLabel(key), shown, risk);
  }).filter(Boolean);
  if (body.length) {
    out.push(`<section style="background:#fff;border:1px solid ${LINE};border-left:4px solid ${BLUE};border-radius:12px;padding:8px;margin:0 0 16px"><table style="border-collapse:collapse;width:100%">${body.join("")}</table></section>`);
  }
  if (!out.length) out.push(`<section style="background:#fff;border:1px solid ${LINE};border-radius:12px;padding:16px"><p style="margin:0;color:${GRAY}">The saved IOR has no items yet.</p></section>`);
  return out.join("");
}
