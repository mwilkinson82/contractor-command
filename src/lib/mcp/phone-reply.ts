// Phone text for hosts that cannot show a card. Markdown lists only.
// ChatGPT and Claude keep the HTML card; this is not used for them.
import { addDays } from "./deadlines";
import { isDelayNoticeTask } from "./delay-notice";
import type { CardModel } from "./cards/model";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Sc = Record<string, unknown>;
type Row = {
  action?: string;
  owner?: string | null;
  due?: string | null;
  status?: string;
  severity?: string | null;
  type?: string | null;
  item_type?: string | null;
  kind?: string | null;
  category?: string | null;
  check_key?: string | null;
  flag?: string | null;
  overdue?: boolean;
  due_in_7_days?: boolean;
};

const clean = (value: string) => value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

function monthDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
}

function asDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function cardOf(sc: Sc): CardModel | null {
  const card = sc.card;
  if (!card || typeof card !== "object" || !("title" in card)) return null;
  return card as CardModel;
}

function kpiNumber(card: CardModel | null, label: string): number | null {
  const hit = card?.kpis?.find((kpi) => kpi.label === label);
  if (!hit) return null;
  const n = Number(hit.value);
  return Number.isFinite(n) ? n : null;
}

function ownerName(row: Row): string {
  const owner = clean(row.owner ?? "");
  return /^needed$/i.test(owner) ? "" : owner;
}

function nextMove(sc: Sc, card: CardModel | null, priority: Row[], job?: string | null): string {
  const candidates = [card?.next_move, sc.next_move, sc.next_action, sc.top_priority];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return clean(candidate);
  }
  const row = priority[0];
  if (!row) return "Review the job board for the next action.";
  const title = splitAction(row.action ?? "Item", job).title;
  const owner = ownerName(row);
  const due = monthDay(asDate(row.due));
  return owner
    ? `Review “${title}” with ${owner}${due ? ` (due ${due})` : ""}.`
    : `Assign an owner to review “${title}”${due ? ` (due ${due})` : ""}.`;
}

function splitAction(action: string, job?: string | null, pending = true): { title: string; sentence: string } {
  let text = clean(action) || "Item";
  const jobNumber = job?.split(/\s+[·–—-]\s+/)[0]?.trim();
  if (jobNumber) {
    const escaped = jobNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^(?:Job\\s+)?${escaped}\\s+[–—-]\\s+`, "i"), "");
  }
  const checklist = /^Resolve:\s*/i.test(text);
  if (checklist) text = text.replace(/^Resolve:\s*(?:[A-Z]\d+\s+)?/i, "");
  // These are topic labels, not rewritten requirements. Keep the complete note,
  // including qualifications, amounts and clauses, beneath the shorter title.
  const topic = /\bsubmittal and RFI turnaround times\b/i.test(text) ? "Turnaround times"
    : /^A kickoff meeting has been held with the superintendent\b/i.test(text) ? "Superintendent kickoff"
      : /^Price conditional .*project[- ]supervision exposure\b/i.test(text) ? "Project supervision exposure"
        : null;
  if (topic) return { title: topic, sentence: checklist && pending
    ? `Can you confirm: ${text.replace(/[.!?]$/, "")}?`
    : text.replace(/\.$/, "") };
  if (checklist && pending) return { title: "Confirmation", sentence: `Can you confirm: ${text.replace(/[.!?]$/, "")}?` };
  const label = text.match(/^(Schedule logic|Submittals|Deliveries|Inspections|RFIs):\s*(.+)$/i);
  if (label) return { title: label[1], sentence: label[2].replace(/\.$/, "") };
  const cut = text.indexOf(". ");
  if (cut < 0) return { title: text.replace(/\.$/, ""), sentence: "" };
  return { title: text.slice(0, cut), sentence: text.slice(cut + 2).replace(/\.$/, "") };
}

function bullet(row: Row, job?: string | null): string {
  const { title, sentence } = splitAction(row.action ?? "Item", job, !isResolved(row));
  const who = ownerName(row);
  const due = monthDay(asDate(row.due));
  const detail = sentence ? ` ${sentence}${/[.!?]$/.test(sentence) ? "" : "."}` : "";
  const waiting = !isResolved(row) && (/\b(?:unconfirmed|pending|awaiting|waiting)\b|\bnot\s+(?:yet\s+)?(?:confirmed|requested|sent|received|approved|resolved|complete(?:d)?)\b/i.test(row.action ?? "") || /^(?:pending|waiting|awaiting)$/i.test(row.status ?? ""));
  const question = waiting && !/\?$/.test(sentence || title) ? " What is the current status?" : "";
  const attribution = due ? `${who ? `${who}, ` : ""}due ${due}.` : `${who ? `${who}. ` : ""}Due date needed.`;
  return `- **${title}${/[.!?]$/.test(title) ? "" : "."}**${detail}${question} ${attribution}`;
}

function section(lines: string[], heading: string, rows: Row[], job?: string | null) {
  if (!rows.length) return;
  lines.push("", heading, ...rows.map((row) => bullet(row, job)));
}

function rowKey(row: Row): string {
  return `${clean(row.action ?? "")}\u0000${asDate(row.due) ?? ""}`;
}

function isResolved(row: Row): boolean {
  const status = (row.status ?? "").toLowerCase();
  return status === "resolved" || status === "closed";
}

function isDelayOrRisk(row: Row): boolean {
  if (row.flag === "delay" || row.flag === "risk") return true;
  if (isDelayNoticeTask(row)) return true;
  return row.severity === "high" || row.type === "risk" || row.item_type === "risk";
}

function isOverdue(row: Row, today: string | null): boolean {
  if (row.overdue === true || row.flag === "overdue") return true;
  const due = asDate(row.due);
  return !!today && !!due && due < today;
}

/** Styled list for lookahead_get on a host with no card. Null keeps the caller on the HTML strip. */
export function phoneLookaheadText(sc: Sc): string | null {
  const card = cardOf(sc);
  if (card?.state === "ask" || sc.which_job === true) return null;
  const today = asDate(sc.as_of);
  const saved = (Array.isArray(sc.items) ? sc.items : []) as Row[];
  const jobOverdue = (Array.isArray(sc.overdue_items) ? sc.overdue_items : []) as Row[];
  const seen = new Set<string>();
  const overdue: Row[] = [];
  const due7: Row[] = [];
  const later: Row[] = [];
  const delay: Row[] = [];
  const resolved: Row[] = [];
  const push = (bucket: Row[], row: Row) => {
    const key = rowKey(row);
    if (!clean(row.action ?? "") || seen.has(key)) return;
    seen.add(key);
    bucket.push(row);
  };
  for (const row of jobOverdue) push(overdue, row);
  const horizon = today ? addDays(today, 7) : null;
  for (const row of saved) {
    if (isResolved(row)) {
      push(resolved, row);
      continue;
    }
    if (isOverdue(row, today)) push(overdue, row);
    else if (isDelayOrRisk(row)) push(delay, row);
    else if (horizon && asDate(row.due) && asDate(row.due)! <= horizon) push(due7, row);
    else push(later, row);
  }
  const savedCount = kpiNumber(card, "Saved items") ?? saved.length;
  const openCount = kpiNumber(card, "Open saved items") ?? saved.filter((row) => !isResolved(row)).length;
  const overdueCount = kpiNumber(card, "Overdue on job") ?? kpiNumber(card, "Overdue saved items") ?? overdue.length;
  const lines = ["## 🔵 14-day lookahead"];
  if (card?.job) lines.push(`**${clean(card.job)}**`);
  const win = sc.window && typeof sc.window === "object" ? (sc.window as { start?: unknown; end?: unknown }) : null;
  const start = monthDay(asDate(win?.start));
  const end = monthDay(asDate(win?.end));
  const rev = typeof sc.revision === "number" ? sc.revision : null;
  const dataDate = monthDay(asDate(sc.data_date));
  const version = typeof sc.cpm_version === "number" ? sc.cpm_version : null;
  const windowBits = [
    start && end ? `Window: ${start} to ${end}` : start ? `Window: ${start}` : "",
    rev == null ? "" : start || end ? `, Rev ${rev}` : `Rev ${rev}`,
  ].join("");
  const dateBit = dataDate ? `Data date is ${dataDate}${version == null ? "" : ` (CPM v${version})`}.` : "";
  const windowLine = [windowBits ? `${windowBits}.` : "", dateBit].filter(Boolean).join(" ");
  if (windowLine) lines.push(windowLine);
  const overdueWords = overdueCount > 0 ? `🔴 ${overdueCount} overdue on the job` : `${overdueCount} overdue on the job`;
  lines.push(`**${savedCount} saved item${savedCount === 1 ? "" : "s"} · ${openCount} open · ${overdueWords}**`);
  section(lines, "### 🔴 Overdue", overdue, card?.job);
  section(lines, "### Due within 7 days", due7, card?.job);
  section(lines, "### Coming up", later, card?.job);
  section(lines, "### 🔴 Delay / risk notices", delay, card?.job);
  const activities = (Array.isArray(sc.activities) ? sc.activities : []) as {
    name?: string | null;
    description?: string | null;
    id?: string | null;
    start?: string | null;
    finish?: string | null;
  }[];
  const schedule = activities
    .map((activity) => {
      const name = clean(activity.name || activity.description || activity.id || "");
      if (!name) return "";
      const from = monthDay(asDate(activity.start));
      const to = monthDay(asDate(activity.finish));
      const span = from && to ? `, ${from} to ${to}` : from ? `, ${from}` : "";
      return `- ${name}${span}`;
    })
    .filter(Boolean);
  if (schedule.length) lines.push("", "### Schedule in this window", ...schedule);
  section(lines, "### Resolved", resolved, card?.job);
  lines.push("", `**Athena's next move:** ${nextMove(sc, card, [...overdue, ...delay, ...due7, ...later], card?.job)}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Styled list for list_open_items on a host with no card. */
export function phoneOpenItemsText(sc: Sc): string | null {
  const card = cardOf(sc);
  if (card?.state === "ask" || sc.which_job === true) return null;
  const raw = (Array.isArray(sc.items) ? sc.items : []) as Row[];
  const itemSection = card?.sections?.find((section) => section.heading === "Items");
  const rows: Row[] = raw.map((item, index) => {
    const fromCard = itemSection && itemSection.rows.length === raw.length ? itemSection.rows[index] : undefined;
    return {
      ...item,
      action: item.action ?? fromCard?.cells?.[0],
      owner: item.owner ?? fromCard?.cells?.[1],
      due: asDate(item.due) ?? asDate(fromCard?.cells?.[2]),
      flag: item.flag ?? fromCard?.flag ?? null,
    };
  });
  const source = rows.length
    ? rows
    : (itemSection?.rows ?? []).map((row) => ({
        action: row.cells[0],
        owner: row.cells[1],
        due: asDate(row.cells[2]),
        flag: row.flag ?? null,
      }));
  if (!source.length && !card) return null;
  const counts = sc.counts && typeof sc.counts === "object" ? (sc.counts as { open?: unknown; overdue?: unknown; due_in_7_days?: unknown }) : null;
  const today = asDate(sc.as_of) ?? asDate(sc.today);
  const overdue: Row[] = [];
  const delay: Row[] = [];
  const rest: Row[] = [];
  const resolved: Row[] = [];
  for (const row of source) {
    if (isResolved(row)) resolved.push(row);
    else if (isOverdue(row, today)) overdue.push(row);
    else if (isDelayOrRisk(row)) delay.push(row);
    else rest.push(row);
  }
  const due7Count = typeof counts?.due_in_7_days === "number" ? counts.due_in_7_days : kpiNumber(card, "Due in 7 days");
  let due7: Row[] = [];
  let later: Row[] = [];
  if (rest.some((row) => row.due_in_7_days === true || row.due_in_7_days === false)) {
    due7 = rest.filter((row) => row.due_in_7_days === true);
    later = rest.filter((row) => row.due_in_7_days !== true);
  } else if (today) {
    const horizon = addDays(today, 7);
    for (const row of rest) {
      const due = asDate(row.due);
      if (due && due <= horizon) due7.push(row);
      else later.push(row);
    }
  } else if (due7Count != null) {
    const dated = rest.filter((row) => asDate(row.due)).sort((a, b) => String(asDate(a.due)).localeCompare(String(asDate(b.due))));
    const undated = rest.filter((row) => !asDate(row.due));
    due7 = dated.slice(0, due7Count);
    later = [...dated.slice(due7Count), ...undated];
  } else later = rest;
  const openCount = typeof counts?.open === "number" ? counts.open : kpiNumber(card, "Open") ?? source.length;
  const overdueCount = typeof counts?.overdue === "number" ? counts.overdue : kpiNumber(card, "Overdue") ?? overdue.length;
  const dueCount = due7Count ?? due7.length;
  const lines = ["## 🔵 Open items"];
  if (card?.job) lines.push(`**${clean(card.job)}**`);
  const overdueWords = overdueCount > 0 ? `🔴 ${overdueCount} overdue` : `${overdueCount} overdue`;
  lines.push(`**${openCount} open · ${overdueWords} · ${dueCount} due within 7 days**`);
  section(lines, "### 🔴 Overdue", overdue, card?.job);
  section(lines, "### Due within 7 days", due7, card?.job);
  section(lines, "### Coming up", later, card?.job);
  section(lines, "### 🔴 Delay notices", delay, card?.job);
  section(lines, "### Resolved", resolved, card?.job);
  lines.push("", `**Athena's next move:** ${nextMove(sc, card, [...overdue, ...delay, ...due7, ...later], card?.job)}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function phoneHostText(tool: string, sc: Sc | null | undefined): string | null {
  if (!sc) return null;
  if (tool === "lookahead_get") return phoneLookaheadText(sc);
  if (tool === "list_open_items") return phoneOpenItemsText(sc);
  return null;
}
