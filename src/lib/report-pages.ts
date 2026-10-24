// 0.8.14: living report pages (job IOR, job schedule, company portfolio) at app.meetathena.io/r/...
// Pure logic: URLs, payload types and one HTML renderer shared by the signed-in page and the owner share link.
// Member-facing text never names tools, hosting or database vendors. Navy, blue and gray; red only for delays,
// risks and overdue items. Scheduling term: "fragnet".
import { ALERT_HEX } from "./mcp/alert-color";
import { isDelayNoticeTask } from "./mcp/delay-notice";
import { delayCallout, jobWorkingDays } from "./mcp/living";
import { DEFAULT_TZ, addDays, todayIn } from "./mcp/deadlines";
import { activityLine, activityTitle, briefingModel, dayHead, lookaheadModel, lookaheadAlert, payModel, shortDate, lookaheadWindow, type BriefItem, type Billing, type LaItem, type LaEntry, type SAct } from "./mcp/styled-views";
import { dailyPageHtml, fieldPageHtml, photoPageHtml } from "./mcp/superintendent";
import { renderIorLayout, type ReportNames } from "./ior-layout";
import { formatReportNumber, money } from "./report-format";
import { dedupeOpenRows, itemName } from "./mcp/open-feed";
import { BALL_LABEL, currentSubmittals, labelOf, packageLine, postureSentence, resolvePosture, sourceLine, STATUS_LABEL, submittalOverdue, transmittalLabel, type SubmittalRecord } from "./mcp/submittals";
import { jobHeading } from "./mcp/job-label";

function jobPageTitle(number?: string | null, name?: string | null): string {
  return jobHeading({ job_number: number ?? "", name: name ?? "" }, " ");
}

export const REPORT_PAGES = ["ior", "schedule", "portfolio"] as const;
export type ReportPage = (typeof REPORT_PAGES)[number];
/** 0.8.17: private-only pages (no share links). */
export const VIEW_PAGES = ["lookahead", "payapp", "briefing", "field", "daily", "photos", "items", "submittals"] as const;
export type ViewPage = (typeof VIEW_PAGES)[number];
export type AnyPage = ReportPage | ViewPage;
export const JOB_PAGES = ["ior", "schedule", ...VIEW_PAGES] as const;
export const PAGE_LABEL: Record<AnyPage, string> = { ior: "IOR", schedule: "Schedule", portfolio: "Portfolio dashboard", lookahead: "Two-Week Lookahead", payapp: "Pay App", briefing: "Morning Briefing", field: "Field board", daily: "Daily report", photos: "Progress photos", items: "Open items", submittals: "Submittal log" };
export const PAGE_ORIGIN = "https://app.meetathena.io";
export const PERMANENT_LINK_ASK = "Want the job board links I keep updated? Items (/items), the IOR (/ior), the field board (/field), and the schedule.";
export const SHARE_DEFAULT_DAYS = 30;
export const SHARE_MAX_DAYS = 90;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** Private page path. Job pages: /r/job/<job_id>/<ior|schedule>. Portfolio: /r/portfolio/<company_id>. */
export function pagePath(page: AnyPage, id: string): string {
  if (!isUuid(id)) throw new Error("bad id");
  return page === "portfolio" ? `/r/portfolio/${id}` : `/r/job/${id}/${page}`;
}
export const pageUrl = (page: AnyPage, id: string, origin = PAGE_ORIGIN) => `${origin.replace(/\/$/, "")}${pagePath(page, id)}`;

/** Page name from a route param. Query strings such as utm_source are not part of the page. */
export function hostedPageName(raw: string): string {
  return raw.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
}

/**
 * /items uses the field board RPC. That is the same company and member check as /field.
 * A ChatGPT link's utm_source query does not change the page or the arguments.
 */
export function reportPageQuery(page: string, jobId?: string | null, companyId?: string | null): { view: string; args: { _page: string; _job: string | null; _company: string | null } } {
  const view = hostedPageName(page);
  const rpcPage = view === "items" ? "field" : view;
  return { view, args: { _page: rpcPage, _job: jobId ?? null, _company: companyId ?? null } };
}
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
export function pageAllowed(page: AnyPage, scope: "full" | "contract" | "super" | null | undefined, leader: boolean): boolean {
  if (page === "portfolio") return leader;
  if (page === "ior" || page === "payapp") return scope === "full";
  return scope === "full" || scope === "super";
}

// ---------- payloads (what the page functions return) ----------
type Act = { id: string; name: string; description?: string | null; start: string | null; finish: string | null; total_float?: number | null; critical?: boolean | null; pct_complete?: number | null; duration?: number | null };
type Tia = { fragnet?: string; fragment?: string; prior_completion?: string; updated_completion?: string; holidays?: string[] | null };
export type Report = {
  found: boolean; version?: number; data_date?: string | null; updated_at?: string | null; updated_by_name?: string | null;
  contract_total?: number | null; forecast_total?: number | null; contract_completion_date?: string | null; scope?: string;
  data?: { activities?: Act[]; tia?: Tia | null; kpis?: Record<string, unknown>; items?: unknown[]; risks?: unknown[]; [k: string]: unknown };
};
export type JobPayload = { page: "ior" | "schedule"; company?: string; job_number?: string; job_name?: string; report: Report; names?: ReportNames; shared?: boolean; expires_at?: string };
export type PortfolioJob = { job_id: string; job_number: string; name: string; pm?: string | null; completion_date?: string | null;
  cpm?: { version: number; data_date?: string | null; updated_at?: string; tia?: Tia | null; contract_total?: number | null; forecast_total?: number | null } | null;
  ior?: { version: number; data_date?: string | null; updated_at?: string; data?: Record<string, unknown> } | null };
export type PortfolioPayload = { page: "portfolio"; company?: string; jobs: PortfolioJob[]; money?: boolean; shared?: boolean; expires_at?: string };
export type LookaheadPayload = { page: "lookahead"; company?: string; job_number?: string; job_name?: string; lookahead?: { id: string; start_date: string | null; end_date: string | null } | null; report: Report; items?: LaItem[]; today?: string };
export type PayAppPayload = { page: "payapp"; company?: string; job_number?: string; job_name?: string; report: Report };
export type BriefingPayload = { page: "briefing"; company?: string; job_number?: string; job_name?: string; today: string; items?: BriefItem[]; report?: Report };
export type FieldPagePayload = { page: "field"; company?: string; job_number?: string; job_name?: string; scope?: string; data_date?: string | null; lookahead?: { start_date?: string | null; end_date?: string | null } | null; activities?: unknown; assignments?: unknown; materials?: unknown; rates?: unknown; installed?: unknown; items?: { id?: string | null; action?: string; owner?: string | null; due?: string | null; type?: string | null; item_type?: string | null; kind?: string | null; category?: string | null; check_key?: string | null }[]; today?: string };
export type DailyPagePayload = { page: "daily"; company?: string; job_number?: string; job_name?: string; found?: boolean; report_date?: string | null; weather?: string | null; manpower?: string | null; subs_on_site?: string | null; deliveries?: string | null; issues?: string | null; delays?: string | null; safety?: string | null; lines?: { work?: string; sov_item?: string | null; activity_id?: string | null; qty?: number | null; unit?: string | null; crew?: number | null; hours?: number | null }[] };
export type PhotoPagePayload = { page: "photos"; company?: string; job_number?: string; job_name?: string; photos?: { id?: string; taken_on?: string; area?: string; work?: string | null; sov_item?: string | null; activity_id?: string | null; client_safe?: boolean; url?: string | null; storage_path?: string }[] };
export type ItemsPagePayload = { page: "items"; company?: string; job_number?: string; job_name?: string; items?: { id?: string | null; action?: string | null; owner?: string | null; due?: string | null; type?: string | null; item_type?: string | null; kind?: string | null; category?: string | null; check_key?: string | null }[] };
export type SubmittalsPagePayload = {
  page: "submittals";
  company?: string;
  job_number?: string;
  job_name?: string;
  read_only?: boolean;
  review_days?: number;
  today?: string;
  posture?: string | null;
  posture_set?: string | null;
  public_job?: string | null;
  submittals?: SubmittalRecord[];
};
type ViewExtras = { shared?: boolean; expires_at?: string };
export type PagePayload = JobPayload | PortfolioPayload | FieldPagePayload | DailyPagePayload | PhotoPagePayload | ItemsPagePayload | SubmittalsPagePayload | ((LookaheadPayload | PayAppPayload | BriefingPayload) & ViewExtras);

// ---------- helpers ----------
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export { money };
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Schedule float is working days. A raw float is rounded; it is never currency. */
const shownFloat = (value: unknown) => (isNum(value) ? formatReportNumber("total_float", value) : String(value ?? ""));
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
// ---------- views ----------
function scheduleView(p: JobPayload): string {
  const r = p.report, d = r.data ?? {};
  const acts = (d.activities ?? []).filter((a) => a.start && a.finish);
  const tia = d.tia ?? null;
  const out: string[] = [];
  if (tia?.prior_completion && tia.updated_completion && tia.updated_completion !== tia.prior_completion) {
    const fragId = String(tia.fragnet ?? tia.fragment ?? "");
    const frag = (d.activities ?? []).find((a) => a.id === fragId);
    out.push(`<div style="border:2px solid ${RED};border-radius:10px;padding:12px;margin:0 0 16px;background:repeating-linear-gradient(45deg,#fff,#fff 8px,#FEF2F2 8px,#FEF2F2 16px)"><strong style="color:${RED}">${esc(delayLabel(tia.prior_completion, tia.updated_completion, tia.holidays))}</strong><span style="color:${G1}"> · Delay fragnet ${esc(fragId)}${frag ? ` · ${esc(activityTitle(frag))}` : ""}: completion ${esc(tia.prior_completion)} → ${esc(tia.updated_completion)}</span></div>`);
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
      return `<tr id="activity-${esc(a.id)}"><td style="padding:4px 8px;font-size:12px;color:${NAVY};font-weight:600" data-id="${esc(a.id)}">${esc(activityTitle(a))}<div style="font-size:11px;font-weight:400;color:${G1}">${esc(a.id)}</div></td><td style="padding:4px 8px;font-size:12px;color:${G1};white-space:nowrap">${esc(a.start)} – ${esc(a.finish)}</td><td style="padding:4px 8px;font-size:12px;color:${isNum(a.total_float) && a.total_float < 0 ? RED : G1}">${isNum(a.total_float) ? esc(shownFloat(a.total_float)) : ""}</td><td style="position:relative;min-width:320px;width:50%"><div style="position:relative;height:14px;background:${G4};border-radius:3px"><div style="position:absolute;left:${l.toFixed(2)}%;width:${w.toFixed(2)}%;top:0;bottom:0;border-radius:3px;${bar}"></div>${markPct >= 0 && markPct <= 100 ? `<div style="position:absolute;left:${markPct.toFixed(2)}%;top:-2px;bottom:-2px;width:2px;background:${NAVY}"></div>` : ""}</div></td></tr>`;
    }).join("");
    out.push(card(`<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr style="text-align:left;font-size:12px;color:${G1}"><th style="padding:4px 8px">Activity</th><th style="padding:4px 8px">Dates</th><th style="padding:4px 8px">Float</th><th style="padding:4px 8px">Gantt</th></tr></thead><tbody>${rows}</tbody></table></div>` +
      `<p style="margin:12px 0 0;font-size:12px;color:${G1}"><span style="display:inline-block;width:10px;height:10px;background:${BLUE}"></span> Critical &nbsp; <span style="display:inline-block;width:10px;height:10px;background:${G2}"></span> Non-critical &nbsp; <span style="display:inline-block;width:10px;height:10px;background:${RED}"></span> Delay fragnet &nbsp; <span style="display:inline-block;width:2px;height:10px;background:${NAVY}"></span> ${Number.isFinite(dd) && dd > today ? "Data date" : "Today"}</p>`));
  }
  return out.join("");
}

function iorView(p: JobPayload): string {
  return renderIorLayout({ report: p.report, names: { ...p.names, job_name: p.names?.job_name ?? p.job_name } });
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

// ---------- 0.8.17 views ----------
const CELL_HTML: Record<string, string> = {
  crit: `<div style="height:12px;border-radius:3px;background:${BLUE}"></div>`,
  non: `<div style="height:12px;border-radius:3px;background:${G2}"></div>`,
  insp: "📋", deliv: "🚚", mile: `<span style="color:${NAVY}">◆</span>`, "": "",
};
const legend = (items: [string, string][]) => `<p style="margin:12px 0 0;font-size:12px;color:${G1}">${items.map(([sw, l]) => `${sw} ${esc(l)}`).join(" &nbsp; ")}</p>`;
const sw = (c: string) => `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c}"></span>`;
const h2 = (t: string) => `<h2 style="margin:0 0 12px;font-size:13px;letter-spacing:.06em;color:${NAVY}">${esc(t)}</h2>`;

function lookaheadPageView(p: LookaheadPayload): string {
  const r = p.report ?? { found: false };
  const acts = ((r.found ? r.data?.activities : []) ?? []) as SAct[];
  const dd = r.found ? r.data_date ?? null : null;
  const la = p.lookahead ?? null;
  const win = lookaheadWindow(la, dd);
  if (!win) return card(`<p style="margin:0;color:${G1}">No lookahead window or saved schedule yet.</p><p style="margin:8px 0 0;color:${NAVY}"><strong>Next move:</strong> send the schedule export (or save the CPM) and Athena fills the lookahead from it.</p>`);
  // 0.8.20: never UTC; the page payload's job-zone today, else the default job zone.
  const today = p.today?.slice(0, 10) || todayIn(DEFAULT_TZ);
  const m = lookaheadModel(win.start, win.end, acts, p.items ?? [], { today, dataDate: dd });
  const hl = dd && dd > today ? dd : today;
  const out: string[] = [];
  out.push(`<p style="margin:0 0 12px;font-size:13px;color:${G1}">Window ${esc(shortDate(win.start))} – ${esc(shortDate(win.end))}${dd ? ` · Data date ${esc(shortDate(dd))}` : ""}</p>`);
  out.push(tiles([tile("Activities", String(m.counts.activities)), tile("Critical", String(m.counts.critical)), tile("Inspections", String(m.counts.inspections)), tile("Deliveries", String(m.counts.deliveries)), tile("Risks", String(m.counts.risks), m.counts.risks > 0), tile("Overdue", String(m.counts.overdue), m.counts.overdue > 0)]));
  const due = (e: LaEntry) => `Owner: ${esc(e.item.owner ?? "Needed")} · Due ${e.item.due ? `<span style="color:${e.overdue ? RED : G1};font-weight:${e.overdue ? 700 : 400}">${esc(shortDate(e.item.due))}</span>` : "Needed"}`;
  const flagsHtml = (e: LaEntry) => e.flags.map((f) => `<div style="margin-top:6px;font-size:12px;color:${NAVY};border-left:3px solid #1E5FED;padding-left:8px">${esc(f.text)}</div>`).join("");
  const badge = `<span style="display:inline-block;background:${RED};color:#fff;font-size:11px;font-weight:700;border-radius:4px;padding:1px 6px;margin-right:6px">OVERDUE</span>`;
  out.push(card(h2("TOP 3 PRIORITIES") + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${m.top.length ? m.top.map((t, i) => `<div style="border:1px solid ${G3};border-left:4px solid ${lookaheadAlert(t) ? RED : "#1E5FED"};border-radius:10px;padding:12px"><div style="font-size:18px;font-weight:700;color:${t.overdue ? RED : BLUE}">${i + 1}</div><div style="font-weight:600;color:${NAVY};margin:4px 0">${t.overdue ? badge : ""}${esc(t.label)}</div><div style="font-size:12px;color:${G1}">${due(t)}</div>${flagsHtml(t)}</div>`).join("") : `<div style="border:1px solid ${G3};border-left:4px solid ${BLUE};border-radius:10px;padding:12px;color:${G1}">No open items in this window</div>`}</div>`));
  if (!m.rows.length) out.push(card(`<p style="margin:0;color:${G1}">No saved schedule activities fall in this window.</p><p style="margin:8px 0 0;color:${NAVY}"><strong>Next move:</strong> pick a window that overlaps the saved schedule, or send this window's schedule export.</p>`));
  else {
    const th = m.days.map((d, i) => `<th style="padding:4px 2px;font-size:11px;color:${d === hl ? BLUE : G1};text-align:center;${i === 5 ? `border-left:2px solid ${G3};` : ""}">${i === 0 ? "WEEK 1<br>" : i === 5 ? "WEEK 2<br>" : "<br>"}${esc(dayHead(d))}</th>`).join("");
    const rows = m.rows.map((row) => `<tr id="activity-${esc(row.a.id)}" style="border-top:1px solid ${G4}"><td style="padding:6px 8px;font-size:12px;font-weight:600;color:${NAVY}" data-id="${esc(row.a.id)}">${esc(activityTitle(row.a))}<div style="font-size:11px;font-weight:400;color:${G1}">${esc(row.a.id)}</div></td><td style="padding:6px 8px;font-size:12px;color:${Number(row.a.total_float) === 0 ? BLUE : G1};text-align:center">${esc(shownFloat(row.a.total_float))}</td>${row.cells.map((c, i) => `<td style="padding:4px 2px;min-width:44px;text-align:center;${i === 5 ? `border-left:2px solid ${G3};` : ""}">${CELL_HTML[c.kind]}${c.risk ? `<span style="color:${RED}">⚑</span>` : ""}</td>`).join("")}</tr>`).join("");
    out.push(card(h2("CALENDAR") + `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr style="text-align:left;font-size:12px;color:${G1}"><th style="padding:4px 8px">Activity</th><th style="padding:4px 8px">Float</th>${th}</tr></thead><tbody>${rows}</tbody></table></div>` + legend([[sw(BLUE), "Critical"], [sw(G2), "Non-critical"], ["📋", "Inspection"], ["🚚", "Delivery"], ["◆", "Milestone"], [`<span style="color:${RED}">⚑</span>`, "Risk"]])));
  }
  if (m.overdue.length) out.push(card(h2("OVERDUE") + m.overdue.map((e, n) => `<div id="item-${esc(e.item.id || String(n + 1))}" style="border:1px solid ${G3};border-left:4px solid ${RED};border-radius:10px;padding:12px;margin:0 0 8px">${badge}<strong style="color:${RED}">${esc(e.label)}</strong><span style="color:${NAVY}"> · ${due(e)}</span></div>`).join("")));
  if (m.risks.length) out.push(card(h2("RISKS") + m.risks.map((e) => `<div style="border:1px solid ${G3};border-left:4px solid ${RED};border-radius:10px;padding:12px;margin:0 0 8px"><strong style="color:${RED}">${esc(e.label)}</strong><span style="color:${NAVY}"> · Impact: ${esc(activityLine(e.a!))}${e.a!.total_float !== undefined && e.a!.total_float !== null ? ` (float ${esc(shownFloat(e.a!.total_float))} WD)` : ""}. ${due(e)}</span>${flagsHtml(e)}</div>`).join("")));
  if (m.callouts.length) out.push(card(h2("OPEN FOLLOW-UPS") + m.callouts.map((e) => `<div style="border-left:4px solid #1E5FED;padding:8px 12px;margin:0 0 8px;color:${NAVY}"><strong>${esc(e.label)}</strong><div style="font-size:12px;color:${G1}">${due(e)}</div></div>`).join("")));
  if (m.flagged.length) out.push(card(h2("DATES TO CHECK") + m.flagged.map((e) => `<div style="padding:8px 0;border-top:1px solid ${G4};color:${NAVY};font-size:13px">${esc(e.label)}${flagsHtml(e)}</div>`).join("")));
  return out.join("");
}

function payAppPageView(p: PayAppPayload): string {
  const r = p.report;
  if (!r?.found) return card(`<p style="margin:0;color:${G1}">No billing has been saved for this job yet.</p><p style="margin:8px 0 0;color:${NAVY}"><strong>Next move:</strong> send the billed-to-date figure and the latest pay app, and Athena builds the forecast from the saved schedule.</p>`);
  const m = payModel((r.data?.billing ?? null) as Billing | null, isNum(r.contract_total) ? r.contract_total : null);
  const out: string[] = [];
  if (m.tie) out.push(`<p style="margin:0 0 12px;font-weight:600;color:${m.tie.startsWith("Doesn't") ? RED : NAVY}">${esc(m.tie)}</p>`);
  out.push(tiles([tile("Billed to date", money(m.billed)), tile("Forecast remaining", money(m.forecast)), tile("Contract", m.contract === null ? "Needed" : money(m.contract)), tile("Left to bill", m.left === null ? "Needed" : money(m.left))]));
  const max = Math.max(1, ...m.months.map((x) => x.amount));
  out.push(card(h2("MONTHLY BILLING") + `<table style="border-collapse:collapse;width:100%">${m.months.map((x) => `<tr style="border-top:1px solid ${G4}"><td style="padding:6px 8px;font-size:12px;color:${NAVY};white-space:nowrap">${esc(x.month)}</td><td style="padding:6px 8px;width:50%"><div style="height:12px;border-radius:3px;width:${((x.amount / max) * 100).toFixed(1)}%;background:${x.kind === "actual" ? BLUE : G2}"></div></td><td style="padding:6px 8px;font-size:12px;color:${NAVY};text-align:right">${money(x.amount)}</td><td style="padding:6px 8px;font-size:12px;color:${G1};text-align:right">${money(x.cum)}</td></tr>`).join("")}<tr style="border-top:2px solid ${G3}"><td style="padding:6px 8px;font-weight:600">Total</td><td></td><td style="padding:6px 8px;font-weight:600;text-align:right">${money(m.total)}</td><td></td></tr></table>` + legend([[sw(BLUE), "Billed"], [sw(G2), "Forecast"]])));
  return out.join("");
}

function briefingPageView(p: BriefingPayload): string {
  const m = briefingModel(p.items ?? [], p.today);
  const out = [tiles([tile("Overdue", String(m.overdue.length), m.overdue.length > 0), tile("Due today", String(m.today.length)), tile("Next 7 days", String(m.week.length)), tile("8–14 days", String(m.next.length))])];
  const sec = (t: string, list: BriefItem[], flag = false) => list.length ? card(h2(t) + list.map((i) => {
    const alert = flag || isDelayNoticeTask(i);
    return `<div style="padding:8px 0;border-top:1px solid ${G4};${alert ? `border-left:4px solid ${RED};padding-left:8px;` : ""}"><div style="color:${alert ? RED : NAVY};font-weight:600">${esc(i.action)}</div><div style="font-size:12px;color:${G1}">Owner: ${esc(i.owner ?? "Needed")} · Due ${esc(i.due ? shortDate(i.due.slice(0, 10)) : "Needed")}</div></div>`;
  }).join("")) : "";
  out.push(sec("OVERDUE", m.overdue, true), sec("DUE TODAY", m.today), sec("NEXT 7 DAYS", m.week), sec("8–14 DAYS", m.next));
  if (!m.overdue.length && !m.today.length && !m.week.length && !m.next.length) out.push(card(`<p style="margin:0;color:${G1}">Nothing due in the next 14 days.</p>`));
  return out.join("");
}

/** Page body (no <html>). Used inside the signed-in page and the share page. */
function itemsPageHtml(p: ItemsPagePayload): string {
  const items = dedupeOpenRows((p.items ?? []).map((item, n) => ({
    id: item.id || String(n + 1),
    action: item.action || "Item",
    due: item.due,
    owner: item.owner,
    type: item.type ?? item.item_type,
    item_type: item.item_type,
    kind: item.kind,
    category: item.category,
    check_key: item.check_key,
  })));
  if (!items.length) return card(`<p style="margin:0;color:${G1}">No open items on this job.</p>`);
  return items.map((item, n) => {
    const id = item.id || String(n + 1);
    const due = item.due?.slice(0, 10) ?? "";
    const notice = isDelayNoticeTask(item);
    const color = notice ? RED : NAVY;
    const border = notice ? `border-left:4px solid ${RED};` : "";
    return `<section id="item-${esc(id)}"${item.id ? ` data-id="${esc(item.id)}"` : ""} style="${border}">${card(`<div style="font-weight:700;color:${color}">${esc(itemName(item.action || "Item"))}</div><div style="font-size:12px;color:${G1};margin-top:4px">${esc(item.owner || "Needed")}${due ? ` · ${esc(shortDate(due))}` : ""}</div>`)}</section>`;
  }).join("");
}

function submittalsPageHtml(p: SubmittalsPagePayload): string {
  const today = (p.today ?? "").slice(0, 10);
  const rows = currentSubmittals(p.submittals ?? []);
  const overdue = rows.filter((row) => submittalOverdue(row, today)).length;
  const posture = postureSentence(resolvePosture(p.posture_set ?? p.posture, p.public_job));
  const head = `<div data-count="${rows.length}" data-overdue="${overdue}">${tiles([tile("Submittals", String(rows.length)), tile("Overdue", String(overdue), overdue > 0), tile("Review days", String(p.review_days ?? 14))])}<p style="margin:0 0 16px;font-size:13px;color:${G1}">${esc(posture)}${p.read_only ? " Read only." : ""}</p></div>`;
  if (!rows.length) return head + card(`<p style="margin:0;color:${G1}">No submittals on this job yet.</p>`);
  return head + rows.map((row) => {
    const late = submittalOverdue(row, today);
    const who = row.ball_in_court_name?.trim() ? `${labelOf(BALL_LABEL, row.ball_in_court)}, ${row.ball_in_court_name.trim()}` : labelOf(BALL_LABEL, row.ball_in_court);
    const border = late ? `border-left:4px solid ${RED};` : "";
    const color = late ? RED : NAVY;
    // Every row is a link to its record: submittal/<number> resolves beside this page at /r/job/<job>/submittal/<number>.
    const href = `submittal/${encodeURIComponent(row.number.trim())}`;
    return `<section id="submittal-${esc(row.id)}" data-submittal-row="1" data-id="${esc(row.id)}" style="${border}">${card(`<div style="font-weight:700;color:${color}"><a href="${esc(href)}" data-record="${esc(row.number)}" style="color:${color};text-decoration:none">${late ? "Overdue · " : ""}${esc(row.number)} revision ${esc(row.revision)}, ${esc(row.title)}</a></div><div style="font-size:12px;color:${G1};margin-top:4px">Spec ${esc(row.spec_section)} · ${esc(labelOf(STATUS_LABEL, row.status))} · ${esc(sourceLine(row))} · ${esc(who)} · ${esc(transmittalLabel(row.transmittal_number))} · Due back ${esc(row.due_back?.slice(0, 10) || "Needed")} · ${esc(packageLine(row.package_items))} · Overdue: ${late ? "Yes" : "No"} · ${row.submission_sent_at ? `Package sent ${esc(row.submission_sent_at.slice(0, 10))}` : "Package send receipt not recorded"}</div>`)}</section>`;
  }).join("");
}

export function renderReportBody(p: PagePayload): string {
  if (p.page === "submittals") {
    const title = `${esc(jobPageTitle(p.job_number, p.job_name))} · Submittal log`;
    return `<div style="max-width:1100px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${NAVY}"><h1 style="margin:0 0 16px;font-size:22px;color:${NAVY}">${title}</h1>${submittalsPageHtml(p)}<p style="margin:24px 0 0;font-size:12px;color:${G2}">Private to your company · Athena powered by ALP</p></div>`;
  }
  if (p.page === "field") return fieldPageHtml(p);
  if (p.page === "daily") return dailyPageHtml(p);
  if (p.page === "photos") return photoPageHtml(p);
  if (p.page === "items") {
    const title = `${esc(jobPageTitle(p.job_number, p.job_name))} · Open items`;
    return `<div style="max-width:1100px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${NAVY}"><h1 style="margin:0 0 16px;font-size:22px;color:${NAVY}">${title}</h1>${itemsPageHtml(p)}<p style="margin:24px 0 0;font-size:12px;color:${G2}">Private to your company · Athena powered by ALP</p></div>`;
  }
  const title = p.page === "portfolio" ? `${esc(p.company ?? "")} · Portfolio dashboard` : `${esc(jobPageTitle(p.job_number, p.job_name))} · ${PAGE_LABEL[p.page]}`;
  let body: string;
  let st = "";
  if (p.page === "portfolio") body = portfolioView(p);
  else if (p.page === "lookahead") body = lookaheadPageView(p);
  else if (p.page === "payapp") body = payAppPageView(p);
  else if (p.page === "briefing") body = briefingPageView(p);
  else if (!p.report?.found) body = card(`<p style="margin:0;color:${G1}">Nothing saved yet. Once the ${PAGE_LABEL[p.page]} is saved in Athena, it shows here and stays up to date.</p>`);
  else { st = stamp(p.report); body = p.page === "schedule" ? scheduleView(p as JobPayload) : iorView(p as JobPayload); }
  if (p.page === "payapp" && p.report?.found) st = stamp(p.report);
  if (p.page === "briefing") st = `<p style="margin:4px 0 16px;font-size:12px;color:${G1}">${esc(shortDate(p.today))}</p>`;
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

