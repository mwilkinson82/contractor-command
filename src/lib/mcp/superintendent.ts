// Superintendent field board, daily reports, pay-app feed, schedule percents and production rates.
// Pure helpers. Dollars stay out of the field board. The pay application is built with the same
// G702/G703 column math as the schedule of values, and it is refused when it does not tie.
import { fieldPayAppCardModel, presentPayApp } from "./pay-app-card";
import type { CardModel, CardRow } from "./cards/model";
import { detailAnchor, mdLink, withAnchor } from "./plain-label";
import { ALERT_HEX } from "./alert-color";
import { DEFAULT_TZ, dateIn } from "./deadlines";
import { activityTitle, lookaheadWindow, shortDate } from "./styled-views";
import { isDelayNoticeTask } from "./delay-notice";
import { dedupeOpenRows, itemName } from "./open-feed";
import { SovMismatch, buildSov, lineBilling, money, type SovLineIn } from "./sov";
import { jobHeading } from "./job-label";

function pageJobTitle(number?: string | null, name?: string | null, fallback = ""): string {
  return jobHeading({ job_number: number ?? "", name: name ?? "" }, " ").trim() || fallback;
}

export const FIELD_NAVY = "#1E3A5F";
export const FIELD_BLUE = "#1E5FED";
export const FIELD_GRAY = "#6B7280";
export const FIELD_LINE = "#D1D5DB";
export const FIELD_WASH = "#F3F4F6";
export const FIELD_RED = ALERT_HEX;
export const FIELD_MOBILE_PX = 420;

/** Server instruction. No palette hex, so it cannot fight the shared color rule. */
export const FIELD_SERVER_RULE =
  " For the superintendent, show the field board on a phone-width card. When someone asks for the field board, the super board, the superintendent board, the super's plan, or what the crew is doing, call field_board or superintendent_view. Assemble the daily from the transcript or the typed notes, ask every missing item it lists, and save the daily only after the superintendent says yes. A progress photo keeps the upload date until they confirm it, and needs the place on site. Daily reminders stay off until that job turns them on. When they are on, the reminder is a card in the chat. Nothing is emailed.";

export type JobScope = "full" | "contract" | "super";

/**
 * Existing scopes are unchanged: full (owner, all-access, AP, and a PM on their jobs),
 * contract (estimating and contracts), super (assigned jobs, no dollars, still read-only
 * on the tools that were already there). Field tools add a layer on top:
 * - full and super can use the field board, dailies, photos and the schedule feed.
 * - super still does not see pay-app dollars. Full does.
 * - contract can read production rates only, so estimating can use hours against quantities.
 */
export function fieldAccess(scope: JobScope | null | undefined): "field" | "rates" | "none" {
  if (scope === "full" || scope === "super") return "field";
  if (scope === "contract") return "rates";
  return "none";
}

export const fieldMoney = (scope: JobScope | null | undefined) => scope === "full";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};
const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;
const round2 = (n: number) => dollars(cents(n));
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------- daily ----------
export type WorkLine = {
  work: string;
  sov_item: string | null;
  activity_id: string | null;
  qty: number | null;
  unit: string | null;
  crew: number | null;
  hours: number | null;
  pct_complete: number | null;
};

export type DailySections = {
  weather: string | null;
  manpower: string | null;
  subs_on_site: string | null;
  deliveries: string | null;
  issues: string | null;
  delays: string | null;
  safety: string | null;
  work: WorkLine[];
};

export type DailyDraft = DailySections & { follow_ups: string[]; ready: boolean };

const NONE = /^(none|nothing|n\/?a|no|nope)\b/i;
const present = (s: string | null | undefined) => !!s && s.trim() !== "";

/**
 * A delay line is real only when it records a delay.
 * "none", "no delays", and notes such as "TEST - none" are not delays.
 */
export function isRecordedDelay(value: string | null | undefined): boolean {
  if (!present(value)) return false;
  const t = value!.trim().replace(/\s+/g, " ");
  if (NONE.test(t)) return false;
  if (/\bno\s+delays?\b/i.test(t) && !/\b(waiting|late|behind|stopped|hold)\b/i.test(t)) return false;
  if (/\bnone\b/i.test(t)) {
    const rest = t.replace(/\bnone\b/gi, " ").replace(/\bdelays?\b/gi, " ");
    if (!/\b(waiting|late|behind|stopped|hold|delayed|down)\b/i.test(rest)) return false;
  }
  return true;
}

const SECTION_HEAD: [keyof Omit<DailySections, "work"> | "work", RegExp][] = [
  ["weather", /^weather\b/i],
  ["manpower", /^(manpower|headcount|crew(?: on site)?)\b/i],
  ["subs_on_site", /^(subs|subcontractors)\b/i],
  ["work", /^work( performed)?\b/i],
  ["deliveries", /^deliver(y|ies)\b/i],
  ["issues", /^issues?\b/i],
  ["delays", /^delays?\b/i],
  ["safety", /^safety\b/i],
];

function headingOf(line: string): keyof DailySections | null {
  const t = line.replace(/^[-*•]+(?:\s+|(?=\S))/, "").replace(/[:\-–]+$/, "").trim();
  for (const [key, re] of SECTION_HEAD) if (re.test(t)) return key;
  return null;
}

/** Pull "Weather: Clear. Manpower: …" onto separate lines so a transcript-only note still maps. */
function splitLabeledTranscript(transcript: string): string {
  const label = "(?:weather|manpower|headcount|crew|subs|subcontractors|work|deliver(?:y|ies)|issues?|delays?|safety)";
  return transcript
    .replace(/\r\n/g, "\n")
    .replace(new RegExp(`(^|\\n)\\s*[-*•]\\s+(?=${label}\\b)`, "gi"), "$1")
    .replace(new RegExp(`([.!?])\\s+(?=${label}\\b)`, "gi"), "$1\n");
}

const SOV_RE = /\b(?:SOV\s*)?(\d{2}\.\d{2,3})\b/i;
const ACT_RE = /\b([A-Za-z]{1,4}-?\d{2,5})\b/;
const PCT_RE = /\b(\d+(?:\.\d+)?)\s*%/;
const CREW_RE = /\bcrew\s*(\d+(?:\.\d+)?)\b/i;
const HOURS_RE = /\b(\d+(?:\.\d+)?)\s*hours?\b/i;
const QTY_RE = /\b(\d+(?:\.\d+)?)\s*([A-Za-z]{1,12})\b/;

export function parseWorkLine(raw: string): WorkLine {
  let rest = raw.replace(/^[-*•]\s*/, "").trim();
  const sov = rest.match(SOV_RE);
  const pct = rest.match(PCT_RE);
  const crew = rest.match(CREW_RE);
  const hours = rest.match(HOURS_RE);
  const activity = rest.match(ACT_RE);
  if (sov) rest = rest.replace(sov[0], " ");
  if (pct) rest = rest.replace(pct[0], " ");
  if (crew) rest = rest.replace(crew[0], " ");
  if (hours) rest = rest.replace(hours[0], " ");
  if (activity) rest = rest.replace(activity[0], " ");
  const qty = rest.match(QTY_RE);
  if (qty) rest = rest.replace(qty[0], " ");
  const work = rest.replace(/\s{2,}/g, " ").replace(/^[,.\s]+|[,.\s]+$/g, "").trim() || raw.replace(/^[-*•]\s*/, "").trim();
  return {
    work,
    sov_item: sov ? sov[1] : null,
    activity_id: activity ? activity[1].toUpperCase() : null,
    qty: qty ? Number(qty[1]) : null,
    unit: qty ? qty[2] : null,
    crew: crew ? Number(crew[1]) : null,
    hours: hours ? Number(hours[1]) : null,
    pct_complete: pct ? Number(pct[1]) : null,
  };
}

const WORD_COUNT: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

function sentenceList(transcript: string): string[] {
  return transcript
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Spoken notes with no field labels. Only fills a section the heading pass left empty. */
function fillFromProse(transcript: string, out: DailySections): void {
  const sentences = sentenceList(transcript);
  const text = sentences.join(" ");
  const sentence = (re: RegExp) => sentences.find((s) => re.test(s))?.replace(/[.!?]+$/, "").trim() ?? null;
  if (!out.weather) {
    const labeled = text.match(/\bweather\b(?:\s+\w+){0,4}?\s*(?:was|is|:|-|–)\s*([^.]{1,80})/i);
    out.weather = labeled?.[1]?.trim() ?? sentence(/^(?:it was\s+)?(?:clear|sunny|cloudy|overcast|rain|windy|hot|cold)\b/i);
  }
  if (!out.manpower) {
    const crew = text.match(/\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:carpenters|laborers|workers|people|men|guys|operators|ironworkers|finishers)(?:\s+from\s+our\s+crew)?)\b/i);
    out.manpower = crew?.[1]?.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i, (w) => WORD_COUNT[w.toLowerCase()] ?? w) ?? null;
  }
  if (!out.subs_on_site) {
    if (/\bno subs\b|\bsubs?:?\s*none\b/i.test(text)) out.subs_on_site = "none";
    else {
      const subs = text.match(/\bsubs?\s+(?:on site\s+)?(?:were|was|included|:|-|–)\s*([^.]{1,80})/i);
      if (subs) out.subs_on_site = subs[1].trim();
    }
  }
  if (!out.work.length) {
    const lines = sentences.filter((s) => SOV_RE.test(s) || /\bwork(?:\s+performed)?\b/i.test(s) || ACT_RE.test(s));
    out.work.push(...lines.map((s) => parseWorkLine(s.replace(/^(?:work(?:\s+performed)?\s*[:\-–]\s*)/i, ""))));
  }
  if (!out.deliveries) {
    if (/\b(nothing was delivered|no deliveries|deliveries?:?\s*none)\b/i.test(text)) out.deliveries = "none";
    else out.deliveries = sentence(/\bdeliver(?:y|ies|ed)\b/i);
  }
  if (!out.issues) {
    if (/\b(no issues|issues?:?\s*none)\b/i.test(text)) out.issues = "none";
    else out.issues = sentence(/\bissues?\b/i);
  }
  if (!out.delays) {
    if (/\bcrane\b/i.test(text) && /\bwaiting\b/i.test(text)) out.delays = sentence(/\bcrane\b/i) ?? "Crane waiting";
    else if (/\b(no delays|delays?:?\s*none)\b/i.test(text)) out.delays = "none";
    else out.delays = sentence(/\bdelays?\b/i);
  }
  if (!out.safety) {
    if (/\bsafety\b/i.test(text) && /\bnone\b/i.test(text) && !/\bsafety talk\b/i.test(text)) out.safety = "none";
    else out.safety = sentence(/\bsafety\b/i);
  }
}

export function parseTranscript(transcript: string): DailySections {
  const out: DailySections = {
    weather: null, manpower: null, subs_on_site: null, deliveries: null, issues: null, delays: null, safety: null, work: [],
  };
  let key: keyof DailySections | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (!key) return;
    const body = buf.join("\n").trim();
    buf.length = 0;
    if (!body) return;
    if (key === "work") {
      const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const bullets = lines.filter((l) => /^[-*•]/.test(l) || SOV_RE.test(l) || ACT_RE.test(l));
      const use = bullets.length ? bullets : lines;
      out.work.push(...use.map(parseWorkLine));
    } else out[key] = body;
  };
  for (const line of splitLabeledTranscript(transcript).split(/\n/)) {
    const head = headingOf(line.trim());
    if (head) {
      flush();
      key = head;
      const rest = line.replace(/^[^:–-]*[:–-]\s*/, "").trim();
      if (rest && rest !== line.trim()) buf.push(rest);
      continue;
    }
    if (key) buf.push(line);
  }
  flush();
  if (!out.weather || !out.manpower || !out.subs_on_site || !out.deliveries || !out.issues || !out.delays || !out.safety || !out.work.length) {
    fillFromProse(transcript, out);
  }
  return out;
}

function lineFollowUps(line: WorkLine): string[] {
  const name = line.work || "this work";
  const q: string[] = [];
  if (!line.sov_item) q.push(`Which SOV item covers "${name}"?`);
  if (!line.activity_id) q.push(`Which CPM activity covers "${name}"?`);
  if (line.qty == null || !line.unit) q.push(`How much of "${name}" was installed, and in what unit?`);
  if (line.crew == null || line.hours == null) q.push(`How many people were on "${name}", and for how many hours?`);
  return q;
}

const SECTION_ASK: [keyof Omit<DailySections, "work">, string][] = [
  ["weather", "What was the weather?"],
  ["manpower", "Who was on site from your crew, and how many?"],
  ["subs_on_site", "Which subs were on site? Say none if there were none."],
  ["deliveries", "What was delivered? Say none if nothing was delivered."],
  ["issues", "Any issues? Say none if there were none."],
  ["delays", "Any delays? Say none if there were none."],
  ["safety", "Anything for safety? Say none if nothing came up."],
];

export function assembleDaily(input: {
  transcript?: string | null;
  weather?: string | null;
  manpower?: string | null;
  subs_on_site?: string | null;
  deliveries?: string | null;
  issues?: string | null;
  delays?: string | null;
  safety?: string | null;
  work?: Partial<WorkLine>[] | null;
}): DailyDraft {
  const parsed = input.transcript?.trim() ? parseTranscript(input.transcript) : {
    weather: null, manpower: null, subs_on_site: null, deliveries: null, issues: null, delays: null, safety: null, work: [] as WorkLine[],
  };
  const pick = (k: keyof Omit<DailySections, "work">) => text(input[k]) ?? parsed[k];
  const work: WorkLine[] = input.work?.length
    ? input.work.map((w) => ({
        work: text(w.work) ?? "",
        sov_item: text(w.sov_item),
        activity_id: text(w.activity_id)?.toUpperCase() ?? null,
        qty: num(w.qty),
        unit: text(w.unit),
        crew: num(w.crew),
        hours: num(w.hours),
        pct_complete: num(w.pct_complete),
      }))
    : parsed.work;
  const draft: DailySections = {
    weather: pick("weather"),
    manpower: pick("manpower"),
    subs_on_site: pick("subs_on_site"),
    deliveries: pick("deliveries"),
    issues: pick("issues"),
    delays: pick("delays"),
    safety: pick("safety"),
    work,
  };
  const follow_ups: string[] = [];
  for (const [k, ask] of SECTION_ASK) if (!present(draft[k])) follow_ups.push(ask);
  if (!draft.work.length) follow_ups.push("What work was performed?");
  for (const line of draft.work) follow_ups.push(...lineFollowUps(line));
  return { ...draft, follow_ups, ready: follow_ups.length === 0 };
}

export function dailyCard(jobLabel: string, date: string, d: DailyDraft, saved: boolean): string {
  const row = (label: string, value: string | null, alert = false) =>
    `${alert ? "DELAY — " : ""}${label}: ${value?.trim() || "Needed"}`;
  const lines = d.work.length
    ? d.work.map((w) => {
        const bits = [w.work || "Work"];
        if (w.qty != null && w.unit) bits.push(`${w.qty} ${w.unit}`);
        if (w.crew != null) bits.push(`crew ${w.crew}`);
        if (w.hours != null) bits.push(`${w.hours} hours`);
        if (w.pct_complete != null) bits.push(`${w.pct_complete}% complete`);
        return `- ${bits.join(" · ")}`;
      })
    : ["- Needed"];
  const who = jobLabel.replace(/[\s·–—-]+$/g, "").trim();
  return [
    "REQUIRED: Show this daily as one phone-width card. Navy, blue and gray only. Red only on the delay line, and only when there is a delay.",
    `${who ? `${who} · ` : ""}Daily report · ${date}`,
    saved ? "Saved." : "Draft. Not saved.",
    row("Weather", d.weather),
    row("Manpower", d.manpower),
    row("Subs on site", d.subs_on_site),
    "Work performed:",
    ...lines,
    row("Deliveries", d.deliveries),
    row("Issues", d.issues),
    row("Delays", d.delays, isRecordedDelay(d.delays)),
    row("Safety", d.safety),
    ...(d.follow_ups.length ? ["", "Still needed:", ...d.follow_ups.map((q) => `- ${q}`)] : []),
  ].join("\n");
}

// ---------- production rates and schedule feed ----------
export type RateLine = {
  work: string;
  sov_item: string;
  activity_id: string;
  qty: number;
  unit: string;
  crew: number;
  hours: number;
  man_hours: number;
  qty_per_man_hour: number;
};

/** Hours times crew is the man-hours. Quantity over man-hours is the rate estimating can reuse. */
export function rateFromLine(line: WorkLine): RateLine | null {
  if (!line.sov_item || !line.activity_id || line.qty == null || !line.unit || line.crew == null || line.hours == null) return null;
  if (!(line.qty > 0) || !(line.crew > 0) || !(line.hours > 0)) return null;
  const man_hours = round2(line.crew * line.hours);
  if (!(man_hours > 0)) return null;
  return {
    work: line.work,
    sov_item: line.sov_item,
    activity_id: line.activity_id,
    qty: line.qty,
    unit: line.unit,
    crew: line.crew,
    hours: line.hours,
    man_hours,
    qty_per_man_hour: line.qty / man_hours,
  };
}

export type ScheduleProposal = { activity_id: string; from_pct: number | null; to_pct: number | null; report_date: string | null };

/** Latest stated percent per activity. This does not write the saved schedule. */
export function scheduleProposals(
  activities: { id: string; pct_complete?: number | null }[],
  lines: { activity_id: string; report_date: string; pct_complete: number | null }[],
): ScheduleProposal[] {
  const latest = new Map<string, { pct: number; report_date: string }>();
  for (const line of [...lines].sort((a, b) => a.report_date.localeCompare(b.report_date))) {
    if (line.pct_complete == null) continue;
    latest.set(line.activity_id, { pct: line.pct_complete, report_date: line.report_date });
  }
  const ids = new Set<string>([...activities.map((a) => a.id), ...latest.keys()]);
  return [...ids].sort().map((id) => {
    const act = activities.find((a) => a.id === id);
    const hit = latest.get(id);
    return { activity_id: id, from_pct: num(act?.pct_complete), to_pct: hit?.pct ?? null, report_date: hit?.report_date ?? null };
  }).filter((p) => p.to_pct != null);
}

// ---------- pay app (G702 / G703) ----------
export type ProgressSnap = { item_no: string; pct: number | null; qty: number; as_of: string | null };

/** Cumulative percent: the latest stated percent, otherwise installed quantity over the takeoff quantity. */
export function progressByItem(
  lines: { report_date: string; sov_item: string; qty: number | null; pct_complete: number | null }[],
  totals: { sov_item: string; qty: number | null }[] = [],
  asOf?: string | null,
): ProgressSnap[] {
  const use = asOf ? lines.filter((l) => l.report_date <= asOf) : lines;
  const by = new Map<string, ProgressSnap>();
  for (const line of [...use].sort((a, b) => a.report_date.localeCompare(b.report_date))) {
    const cur = by.get(line.sov_item) ?? { item_no: line.sov_item, pct: null, qty: 0, as_of: null };
    if (line.qty != null) cur.qty = round2(cur.qty + line.qty);
    if (line.pct_complete != null) cur.pct = line.pct_complete;
    cur.as_of = line.report_date;
    by.set(line.sov_item, cur);
  }
  for (const snap of by.values()) {
    if (snap.pct != null) continue;
    const total = totals.find((t) => t.sov_item === snap.item_no)?.qty;
    if (total != null && total > 0) snap.pct = Math.round((snap.qty / total) * 10000) / 100;
  }
  return [...by.values()];
}

export type G703Row = {
  item_no: string;
  description: string;
  scheduled_value: number;
  previous: number | null;
  this_period: number | null;
  total_completed: number | null;
  pct_complete: number | null;
  balance: number | null;
  retainage: number | null;
  note: string | null;
};

export type G702 = {
  contract_sum: number;
  completed_and_stored: number;
  retainage: number | null;
  retainage_note: string | null;
  earned_less_retainage: number;
  previous_certificates: number;
  current_payment_due: number;
  balance_to_finish: number;
  rows: G703Row[];
  checks: string[];
};

export class PayAppMismatch extends Error {}

/**
 * Column D is the previous application, E is this period, G = D + E, percent = G / C, H = C − G.
 * The fee is earned in proportion to completed work so the certificate ties to the contract sum.
 * A one-cent rounding remainder, if any, is carried on the current payment and the checks say so.
 */
export function buildFieldPayApp(
  lines: SovLineIn[],
  feePct: number | null,
  retPct: number | null,
  current: { item_no: string; pct: number | null }[],
  previous: { item_no: string; pct: number | null }[],
): G702 {
  const problems: string[] = [];
  const billing: Record<string, { d: number | null; e: number | null }> = {};
  const notes = new Map<string, string>();
  for (const line of lines) {
    const now = current.find((p) => p.item_no === line.item_no);
    const prev = previous.find((p) => p.item_no === line.item_no);
    if (now?.pct == null && prev?.pct == null) continue;
    if (typeof line.scheduled_value !== "number") continue;
    const prevDollars = prev?.pct == null ? 0 : round2((line.scheduled_value * prev.pct) / 100);
    let nowDollars = now?.pct == null ? prevDollars : round2((line.scheduled_value * now.pct) / 100);
    if (line.scheduled_value >= 0 ? nowDollars + 0.001 < prevDollars : nowDollars - 0.001 > prevDollars) {
      notes.set(line.item_no, `Percent on the daily is below what was already billed. The pay app keeps ${money(prevDollars)}.`);
      nowDollars = prevDollars;
    }
    const e = round2(nowDollars - prevDollars);
    billing[line.item_no] = { d: prevDollars, e };
  }
  let sov;
  try {
    sov = buildSov(lines, feePct, retPct, billing);
  } catch (e) {
    if (e instanceof SovMismatch) throw new PayAppMismatch(e.message);
    throw e;
  }
  const rows: G703Row[] = [];
  let workG = 0;
  let workC = 0;
  let prevWork = 0;
  let baseWorkC = 0, baseWorkG = 0, basePrevWork = 0;
  for (const div of sov.divisions) {
    for (const line of div.lines) {
      workC += cents(line.scheduled_value);
      const b = lineBilling(line.scheduled_value, billing[line.item_no]?.d ?? null, billing[line.item_no]?.e ?? null, retPct);
      if (b.g != null) workG += cents(b.g);
      if (b.d != null) prevWork += cents(b.d);
      const original = lines.find(input=>input.item_no===line.item_no);
      if (!(original?.executed_change_order && original.fee_included)) {
        baseWorkC += cents(line.scheduled_value);
        if (b.g != null) baseWorkG += cents(b.g);
        if (b.d != null) basePrevWork += cents(b.d);
      }
      rows.push({
        item_no: line.item_no,
        description: line.description,
        scheduled_value: line.scheduled_value,
        previous: b.d,
        this_period: b.e,
        total_completed: b.g,
        pct_complete: b.pct_complete,
        balance: b.h,
        retainage: b.i,
        note: notes.get(line.item_no) ?? null,
      });
      if (b.g != null) {
        const g = cents(b.d ?? 0) + cents(b.e ?? 0);
        if (g !== cents(b.g) || cents(b.h ?? 0) !== cents(line.scheduled_value) - g)
          problems.push(`Line ${line.item_no} does not tie: total completed must equal previous plus this period, and the balance must be the scheduled value minus that.`);
      }
    }
  }
  const contract = cents(sov.summary.contract_total);
  const feeC = cents(sov.summary.fee);
  if (workC + feeC !== contract) problems.push("The schedule of values does not tie to the contract sum.");
  const feeG = baseWorkC === 0 ? 0 : Math.round((feeC * baseWorkG) / baseWorkC);
  const feePrev = baseWorkC === 0 ? 0 : Math.round((feeC * basePrevWork) / baseWorkC);
  const completed = workG + feeG;
  const balance = contract - completed;
  const retNote = retPct == null ? "Retainage percent isn't recorded, so retainage is not applied." : null;
  const ret = retPct == null ? 0 : Math.round((completed * retPct) / 100);
  const earnedLess = completed - ret;
  const previousCertificates = prevWork + feePrev;
  let currentDue = earnedLess - previousCertificates;
  const identity = currentDue + previousCertificates + ret + balance;
  let rounding: string | null = null;
  if (identity !== contract) {
    const drift = contract - identity;
    if (Math.abs(drift) > 2) problems.push(`The certificate is off by ${money(dollars(drift))}.`);
    else {
      currentDue += drift;
      rounding = `A ${money(dollars(Math.abs(drift)))} rounding remainder is on the current payment.`;
    }
  }
  if (problems.length) throw new PayAppMismatch(problems.join("\n"));
  const checks = [
    `Contract sum ${money(dollars(contract))} equals the schedule of values.`,
    `Completed and stored ${money(dollars(completed))} plus balance ${money(dollars(balance))} equals the contract sum.`,
    `Current payment ${money(dollars(currentDue))} plus previous certificates ${money(dollars(previousCertificates))} plus retainage ${money(dollars(ret))} plus balance equals the contract sum.`,
    ...(rounding ? [rounding] : []),
  ];
  return {
    contract_sum: dollars(contract),
    completed_and_stored: dollars(completed),
    retainage: retPct == null ? null : dollars(ret),
    retainage_note: retNote,
    earned_less_retainage: dollars(earnedLess),
    previous_certificates: dollars(previousCertificates),
    current_payment_due: dollars(currentDue),
    balance_to_finish: dollars(balance),
    rows,
    checks,
  };
}

export function payAppCard(jobLabel: string, period: string, app: G702): string {
  return presentPayApp(fieldPayAppCardModel(jobLabel, period, app)).content[0].text;
}

/** Super and anyone without full scope sees percents and quantities, never dollars. */
export function payAppPercentCard(
  jobLabel: string,
  period: string,
  rows: { item_no: string; description?: string | null; pct: number | null; qty: number | null; unit: string | null }[],
): string {
  const body = rows.length
    ? rows.map((r) => `- ${r.description || "Item"}${r.item_no ? ` (${r.item_no})` : ""}: ${r.pct == null ? "percent needed" : `${r.pct}% complete`}${r.qty != null ? `, ${r.qty}${r.unit ? ` ${r.unit}` : ""} installed` : ""}`)
    : ["- No progress saved yet."];
  return [`${jobLabel}Progress for the next pay app · ${period}`, "Percents only. Dollar columns stay with the PM.", ...body].join("\n");
}

// ---------- field board ----------
export type FieldMaterial = { item: string; qty: number | null; unit: string | null; remaining: number | null };
export type FieldRow = {
  id: string;
  name: string;
  start: string | null;
  finish: string | null;
  total_float: number | null;
  critical: boolean;
  pct_complete: number | null;
  self_perform: boolean | null;
  sub: string | null;
  crew: number | null;
  man_hours: number | null;
  man_days: number | null;
  day_hours: number | null;
  materials: FieldMaterial[];
  delay: boolean;
  in_window: boolean;
};

export type FieldSource = {
  activities?: unknown;
  assignments?: unknown;
  materials?: unknown;
  rates?: unknown;
  installed?: unknown;
  data_date?: string | null;
  lookahead?: { start_date?: string | null; end_date?: string | null } | null;
  today?: string | null;
};

type Act = { id: string; name: string; start: string | null; finish: string | null; total_float: number | null; critical: boolean; pct_complete: number | null; sov_line: string | null };
type Mat = { item: string; qty: number | null; unit: string | null; trade: string | null };
type Rate = { activity_id: string | null; sov_item: string | null; unit: string | null; qty_per_man_hour: number; crew: number | null; hours: number | null };

const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);

function bestActivity(label: string, acts: Act[]): Act | null {
  let best: Act | null = null;
  let score = 0;
  const mine = new Set(tokens(label));
  if (!mine.size) return null;
  for (const a of acts) {
    const n = tokens(a.name).filter((t) => mine.has(t)).length;
    if (n > score) {
      score = n;
      best = a;
    }
  }
  return score > 0 ? best : null;
}

export function projectField(src: FieldSource): { window: { start: string; end: string } | null; rows: FieldRow[]; outside: number } {
  const acts: Act[] = asArray(src.activities).map((a) => ({
    id: text(a.id) ?? "",
    name: activityTitle({ id: text(a.id), name: text(a.name), description: text(a.description) }),
    start: text(a.start)?.slice(0, 10) ?? null,
    finish: text(a.finish)?.slice(0, 10) ?? null,
    total_float: num(a.total_float),
    critical: a.critical === true,
    pct_complete: num(a.pct_complete),
    sov_line: text(a.sov_line),
  })).filter((a) => a.id);
  const assignments = asArray(src.assignments).map((a) => ({
    activity_id: text(a.activity_id) ?? "",
    self_perform: a.self_perform === true ? true : a.self_perform === false ? false : null,
    sub_name: text(a.sub_name),
    crew_size: num(a.crew_size),
  }));
  const materials: Mat[] = asArray(src.materials).map((m) => ({
    item: text(m.material) || text(m.item) || "",
    qty: num(m.qty),
    unit: text(m.unit),
    trade: text(m.trade),
  })).filter((m) => m.item);
  const rates: Rate[] = asArray(src.rates).map((r) => ({
    activity_id: text(r.activity_id),
    sov_item: text(r.sov_item),
    unit: text(r.unit),
    qty_per_man_hour: num(r.qty_per_man_hour) ?? 0,
    crew: num(r.crew),
    hours: num(r.hours),
  })).filter((r) => r.qty_per_man_hour > 0);
  const installed = asArray(src.installed).map((i) => ({
    activity_id: text(i.activity_id),
    sov_item: text(i.sov_item),
    qty: num(i.qty) ?? 0,
    unit: text(i.unit),
  }));
  const window = lookaheadWindow(
    src.lookahead?.start_date && src.lookahead.end_date ? { start_date: src.lookahead.start_date, end_date: src.lookahead.end_date } : null,
    src.data_date ?? null,
  );
  const inWindow = (a: Act) => {
    if (!window) return true;
    if (!a.start || !a.finish) return false;
    return a.start <= window.end && a.finish >= window.start;
  };
  const rows: FieldRow[] = acts.map((a) => {
    const asg = assignments.find((x) => x.activity_id === a.id);
    const rate = rates.find((r) => r.activity_id === a.id || (a.sov_line != null && r.sov_item === a.sov_line)) ?? null;
    const mats = materials.filter((m) => bestActivity(`${m.item} ${m.trade ?? ""}`, acts)?.id === a.id);
    const self = asg?.self_perform ?? null;
    const crew = asg?.crew_size ?? rate?.crew ?? null;
    let man_hours: number | null = null;
    let man_days: number | null = null;
    const day_hours = rate?.hours ?? null;
    const shown: FieldMaterial[] = self === true
      ? mats.map((m) => {
          const done = installed.filter((i) => (i.activity_id === a.id || (a.sov_line != null && i.sov_item === a.sov_line)) && i.unit === m.unit).reduce((s, i) => s + i.qty, 0);
          const remaining = m.qty == null ? null : Math.max(0, round2(m.qty - done));
          return { item: m.item, qty: m.qty, unit: m.unit, remaining };
        })
      : [];
    if (self === true && rate && day_hours != null && day_hours > 0) {
      const remainingQty = shown.filter((m) => m.unit === rate.unit && m.remaining != null).reduce((s, m) => s + (m.remaining ?? 0), 0);
      if (remainingQty > 0) {
        man_hours = round2(remainingQty / rate.qty_per_man_hour);
        man_days = round2(man_hours / day_hours);
      }
    }
    const delay = (a.total_float != null && a.total_float < 0) || /fragnet|delay/i.test(a.name);
    return {
      id: a.id,
      name: a.name,
      start: a.start,
      finish: a.finish,
      total_float: a.total_float,
      critical: a.critical,
      pct_complete: a.pct_complete,
      self_perform: self,
      sub: self === false ? asg?.sub_name ?? null : null,
      crew: self === false ? null : crew,
      man_hours: self === true ? man_hours : null,
      man_days: self === true ? man_days : null,
      day_hours: self === true ? day_hours : null,
      materials: shown,
      delay,
      in_window: inWindow(a),
    };
  });
  const visible = window ? rows.filter((r) => r.in_window) : rows;
  return { window: window ? { start: window.start, end: window.end } : null, rows: visible, outside: rows.length - visible.length };
}

export type FieldLinks = { field?: string | null; daily?: string | null; photos?: string | null; items?: string | null; ior?: string | null };

export function fieldCard(jobLabel: string, board: ReturnType<typeof projectField>, items: { id?: string | null; action?: string; owner?: string | null; due?: string | null }[] = [], today?: string | null, links?: FieldLinks | null): string {
  const win = board.window ? `${shortDate(board.window.start)} – ${shortDate(board.window.end)}` : "Needed";
  const lines = board.rows.length
    ? board.rows.map((r) => {
        const who = r.self_perform === true ? "Self-perform" : r.self_perform === false ? `Sub: ${r.sub ?? "Needed"}` : "Self-perform or sub: Needed";
        const crew = r.self_perform === true ? `Crew: ${r.crew ?? "Needed"}` : null;
        const days = r.self_perform === true
          ? `Man-days: ${r.man_days == null ? "Needed" : `${r.man_days}${r.day_hours != null ? ` (${r.man_hours} man-hours at ${r.day_hours} hours in the reported day)` : ""}`}`
          : null;
        const mats = r.self_perform === true
          ? `Materials: ${r.materials.length ? r.materials.map((m) => `${m.item} ${m.remaining ?? m.qty ?? "Needed"}${m.unit ? ` ${m.unit}` : ""}`).join(", ") : "Needed"}`
          : null;
        const flag = r.delay ? "DELAY — " : "";
        const label = `${flag}${r.name || "Activity"}`;
        const href = withAnchor(links?.field, detailAnchor("activity", r.id));
        return `- ${mdLink(label, href)} · ${who}${crew ? ` · ${crew}` : ""}${days ? ` · ${days}` : ""}${mats ? ` · ${mats}` : ""}${r.pct_complete != null ? ` · ${r.pct_complete}%` : ""}`;
      })
    : ["- No activities in this lookahead yet."];
  const todayIso = today?.slice(0, 10) || "";
  const open = items.map((i, n) => {
    const due = i.due?.slice(0, 10) ?? "";
    const late = !!(due && todayIso && due < todayIso);
    const title = i.action?.trim() || "Item";
    const href = withAnchor(links?.items, detailAnchor("item", i.id || String(n + 1)));
    return `- ${mdLink(`${late ? "OVERDUE — " : ""}${title}`, href)}${i.owner ? ` · ${i.owner}` : ""}${due ? ` · due ${shortDate(due)}` : ""}`;
  });
  const dashboard = links?.field ? `Dashboard: ${mdLink("Open this job's field board", links.field)}` : null;
  const more = [
    links?.daily ? mdLink("Daily", links.daily) : null,
    links?.photos ? mdLink("Photos", links.photos) : null,
    links?.items ? mdLink("Open items", links.items) : null,
    links?.ior ? mdLink("IOR", links.ior) : null,
  ].filter(Boolean);
  return [
    "REQUIRED: Show this field board as one phone-width card. Navy, blue and gray. Red only on a delay or an overdue item.",
    `${jobLabel}Field board`,
    ...(dashboard ? [dashboard] : []),
    ...(more.length ? [`Also: ${more.join(" · ")}`] : []),
    `Lookahead: ${win}`,
    ...lines,
    ...(board.outside ? [`${board.outside} activities sit outside this lookahead.`] : []),
    ...(open.length ? ["Lookahead items:", ...open] : []),
  ].join("\n");
}

export function fieldBoardCard(jobLabel: string, board: ReturnType<typeof projectField>, items: { id?: string | null; action?: string; owner?: string | null; due?: string | null }[] = [], today?: string | null, links?: FieldLinks | null): CardModel {
  const todayIso = today?.slice(0, 10) || "";
  const activities: CardRow[] = board.rows.map((r) => {
    const who = r.self_perform === true ? "Self-perform" : r.self_perform === false ? r.sub || "Sub needed" : "Needed";
    return {
      cells: [`${r.delay ? "DELAY — " : ""}${r.name || "Activity"}`, who],
      href: withAnchor(links?.field, detailAnchor("activity", r.id)),
      refId: r.id,
      flag: r.delay ? "delay" : null,
    };
  });
  const open: CardRow[] = items.map((i, n) => {
    const due = i.due?.slice(0, 10) ?? "";
    const late = !!(due && todayIso && due < todayIso);
    return {
      cells: [i.action?.trim() || "Item", i.owner?.trim() || "Needed", due ? shortDate(due) : ""],
      href: withAnchor(links?.items, detailAnchor("item", i.id || String(n + 1))),
      refId: i.id ?? null,
      flag: late ? "overdue" : null,
    };
  });
  return {
    state: "result",
    title: "Field board",
    job: jobLabel.replace(/\s+$/, "") || null,
    sections: [
      { heading: "Crew", kind: "list", rows: activities },
      { heading: "Open items", kind: "list", rows: open },
    ],
    alerts: [
      ...board.rows.filter((r) => r.delay).map((r) => ({ level: "delay" as const, text: r.name || "Activity" })),
      ...open.filter((r) => r.flag === "overdue").map((r) => ({ level: "overdue" as const, text: r.cells[0] || "Item" })),
    ],
    next_move: links?.field ? "Open the dashboard for this job." : null,
  };
}

// ---------- photos ----------
export type PhotoGate = {
  ok: boolean;
  taken_on: string;
  questions: string[];
};

/** Host apps strip the camera date, so the date starts as the upload time until the superintendent confirms it. */
export function photoGate(input: {
  recognized?: boolean;
  date_confirmed?: boolean;
  confirmed?: boolean;
  uploaded_at: string;
  time_zone?: string | null;
  taken_on?: string | null;
  area?: string | null;
}): PhotoGate {
  const zone = input.time_zone?.trim() || DEFAULT_TZ;
  const uploaded = dateIn(input.uploaded_at, zone);
  const taken = text(input.taken_on)?.slice(0, 10) || uploaded;
  const questions: string[] = [];
  if (!input.recognized) questions.push("Is this a progress photo?");
  if (!input.date_confirmed) questions.push(`The date on this photo is ${shortDate(taken)}, which is when it was uploaded. The camera date isn't available. Is that the right date?`);
  if (!text(input.area)) questions.push("Where on site was this taken?");
  if (!input.confirmed) questions.push("Save this photo? Yes or no?");
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(taken);
  if (input.date_confirmed && !dateOk) questions.push("What date should this photo use? Use a calendar date.");
  return { ok: questions.length === 0 && dateOk, taken_on: dateOk ? taken : uploaded, questions };
}

const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export function sniffPhoto(bytes: Uint8Array, filename: string): { ext: "jpg" | "png" | "webp"; mime: string } | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext !== "jpg" && ext !== "jpeg" && ext !== "png" && ext !== "webp") return null;
  if (bytes.length < 12 || bytes.length > PHOTO_MAX_BYTES) return null;
  if ((ext === "jpg" || ext === "jpeg") && starts(bytes, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (ext === "png" && starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png", mime: "image/png" };
  if (ext === "webp" && starts(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return { ext: "webp", mime: "image/webp" };
  return null;
}

// ---------- mobile pages ----------
const shell = (title: string, body: string) =>
  `<div style="max-width:${FIELD_MOBILE_PX}px;margin:0 auto;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${FIELD_NAVY}"><h1 style="margin:0 0 12px;font-size:20px;color:${FIELD_NAVY}">${esc(title)}</h1>${body}<p style="margin:20px 0 0;font-size:12px;color:${FIELD_GRAY}">Private to your company · Athena powered by ALP</p></div>`;

const card = (inner: string, alert = false) =>
  `<section style="background:#fff;border:1px solid ${alert ? FIELD_RED : FIELD_LINE};border-left:4px solid ${alert ? FIELD_RED : FIELD_BLUE};border-radius:12px;padding:12px;margin:0 0 12px">${inner}</section>`;

const label = (t: string) => `<div style="font-size:12px;color:${FIELD_GRAY};margin-bottom:2px">${esc(t)}</div>`;
const value = (t: string, alert = false) => `<div style="font-size:15px;color:${alert ? FIELD_RED : FIELD_NAVY};font-weight:${alert ? 700 : 600}">${esc(t)}</div>`;

export function fieldPageHtml(src: FieldSource & { job_number?: string; job_name?: string; items?: { id?: string | null; action?: string; owner?: string | null; due?: string | null; type?: string | null; item_type?: string | null; kind?: string | null; category?: string | null; check_key?: string | null }[] }): string {
  const board = projectField(src);
  const title = pageJobTitle(src.job_number, src.job_name, "Field board");
  const win = board.window ? `${shortDate(board.window.start)} – ${shortDate(board.window.end)}` : "Lookahead needed";
  const rows = board.rows.map((r) => {
    const who = r.self_perform === true ? "Self-perform" : r.self_perform === false ? `Sub · ${r.sub ?? "Needed"}` : "Self-perform or sub needed";
    const extra = r.self_perform === true
      ? `<div style="font-size:13px;color:${FIELD_GRAY};margin-top:4px">Crew ${esc(r.crew ?? "Needed")} · Man-days ${esc(r.man_days ?? "Needed")}${r.man_hours != null ? ` · ${esc(r.man_hours)} man-hours` : ""}</div><div style="font-size:13px;color:${FIELD_NAVY};margin-top:4px">${esc(r.materials.length ? r.materials.map((m) => `${m.item} ${m.remaining ?? m.qty ?? "Needed"}${m.unit ? ` ${m.unit}` : ""}`).join(" · ") : "Materials needed")}</div>`
      : "";
    const anchor = detailAnchor("activity", r.id);
    return `<section id="${esc(anchor)}" data-id="${esc(r.id)}">${card(`${r.delay ? `<div style="color:${FIELD_RED};font-size:12px;font-weight:700">DELAY</div>` : ""}<div style="font-weight:700;color:${r.delay ? FIELD_RED : FIELD_NAVY}"><a href="#${esc(anchor)}" style="color:inherit;text-decoration:none">${esc(r.name || "Activity")}</a></div><div style="font-size:11px;color:${FIELD_GRAY}">${esc(r.id)}</div><div style="font-size:13px;color:${FIELD_BLUE};margin-top:4px">${esc(who)}</div>${extra}`, r.delay)}</section>`;
  }).join("");
  const today = src.today?.slice(0, 10) || "";
  const items = dedupeOpenRows((src.items ?? []).map((i, n) => ({
    id: i.id || String(n + 1),
    action: i.action || "Item",
    owner: i.owner,
    due: i.due,
    type: i.type,
    item_type: i.item_type,
    kind: i.kind,
    category: i.category,
    check_key: i.check_key,
  }))).map((i, n) => {
    const due = i.due?.slice(0, 10) ?? "";
    const late = !!(due && today && due < today);
    const notice = isDelayNoticeTask(i);
    const alert = late || notice;
    const anchor = detailAnchor("item", i.id || String(n + 1));
    return `<section id="${esc(anchor)}"${i.id ? ` data-id="${esc(i.id)}"` : ""}>${card(`${label(late ? "Overdue" : notice ? "Delay" : "Lookahead")}${value(itemName(i.action || "Item"), alert)}<div style="font-size:12px;color:${alert ? FIELD_RED : FIELD_GRAY}">${esc(i.owner ?? "Needed")}${due ? ` · ${esc(shortDate(due))}` : ""}</div>`, alert)}</section>`;
  }).join("");
  const allItems = `<p style="margin:4px 0 12px"><a href="../items" style="color:${FIELD_BLUE};font-weight:700;text-decoration:none">View all open items</a></p>`;
  return shell(`${title} · Field`, `<p style="margin:0 0 12px;color:${FIELD_GRAY};font-size:13px">Lookahead ${esc(win)}</p>${rows || card(`${value("No activities in this lookahead yet.")}`)}${items}${allItems}`);
}

// Owner-approved display cleanup for two saved training reports only. The native
// payload uses the unique (job_id, report_date) key; retain the saved IDs here for
// traceability. Stored text, transcripts, audit and production rows stay intact.
const CEDAR_DAILY_PRESENTATION_JOB = "289ca2cd-b585-419a-8c09-3501d1be48c3";
const CEDAR_DAILY_PRESENTATION_REPORTS: Readonly<Record<string, string>> = {
  "2026-10-26": "05b33d1c-9cf4-4af4-a9b1-4bc7b01474e6",
  "2026-10-27": "b15d97e1-afea-4622-a040-1278825e0dda",
};

function dailyReportHeading(day?: string | null): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Daily Report";
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return "Daily Report";
  return `Daily Report for ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)}`;
}

export function dailyPageHtml(p: {
  job_number?: string;
  job_name?: string;
  found?: boolean;
  report_date?: string | null;
  weather?: string | null;
  manpower?: string | null;
  subs_on_site?: string | null;
  work?: { work?: string; sov_item?: string | null; activity_id?: string | null; qty?: number | null; unit?: string | null; crew?: number | null; hours?: number | null }[];
  deliveries?: string | null;
  issues?: string | null;
  delays?: string | null;
  safety?: string | null;
  lines?: { work?: string; sov_item?: string | null; activity_id?: string | null; qty?: number | null; unit?: string | null; crew?: number | null; hours?: number | null }[];
}, context?: { jobId?: string }): string {
  const title = pageJobTitle(p.job_number, p.job_name, "Daily");
  if (!p.found) return shell(`${title} · Daily`, card(`${value("No daily is saved for this job yet.")}`));
  const cleanTrainingPrefix = context?.jobId === CEDAR_DAILY_PRESENTATION_JOB
    && !!p.report_date && Object.hasOwn(CEDAR_DAILY_PRESENTATION_REPORTS, p.report_date);
  const displayText = (text: string | null | undefined) => cleanTrainingPrefix
    ? text?.replace(/^FICTIONAL DEMO:\s*/, "")
    : text;
  const delay = isRecordedDelay(p.delays);
  const block = (k: string, v: string | null | undefined, alert = false) => card(`${label(k)}${value(displayText(v)?.trim() || "Needed", alert)}`, alert);
  const work = (p.work ?? p.lines ?? []).map((w, n) => {
    const anchor = detailAnchor("line", w.activity_id || String(n + 1));
    const facts = [w.qty != null ? `${w.qty} ${w.unit ?? ""}` : "", w.crew != null ? `crew ${w.crew}` : "", w.hours != null ? `${w.hours} hours` : ""].filter(Boolean).join(" · ");
    return `<section id="${esc(anchor)}"${w.activity_id ? ` data-id="${esc(w.activity_id)}"` : ""}>${card(`${value(displayText(w.work) || "Work")}${facts ? `<div style="font-size:13px;color:${FIELD_GRAY};margin-top:4px">${esc(facts)}</div>` : ""}${w.activity_id ? `<div style="font-size:11px;color:${FIELD_GRAY}">${esc(w.activity_id)}</div>` : ""}`)}</section>`;
  }).join("");
  return shell(title, [
    `<h2 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:700;color:${FIELD_NAVY}">${esc(dailyReportHeading(p.report_date))}</h2>`,
    block("Weather", p.weather),
    block("Manpower", p.manpower),
    block("Subs on site", p.subs_on_site),
    work || card(`${label("Work performed")}${value("Needed")}`),
    block("Deliveries", p.deliveries),
    block("Issues", p.issues),
    block("Delays", p.delays, delay),
    block("Safety", p.safety),
  ].join(""));
}

export function photoPageHtml(p: {
  job_number?: string;
  job_name?: string;
  photos?: { id?: string | null; taken_on?: string; area?: string; work?: string | null; sov_item?: string | null; activity_id?: string | null; client_safe?: boolean; url?: string | null }[];
}): string {
  const title = pageJobTitle(p.job_number, p.job_name, "Photos");
  const photos = p.photos ?? [];
  if (!photos.length) return shell(`${title} · Photos`, card(`${value("No progress photos in this view.")}`));
  const body = photos.map((ph, n) => {
    const img = ph.url ? `<img alt="${esc(ph.area || "Progress photo")}" src="${esc(ph.url)}" style="width:100%;border-radius:8px;margin-bottom:8px"/>` : "";
    const tags = [ph.work, ph.client_safe ? "Client-safe" : "Internal"].filter(Boolean).join(" · ");
    const anchor = detailAnchor("photo", ph.id || String(n + 1));
    return `<section id="${esc(anchor)}"${ph.id ? ` data-id="${esc(ph.id)}"` : ""}>${card(`${img}${label(ph.taken_on ? shortDate(ph.taken_on) : "Date needed")}${value(ph.area || "Place needed")}<div style="font-size:13px;color:${FIELD_GRAY};margin-top:4px">${esc(tags)}</div>`)}</section>`;
  }).join("");
  return shell(`${title} · Photos`, body);
}
