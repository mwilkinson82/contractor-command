// The PM morning brief (Nov 5 redesign). One brief for every seat, in Marshall's order:
// 1 yesterday, 2 today and this week (lookahead, buyout, long lead), 3 risks,
// 4 change orders, mail and open items, 5 money, other jobs, then "What don't I know yet?".
// Pure: the loader passes the facts in. Nothing here sends, saves or reads the database.
import { addDays, diffDays } from "./deadlines";
import { clockLabel } from "./field-reminder";
import { dedupeOpenRows, dueOf, isOverdue, itemName, openItemFeed } from "./open-feed";
import type { CardModel, CardRow, CardSection } from "./cards/model";
import type { ChaseRow } from "./submittal-chase";
import { openSubmittals, type FocusAct, type FocusData } from "./morning-brief-focus";
import {
  briefView,
  classifyItem,
  INBOX_PLACEHOLDER,
  INBOX_SECTION,
  jobTitle,
  jobToday,
  MORNING_BRIEF_DEFAULTS,
  TODAY_BOARD_LABEL,
  todayBoardUrl,
  type BriefJob,
  type BriefSettings,
  type BriefView,
} from "./morning-brief";

// ---------- document model ----------
export type BriefButton = { label: string; prompt: string; kind?: "primary" | "secondary" | "quiet" };
export type BriefTone = "bad" | "note" | null;
export type BriefRow = {
  title: string;
  detail?: string | null;
  tone?: BriefTone;
  href?: string | null;
  buttons?: BriefButton[];
  /** Small toggles shown as chips (Manpower, Material). Each one asks Athena to record it. */
  checks?: BriefButton[];
  /** Done / Partly / Didn't happen. */
  choices?: BriefButton[];
};
export type GanttAct = { id: string; name: string; start: string; finish: string; pct: number; critical: boolean; party: "sub" | "self" | null; meta: string; tag: string };
export type BriefBlock =
  | { type: "rows"; rows: BriefRow[] }
  | { type: "table"; columns: string[]; right?: number[]; rows: { cells: string[]; tone?: BriefTone; pill?: { col: number; text: string; tone: BriefTone } }[] }
  | { type: "kpis"; items: { label: string; value: string; note?: string; unknown?: boolean }[] }
  | { type: "bars"; items: { label: string; pct: number }[] }
  | { type: "gantt"; start: string; acts: GanttAct[] }
  | { type: "callouts"; items: { title: string; text: string; tone: BriefTone; buttons: BriefButton[] }[] }
  | { type: "inbox"; heading: string; placeholder: string }
  | { type: "text"; text: string; strong?: boolean }
  | { type: "actions"; buttons: BriefButton[] }
  | { type: "jobs"; rows: { title: string; sub: string; pill: string; tone: BriefTone; href?: string | null; prompt: string }[] }
  | { type: "tell"; heading: string; text: string; chips: BriefButton[] };
export type BriefSectionDoc = { step?: number; heading: string; meta?: string; blocks: BriefBlock[] };
export type BriefDoc = {
  greeting: string;
  when: string;
  badge?: string | null;
  /** The member's own day, even when the brief reads a stale schedule as of an earlier day. The email leads with it. */
  sentDay?: string | null;
  /** The focus job's schedule data date, as "Oct 25". */
  scheduleUpdated?: string | null;
  finish?: { contract: string; forecast: string; variance: string; late: boolean } | null;
  moves?: { title: string; heading: string; items: { lead: string; rest: string }[] } | null;
  sections: BriefSectionDoc[];
  footer: string;
  board?: { label: string; href: string } | null;
};

export type PmBriefInput = {
  jobs: BriefJob[];
  focus: Map<string, FocusData>;
  settings?: BriefSettings;
  now?: Date;
  firstName?: string | null;
  chases?: ChaseRow[];
  notices?: CardSection | null;
};

// ---------- small helpers ----------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const md = (d: string) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const dmd = (d: string) => `${DOW3[dow(d)]} ${md(d)}`;
const longDay = (d: string) => `${DOW[dow(d)]}, ${MON[+d.slice(5, 7) - 1].replace("May", "May")} ${+d.slice(8, 10)}`;
export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SUBMITTAL_STATUS_WORDS: Record<string, string> = {
  not_started: "Not started",
  in_prep: "In prep",
  submitted: "Submitted",
  in_review: "In review",
  revise_and_resubmit: "Revise and resubmit",
  rejected: "Rejected",
};
const BALL_WORDS: Record<string, string> = { sub: "Sub", gc: "GC", architect_engineer: "Architect or engineer", owner: "Owner" };
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Working days from a to b (b later), on the schedule's calendar. Mask bit 1<<day, Sunday = 0. */
export function workDaysBetween(a: string, b: string, mask: number | null): number {
  const bits = mask && mask > 0 ? mask : 0b0111110;
  let n = 0;
  for (let d = addDays(a, 1); d <= b; d = addDays(d, 1)) if (bits & (1 << dow(d))) n += 1;
  return n;
}

function previousWorkDay(d: string, mask: number | null): string {
  const bits = mask && mask > 0 ? mask : 0b0111110;
  let x = addDays(d, -1);
  for (let i = 0; i < 7 && !(bits & (1 << dow(x))); i += 1) x = addDays(x, -1);
  return x;
}

const remainingOf = (a: FocusAct) => !a.actual_finish && a.pct < 100;
const workingOn = (a: FocusAct, d: string) => !a.milestone && remainingOf(a) && !!a.start && !!a.finish && a.start <= d && a.finish >= d;
// With no responsible party coded on the activity, name none rather than guess "Crew".
const who = (a: FocusAct): string | null => (a.party === "self" ? "Self-perform" : a.subco ?? (a.party === "sub" ? "Subcontractor" : null));
const floatText = (a: FocusAct) => (a.critical ? "critical path" : a.total_float != null ? `${a.total_float} days float` : "");
const LONG_LEAD = /fabricat|deliver|procure|order|long[- ]?lead|manufactur|lead time|package/i;

function short(job: BriefJob): string {
  return jobTitle(job) || job.job_number.trim();
}

function hrefOf(job: BriefJob, page: keyof BriefJob["links"]): string | null {
  return job.links[page] ?? job.links.items ?? null;
}

// ---------- the build ----------
export type PmBrief = { doc: BriefDoc; card: CardModel; counts: { open: number; overdue: number; today: number } };

type Ctx = { job: BriefJob; focus: FocusData; view: BriefView; today: string; asOf: string; stale: boolean; label: string };

function contextFor(job: BriefJob, focus: FocusData, now: Date): Ctx {
  const today = jobToday(job.time_zone, now);
  const dataDate = focus.cpm?.data_date ?? null;
  const stale = !!dataDate && diffDays(today, dataDate) > 7;
  // A schedule older than a week is read as of the morning after its last update, and the brief says so.
  const asOf = stale && dataDate ? addDays(dataDate, 1) : today;
  return { job, focus, view: briefView(job.seat, job.scope), today, asOf, stale, label: short(job) };
}

function finishFacts(c: Ctx): BriefDoc["finish"] {
  const cpm = c.focus.cpm;
  if (!cpm?.contract_completion || !cpm.forecast_finish) return null;
  const late = cpm.forecast_finish > cpm.contract_completion;
  const early = cpm.forecast_finish < cpm.contract_completion;
  const wd = late
    ? workDaysBetween(cpm.contract_completion, cpm.forecast_finish, cpm.work_days_mask)
    : early
      ? workDaysBetween(cpm.forecast_finish, cpm.contract_completion, cpm.work_days_mask)
      : 0;
  return {
    contract: md(cpm.contract_completion),
    forecast: md(cpm.forecast_finish),
    variance: late ? `${plural(wd, "work day")} late` : early ? `${plural(wd, "work day")} ahead` : "On time",
    late,
  };
}

function yesterdaySection(c: Ctx): BriefSectionDoc | null {
  const cpm = c.focus.cpm;
  if (!cpm || c.view === "accounting" || c.view === "contract") return null;
  const y = previousWorkDay(c.asOf, cpm.work_days_mask);
  const working = cpm.acts.filter((a) => workingOn(a, y)).sort((a, b) => Number(b.critical) - Number(a.critical) || (a.finish ?? "").localeCompare(b.finish ?? ""));
  const filed = (c.focus.dailies ?? []).includes(y);
  if (!working.length) {
    return {
      step: 1,
      heading: `Yesterday, ${longDay(y)}`,
      meta: filed ? "Daily report filed" : "No daily report filed",
      blocks: [{ type: "text", text: "Nothing was scheduled to be working yesterday." }],
    };
  }
  const rows: BriefRow[] = working.slice(0, 6).map((a) => ({
    title: a.name,
    detail: [a.critical ? "Critical" : null, who(a), `${a.pct}%`, a.finish ? `planned finish ${dmd(a.finish)}` : null].filter(Boolean).join(" · "),
    tone: a.critical ? "bad" : null,
    choices: [
      { label: "Done", prompt: `On ${c.label} yesterday (${md(y)}), ${a.name} got done. Log it on the daily report.` },
      { label: "Partly", prompt: `On ${c.label} yesterday (${md(y)}), ${a.name} only partly got done. Ask me what held it up and log it on the daily report.` },
      { label: "Didn't happen", prompt: `On ${c.label} yesterday (${md(y)}), ${a.name} didn't happen. Ask me why, log it on the daily report and tell me what it does to the schedule.` },
    ],
  }));
  return {
    step: 1,
    heading: `Yesterday, ${longDay(y)}`,
    meta: filed ? "Daily report filed" : "No daily report filed",
    blocks: [
      {
        type: "text",
        text: filed
          ? `The schedule had ${plural(working.length, "activity", "activities")} working. Check the daily against them.`
          : `The schedule had ${plural(working.length, "activity", "activities")} working yesterday. Tell me what really happened and I'll write the daily.`,
      },
      { type: "rows", rows },
      {
        type: "actions",
        buttons: filed
          ? [{ label: "Open yesterday's daily", prompt: `Show me yesterday's daily report for ${c.label}.`, kind: "secondary" }]
          : [
              { label: "Write yesterday's daily", prompt: `Write yesterday's daily report for ${c.label} (${md(y)}) from what I marked.`, kind: "primary" },
              { label: "It all went as planned", prompt: `Everything on ${c.label} went as scheduled yesterday (${md(y)}). Write the daily report that way.`, kind: "secondary" },
            ],
      },
    ],
  };
}

function checksFor(a: FocusAct, label: string): BriefButton[] {
  const base = a.party === "self" ? ["Crew", "Material"] : ["Manpower", "Material", "Supplier"];
  const list = /inspect/i.test(a.name) ? [...base.slice(0, 1), "Inspection booked"] : base;
  return list.map((name) => ({ label: name, prompt: `${name} is locked in for ${a.name} on ${label} this week. Record it on the lookahead.` }));
}

function ganttActs(c: Ctx): GanttAct[] {
  const cpm = c.focus.cpm;
  if (!cpm) return [];
  const end = addDays(c.asOf, 27);
  return cpm.acts
    .filter((a) => !a.milestone && remainingOf(a) && a.start && a.finish && a.finish >= c.asOf && a.start <= end)
    .sort((a, b) => (a.start! < b.start! ? -1 : a.start! > b.start! ? 1 : Number(b.critical) - Number(a.critical)))
    .slice(0, 14)
    .map((a) => ({
      id: a.id,
      name: a.name,
      start: a.start! < c.asOf ? c.asOf : a.start!,
      finish: a.finish!,
      pct: a.pct,
      critical: a.critical,
      party: a.party,
      meta: [who(a), `${md(a.start!)} to ${md(a.finish!)}`].filter(Boolean).join(" · "),
      tag: [a.pct ? `${a.pct}%` : null, a.critical ? "Critical" : a.total_float != null ? `${a.total_float}d float` : null].filter(Boolean).join(" · "),
    }));
}

function todaySection(c: Ctx): BriefSectionDoc | null {
  const cpm = c.focus.cpm;
  if (!cpm || c.view === "accounting" || c.view === "contract") return null;
  const weekEnd = addDays(c.asOf, 6);
  const onSite = cpm.acts
    .filter((a) => !a.milestone && remainingOf(a) && a.start && a.finish && a.start <= weekEnd && a.finish >= c.asOf)
    .sort((a, b) => Number(b.critical) - Number(a.critical) || (a.finish ?? "").localeCompare(b.finish ?? ""))
    .slice(0, 6);
  const rows: BriefRow[] = onSite.map((a) => {
    const starting = a.start! > c.asOf;
    const left = a.remaining != null ? `${plural(a.remaining, "day")} left, ` : "";
    const when = starting ? `starts ${dmd(a.start!)}` : `${left}done ${dmd(a.finish!)}`;
    return {
      title: who(a) ? `${who(a)}: ${a.name}` : a.name,
      detail: [when, floatText(a)].filter(Boolean).join(" · "),
      tone: a.critical ? "bad" : null,
      checks: checksFor(a, c.label),
    };
  });
  const blocks: BriefBlock[] = [];
  if (c.stale && cpm.data_date) {
    blocks.push({
      type: "callouts",
      items: [
        {
          title: "The schedule is out of date",
          text: `The last update has a data date of ${md(cpm.data_date)}, ${plural(diffDays(c.today, cpm.data_date), "day")} ago. This brief reads it as of ${md(c.asOf)}. Update progress so tomorrow's brief is current.`,
          tone: "bad",
          buttons: [{ label: "Update the schedule", prompt: `Start this period's schedule update for ${c.label}.`, kind: "primary" }],
        },
      ],
    });
  }
  blocks.push({ type: "text", text: rows.length ? "These crews should be on site. Tap each check once it's locked in." : "No scheduled work is due on site this week." });
  if (rows.length) blocks.push({ type: "rows", rows });
  const acts = ganttActs(c);
  if (acts.length) blocks.push({ type: "gantt", start: c.asOf, acts });

  // Buyout and long lead.
  const callouts: Extract<BriefBlock, { type: "callouts" }>["items"] = [];
  if (c.focus.buyout && c.view !== "superintendent") {
    const ordered = new Set(c.focus.buyout.ordered.map((n) => n.toLowerCase()));
    const bought = (a: FocusAct) => !!a.subco && ordered.has(a.subco.toLowerCase());
    const soon = cpm.acts.filter((a) => a.party === "sub" && !a.milestone && a.pct === 0 && a.start && a.start > c.asOf && a.start <= addDays(c.asOf, 14) && !bought(a));
    const working = cpm.acts.filter((a) => a.party === "sub" && !a.milestone && remainingOf(a) && a.start && a.start <= c.asOf && !bought(a));
    if (soon.length) {
      const first = soon[0];
      const others = working.length ? ` ${plural(working.length, "other sub")} ${working.length === 1 ? "is" : "are"} already working without a PO.` : "";
      callouts.push({
        title: "Starts within 2 weeks, not bought out",
        text: `${first.name}${first.subco ? ` (${first.subco})` : ""} starts ${dmd(first.start!)}. No subcontract or PO is on file.${soon.length > 1 ? ` ${plural(soon.length - 1, "more start")} too.` : ""}${others}`,
        tone: "bad",
        buttons: [
          { label: "Start the buyout", prompt: `Start the buyout for ${first.name} on ${c.label}.`, kind: "primary" },
          ...(working.length ? [{ label: "Set up the other POs", prompt: `Set up POs for the subs already working on ${c.label} without one.`, kind: "secondary" as const }] : []),
        ],
      });
    } else if (working.length) {
      callouts.push({
        title: "Subs working without a PO",
        text: `${plural(working.length, "sub")} ${working.length === 1 ? "is" : "are"} working on ${c.label} with no PO on file, starting with ${working[0].subco ?? working[0].name}.`,
        tone: "bad",
        buttons: [{ label: "Set up the POs", prompt: `Set up POs for the subs working on ${c.label} without one.`, kind: "primary" }],
      });
    }
  }
  const longLead = cpm.acts.filter((a) => !a.milestone && remainingOf(a) && LONG_LEAD.test(a.name) && (a.duration ?? 0) > 10 && a.finish && a.finish >= c.asOf);
  const iorLead = (c.focus.ior?.risks ?? []).filter((r) => r.status !== "closed" && r.status !== "accepted" && /\bPOs? (?:not issued|issued)\b|procure/i.test(`${r.next_move ?? ""} ${r.category ?? ""}`) && !/window|cabinet/i.test(r.title));
  if (longLead.length || iorLead.length) {
    const a = longLead[0];
    const parts: string[] = [];
    if (a) parts.push(`${a.name} is ${a.pct}% done and due ${dmd(a.finish!)}${a.total_float != null ? `, with ${plural(a.total_float, "day")} of float` : ""}.`);
    if (iorLead[0]) parts.push(`${iorLead[0].title}: ${iorLead[0].next_move?.replace(/^Release when:\s*/i, "waiting on ") ?? "still open"}.`);
    callouts.push({
      title: "Long lead, more than 2 weeks",
      text: parts.join(" "),
      tone: "note",
      buttons: [
        ...(a ? [{ label: "Confirm the delivery", prompt: `Draft a delivery confirmation to the supplier for ${a.name} on ${c.label}.`, kind: "primary" as const }] : []),
        ...(iorLead[0] ? [{ label: "What's holding it", prompt: `What's needed to clear "${iorLead[0].title}" on ${c.label}?`, kind: "secondary" as const }] : []),
      ],
    });
  }
  if (callouts.length) blocks.push({ type: "callouts", items: callouts });
  blocks.push({
    type: "actions",
    buttons: [
      { label: "Lock the two-week lookahead", prompt: `Lock the two-week lookahead on ${c.label}.`, kind: "primary" },
      { label: "Confirm crews with subs", prompt: `Draft crew confirmations to the subs on this week's ${c.label} lookahead.`, kind: "secondary" },
    ],
  });
  return { step: 2, heading: "Today and this week", meta: cpm.data_date ? `From the schedule, data date ${md(cpm.data_date)}` : "From the schedule", blocks };
}

function risksSection(c: Ctx): BriefSectionDoc | null {
  if (c.view === "accounting" || c.view === "contract") return null;
  const ior = c.focus.ior;
  const open = (ior?.risks ?? []).filter((r) => r.status !== "closed" && r.status !== "accepted" && r.status !== "resolved");
  const ask: BriefBlock = { type: "text", text: `Do you see a new risk today on ${c.label}?`, strong: true };
  const buttons: BriefBlock = {
    type: "actions",
    buttons: [
      { label: "Log a new risk", prompt: `I want to log a new risk on ${c.label}.`, kind: "primary" },
      ...(open.length ? [{ label: "Review my risks", prompt: `Walk me through the ${c.label} risks that are due for review.`, kind: "secondary" as const }] : []),
      { label: "No new risks", prompt: `No new risks on ${c.label} today.`, kind: "quiet" },
    ],
  };
  if (!open.length) {
    return {
      step: 3,
      heading: `Risks on ${c.label}`,
      meta: ior ? "None open on the IOR" : "No IOR saved yet",
      blocks: [{ type: "text", text: "No risks are logged on this job yet. Name the ones you see today and I'll track them." }, ask, buttons],
    };
  }
  const total = open.reduce((s, r) => s + (r.dollar || 0), 0);
  const ranked = [...open].sort((a, b) => b.dollar - a.dollar).slice(0, 5);
  const showMoney = c.view !== "superintendent";
  return {
    step: 3,
    heading: `Risks on ${c.label}`,
    meta: showMoney ? `${plural(open.length, "open risk")} · ${usd(total)} at risk` : plural(open.length, "open risk"),
    blocks: [
      {
        type: "table",
        columns: showMoney ? ["Risk", "Owner", "Plan", "At risk"] : ["Risk", "Owner", "Plan"],
        right: showMoney ? [3] : [],
        rows: ranked.map((r) => ({
          cells: [r.title, r.owner ?? "Needed", r.response ? r.response[0].toUpperCase() + r.response.slice(1) : "Needed", ...(showMoney ? [usd(r.dollar)] : [])],
          tone: r.status === "escalated" ? "bad" : null,
          pill: r.status === "escalated" ? { col: 0, text: "Escalated", tone: "bad" } : undefined,
        })),
      },
      ask,
      buttons,
    ],
  };
}

function coSection(c: Ctx, chases: ChaseRow[]): BriefSectionDoc | null {
  if (c.view === "superintendent" && !chases.length) return null;
  const rows: BriefRow[] = [];
  const cos = c.focus.cos ?? [];
  const showMoney = c.view !== "superintendent" && c.view !== "contract";
  for (const co of cos.filter((x) => x.state === "draft" || x.state === "priced" || x.state === "submitted").slice(0, 4)) {
    const amount = showMoney && co.total != null ? ` · ${usd(co.total)}` : "";
    const state =
      co.state === "submitted"
        ? `Sent, waiting on the owner${co.due ? `, answer due ${md(co.due)}` : ""}.`
        : co.state === "priced" || (co.total ?? 0) > 0
          ? "Priced, still a draft. Not sent to the owner."
          : "Draft, waiting on final pricing from estimating.";
    rows.push({
      title: `${co.number} ${co.title}${amount}`,
      detail: state,
      tone: co.state === "submitted" && co.due && co.due < c.today ? "bad" : "note",
      buttons: [
        co.state === "submitted"
          ? { label: "Chase the owner", prompt: `Draft a follow-up to the owner on ${co.number} for ${c.label}.`, kind: "primary" }
          : (co.total ?? 0) > 0
            ? { label: "Get it ready to send", prompt: `Get ${co.number} on ${c.label} ready to send to the owner.`, kind: "primary" }
            : { label: "Ask for pricing", prompt: `Ask estimating for final pricing on ${co.number} for ${c.label}.`, kind: "primary" },
      ],
    });
  }
  if (!cos.length && c.focus.ior?.pending_cos.length) {
    for (const co of c.focus.ior.pending_cos.slice(0, 3)) {
      rows.push({
        title: `${co.number} ${co.title}${showMoney && co.amount != null ? ` · ${usd(co.amount)}` : ""}`,
        detail: `${co.status} on the IOR. Not in Athena's change order log yet.`,
        tone: "note",
        buttons: [{ label: "Add it to the log", prompt: `Add ${co.number} (${co.title}) to the change order log on ${c.label}.`, kind: "primary" }],
      });
    }
  }
  const fieldChange = (c.focus.ior?.risks ?? []).find((r) => r.category === "field_change" && /CO package/i.test(r.next_move ?? "") && r.status !== "closed");
  if (fieldChange && showMoney) {
    rows.push({
      title: `${fieldChange.title} · ${usd(fieldChange.dollar)}`,
      detail: "Work is in place. No change order package exists yet.",
      tone: "bad",
      buttons: [{ label: "Draft the CO package", prompt: `Draft the change order package for "${fieldChange.title}" on ${c.label}.`, kind: "primary" }],
    });
  }
  const today = c.today;
  const items = dedupeOpenRows(c.job.items).filter((it) => {
    const kind = classifyItem(it);
    return kind === "submittal" || kind === "rfi";
  });
  for (const it of items.sort((a, b) => (dueOf(a) || "9").localeCompare(dueOf(b) || "9")).slice(0, 3)) {
    const due = dueOf(it);
    rows.push({
      title: clip(itemName(it.action)),
      detail: `${classifyItem(it) === "rfi" ? "RFI" : "Submittal"} waiting on a response${due ? `, due ${md(due)}` : ""}.${it.accountable ?? it.owner ? ` ${it.accountable ?? it.owner}.` : ""}`,
      tone: isOverdue(it, today) ? "bad" : null,
      href: hrefOf(c.job, "items"),
      buttons: [{ label: "Chase it", prompt: `Draft a chase for "${clip(itemName(it.action), 60)}" on ${c.label}.`, kind: "secondary" }],
    });
  }
  // Everything else that's tracked on the job: overdue first, then due soonest.
  const tracked = openItemFeed(
    dedupeOpenRows(c.job.items).filter((it) => {
      const kind = classifyItem(it);
      return kind !== "submittal" && kind !== "rfi" && !/^IOR:/i.test(it.action);
    }),
    today,
  ).items;
  for (const it of tracked.slice(0, 4)) {
    const due = dueOf(it);
    const late = isOverdue(it, today);
    rows.push({
      title: clip(itemName(it.action)),
      detail: [late && due ? `Overdue since ${md(due)}` : due ? `Due ${md(due)}` : "No due date", it.accountable ?? it.owner ?? null].filter(Boolean).join(" · "),
      tone: late ? "bad" : null,
      href: hrefOf(c.job, "items"),
      buttons: [{ label: "Handle it", prompt: `Help me close "${clip(itemName(it.action), 60)}" on ${c.label}.`, kind: "secondary" }],
    });
  }
  const seen = new Set<string>();
  for (const ch of chases) {
    if (ch.job_id && ch.job_id !== c.job.job_id) continue;
    const key = ch.submittal_id || `${ch.number}:${ch.revision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 3) break;
    rows.push({
      title: `${ch.number} ${clip(ch.title, 60)}`,
      detail: `Submittal revision ${ch.revision} is waiting${ch.chase_name ? ` on ${ch.chase_name}` : ""}.`,
      tone: ch.overdue ? "bad" : null,
      buttons: [{ label: "Chase it", prompt: `Chase submittal ${ch.number} revision ${ch.revision} on ${c.label}.`, kind: "secondary" }],
    });
  }
  // The saved log itself: what's still moving, soonest due first, after any chases above.
  const chased = new Set(chases.filter((ch) => !ch.job_id || ch.job_id === c.job.job_id).map((ch) => ch.number.trim().toLowerCase()));
  const moving = openSubmittals(c.focus.submittals)
    .filter((s) => !chased.has(s.number.trim().toLowerCase()))
    .sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
  if (c.view !== "superintendent") {
    for (const s of moving.slice(0, Math.max(0, 3 - Math.min(seen.size, 3)))) {
      const late = !!s.due && s.due < today;
      const who = [BALL_WORDS[s.ball ?? ""] ?? null, s.ball_name].filter(Boolean).join(", ");
      rows.push({
        title: `${s.number} ${clip(s.title, 60)}`,
        detail: [SUBMITTAL_STATUS_WORDS[s.status] ?? "Open", who ? `with ${who}` : null, s.due ? `${late ? "was due" : "due"} ${md(s.due)}` : null].filter(Boolean).join(" · "),
        tone: late ? "bad" : null,
        href: hrefOf(c.job, "submittals"),
        buttons: [{ label: "Open the log", prompt: `Show me the submittal log for ${c.label}.`, kind: "secondary" }],
      });
    }
  }
  const hasSubmittalLog = items.some((it) => classifyItem(it) === "submittal") || chases.some((ch) => ch.job_id === c.job.job_id) || (c.focus.submittals?.length ?? 0) > 0;
  if (!hasSubmittalLog && c.view !== "superintendent") {
    rows.push({
      title: `No submittals are logged on ${c.label}`,
      detail: "Long-lead material and finishes usually need them.",
      buttons: [{ label: "Set up the log", prompt: `Set up the submittal log for ${c.label}.`, kind: "secondary" }],
    });
  }
  const submittals = Math.max(items.filter((it) => classifyItem(it) === "submittal").length, openSubmittals(c.focus.submittals).length);
  const rfis = items.filter((it) => classifyItem(it) === "rfi").length;
  return {
    step: 4,
    heading: "Change orders, mail and open items",
    meta: `${plural(rfis, "RFI")} · ${plural(submittals, "submittal")} · ${plural(tracked.length, "other open item")}`,
    blocks: [...(rows.length ? [{ type: "rows", rows } as BriefBlock] : [{ type: "text", text: "No change orders or open items are waiting." } as BriefBlock]), { type: "inbox", heading: INBOX_SECTION, placeholder: INBOX_PLACEHOLDER }],
  };
}

function scheduleProgress(acts: FocusAct[]): number | null {
  const work = acts.filter((a) => !a.milestone && (a.duration ?? 0) > 0);
  const total = work.reduce((s, a) => s + (a.duration ?? 0), 0);
  if (!total) return null;
  return Math.round(work.reduce((s, a) => s + (a.duration ?? 0) * a.pct, 0) / total);
}

function moneySection(c: Ctx): BriefSectionDoc | null {
  if (c.view === "superintendent" || c.view === "contract" || c.job.scope !== "full") return null;
  const f = c.focus;
  const cos = f.cos ?? [];
  const unsent = cos.filter((x) => x.state === "draft" || x.state === "priced").reduce((s, x) => s + (x.total ?? 0), 0);
  const unsentCount = cos.filter((x) => (x.state === "draft" || x.state === "priced") && (x.total ?? 0) > 0);
  const contract = f.contract_total;
  const kpis: Extract<BriefBlock, { type: "kpis" }>["items"] = [
    contract != null ? { label: "Contract", value: usd(contract), note: "Saved SOV with approved COs" } : { label: "Contract", value: "Not set up", note: "No SOV saved yet", unknown: true },
    f.ior?.cost_to_date != null ? { label: "Cost to date", value: usd(f.ior.cost_to_date), note: "From the IOR" } : { label: "Cost to date", value: "Not recorded", note: "No IOR cost yet", unknown: true },
    f.pay?.latest
      ? { label: "Last pay app", value: f.pay.latest.number, note: f.pay.latest.period_end ? `Period to ${md(f.pay.latest.period_end)}` : f.pay.latest.state }
      : { label: "Billed to date", value: "Not recorded", note: "No pay app saved yet", unknown: true },
    { label: "Unsent change orders", value: usd(unsent), note: unsentCount.length ? unsentCount.map((x) => x.number).slice(0, 3).join(" and ") : "None waiting" },
  ];
  const blocks: BriefBlock[] = [{ type: "kpis", items: kpis }];
  const sched = f.cpm ? scheduleProgress(f.cpm.acts) : null;
  const bars = [
    ...(sched != null ? [{ label: "Schedule progress", pct: sched }] : []),
    ...(f.ior?.pct != null ? [{ label: "IOR progress", pct: f.ior.pct }] : []),
  ];
  if (bars.length) blocks.push({ type: "bars", items: bars });
  // What we could bill: work in progress or finished in the last week, matched to the SOV line.
  const weekAgo = addDays(c.asOf, -7);
  const dailies = new Set(f.dailies ?? []);
  const anyDaily = [...dailies].some((d) => d >= weekAgo && d < c.asOf);
  const billable = (f.cpm?.acts ?? []).filter((a) => !a.milestone && a.pct > 0 && a.start && a.start < c.asOf && (!a.actual_finish || a.actual_finish >= weekAgo)).slice(0, 6);
  if (billable.length) {
    blocks.push({
      type: "text",
      text: anyDaily
        ? `Work you could bill this period, from this week's daily reports. Match each to its SOV line and I'll queue it for the ${MON[+c.asOf.slice(5, 7) - 1]} pay app.`
        : `Work you could bill this period. No daily reports were filed this week, so these come from the schedule's progress. Match each to its SOV line and I'll queue it for the ${MON[+c.asOf.slice(5, 7) - 1]} pay app.`,
    });
    blocks.push({
      type: "table",
      columns: ["Activity", "Progress", "Proof", "SOV line"],
      right: [1],
      rows: billable.map((a) => ({
        cells: [a.name, `${a.pct}%`, anyDaily ? "Daily reports" : LONG_LEAD.test(a.name) ? "Needs invoice" : "Schedule only", a.sov_line ?? "Match needed"],
        pill: a.sov_line ? undefined : { col: 3, text: "Match needed", tone: "note" },
      })),
    });
  }
  if (f.pay?.issue) blocks.push({ type: "text", text: `Before the next pay app: ${f.pay.issue}` });
  blocks.push({
    type: "actions",
    buttons: [
      ...(billable.length ? [{ label: "Match to the SOV", prompt: `Match this week's ${c.label} progress to the SOV lines.`, kind: "primary" as const }] : []),
      { label: `Start the ${MON[+c.asOf.slice(5, 7) - 1]} pay app`, prompt: `Start the ${MON[+c.asOf.slice(5, 7) - 1]} pay app for ${c.label}.`, kind: billable.length ? "secondary" : "primary" },
      { label: "Add it to the PM meeting", prompt: `Add today's ${c.label} money, risks and lookahead to the PM meeting.`, kind: "quiet" },
    ],
  });
  return { step: 5, heading: `Money on ${c.label}`, meta: f.ior ? "From the IOR and contract on file" : "From the contract on file", blocks };
}

function movesFor(c: Ctx, sections: BriefSectionDoc[]): BriefDoc["moves"] {
  const items: { lead: string; rest: string }[] = [];
  const cpm = c.focus.cpm;
  if (c.stale && cpm?.data_date) items.push({ lead: "Update the schedule.", rest: `The last update is from ${md(cpm.data_date)}.` });
  const crit = cpm?.acts.find((a) => !a.milestone && remainingOf(a) && a.critical && a.start && a.start <= addDays(c.asOf, 6) && (a.finish ?? "") >= c.asOf);
  if (crit) items.push({ lead: `Lock the ${crit.party === "self" ? "crew" : crit.subco ?? "sub"} on ${crit.name.toLowerCase()}.`, rest: "It's on the critical path with zero float." });
  const buyout = sections.flatMap((s) => s.blocks).find((b): b is Extract<BriefBlock, { type: "callouts" }> => b.type === "callouts" && b.items.some((i) => i.title.includes("not bought out")));
  if (buyout) items.push({ lead: "Buy out the next sub.", rest: buyout.items.find((i) => i.title.includes("not bought out"))!.text.split(". ")[0] + "." });
  const unsent = (c.focus.cos ?? []).filter((x) => (x.state === "draft" || x.state === "priced") && (x.total ?? 0) > 0);
  if (unsent.length && c.view !== "superintendent") {
    const sum = unsent.reduce((s, x) => s + (x.total ?? 0), 0);
    items.push({ lead: `Send ${unsent.map((x) => x.number).slice(0, 2).join(" and ")}.`, rest: `${usd(sum)} of priced change orders are sitting in draft.` });
  }
  if (!items.length) return null;
  return { title: `Your first moves on ${c.label}`, heading: c.label, items: items.slice(0, 3) };
}

function compactJobs(jobs: BriefJob[], focusIds: Set<string>, now: Date): BriefBlock | null {
  const rows = jobs
    .filter((job) => !focusIds.has(job.job_id))
    .map((job) => {
      const today = jobToday(job.time_zone, now);
      const feed = openItemFeed(dedupeOpenRows(job.items), today);
      return { job, open: feed.counts.open, overdue: feed.counts.overdue };
    })
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  if (!rows.length) return null;
  const busy = rows.slice(0, 3);
  const rest = rows.length - busy.length;
  const out: Extract<BriefBlock, { type: "jobs" }>["rows"] = busy.map((r) => ({
    title: jobTitle(r.job),
    sub: r.job.company_name ?? "",
    pill: r.overdue ? `${r.overdue} overdue of ${r.open}` : r.open ? `${r.open} open` : "Nothing open",
    tone: r.overdue ? "bad" : null,
    href: r.job.links.items ?? null,
    prompt: `Give me the morning brief for ${r.job.job_number}.`,
  }));
  if (rest > 0) out.push({ title: `${plural(rest, "more job")}`, sub: "Sorted below these", pill: "See all", tone: null, prompt: "Show me the rest of my jobs." });
  return { type: "jobs", rows: out };
}

function noScheduleSection(c: Ctx): BriefSectionDoc {
  return {
    step: 2,
    heading: "Today and this week",
    meta: "No schedule saved",
    blocks: [
      { type: "text", text: `${c.label} has no saved CPM schedule, so I can't tell who should be on site or what's coming in the next four weeks.` },
      { type: "actions", buttons: [{ label: "Build the schedule", prompt: `Help me build the CPM schedule for ${c.label}.`, kind: "primary" }, { label: "Import a schedule", prompt: `I want to import a schedule for ${c.label}.`, kind: "secondary" }] },
    ],
  };
}

const TELL_CHIPS = (label: string): BriefButton[] => [
  { label: "A sub is short-handed", prompt: `A sub on ${label} is short-handed.` },
  { label: "Owner is slow on a decision", prompt: `The owner on ${label} is slow on a decision.` },
  { label: "A delivery might slip", prompt: `A delivery on ${label} might slip.` },
  { label: "Something I heard in the field", prompt: `I heard something in the field on ${label} you should know.` },
];

export function buildPmBrief(input: PmBriefInput): PmBrief {
  const now = input.now ?? new Date();
  const settings = input.settings ?? { ...MORNING_BRIEF_DEFAULTS };
  const jobs = input.jobs;
  const focusJobs = jobs.filter((job) => input.focus.has(job.job_id));
  const contexts = focusJobs.map((job) => contextFor(job, input.focus.get(job.job_id)!, now));
  const primary = contexts[0] ?? null;
  const chases = input.chases ?? [];
  const sections: BriefSectionDoc[] = [];
  if (input.notices?.rows.length) {
    sections.push({
      heading: input.notices.heading,
      blocks: [{ type: "rows", rows: input.notices.rows.map((r) => ({ title: r.cells.filter(Boolean).join(" · "), href: r.href ?? null, tone: r.flag === "overdue" || r.flag === "risk" || r.flag === "delay" ? "bad" : null })) }],
    });
  }
  for (const c of contexts) {
    const sub = [
      yesterdaySection(c),
      c.focus.cpm ? todaySection(c) : c.view === "accounting" || c.view === "contract" ? null : noScheduleSection(c),
      risksSection(c),
      coSection(c, chases),
      moneySection(c),
    ].filter((s): s is BriefSectionDoc => !!s);
    if (contexts.length > 1) for (const s of sub) s.heading = s.heading.includes(c.label) ? s.heading : `${s.heading} · ${c.label}`;
    sections.push(...sub);
  }
  if (!contexts.length) {
    // No job with a schedule yet: still lead with what needs them and keep the inbox heading.
    const openRows: BriefRow[] = [];
    for (const job of jobs) {
      const today = jobToday(job.time_zone, now);
      for (const it of openItemFeed(dedupeOpenRows(job.items), today).items.slice(0, 3)) {
        openRows.push({ title: `${short(job)} · ${clip(itemName(it.action))}`, detail: dueOf(it) ? `Due ${md(dueOf(it))}` : null, tone: isOverdue(it, today) ? "bad" : null, href: job.links.items ?? null });
      }
    }
    sections.push({
      heading: "What needs you",
      blocks: [
        openRows.length ? { type: "rows", rows: openRows.slice(0, 6) } : { type: "text", text: "Nothing is overdue. Save a CPM schedule on a job and I'll start each day with who's on site and what's coming." },
        { type: "inbox", heading: INBOX_SECTION, placeholder: INBOX_PLACEHOLDER },
      ],
    });
  }
  // Chases on jobs without a full section still show, once per submittal.
  const focusIds = new Set(focusJobs.map((j) => j.job_id));
  const seenChase = new Set<string>();
  const loose = chases.filter((ch) => {
    const key = ch.submittal_id || `${ch.job_id}:${ch.number}:${ch.revision}`;
    if ((ch.job_id && focusIds.has(ch.job_id)) || seenChase.has(key)) return false;
    seenChase.add(key);
    return true;
  });
  if (loose.length) {
    sections.push({
      heading: "Submittals to chase",
      meta: plural(loose.length, "submittal"),
      blocks: [
        {
          type: "rows",
          rows: loose.slice(0, 6).map((ch) => ({
            title: `${ch.job_number ? `${ch.job_number} · ` : ""}${ch.number} ${clip(ch.title, 60)}`,
            detail: `Revision ${ch.revision} is waiting${ch.chase_name ? ` on ${ch.chase_name}` : ""}.`,
            tone: ch.overdue ? ("bad" as const) : null,
            buttons: [{ label: "Chase it", prompt: `Chase submittal ${ch.number} revision ${ch.revision}${ch.job_number ? ` on ${ch.job_number}` : ""}.`, kind: "secondary" as const }],
          })),
        },
      ],
    });
  }
  const others = compactJobs(jobs, focusIds, now);
  if (others) sections.push({ heading: focusJobs.length ? "Your other jobs" : "Your jobs", meta: "Sorted by what needs you", blocks: [others] });
  const tellLabel = primary?.label ?? "my job";
  sections.push({
    heading: "What don't I know yet?",
    blocks: [{ type: "tell", heading: "What don't I know yet?", text: `Anything on ${tellLabel} that doesn't smell right? Tell me now and I'll log it, track it and remind you before it turns into a problem.`, chips: TELL_CHIPS(tellLabel) }],
  });

  // Header.
  const headerDay = primary ? primary.today : jobToday(settings.time_zone, now);
  let overdue = 0;
  let open = 0;
  let needYou = 0;
  for (const job of jobs) {
    const counts = openItemFeed(dedupeOpenRows(job.items), jobToday(job.time_zone, now)).counts;
    overdue += counts.overdue;
    open += counts.open;
    if (counts.overdue || input.focus.has(job.job_id)) needYou += 1;
  }
  const finish = primary ? finishFacts(primary) : null;
  const whenBits = [longDay(headerDay)];
  if (needYou) whenBits.push(`${plural(needYou, "job")} ${needYou === 1 ? "needs" : "need"} you`);
  if (primary && finish?.late) whenBits.push(`${primary.label} is running ${finish.variance}`);
  const doc: BriefDoc = {
    greeting: input.firstName ? `Good morning, ${input.firstName}.` : "Good morning.",
    when: whenBits.join(" · "),
    badge: primary?.focus.cpm?.data_date ? `Schedule updated ${md(primary.focus.cpm.data_date)}` : null,
    sentDay: longDay(jobToday(settings.time_zone, now)),
    scheduleUpdated: primary?.focus.cpm?.data_date ? md(primary.focus.cpm.data_date) : null,
    finish,
    moves: primary ? movesFor(primary, sections) : null,
    sections,
    footer: `Your brief is ready at ${clockLabel(settings.send_local)}, ${settings.time_zone.replace(/^.*\//, "").replace(/_/g, " ")} time.`,
    board: { label: TODAY_BOARD_LABEL, href: todayBoardUrl() },
  };
  return { doc, card: briefCardModel(doc, { overdue, open, jobs: jobs.length }), counts: { open, overdue, today: 0 } };
}

// ---------- compatible card model (markdown text, older hosts, push) ----------
function rowsOf(block: BriefBlock): CardRow[] {
  switch (block.type) {
    case "rows":
      return block.rows.map((r) => ({ cells: [r.title, r.detail ?? ""].filter(Boolean), href: r.href ?? null, flag: r.tone === "bad" ? ("risk" as const) : null }));
    case "table":
      return block.rows.map((r) => ({ cells: r.cells, flag: r.tone === "bad" ? ("risk" as const) : null }));
    case "kpis":
      return block.items.map((k) => ({ cells: [`${k.label}: ${k.value}`, k.note ?? ""].filter(Boolean) }));
    case "bars":
      return block.items.map((b) => ({ cells: [`${b.label}: ${b.pct}%`] }));
    case "gantt":
      return block.acts.map((a) => ({ cells: [a.name, a.meta, a.tag].filter(Boolean), flag: a.critical ? ("delay" as const) : null }));
    case "callouts":
      return block.items.map((i) => ({ cells: [i.title, i.text], flag: i.tone === "bad" ? ("risk" as const) : null }));
    case "text":
      return [{ cells: [block.text] }];
    case "jobs":
      return block.rows.map((r) => ({ cells: [r.title, r.pill], href: r.href ?? null, flag: r.tone === "bad" ? ("overdue" as const) : null }));
    case "tell":
      return [{ cells: [block.text] }];
    default:
      return [];
  }
}

export function briefCardModel(doc: BriefDoc, totals: { overdue: number; open: number; jobs: number }): CardModel {
  const sections: CardSection[] = [];
  if (doc.moves) sections.push({ heading: doc.moves.title, kind: "list", rows: doc.moves.items.map((m) => ({ cells: [`${m.lead} ${m.rest}`] })) });
  for (const s of doc.sections) {
    const inbox = s.blocks.find((b) => b.type === "inbox");
    const rows = s.blocks.filter((b) => b.type !== "inbox" && b.type !== "actions").flatMap(rowsOf);
    if (rows.length) sections.push({ heading: s.step ? `${s.step}. ${s.heading}` : s.heading, kind: "list", rows });
    if (inbox && inbox.type === "inbox") sections.push({ heading: inbox.heading, kind: "list", placeholder: true, rows: [{ cells: [inbox.placeholder], tone: "unknown" }] });
  }
  if (!sections.some((s) => s.heading === INBOX_SECTION)) sections.push({ heading: INBOX_SECTION, kind: "list", placeholder: true, rows: [{ cells: [INBOX_PLACEHOLDER], tone: "unknown" }] });
  if (doc.board) sections.push({ heading: "Board", kind: "list", rows: [{ cells: [doc.board.label], href: doc.board.href }] });
  const kpis = doc.finish
    ? [
        { label: "Contract finish", value: doc.finish.contract },
        { label: "Forecast finish", value: doc.finish.forecast, flag: doc.finish.late ? ("delay" as const) : null },
        { label: "Overdue items", value: String(totals.overdue), flag: totals.overdue ? ("overdue" as const) : null },
      ]
    : [
        { label: "Jobs", value: String(totals.jobs) },
        { label: "Open", value: String(totals.open) },
        { label: "Overdue", value: String(totals.overdue), flag: totals.overdue ? ("overdue" as const) : null },
      ];
  return {
    presentation: "brief",
    state: "result",
    show_state: false,
    title: "Morning brief",
    job: `${doc.greeting} ${doc.when}`,
    kpis,
    sections,
    alerts: [],
    next_move: doc.moves?.items[0] ? `${doc.moves.items[0].lead} ${doc.moves.items[0].rest}` : "Tell me what doesn't smell right today.",
  };
}
