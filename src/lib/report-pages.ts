// 0.8.14: living report pages (job IOR, job schedule, company portfolio) at app.meetathena.io/r/...
// Pure logic: URLs, payload types and one HTML renderer shared by the signed-in page and the owner share link.
// Member-facing text never names tools, hosting or database vendors. Navy, blue and gray; red only for delays,
// risks and overdue items. Scheduling term: "fragnet".
import { ALERT_HEX } from "./mcp/alert-color";
import { delayCallout, jobWorkingDays } from "./mcp/living";
import { addDays } from "./mcp/deadlines";

export const REPORT_PAGES = ["ior", "schedule", "portfolio"] as const;
export type ReportPage = (typeof REPORT_PAGES)[number];
export const PAGE_LABEL: Record<ReportPage, string> = { ior: "IOR", schedule: "Schedule", portfolio: "Portfolio dashboard" };
export const PAGE_ORIGIN = "https://app.meetathena.io";
export const PERMANENT_LINK_ASK = "Want this as a permanent link I keep updated?";
export const SHARE_DEFAULT_DAYS = 30;
export const SHARE_MAX_DAYS = 90;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** Private page path. Job pages: /r/job/<job_id>/<ior|schedule>. Portfolio: /r/portfolio/<company_id>. */
export function pagePath(page: ReportPage, id: string): string {
  if (!isUuid(id)) throw new Error("bad id");
  return page === "portfolio" ? `/r/portfolio/${id}` : `/r/job/${id}/${page}`;
}
export const pageUrl = (page: ReportPage, id: string, origin = PAGE_ORIGIN) => `${origin.replace(/\/$/, "")}${pagePath(page, id)}`;
export const shareUrl = (token: string, origin = PAGE_ORIGIN) => `${origin.replace(/\/$/, "")}/r/s/${token}`;
export function shareTokenFromLink(s: string): string | null {
  const t = s.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
}
export function shareExpiry(days: number | undefined, now = new Date()): Date {
  const d = Math.min(Math.max(Math.trunc(days ?? SHARE_DEFAULT_DAYS), 1), SHARE_MAX_DAYS);
  return new Date(now.getTime() + d * 86_400_000);
}

/** Who may hold a private page link (mirrors the database checks; the database decides). */
export function pageAllowed(page: ReportPage, scope: "full" | "contract" | "super" | null | undefined, leader: boolean): boolean {
  if (page === "portfolio") return leader;
  if (page === "ior") return scope === "full";
  return scope === "full" || scope === "super";
}

// ---------- payloads (what the page functions return) ----------
type Act = { id: string; name: string; start: string | null; finish: string | null; total_float?: number | null; critical?: boolean | null; pct_complete?: number | null; duration?: number | null };
type Tia = { fragnet?: string; fragment?: string; prior_completion?: string; updated_completion?: string; holidays?: string[] | null };
export type Report = {
  found: boolean; version?: number; data_date?: string | null; updated_at?: string | null; updated_by_name?: string | null;
  contract_total?: number | null; forecast_total?: number | null; contract_completion_date?: string | null; scope?: string;
  data?: { activities?: Act[]; tia?: Tia | null; kpis?: Record<string, unknown>; items?: unknown[]; risks?: unknown[]; [k: string]: unknown };
};
export type JobPayload = { page: "ior" | "schedule"; company?: string; job_number?: string; job_name?: string; report: Report; shared?: boolean; expires_at?: string };
export type PortfolioJob = { job_id: string; job_number: string; name: string; pm?: string | null; completion_date?: string | null;
  cpm?: { version: number; data_date?: string | null; updated_at?: string; tia?: Tia | null; contract_total?: number | null; forecast_total?: number | null } | null;
  ior?: { version: number; data_date?: string | null; updated_at?: string; data?: Record<string, unknown> } | null };
export type PortfolioPayload = { page: "portfolio"; company?: string; jobs: PortfolioJob[]; money?: boolean; shared?: boolean; expires_at?: string };
export type PagePayload = JobPayload | PortfolioPayload;

// ---------- helpers ----------
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const day = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
const NAVY = "#1E3A5F", BLUE = "#2563EB", G1 = "#6B7280", G2 = "#9CA3AF", G3 = "#D1D5DB", G4 = "#F3F4F6", RED = ALERT_HEX;

/** Same counting as the chart callout and the TIA line: day after the prior completion through the updated one, both units. */
export function delayLabel(prior: string, updated: string, holidays?: string[] | null): string {
  if (updated.slice(0, 10) <= prior.slice(0, 10)) return "Delay: +0 WD (0 CD)";
  const start = addDays(prior.slice(0, 10), 1), finish = updated.slice(0, 10);
  return delayCallout(jobWorkingDays(start, finish, holidays), start, finish);
}

const card = (inner: string) => `<section style="background:#fff;border:1px solid ${G3};border-radius:12px;padding:16px;margin:0 0 16px">${inner}</section>`;
const tile = (label: string, value: string, alert = false) =>
  `<div style="flex:1 1 160px;background:#fff;border:1px solid ${alert ? RED : G3};border-radius:10px;padding:12px"><div style="font-size:12px;color:${G1}">${esc(label)}</div><div style="font-size:20px;font-weight:600;color:${alert ? RED : NAVY}">${esc(value)}</div></div>`;
const tiles = (t: string[]) => `<div style="display:flex;flex-wrap:wrap;gap:12px;margin:0 0 16px">${t.join("")}</div>`;
const stamp = (r: { version?: number; updated_at?: string | null; updated_by_name?: string | null; data_date?: string | null }) =>
  `<p style="margin:4px 0 16px;font-size:12px;color:${G1}">v${esc(r.version)} · Last updated ${esc(r.updated_at?.slice(0, 10) ?? "")}${r.updated_by_name ? ` by ${esc(r.updated_by_name)}` : ""}${r.data_date ? ` · Data date ${esc(r.data_date)}` : ""}</p>`;
const fmtVal = (v: unknown, moneyOk: boolean) => (isNum(v) ? (moneyOk ? money(v) : "—") : esc(typeof v === "object" ? JSON.stringify(v) : v));
const isRiskKey = (k: string) => /risk|delay|overdue|late|behind/i.test(k);

// ---------- views ----------
function scheduleView(p: JobPayload): string {
  const r = p.report, d = r.data ?? {};
  const acts = (d.activities ?? []).filter((a) => a.start && a.finish);
  const tia = d.tia ?? null;
  const out: string[] = [];
  if (tia?.prior_completion && tia.updated_completion && tia.updated_completion !== tia.prior_completion) {
    out.push(`<div style="border:2px solid ${RED};border-radius:10px;padding:12px;margin:0 0 16px;background:repeating-linear-gradient(45deg,#fff,#fff 8px,#FEF2F2 8px,#FEF2F2 16px)"><strong style="color:${RED}">${esc(delayLabel(tia.prior_completion, tia.updated_completion, tia.holidays))}</strong><span style="color:${G1}"> · Delay fragnet ${esc(tia.fragnet ?? tia.fragment ?? "")}: completion ${esc(tia.prior_completion)} → ${esc(tia.updated_completion)}</span></div>`);
  }
  const crit = acts.filter((a) => a.critical).length;
  out.push(tiles([tile("Activities", String((d.activities ?? []).length)), tile("Critical", String(crit)), tile("Contract completion", r.contract_completion_date ?? "Needed"), ...(isNum(r.contract_total) ? [tile("Contract", money(r.contract_total))] : [])]));
  if (acts.length) {
    const lo = Math.min(...acts.map((a) => day(a.start!))), hi = Math.max(...acts.map((a) => day(a.finish!)));
    const span = Math.max(hi - lo, 86_400_000);
    const dd = r.data_date ? day(r.data_date) : NaN;
    const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const mark = Number.isFinite(dd) && dd > today ? dd : today;
    const markPct = ((mark - lo) / span) * 100;
    const rows = acts.map((a) => {
      const l = ((day(a.start!) - lo) / span) * 100, w = Math.max(((day(a.finish!) - day(a.start!)) / span) * 100, 0.6);
      const frag = /^FRAG|^D\d/i.test(a.id) || /fragnet|delay/i.test(a.name);
      const color = frag ? RED : a.critical ? BLUE : G2;
      const bar = frag ? `background:repeating-linear-gradient(45deg,${RED},${RED} 4px,#FCA5A5 4px,#FCA5A5 8px)` : `background:${color}`;
      return `<tr><td style="padding:4px 8px;font-size:12px;color:${G1};white-space:nowrap">${esc(a.id)}</td><td style="padding:4px 8px;font-size:12px;color:${NAVY}">${esc(a.name)}</td><td style="padding:4px 8px;font-size:12px;color:${G1};white-space:nowrap">${esc(a.start)} – ${esc(a.finish)}</td><td style="padding:4px 8px;font-size:12px;color:${isNum(a.total_float) && a.total_float < 0 ? RED : G1}">${isNum(a.total_float) ? esc(a.total_float) : ""}</td><td style="position:relative;min-width:320px;width:50%"><div style="position:relative;height:14px;background:${G4};border-radius:3px"><div style="position:absolute;left:${l.toFixed(2)}%;width:${w.toFixed(2)}%;top:0;bottom:0;border-radius:3px;${bar}"></div>${markPct >= 0 && markPct <= 100 ? `<div style="position:absolute;left:${markPct.toFixed(2)}%;top:-2px;bottom:-2px;width:2px;background:${NAVY}"></div>` : ""}</div></td></tr>`;
    }).join("");
    out.push(card(`<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr style="text-align:left;font-size:12px;color:${G1}"><th style="padding:4px 8px">ID</th><th style="padding:4px 8px">Activity</th><th style="padding:4px 8px">Dates</th><th style="padding:4px 8px">Float</th><th style="padding:4px 8px">Gantt</th></tr></thead><tbody>${rows}</tbody></table></div>` +
      `<p style="margin:12px 0 0;font-size:12px;color:${G1}"><span style="display:inline-block;width:10px;height:10px;background:${BLUE}"></span> Critical &nbsp; <span style="display:inline-block;width:10px;height:10px;background:${G2}"></span> Non-critical &nbsp; <span style="display:inline-block;width:10px;height:10px;background:${RED}"></span> Delay fragnet &nbsp; <span style="display:inline-block;width:2px;height:10px;background:${NAVY}"></span> ${Number.isFinite(dd) && dd > today ? "Data date" : "Today"}</p>`));
  }
  return out.join("");
}

function iorView(p: JobPayload): string {
  const r = p.report, d = r.data ?? {};
  const moneyOk = r.scope === "full";
  const out: string[] = [];
  if (isNum(r.contract_total) && isNum(r.forecast_total)) {
    const ties = Math.round(r.contract_total * 100) === Math.round(r.forecast_total * 100);
    out.push(`<p style="margin:0 0 12px;font-weight:600;color:${ties ? NAVY : RED}">${ties ? `Forecast ${money(r.forecast_total)} = contract ${money(r.contract_total)}` : `Doesn't tie: off by ${money(Math.abs(r.forecast_total - r.contract_total))}`}</p>`);
  }
  const kpis = (d.kpis && typeof d.kpis === "object" ? d.kpis : {}) as Record<string, unknown>;
  const kt = Object.entries(kpis).slice(0, 8).map(([k, v]) => tile(k.replace(/_/g, " "), fmtVal(v, moneyOk), isRiskKey(k)));
  if (kt.length) out.push(tiles(kt));
  const risks = Array.isArray(d.risks) ? d.risks : [];
  if (risks.length) {
    out.push(card(`<h2 style="margin:0 0 8px;font-size:15px;color:${NAVY}">Risk register</h2>` + risks.map((x, i) => {
      const o = (typeof x === "object" && x ? x : { risk: x }) as Record<string, unknown>;
      return `<div style="padding:8px 0;border-top:1px solid ${G4}">${i < 3 ? `<span style="color:${RED};font-weight:700">R${i + 1}</span> ` : `<span style="color:${G1}">R${i + 1}</span> `}<span style="color:${NAVY}">${esc(o.risk ?? o.title ?? o.name ?? "")}</span>${isNum(o.exposure) && moneyOk ? ` <span style="color:${G1}">${money(o.exposure)}</span>` : ""}</div>`;
    }).join("")));
  }
  const rest = Object.entries(d).filter(([k]) => !["kpis", "risks", "activities", "tia", "billing"].includes(k));
  if (rest.length) out.push(card(`<table style="border-collapse:collapse;width:100%">${rest.map(([k, v]) => `<tr><td style="padding:6px 8px;color:${G1};font-size:13px;vertical-align:top">${esc(k.replace(/_/g, " "))}</td><td style="padding:6px 8px;color:${NAVY};font-size:13px">${Array.isArray(v) ? v.map((x) => esc(typeof x === "object" ? Object.values(x as object).join(" · ") : x)).join("<br>") : fmtVal(v, moneyOk)}</td></tr>`).join("")}</table>`));
  if (!out.length) out.push(card(`<p style="margin:0;color:${G1}">The saved IOR has no items yet.</p>`));
  return out.join("");
}

function portfolioView(p: PortfolioPayload): string {
  const jobs = p.jobs ?? [];
  const contract = jobs.reduce((s, j) => s + (isNum(j.cpm?.contract_total) ? j.cpm!.contract_total! : 0), 0);
  const delayed = jobs.filter((j) => j.cpm?.tia?.prior_completion && j.cpm.tia.updated_completion && j.cpm.tia.updated_completion > j.cpm.tia.prior_completion);
  const out = [tiles([tile("Jobs", String(jobs.length)), ...(p.money ? [tile("Contract value", money(contract))] : []), tile("Jobs with a delay", String(delayed.length), delayed.length > 0)])];
  if (delayed.length) out.push(card(`<h2 style="margin:0 0 8px;font-size:15px;color:${NAVY}">Needs attention</h2>` + delayed.map((j) => `<div style="padding:6px 0;color:${NAVY}">${esc(j.job_number)} ${esc(j.name)} · <strong style="color:${RED}">${esc(delayLabel(j.cpm!.tia!.prior_completion!, j.cpm!.tia!.updated_completion!))}</strong></div>`).join("")));
  out.push(`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">` + jobs.map((j) => {
    const late = delayed.includes(j);
    const chip = late ? `<span style="font-size:11px;color:#fff;background:${RED};border-radius:999px;padding:2px 8px">Delay</span>` : `<span style="font-size:11px;color:${BLUE};border:1px solid ${BLUE};border-radius:999px;padding:2px 8px">On track</span>`;
    return `<div style="background:#fff;border:1px solid ${G3};border-radius:12px;padding:14px"><div style="display:flex;justify-content:space-between;gap:8px"><strong style="color:${NAVY}">${esc(j.job_number)} ${esc(j.name)}</strong>${chip}</div>` +
      `<div style="font-size:12px;color:${G1};margin-top:6px">PM ${esc(j.pm ?? "—")} · Completion ${esc(j.completion_date ?? "Needed")}</div>` +
      (p.money && isNum(j.cpm?.contract_total) ? `<div style="font-size:13px;color:${NAVY};margin-top:6px">Contract ${money(j.cpm!.contract_total!)}</div>` : "") +
      `<div style="font-size:12px;color:${G2};margin-top:6px">Schedule ${j.cpm ? `v${esc(j.cpm.version)}` : "not saved"} · IOR ${j.ior ? `v${esc(j.ior.version)}` : "not saved"}</div></div>`;
  }).join("") + `</div>`);
  return out.join("");
}

/** Page body (no <html>). Used inside the signed-in page and the share page. */
export function renderReportBody(p: PagePayload): string {
  const title = p.page === "portfolio" ? `${esc(p.company ?? "")} · Portfolio dashboard` : `${esc(p.job_number ?? "")} ${esc(p.job_name ?? "")} · ${PAGE_LABEL[p.page]}`;
  let body: string;
  let st = "";
  if (p.page === "portfolio") body = portfolioView(p);
  else if (!p.report?.found) body = card(`<p style="margin:0;color:${G1}">Nothing saved yet. Once the ${PAGE_LABEL[p.page]} is saved in Athena, it shows here and stays up to date.</p>`);
  else { st = stamp(p.report); body = p.page === "schedule" ? scheduleView(p) : iorView(p); }
  const foot = p.shared ? `Shared view${p.expires_at ? ` · link works until ${esc(p.expires_at.slice(0, 10))}` : ""} · Athena powered by ALP` : "Private to your company · updates when Athena saves a new version · Athena powered by ALP";
  return `<div style="max-width:1100px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${NAVY}"><h1 style="margin:0;font-size:22px;color:${NAVY}">${title}</h1>${st || `<p style="margin:4px 0 16px;font-size:12px;color:${G1}">Live view</p>`}${body}<p style="margin:24px 0 0;font-size:12px;color:${G2}">${foot}</p></div>`;
}

/** Full document for the public share page. */
export function renderReportDocument(p: PagePayload): string {
  const t = p.page === "portfolio" ? `${p.company ?? ""} portfolio` : `${p.job_number ?? ""} ${PAGE_LABEL[p.page]}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(t)} · Athena</title></head><body style="margin:0;background:${G4}">${renderReportBody(p)}</body></html>`;
}

export function reportGoneHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link unavailable</title></head><body style="margin:0;background:${G4};font-family:system-ui,sans-serif;color:${G1}"><main style="max-width:480px;margin:15vh auto;background:#fff;border:1px solid ${G3};border-radius:12px;padding:32px"><h1 style="margin:0 0 12px;font-size:20px;color:${BLUE}">This link isn't available</h1><p style="margin:0;line-height:1.5">It has expired or was turned off. Ask the sender for a new link.</p><p style="margin:24px 0 0;font-size:12px;color:${G2}">Athena powered by ALP</p></main></body></html>`;
}

export const REPORT_PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};

