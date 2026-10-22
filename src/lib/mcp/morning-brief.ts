// Per-user morning brief. Counts come from the same dedupe as open items.
// Red is only for delays, risks, and overdue items. Nothing here sends mail or push.
import { addDays, DEFAULT_TZ, diffDays, todayIn } from "./deadlines";
import { clockLabel, parseSendTime } from "./field-reminder";
import { countOpenItems, dedupeOpenRows, dueOf, isOverdue, itemName, openItemFeed, type FeedRow } from "./open-feed";
import { activityLine, itemLabel, lookaheadModel, shortDate, type LaItem, type SAct } from "./styled-views";
import type { BoardPage } from "./board-link";
import { htmlBlock, renderMarkdown } from "./cards/markdown";
import { renderHtml } from "./cards/html";
import { CARD_WIDGET_URI, cardWidgetMeta } from "./cards/widget";
import { applyCardClosing } from "./cards/silence";
import { guide } from "./visible";
import type { CardModel, CardRow } from "./cards/model";
import { normalizeRole, type TeamRole } from "./team";

export const MORNING_BRIEF_DEFAULT_TIME = "06:30";
export const MORNING_BRIEF_DEFAULTS = {
  enabled: true,
  send_local: MORNING_BRIEF_DEFAULT_TIME,
  time_zone: DEFAULT_TZ,
} as const;

export type BriefSettings = { enabled: boolean; send_local: string; time_zone: string };
export type BriefScope = "full" | "contract" | "super";
export type BriefSeat = TeamRole;
export type BriefView = "pm" | "superintendent" | "accounting" | "executive" | "contract";
export type BriefKind =
  | "rfi"
  | "submittal"
  | "change"
  | "confirmation"
  | "inspection"
  | "meeting"
  | "daily"
  | "payapp"
  | "invoice"
  | "ior"
  | "delay"
  | "risk"
  | "other";

export type BriefActivity = {
  id: string;
  name: string;
  description?: string | null;
  start?: string | null;
  finish?: string | null;
  duration?: number | null;
  total_float?: number | null;
  critical?: boolean | null;
};

export type BriefItem = FeedRow & {
  category?: string | null;
  item_type?: string | null;
  kind?: string | null;
  internal_only?: boolean | null;
  cost_effect?: number | null;
};

export type BriefPay = { label: string; due?: string | null; amount?: number | null };

export type BriefJob = {
  job_id: string;
  job_number: string;
  name: string;
  company_id: string;
  company_name?: string;
  time_zone: string;
  scope: BriefScope;
  seat: BriefSeat;
  activities: BriefActivity[];
  items: BriefItem[];
  lookahead: { start: string; end: string } | null;
  payApps: BriefPay[];
  invoices: BriefPay[];
  dailyToday?: boolean;
  links: Partial<Record<BoardPage, string>>;
};

export type BriefCounts = { open: number; overdue: number; due_in_7_days: number; today: number };

export type BuiltBrief = {
  card: CardModel;
  counts: BriefCounts;
  openItems: BriefItem[];
  todayCount: number;
};

const OPEN_KINDS: BriefKind[] = ["rfi", "submittal", "change", "confirmation", "inspection", "ior", "delay", "risk", "invoice", "payapp"];

export function parseBriefingTime(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const spoken = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(s);
  if (spoken) {
    let hour = Number(spoken[1]);
    const minute = Number(spoken[2] ?? "0");
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (spoken[3] === "pm" && hour !== 12) hour += 12;
    if (spoken[3] === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const clock = /^(\d{2}):(\d{2})$/.exec(s);
  if (!clock) return null;
  return parseSendTime(clock[0]) == null ? null : `${clock[1]}:${clock[2]}`;
}

export function briefSettingsFrom(row: Partial<BriefSettings> | null | undefined): BriefSettings {
  const send = row?.send_local && parseSendTime(row.send_local.slice(0, 5)) != null ? row.send_local.slice(0, 5) : MORNING_BRIEF_DEFAULT_TIME;
  const zone = row?.time_zone?.trim() || DEFAULT_TZ;
  try {
    todayIn(zone);
  } catch {
    return { enabled: row?.enabled !== false, send_local: send, time_zone: DEFAULT_TZ };
  }
  return { enabled: row?.enabled !== false, send_local: send, time_zone: zone };
}

export function settingsLine(settings: BriefSettings): string {
  const state = settings.enabled ? "on" : "off";
  return `Morning briefing is ${state} at ${clockLabel(settings.send_local)} in ${settings.time_zone}. Nothing is sent.`;
}

export function settingsCard(settings: BriefSettings): CardModel {
  return {
    state: "result",
    title: "Morning briefing",
    job: settingsLine(settings),
    sections: [
      { heading: "Time", kind: "list", rows: [{ cells: [clockLabel(settings.send_local)] }] },
      { heading: "Time zone", kind: "list", rows: [{ cells: [settings.time_zone] }] },
      { heading: "Delivery", kind: "list", rows: [{ cells: [settings.enabled ? "On" : "Off"] }, { cells: ["Nothing is sent."] }] },
    ],
    next_move: "Nothing is sent.",
  };
}

export function classifyItem(it: { action: string; check_key?: string | null; category?: string | null; item_type?: string | null; kind?: string | null }): BriefKind {
  const key = (it.check_key ?? "").toLowerCase();
  if (key === "pm:billing" || key.startsWith("pm:billing")) return "payapp";
  if (key.startsWith("pm:")) return "confirmation";
  const blob = `${it.action} ${it.category ?? ""} ${it.item_type ?? ""} ${it.kind ?? ""}`.toLowerCase();
  if (/pay app|payapp|application for payment/.test(blob)) return "payapp";
  if (/invoice/.test(blob)) return "invoice";
  if (/\bior\b|items of record/.test(blob)) return "ior";
  if (/\brfi\b/.test(blob)) return "rfi";
  if (/submittal/.test(blob)) return "submittal";
  if (/change order|\bco[- ]?\d/.test(blob)) return "change";
  if (/inspect/.test(blob)) return "inspection";
  if (/\bmeeting\b/.test(blob)) return "meeting";
  if (/daily/.test(blob)) return "daily";
  if (/delay/.test(blob)) return "delay";
  if (/claim/.test(blob)) return "risk";
  if (/risk/.test(blob)) return "risk";
  return "other";
}

export function briefView(seat: string, scope: string): BriefView {
  const role = normalizeRole(seat);
  if (scope === "super" || role === "super") return "superintendent";
  if (role === "owner") return "executive";
  if (role === "ap") return "accounting";
  if (role === "estimating" || role === "contracts" || scope === "contract") return "contract";
  return "pm";
}

export function jobToday(timeZone: string, now: Date): string {
  try {
    return todayIn(timeZone || DEFAULT_TZ, now);
  } catch {
    return todayIn(DEFAULT_TZ, now);
  }
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function jobLabel(job: BriefJob): string {
  const base = `${job.job_number} ${job.name}`.trim();
  return job.company_name ? `${job.company_name} · ${base}` : base;
}

/** One section per company, in name order, when the brief covers more than one company. */
export function companyGroupSections(jobs: BriefJob[]): NonNullable<CardModel["sections"]> {
  const ids = new Set(jobs.map((job) => job.company_id).filter(Boolean));
  if (ids.size < 2) return [];
  const groups = new Map<string, BriefJob[]>();
  for (const job of jobs) {
    const name = job.company_name?.trim() || "Company";
    const list = groups.get(name) ?? [];
    list.push(job);
    groups.set(name, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, list]) => ({
      heading: name,
      kind: "list" as const,
      rows: list.map((job) => ({ cells: [`${job.job_number} ${job.name}`.trim()] })),
    }));
}

function allowedLinks(view: BriefView, links: BriefJob["links"]): BriefJob["links"] {
  const out = { ...links };
  if (view === "superintendent" || view === "contract") {
    delete out.ior;
    delete out.payapp;
  }
  if (view === "accounting") {
    delete out.ior;
    delete out.field;
    delete out.daily;
    delete out.photos;
  }
  return out;
}

function hrefFor(view: BriefView, links: BriefJob["links"], page: BoardPage): string | null {
  const safe = allowedLinks(view, links);
  if ((page === "ior" || page === "payapp") && (view === "superintendent" || view === "contract")) return null;
  return safe[page] ?? safe.items ?? safe.field ?? safe.schedule ?? null;
}

function itemVisible(view: BriefView, it: BriefItem): boolean {
  if (it.internal_only && view !== "pm" && view !== "executive") return false;
  const kind = classifyItem(it);
  if (view === "pm" || view === "executive") return true;
  if (view === "superintendent") {
    if (kind === "ior" || kind === "payapp" || kind === "invoice" || kind === "change" || kind === "confirmation") return false;
    return true;
  }
  if (view === "accounting") return kind === "payapp" || kind === "invoice" || kind === "change" || (kind === "confirmation" && /billing|pay/.test(`${it.check_key ?? ""} ${it.action}`));
  return kind === "rfi" || kind === "submittal" || kind === "change";
}

function inOpenList(view: BriefView, it: BriefItem): boolean {
  if (!itemVisible(view, it)) return false;
  if (view === "executive") return false;
  const kind = classifyItem(it);
  if (view === "superintendent") return kind === "rfi" || kind === "submittal" || kind === "inspection" || kind === "daily" || kind === "delay" || kind === "risk" || kind === "meeting";
  if (view === "accounting") return kind === "payapp" || kind === "invoice" || kind === "change" || kind === "confirmation";
  if (view === "contract") return kind === "rfi" || kind === "submittal" || kind === "change";
  return OPEN_KINDS.includes(kind) || kind === "meeting" || kind === "daily" || kind === "other";
}

function rowFlag(it: BriefItem, today: string): CardRow["flag"] {
  if (isOverdue(it, today)) return "overdue";
  const kind = classifyItem(it);
  if (kind === "delay") return "delay";
  if (kind === "risk") return "risk";
  return null;
}

function detail(it: BriefItem, view: BriefView): string {
  const name = itemName(it.action);
  const who = it.accountable ?? it.owner;
  const due = dueOf(it);
  const bits = [name];
  if (who) bits.push(who);
  if (due) bits.push(shortDate(due));
  if (view !== "superintendent" && view !== "contract" && it.cost_effect != null) bits.push(money(it.cost_effect));
  return bits.join(" · ");
}

function urgentRank(it: BriefItem, today: string): number {
  const due = dueOf(it);
  if (!due) return 10_000;
  return diffDays(due, today);
}

function deduped(items: BriefItem[]): BriefItem[] {
  return dedupeOpenRows(items);
}

function actsOf(job: BriefJob): SAct[] {
  return job.activities.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    start: a.start,
    finish: a.finish,
    duration: a.duration,
    total_float: a.total_float,
    critical: a.critical,
  }));
}

function firstJobCard(hasCompany: boolean): CardModel {
  if (!hasCompany) {
    return {
      state: "ask",
      title: "Let's set up your company",
      ask: { prompt: "What is the company name?" },
      sections: [{ heading: "Why", kind: "list", rows: [{ cells: ["Jobs belong to a company. The company name is the first save."] }] }],
      next_move: "Send the company name.",
    };
  }
  return {
    state: "ask",
    title: "Let's set up your first job",
    ask: { prompt: "What is the job number, and what should we call the job?" },
    sections: [{ heading: "Why", kind: "list", rows: [{ cells: ["The job number is required. The morning brief and the boards start from that job."] }] }],
    next_move: "Send the job number and the name.",
  };
}

type Tagged = { job: BriefJob; item: BriefItem; today: string };

function collect(jobs: BriefJob[], now: Date, viewOf: (job: BriefJob) => BriefView): Tagged[] {
  const out: Tagged[] = [];
  for (const job of jobs) {
    const today = jobToday(job.time_zone, now);
    const view = viewOf(job);
    for (const item of deduped(job.items.filter((it) => itemVisible(view, it)))) out.push({ job, item, today });
  }
  return out;
}

function todayRows(jobs: BriefJob[], now: Date, viewOf: (job: BriefJob) => BriefView): CardRow[] {
  const rows: CardRow[] = [];
  for (const job of jobs) {
    const today = jobToday(job.time_zone, now);
    const view = viewOf(job);
    const links = allowedLinks(view, job.links);
    const label = jobLabel(job);
    for (const act of job.activities) {
      const start = act.start?.slice(0, 10);
      const finish = act.finish?.slice(0, 10);
      if (start !== today && finish !== today) continue;
      const inspection = /inspect/i.test(act.name);
      const meeting = /\bmeeting\b/i.test(act.name);
      if (view === "accounting" && !/pay app|payapp/i.test(act.name)) continue;
      if (view === "contract") continue;
      if (view === "superintendent" && /pay app|payapp|\bior\b/i.test(act.name)) continue;
      const when = start === today && finish === today ? "today" : start === today ? "starts today" : "due today";
      const kind = inspection ? "Inspection" : meeting ? "Meeting" : "Schedule";
      const page: BoardPage = view === "superintendent" ? (inspection ? "schedule" : "field") : "schedule";
      rows.push({ cells: [label, `${kind}: ${activityLine(act)} ${when}`], href: hrefFor(view, links, page) });
    }
    for (const item of deduped(job.items.filter((it) => itemVisible(view, it)))) {
      if (dueOf(item) !== today) continue;
      const kind = classifyItem(item);
      if (kind !== "meeting" && kind !== "inspection" && kind !== "payapp") continue;
      if (view === "superintendent" && kind === "payapp") continue;
      if (view === "accounting" && kind !== "payapp") continue;
      const page: BoardPage = kind === "payapp" ? "payapp" : kind === "inspection" ? "schedule" : "items";
      rows.push({ cells: [label, detail(item, view)], href: hrefFor(view, links, page), flag: rowFlag(item, today) });
    }
    if ((view === "pm" || view === "superintendent") && job.dailyToday === false) {
      rows.push({ cells: [label, "Daily isn't in yet"], href: hrefFor(view, links, "daily") });
    }
    if (view !== "superintendent" && view !== "contract") {
      for (const pay of job.payApps) {
        if (pay.due?.slice(0, 10) !== today) continue;
        const amount = pay.amount != null ? ` · ${money(pay.amount)}` : "";
        rows.push({ cells: [label, `${pay.label}${amount}`], href: hrefFor(view, links, "payapp") });
      }
    }
  }
  return rows;
}

function weekRows(jobs: BriefJob[], now: Date, viewOf: (job: BriefJob) => BriefView): CardRow[] {
  const rows: CardRow[] = [];
  for (const job of jobs) {
    const today = jobToday(job.time_zone, now);
    const view = viewOf(job);
    if (view === "accounting") continue;
    const end = job.lookahead?.end ?? addDays(today, 6);
    const start = job.lookahead?.start ?? today;
    if (start > end) continue;
    const visible = deduped(job.items.filter((it) => itemVisible(view, it))).filter((it) => {
      const due = dueOf(it);
      return !due || due <= end;
    });
    const laItems: LaItem[] = visible.map((it) => ({ id: it.id, action: it.action, owner: it.accountable ?? it.owner, due: dueOf(it) || null }));
    const model = lookaheadModel(start, end, actsOf(job), laItems, { today });
    for (const entry of model.top) {
      const source = visible.find((it) => it.id === entry.item.id) ?? visible.find((it) => it.action === entry.item.action);
      const flag = entry.overdue ? "overdue" : source ? rowFlag(source, today) : null;
      rows.push({
        cells: [jobLabel(job), itemLabel(entry.label)],
        href: hrefFor(view, job.links, view === "superintendent" ? "schedule" : "lookahead"),
        flag,
      });
    }
  }
  return rows;
}

function openFor(jobs: BriefJob[], now: Date, viewOf: (job: BriefJob) => BriefView): { rows: CardRow[]; items: BriefItem[]; counts: { open: number; overdue: number; due_in_7_days: number } } {
  const rows: CardRow[] = [];
  const items: BriefItem[] = [];
  let open = 0;
  let overdue = 0;
  let dueIn7 = 0;
  for (const job of jobs) {
    const today = jobToday(job.time_zone, now);
    const view = viewOf(job);
    const feed = openItemFeed(job.items.filter((it) => inOpenList(view, it)), today);
    const mine = feed.items;
    const counts = feed.counts;
    open += counts.open;
    overdue += counts.overdue;
    dueIn7 += counts.due_in_7_days;
    for (const it of mine) {
      items.push(it);
      const kind = classifyItem(it);
      const page: BoardPage = kind === "payapp" || kind === "invoice" ? "payapp" : kind === "ior" ? "ior" : kind === "inspection" ? "schedule" : "items";
      rows.push({ cells: [jobLabel(job), detail(it, view)], href: hrefFor(view, job.links, page), flag: rowFlag(it, today) });
    }
  }
  return { rows, items, counts: { open, overdue, due_in_7_days: dueIn7 } };
}

function forgetRows(tagged: Tagged[], viewOf: (job: BriefJob) => BriefView): CardRow[] {
  const pool = tagged.filter((t) => (viewOf(t.job) === "executive" ? true : inOpenList(viewOf(t.job), t.item)) && itemVisible(viewOf(t.job), t.item));
  const ranked = [...pool].sort((a, b) => urgentRank(a.item, a.today) - urgentRank(b.item, b.today) || itemName(a.item.action).localeCompare(itemName(b.item.action)));
  const seen = new Set<string>();
  const rows: CardRow[] = [];
  for (const t of ranked) {
    if (seen.has(t.item.id)) continue;
    seen.add(t.item.id);
    const view = viewOf(t.job);
    rows.push({
      cells: [jobLabel(t.job), detail(t.item, view)],
      href: hrefFor(view, t.job.links, view === "superintendent" ? "field" : view === "accounting" ? "payapp" : "items"),
      flag: rowFlag(t.item, t.today),
    });
    if (rows.length === 3) break;
  }
  return rows;
}

function portfolio(jobs: BriefJob[], tagged: Tagged[], now: Date): { rows: CardRow[]; overdue: number; open: number } {
  const byJob = new Map<string, Tagged[]>();
  for (const t of tagged) {
    const list = byJob.get(t.job.job_id) ?? [];
    list.push(t);
    byJob.set(t.job.job_id, list);
  }
  let overdue = 0;
  let open = 0;
  const rows: CardRow[] = [];
  for (const job of jobs) {
    const today = jobToday(job.time_zone, now);
    const items = deduped((byJob.get(job.job_id) ?? []).map((t) => t.item));
    const counts = countOpenItems(items, today);
    overdue += counts.overdue;
    open += counts.open;
    const billed = job.payApps.find((p) => p.amount != null)?.amount;
    const moneyBit = billed != null ? ` · Billed ${money(billed)}` : "";
    rows.push({
      cells: [jobLabel(job), `${counts.overdue} overdue · ${counts.open} open${moneyBit}`],
      href: hrefFor("executive", job.links, "schedule"),
      flag: counts.overdue ? "overdue" : null,
    });
  }
  return { rows, overdue, open };
}

function inboxSection(): NonNullable<CardModel["sections"]>[number] {
  return {
    heading: "From your inbox and calendar",
    kind: "list",
    rows: [
      { cells: ["Emails that came in overnight."], tone: "unknown" },
      { cells: ["Unanswered emails that need a reply."], tone: "unknown" },
      { cells: ["Today's meetings."], tone: "unknown" },
    ],
  };
}

export function buildMorningBrief(input: { jobs: BriefJob[]; hasCompany: boolean; settings?: BriefSettings; now?: Date }): BuiltBrief {
  const now = input.now ?? new Date();
  const settings = input.settings ?? { ...MORNING_BRIEF_DEFAULTS };
  if (!input.jobs.length) {
    const card = firstJobCard(input.hasCompany);
    card.sections = [inboxSection(), ...(card.sections ?? [])];
    return { card, counts: { open: 0, overdue: 0, due_in_7_days: 0, today: 0 }, openItems: [], todayCount: 0 };
  }
  const multi = new Set(input.jobs.map((job) => job.company_id)).size > 1;
  const jobs = input.jobs.map((job) => (multi ? { ...job, company_name: job.company_name?.trim() || "Company" } : { ...job, company_name: undefined }));
  const viewOf = (job: BriefJob) => briefView(job.seat, job.scope);
  const same = viewOf(jobs[0]);
  const uniform = jobs.every((job) => viewOf(job) === same);
  const view = uniform ? same : "pm";
  const headerToday = jobToday(settings.time_zone, now);
  const tagged = collect(jobs, now, viewOf);
  const today = todayRows(jobs, now, viewOf);
  const week = weekRows(jobs, now, viewOf);
  const opened = openFor(jobs, now, viewOf);
  const forget = forgetRows(tagged, viewOf);
  const groups = companyGroupSections(jobs);
  const countsForOpen = {
    open: opened.rows.length,
    overdue: opened.rows.filter((row) => row.flag === "overdue").length,
    due_in_7_days: opened.counts.due_in_7_days,
  };
  const sections: CardModel["sections"] = [inboxSection(), ...groups];
  if (view === "executive") {
    const port = portfolio(jobs, tagged, now);
      sections.push({ heading: "Portfolio", kind: "list", rows: [{ cells: [`${jobs.length} jobs · ${port.open} open · ${port.overdue} overdue`] }] });
    sections.push({ heading: "Jobs", kind: "list", rows: port.rows });
    if (forget.length) sections.push({ heading: "Don't forget", kind: "list", rows: forget });
    const card: CardModel = {
      state: "result",
      title: "Morning brief",
      job: shortDate(headerToday),
      kpis: [
        { label: "Jobs", value: String(jobs.length) },
        { label: "Open", value: String(port.open) },
        { label: "Overdue", value: String(port.overdue), flag: port.overdue ? "overdue" : null },
      ],
      sections,
      alerts: port.overdue ? [{ level: "overdue", text: `${port.overdue} items` }] : [],
      next_move: port.overdue ? "Clear the overdue item first." : "Review the portfolio.",
    };
    return { card, counts: { open: port.open, overdue: port.overdue, due_in_7_days: 0, today: today.length }, openItems: tagged.map((t) => t.item), todayCount: today.length };
  }
  if (today.length) sections.push({ heading: "Today", kind: "list", rows: today });
  if (week.length) sections.push({ heading: "This week", kind: "list", rows: week });
  if (opened.rows.length) sections.push({ heading: "Open items", kind: "list", rows: opened.rows });
  if (forget.length) sections.push({ heading: "Don't forget", kind: "list", rows: forget });
  if (!opened.rows.length && jobs.length) {
    sections.push({
      heading: "Jobs",
      kind: "list",
      rows: jobs.map((job) => ({ cells: [jobLabel(job)], href: hrefFor(viewOf(job), job.links, view === "superintendent" ? "field" : view === "accounting" ? "payapp" : "items") })),
    });
  }
  const overdue = countsForOpen.overdue;
  const card: CardModel = {
    state: "result",
    title: "Morning brief",
    job: shortDate(headerToday),
    kpis: [
      { label: "Jobs", value: String(jobs.length) },
      { label: "Due today", value: String(today.length) },
      { label: "Open", value: String(countsForOpen.open) },
      { label: "Overdue", value: String(overdue), flag: overdue ? "overdue" : null },
    ],
    sections,
    alerts: overdue ? [{ level: "overdue", text: `${overdue} items` }] : [],
    next_move: overdue ? "Clear the overdue item first." : today.length ? "Start with what is due today." : "Nothing urgent. Review this week.",
  };
  return { card, counts: { ...countsForOpen, today: today.length }, openItems: opened.items, todayCount: today.length };
}

const WORK_HEADINGS = new Set(["Today", "This week", "Open items", "Don't forget", "Portfolio", "Chases"]);

export function ensureBriefCard(card: CardModel): CardModel {
  const sections = card.sections ?? [];
  const hasWork = sections.some((section) => WORK_HEADINGS.has(section.heading) && section.rows.length);
  const next = card.next_move?.trim() || "Name the job, or say let's get started.";
  if (hasWork && sections.some((section) => section.heading === "Next move")) return { ...card, next_move: next };
  if (hasWork) return { ...card, next_move: next };
  if (sections.some((section) => section.heading === "Next move")) return { ...card, next_move: next };
  return {
    ...card,
    sections: [
      ...sections,
      { heading: "Next move", kind: "list", rows: [{ cells: ["Nothing on the list yet, here's my next move."] }] },
    ],
    next_move: next,
  };
}

export function presentBrief(card: CardModel) {
  card = ensureBriefCard(card);
  const html = renderHtml(card);
  const body = applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false);
  return guide(
    {
      structuredContent: { card, html, "openai/outputTemplate": CARD_WIDGET_URI },
      _meta: { ...cardWidgetMeta },
      content: [{ type: "text" as const, text: body, _meta: { ...cardWidgetMeta } }],
    },
    "Fill the three rows under From your inbox and calendar from the member's mail and calendar: emails that came in overnight, unanswered emails that need a reply, and today's meetings. Keep the job sections after that: schedule, notices, submittals due, overdue items, and what happened yesterday versus what is due today. Do not add text after the card.",
  );
}
