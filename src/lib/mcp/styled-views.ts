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

/** The lookahead as a finished markdown view: header and counts, top 3, calendar strip, risk cards, legend. */
export function lookaheadView(v: { title: string; ref: string; start: string; end: string; dataDate: string | null; acts: SAct[]; items: LaItem[]; highlight?: string | null; pageUrl?: string | null }): string {
  const days = workdays(v.start, v.end);
  const acts = windowActivities(v.acts, v.start, v.end);
  const risks = v.items.filter((it) => acts.some((a) => itemHits(a, it)));
  const insp = acts.filter(isInspection).length, deliv = acts.filter(isDelivery).length;
  const top = [...v.items].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).slice(0, 3);
  const L: string[] = [];
  if (v.pageUrl) L.push(pageLine("lookahead", v.pageUrl), "");
  L.push(SHOW_AS_IS, "", `## ${v.title} · Two-Week Lookahead`);
  L.push(`**Window:** ${shortDate(v.start)} – ${shortDate(v.end)}${v.dataDate ? ` · **Data date:** ${shortDate(v.dataDate)}` : ""} · **Ref:** ${v.ref}`);
  L.push(`**Counts:** ${acts.length} activities · ${acts.filter(critical).length} critical · ${insp} inspection${insp === 1 ? "" : "s"} · ${deliv} deliver${deliv === 1 ? "y" : "ies"} · ${risks.length} risk${risks.length === 1 ? "" : "s"}`, "");
  L.push("### Top 3 priorities", "| # | Action | Owner | Due |", "|---|---|---|---|");
  if (top.length) top.forEach((t, i) => L.push(`| ${i + 1} | ${t.action.replace(/\|/g, "/")} | ${t.owner ?? "Needed"} | ${t.due ? shortDate(t.due) : "Needed"} |`));
  else L.push("| – | No open items in this window | – | – |");
  L.push("", "### Calendar strip", "🔵 critical (blue #2563EB) · ⚪ non-critical (gray #9CA3AF) · 📋 inspection · 🚚 delivery · ◆ milestone · 🚩 risk (red #DC2626)", "");
  const head = days.map((d, i) => `${i === 0 ? "**Week 1:** " : i === 5 ? "**Week 2:** " : ""}${d === v.highlight ? "**" : ""}${DOW[dow(d)].charAt(0)} ${md(d)}${d === v.highlight ? "**" : ""}`);
  L.push(`| Activity | Float | ${head.join(" | ")} |`, `|---|---|${days.map(() => "---").join("|")}|`);
  for (const a of acts) {
    const risky = v.items.some((it) => itemHits(a, it));
    const cells = days.map((d) => {
      if (d < a.start!.slice(0, 10) || d > a.finish!.slice(0, 10)) return "";
      const onEnd = d === a.finish!.slice(0, 10);
      if (isMilestone(a)) return `◆${risky ? "🚩" : ""}`;
      if (isInspection(a)) return onEnd ? `📋${risky ? "🚩" : ""}` : "";
      if (isDelivery(a)) return onEnd ? `🚚${risky ? "🚩" : ""}` : "";
      return `${critical(a) ? "🔵" : "⚪"}${risky && onEnd ? "🚩" : ""}`;
    });
    L.push(`| ${a.id} ${a.name.replace(/\|/g, "/")} | ${num(a.total_float) ?? ""} | ${cells.join(" | ")} |`);
  }
  if (!acts.length) L.push(`| No saved CPM activities fall in this window | | ${days.map(() => "").join(" | ")} |`);
  if (risks.length) {
    L.push("", "### Risk cards");
    for (const r of risks) {
      const a = acts.find((x) => itemHits(x, r))!;
      L.push(`> 🚩 **${r.action.replace(/\s+/g, " ").slice(0, 140)}** — Impact: ${a.id} ${a.name}${num(a.total_float) !== null ? ` (float ${num(a.total_float)} WD)` : ""}. Owner: ${r.owner ?? "Needed"} · Due ${r.due ? shortDate(r.due) : "Needed"}.`, "");
    }
  }
  L.push("", "**Legend:** 🔵 Critical · ⚪ Non-critical · 📋 Inspection · 🚚 Delivery · ◆ Milestone · 🚩 Risk");
  return L.join("\n");
}

// ---------- styled empty states ----------
export function emptyCard(kind: "lookahead" | "pay_app", title: string, next: string, missing: string[] = []): string {
  const label = kind === "lookahead" ? "Two-Week Lookahead" : "Pay App";
  return [
    SHOW_AS_IS, "",
    `## ${title} · ${label}`,
    `> ⚪ **Nothing to show yet.** ${kind === "lookahead" ? "No saved schedule activities fall in this window." : "No billing has been saved for this job yet."}`,
    ...(missing.length ? ["", "| Needed | Status |", "|---|---|", ...missing.map((m) => `| ${m} | Needed |`)] : []),
    "", `**Next move:** ${next}`,
  ].join("\n");
}
