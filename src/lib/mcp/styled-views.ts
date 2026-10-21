// 0.8.17: styling is baked into the tool result, never left to the host's wording.
// Every lookahead, schedule, IOR and portfolio result now leads with (1) the private styled page on app.meetathena.io
// (rendered by Athena, so it looks the same in every host) and (2) a pre-rendered markdown view the host shows as-is.
// Also: one delay reader for every saved shape (tia, delay_analysis, a D-fragnet activity), the lookahead filled from
// the saved CPM window, styled empty states with a Next move, and a check that a save note can't contradict saved dates.
import { inclusiveCalendarDays, jobWorkingDays } from "./living";
import { addDays } from "./deadlines";

export type SAct = { id: string; name: string; start?: string | null; finish?: string | null; duration?: number | string | null; total_float?: number | string | null; critical?: boolean | null };
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const shortDate = (d: string) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`;
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const dow = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getUTCDay();

/** Shown first in the visible text, so the styled view never depends on how the host words or formats its reply. */
export const SHOW_AS_IS = "Show the view below exactly as written (tables, icons and colors included). Do not turn it into bullets or a summary.";
/** 0.8.18: Claude pasted the lookahead as plain markdown with emoji. Like the schedule's REQUIRED VIEW (CPM_GANTT_SPEC), the lookahead now asks for an artifact. */
export const LOOKAHEAD_ARTIFACT_LINE =
  "REQUIRED VIEW: build ONE styled lookahead artifact from the data below, the same way you build the schedule Gantt. In Claude: an artifact built only from this result (no tool calls inside it). In ChatGPT: a canvas. Never paste the markdown below as your answer: the emoji are data markers only, so draw real bars, icons and cards. Follow the REQUIRED VIEW – LOOKAHEAD spec.";
export const pageLine = (label: string, url: string) => `Styled ${label} (always current, private to your company): ${url}`;

// ---------- delay result (one reader for every saved shape) ----------
export type DelayInfo = { fragnet: string; delay_wd: number | null; start: string | null; finish: string | null; delay_cd: number | null; callout: string | null; completion_impact_wd: number; fragnet_float: number | null; reference_completion: string | null; impacted_completion: string | null; line: string };

/**
 * Reads the delay result however it was saved. v3 of job 2701 saved it as data.delay_analysis
 * ({fragnet, delay_workdays, completion_impact_workdays, ...}); cpm_activities only read data.tia, so no delay line showed.
 * "15 WD" (the fragnet's own length) and "0 WD" (its effect on completion) are both right: the fragnet had float.
 */
export function readDelay(data: Record<string, unknown> | null | undefined, holidays?: string[] | null): DelayInfo | null {
  if (!data) return null;
  const acts = (Array.isArray(data.activities) ? data.activities : []) as SAct[];
  const da = (data.delay_analysis ?? null) as Record<string, unknown> | null;
  const tia = (data.tia ?? null) as Record<string, unknown> | null;
  const named = String(da?.fragnet ?? tia?.fragnet ?? tia?.fragment ?? "") || null;
  const act = (named ? acts.find((a) => a.id === named) : null) ?? acts.find((a) => /^D\d+/i.test(a.id) || /fragnet/i.test(a.name ?? ""));
  if (!da && !tia && !act) return null;
  const fragnet = named ?? act?.id ?? "fragnet";
  const start = act?.start?.slice(0, 10) ?? null, finish = act?.finish?.slice(0, 10) ?? null;
  const delay_wd = num(da?.delay_workdays) ?? num(act?.duration) ?? (start && finish ? jobWorkingDays(start, finish, holidays) : null);
  const delay_cd = start && finish ? inclusiveCalendarDays(start, finish) : null;
  const callout = delay_wd !== null && delay_cd !== null ? `Delay: +${delay_wd} WD (${delay_cd} CD)` : delay_wd !== null ? `Delay: +${delay_wd} WD` : null;
  const ref = String(da?.reference_completion ?? tia?.prior_completion ?? "") || null;
  const imp = String(da?.impacted_completion ?? tia?.updated_completion ?? "") || null;
  let impact = num(da?.completion_impact_workdays);
  if (impact === null && ref && imp) impact = imp > ref ? jobWorkingDays(addDays(ref.slice(0, 10), 1), imp.slice(0, 10), holidays) : 0;
  const completion_impact_wd = impact ?? 0;
  const fl = num(act?.total_float);
  const window = start && finish ? `, ${shortDate(start)} – ${shortDate(finish)}` : "";
  const absorbed = completion_impact_wd === 0 ? ` (float absorbed it${fl !== null ? `; ${fragnet} still has ${fl} WD float` : ""})` : "";
  const line = `Delay result (${fragnet}): ${callout ?? "Delay: Needed"}${window}. Completion impact: +${completion_impact_wd} WD${absorbed}${imp ? `; completion ${shortDate(imp.slice(0, 10))}` : ""}.`;
  return { fragnet, delay_wd, start, finish, delay_cd, callout, completion_impact_wd, fragnet_float: fl, reference_completion: ref, impacted_completion: imp, line };
}

/** Pinned on every schedule result: the Gantt and the delay callout are required, not optional. */
export function ganttPins(d: DelayInfo | null): string[] {
  return [
    "REQUIRED: the answer must show the styled Gantt (bars on a timeline), never a list of activities.",
    ...(d?.callout ? [`REQUIRED: the Gantt must carry the red callout "${d.callout}" on ${d.fragnet}, plus the line "Completion impact: +${d.completion_impact_wd} WD".`] : []),
  ];
}

// ---------- saved-date consistency on save ----------
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function datesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of s.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith("sept") ? 4 : 3)];
    if (mo) out.push(`${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  return out;
}
/**
 * The v3 note on 2701 said "contract completion remains Sep 30, 2027" and "final acceptance Jul 27, 2027" while the saved
 * contract completion is 2027-09-16 and A1370 Final acceptance finishes 2027-07-13. Notes are free text, so they were never
 * checked. Now a note that names a different date for a saved milestone is refused before the save.
 */
export function noteDateConflicts(note: string, contractCompletion: string | null | undefined, acts: SAct[]): string[] {
  const out: string[] = [];
  const check = (label: string, re: RegExp, saved: string | null | undefined) => {
    if (!saved) return;
    for (const clause of note.split(/[;.\n]|, (?=[a-z])/i)) {
      if (!re.test(clause)) continue;
      for (const d of datesIn(clause)) if (d !== saved.slice(0, 10)) out.push(`${label}: the note says ${shortDate(d)}, the saved date is ${shortDate(saved.slice(0, 10))}.`);
    }
  };
  check("Contract completion", /contract completion/i, contractCompletion);
  const fa = acts.find((a) => /final acceptance/i.test(a.name ?? ""));
  check("Final acceptance", /final acceptance/i, fa?.finish ?? null);
  const sc = acts.find((a) => /substantial completion/i.test(a.name ?? ""));
  check("Substantial completion", /substantial completion(?!.*contract)/i, sc?.finish ?? null);
  return [...new Set(out)];
}

// ---------- lookahead from the saved CPM ----------
/** Window when none was given: the two work weeks starting the Monday after the CPM data date (Mon–Fri, Fri of week 2). */
export function windowFromDataDate(dataDate: string): { start: string; end: string } {
  let s = addDays(dataDate.slice(0, 10), 1);
  while (dow(s) !== 1) s = addDays(s, 1);
  return { start: s, end: addDays(s, 11) };
}
/**
 * 0.8.17: the lookahead window always comes from the saved CPM data date (the next two work weeks), never from a stale
 * saved lookahead, a change-log note ("data date November 2") or an earlier chat. A saved window is used only when no CPM
 * data date exists. Marshall's 2701 test: CPM data date 2026-10-19 → Oct 26 – Nov 6, not Nov 2 – 13.
 */
export function lookaheadWindow(saved: { start_date?: string | null; end_date?: string | null } | null | undefined, cpmDataDate: string | null | undefined): { start: string; end: string; source: "cpm" | "saved"; note: string | null } | null {
  if (cpmDataDate) {
    const w = windowFromDataDate(cpmDataDate);
    const differs = !!(saved?.start_date && saved.end_date && (saved.start_date !== w.start || saved.end_date !== w.end));
    return { ...w, source: "cpm", note: differs ? `The saved lookahead window (${shortDate(saved!.start_date!)} – ${shortDate(saved!.end_date!)}) doesn't match the CPM data date; this view uses the CPM data date ${shortDate(cpmDataDate.slice(0, 10))}.` : null };
  }
  if (saved?.start_date && saved.end_date) return { start: saved.start_date, end: saved.end_date, source: "saved", note: null };
  return null;
}
export const dataDateRule = (dd: string, version?: number | null) => `REQUIRED: the data date is ${dd}${version ? ` (saved CPM v${version})` : " (saved CPM)"}. Use it and this window everywhere, including emails; never a date from a change-log note, an older lookahead or an earlier chat.`;

export function workdays(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 20; d = addDays(d, 1)) if (dow(d) !== 0 && dow(d) !== 6) out.push(d);
  return out;
}
export function windowActivities(acts: SAct[], start: string, end: string): SAct[] {
  return acts
    .filter((a) => a.start && a.finish && a.start.slice(0, 10) <= end && a.finish.slice(0, 10) >= start)
    .sort((a, b) => a.start!.localeCompare(b.start!) || a.id.localeCompare(b.id));
}
export type LaItem = { action: string; owner?: string | null; due?: string | null };
const isInspection = (a: SAct) => /inspection|hold point/i.test(a.name);
const isDelivery = (a: SAct) => /deliver/i.test(a.name);
const isMilestone = (a: SAct) => num(a.duration) === 0;
const critical = (a: SAct) => a.critical === true || num(a.total_float) === 0;
const itemHits = (a: SAct, it: LaItem) => it.action.includes(a.id) || (isInspection(a) && /inspection/i.test(it.action) && !!a.finish && it.action.includes(a.finish.slice(0, 10)));

export type Cell = "crit" | "non" | "insp" | "deliv" | "mile" | "";
export type LaModel = { days: string[]; rows: { a: SAct; cells: { kind: Cell; risk: boolean }[] }[]; top: LaItem[]; risks: { item: LaItem; a: SAct }[]; counts: { activities: number; critical: number; inspections: number; deliveries: number; risks: number } };
/** One model behind both the chat view and the hosted page, so they always agree. */
export function lookaheadModel(start: string, end: string, allActs: SAct[], items: LaItem[]): LaModel {
  const days = workdays(start, end);
  const acts = windowActivities(allActs, start, end);
  const risks = items.flatMap((item) => { const a = acts.find((x) => itemHits(x, item)); return a ? [{ item, a }] : []; });
  const top = [...items].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).slice(0, 3);
  const rows = acts.map((a) => {
    const risky = items.some((it) => itemHits(a, it));
    const cells = days.map((d) => {
      if (d < a.start!.slice(0, 10) || d > a.finish!.slice(0, 10)) return { kind: "" as Cell, risk: false };
      const onEnd = d === a.finish!.slice(0, 10);
      if (isMilestone(a)) return { kind: "mile" as Cell, risk: risky };
      if (isInspection(a)) return { kind: (onEnd ? "insp" : "") as Cell, risk: risky && onEnd };
      if (isDelivery(a)) return { kind: (onEnd ? "deliv" : "") as Cell, risk: risky && onEnd };
      return { kind: (critical(a) ? "crit" : "non") as Cell, risk: risky && onEnd };
    });
    return { a, cells };
  });
  return { days, rows, top, risks, counts: { activities: acts.length, critical: acts.filter(critical).length, inspections: acts.filter(isInspection).length, deliveries: acts.filter(isDelivery).length, risks: risks.length } };
}
const ICON: Record<Cell, string> = { crit: "🔵", non: "⚪", insp: "📋", deliv: "🚚", mile: "◆", "": "" };
export const dayHead = (d: string) => `${DOW[dow(d)]} ${md(d)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The lookahead as a finished markdown view: header and counts, top 3, calendar strip, risk cards, legend. */
export function lookaheadView(v: { title: string; ref: string; start: string; end: string; dataDate: string | null; acts: SAct[]; items: LaItem[]; highlight?: string | null; pageUrl?: string | null }): string {
  const m = lookaheadModel(v.start, v.end, v.acts, v.items);
  const L: string[] = [];
  if (v.pageUrl) L.push(pageLine("lookahead", v.pageUrl), "");
  L.push(LOOKAHEAD_ARTIFACT_LINE, "", `## ${v.title} · Two-Week Lookahead`);
  L.push(`**Window:** ${shortDate(v.start)} – ${shortDate(v.end)}${v.dataDate ? ` · **Data date:** ${shortDate(v.dataDate)}` : ""} · **Ref:** ${v.ref}`);
  const c = m.counts;
  L.push(`**Counts:** ${plural(c.activities, "activity", "activities")} · ${c.critical} critical · ${plural(c.inspections, "inspection", "inspections")} · ${plural(c.deliveries, "delivery", "deliveries")} · ${plural(c.risks, "risk", "risks")}`, "");
  L.push("### Top 3 priorities", "| # | Action | Owner | Due |", "|---|---|---|---|");
  if (m.top.length) m.top.forEach((t, i) => L.push(`| ${i + 1} | ${t.action.replace(/\|/g, "/")} | ${t.owner ?? "Needed"} | ${t.due ? shortDate(t.due) : "Needed"} |`));
  else L.push("| – | No open items in this window | – | – |");
  L.push("", "### Calendar strip", "🔵 critical (blue #2563EB) · ⚪ non-critical (gray #9CA3AF) · 📋 inspection · 🚚 delivery · ◆ milestone · 🚩 risk (red #DC2626)", "");
  const head = m.days.map((d, i) => `${i === 0 ? "**Week 1:** " : i === 5 ? "**Week 2:** " : ""}${d === v.highlight ? "**" : ""}${DOW[dow(d)].charAt(0)} ${md(d)}${d === v.highlight ? "**" : ""}`);
  L.push(`| Activity | Float | ${head.join(" | ")} |`, `|---|---|${m.days.map(() => "---").join("|")}|`);
  for (const r of m.rows) L.push(`| ${r.a.id} ${r.a.name.replace(/\|/g, "/")} | ${num(r.a.total_float) ?? ""} | ${r.cells.map((x) => `${ICON[x.kind]}${x.risk ? "🚩" : ""}`).join(" | ")} |`);
  if (!m.rows.length) L.push(`| No saved CPM activities fall in this window | | ${m.days.map(() => "").join(" | ")} |`);
  if (m.risks.length) {
    L.push("", "### Risk cards");
    for (const { item: r, a } of m.risks) L.push(`> 🚩 **${r.action.replace(/\s+/g, " ").slice(0, 140)}** — Impact: ${a.id} ${a.name}${num(a.total_float) !== null ? ` (float ${num(a.total_float)} WD)` : ""}. Owner: ${r.owner ?? "Needed"} · Due ${r.due ? shortDate(r.due) : "Needed"}.`, "");
  }
  L.push("", "**Legend:** 🔵 Critical · ⚪ Non-critical · 📋 Inspection · 🚚 Delivery · ◆ Milestone · 🚩 Risk");
  return L.join("\n");
}

// ---------- pay app ----------
export type Billing = { billed_to_date?: number | null; months?: { month: string; amount: number; kind: "actual" | "forecast" }[] };
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m: string) => `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
export type PayModel = { billed: number; forecast: number; total: number; contract: number | null; left: number | null; months: { month: string; amount: number; kind: string; cum: number }[]; tie: string | null };
export function payModel(b: Billing | null | undefined, contract: number | null): PayModel {
  const months = [...(b?.months ?? [])].sort((x, y) => x.month.localeCompare(y.month));
  let cum = 0;
  const rows = months.map((m) => ({ ...m, cum: (cum = Math.round((cum + m.amount) * 100) / 100) }));
  const actual = months.filter((m) => m.kind === "actual").reduce((s, m) => s + m.amount, 0);
  const billed = Math.round((b?.billed_to_date ?? actual) * 100) / 100;
  const total = Math.round(months.reduce((s, m) => s + m.amount, 0) * 100) / 100;
  const forecast = Math.round(months.filter((m) => m.kind === "forecast").reduce((s, m) => s + m.amount, 0) * 100) / 100;
  const tie = contract === null ? null : Math.round(total * 100) === Math.round(contract * 100) ? `Forecast total ${usd(total)} = contract ${usd(contract)}` : `Doesn't tie: forecast ${usd(total)} vs contract ${usd(contract)}, off by ${usd(Math.abs(total - contract))}`;
  return { billed, forecast, total, contract, left: contract === null ? null : Math.round((contract - billed) * 100) / 100, months: rows, tie };
}
export function payAppView(v: { title: string; version?: number | null; dataDate?: string | null; billing: Billing | null | undefined; contract: number | null; pageUrl?: string | null }): string {
  const m = payModel(v.billing, v.contract);
  const L: string[] = [];
  if (v.pageUrl) L.push(pageLine("pay app", v.pageUrl), "");
  L.push(SHOW_AS_IS, "");
  if (m.tie) L.push(`**${m.tie}**`, "");
  L.push(`## ${v.title} · Pay App & Billing Forecast`, `${v.version ? `v${v.version}` : ""}${v.dataDate ? ` · Data date ${shortDate(v.dataDate)}` : ""}`, "");
  L.push("| Billed to date | Forecast remaining | Contract | Left to bill |", "|---|---|---|---|", `| ${usd(m.billed)} | ${usd(m.forecast)} | ${m.contract === null ? "Needed" : usd(m.contract)} | ${m.left === null ? "Needed" : usd(m.left)} |`, "");
  L.push("### Monthly billing", "| Month | Type | Amount | Cumulative |", "|---|---|---|---|");
  for (const r of m.months) L.push(`| ${monthLabel(r.month)} | ${r.kind === "actual" ? "🔵 Billed" : "⚪ Forecast"} | ${usd(r.amount)} | ${usd(r.cum)} |`);
  L.push(`| **Total** | | **${usd(m.total)}** | |`, "", "**Legend:** 🔵 Billed (blue #2563EB) · ⚪ Forecast (gray #9CA3AF) · red #DC2626 only when it doesn't tie", "", "Want it as Excel or PDF?");
  return L.join("\n");
}

// ---------- morning briefing ----------
export type BriefItem = { action: string; owner?: string | null; due?: string | null; type?: string | null };
export function briefingModel(items: BriefItem[], today: string) {
  const in7 = addDays(today, 7), in14 = addDays(today, 14);
  const due = (i: BriefItem) => (i.due ?? "").slice(0, 10);
  return {
    overdue: items.filter((i) => i.due && due(i) < today),
    today: items.filter((i) => due(i) === today),
    week: items.filter((i) => i.due && due(i) > today && due(i) <= in7),
    next: items.filter((i) => i.due && due(i) > in7 && due(i) <= in14),
    undated: items.filter((i) => !i.due),
  };
}
export function briefingView(v: { title: string; today: string; items: BriefItem[]; pageUrl?: string | null }): string {
  const m = briefingModel(v.items, v.today);
  const L: string[] = [];
  if (v.pageUrl) L.push(pageLine("morning briefing", v.pageUrl), "");
  L.push(SHOW_AS_IS, "", `## ${v.title} · Morning Briefing`, `**${shortDate(v.today)}**`, "");
  L.push("| 🚩 Overdue | Due today | Next 7 days | 8–14 days |", "|---|---|---|---|", `| ${m.overdue.length} | ${m.today.length} | ${m.week.length} | ${m.next.length} |`, "");
  const sec = (h: string, list: BriefItem[], flag = false) => {
    if (!list.length) return;
    L.push(`### ${h}`, "| Item | Owner | Due |", "|---|---|---|");
    for (const i of list.slice(0, 12)) L.push(`| ${flag ? "🚩 " : ""}${i.action.replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 160)} | ${i.owner ?? "Needed"} | ${i.due ? shortDate(i.due.slice(0, 10)) : "Needed"} |`);
    if (list.length > 12) L.push(`| …and ${list.length - 12} more | | |`);
    L.push("");
  };
  sec("Overdue", m.overdue, true); sec("Due today", m.today); sec("Next 7 days", m.week); sec("8–14 days", m.next);
  if (!m.overdue.length && !m.today.length && !m.week.length && !m.next.length) L.push("> ⚪ Nothing due in the next 14 days.", "");
  L.push(`**Next move:** ${m.overdue[0] ? `${m.overdue[0].owner ?? "The PM"} closes "${m.overdue[0].action.replace(/\s+/g, " ").slice(0, 80)}" today.` : m.today[0] ? `Close "${m.today[0].action.replace(/\s+/g, " ").slice(0, 80)}" today.` : "Nothing urgent; review the next 7 days."}`);
  return L.join("\n");
}

// ---------- styled empty states ----------
export function emptyCard(kind: "lookahead" | "pay_app", title: string, next: string, missing: string[] = [], pageUrl?: string | null): string {
  const label = kind === "lookahead" ? "Two-Week Lookahead" : "Pay App";
  return [
    ...(pageUrl ? [pageLine(kind === "lookahead" ? "lookahead" : "pay app", pageUrl), ""] : []),
    SHOW_AS_IS, "",
    `## ${title} · ${label}`,
    `> ⚪ **Nothing to show yet.** ${kind === "lookahead" ? "No saved schedule activities fall in this window." : "No billing has been saved for this job yet."}`,
    ...(missing.length ? ["", "| Needed | Status |", "|---|---|", ...missing.map((m) => `| ${m} | Needed |`)] : []),
    "", `**Next move:** ${next}`,
  ].join("\n");
}

// ---------- which lookahead a read uses ----------
export type LaRow = { id: string; start_date: string | null; end_date: string | null; created_at: string; items: number };
/**
 * 0.8.17: job 2701 had two lookaheads, LA-37D09 (no items) and LA-31BE8 (the real one). Reads pick the newest one that
 * has content (any open item linked to it); an empty one is used only when every lookahead is empty.
 */
export function pickLatestLookahead(rows: LaRow[]): LaRow | null {
  const k = (v: string | null) => v ?? "";
  const newest = (a: LaRow, b: LaRow) => (!a.start_date !== !b.start_date ? (a.start_date ? -1 : 1) : k(b.start_date).localeCompare(k(a.start_date)) || k(b.end_date).localeCompare(k(a.end_date)) || b.created_at.localeCompare(a.created_at));
  const sorted = [...rows].sort(newest);
  return sorted.find((r) => r.items > 0) ?? sorted[0] ?? null;
}
