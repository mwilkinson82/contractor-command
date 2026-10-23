// One open-item set for the header, the list, structuredContent, and the card.
// Meeting confirmations share a stable key, so a second run updates that row instead of adding another.
import { addDays } from "./deadlines";
import { formatBillingText } from "../report-format";
import { taskListFlag, type DelayNoticeFields } from "./delay-notice";
import type { CardModel } from "./cards/model";

export type FeedRow = {
  id: string;
  action: string;
  check_key?: string | null;
  needed_by?: string | null;
  due_date?: string | null;
  due?: string | null;
  updated_at?: string | null;
  owner?: string | null;
  accountable?: string | null;
};

export type OpenCounts = { open: number; overdue: number; due_in_7_days: number };

export type MeetingItem = { key: string; close: boolean };

// Whole phrases. A negating word inside one of these is not a refusal.
const AFFIRMATIVE_CONFIRMATION =
  /\b(?:nothing outstanding|none outstanding|nothing open|no problems|no concerns|no issues|all good)\b/g;

const CONFIRMATION_NEGATIVE =
  /\b(?:not|never|no|unconfirmed|pending|awaiting|except|unless|if|once|need|needs|needed|waiting)\b|n't\b|\bissues with crews\b/;

// A reported problem stays open. Checked after affirmative phrases are removed,
// so "no problems" still counts as a yes. "no issues" is its own affirmative phrase.
const CONFIRMATION_CAVEAT = /\b(?:problems?|late|failed)\b/;

/** Lowercase, with punctuation folded to spaces so phrase checks ignore case and marks. */
function confirmationText(note: string): string {
  return note
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Crew-note polarity. "Subs and crews confirmed, no issues" is a yes.
 * Affirmative phrases are removed before the negative scan, so "no" inside
 * "no issues" does not keep the item open. A real refusal still does.
 * A confirmation that also reports a problem stays open.
 */
export function isAffirmativeConfirmation(note: string): boolean {
  if (/\?/.test(note)) return false;
  const text = confirmationText(note);
  const remaining = text.replace(AFFIRMATIVE_CONFIRMATION, " ").replace(/\s+/g, " ").trim();
  // "Confirm subs and crews; no issues elsewhere" still asks for confirmation.
  // The affirmative phrase must not promote that request into a completed check.
  // "Subs confirmed, problems with electrical" reports a problem and stays open.
  if (
    CONFIRMATION_NEGATIVE.test(remaining) ||
    CONFIRMATION_CAVEAT.test(remaining) ||
    /\bconfirm\b/.test(remaining)
  ) {
    return false;
  }
  if (remaining !== text) return true;
  return /\bconfirmed\b/.test(text);
}

/** PM-meeting confirmations. Same job + key is one item. Confirmed checks close; the billing line stays open and updates. */
export function meetingItem(note: string): MeetingItem | null {
  const a = note.toLowerCase();
  if (/no change orders pending/.test(a) && /confirm/.test(a)) return { key: "pm:change_orders", close: true };
  if (/(subcontractors|\bsubs\b|suppliers)/.test(a) && /crews/.test(a) && /confirm/.test(a)) {
    // Keep one meeting item. A request, a conditional, a real negative, or a
    // reported problem stays open. "No issues" and the other affirmative phrases still close it.
    return { key: "pm:crews", close: isAffirmativeConfirmation(note) };
  }
  if (/planned billing|realistic billing/.test(a)) return { key: "pm:billing", close: false };
  return null;
}

export function dueOf(it: { needed_by?: string | null; due_date?: string | null; due?: string | null }): string {
  return (it.due ?? it.needed_by ?? it.due_date ?? "").slice(0, 10);
}

export function itemName(action: string): string {
  return action.replace(/^\s*\d[\w.-]*\s*[–-]\s*/, "").trim() || action.trim() || "Item";
}

function actionKey(action: string): string {
  return itemName(action).toLowerCase().replace(/[$,]/g, "").replace(/\s+/g, " ").trim();
}

export function dedupeKey(it: { id: string; action: string; check_key?: string | null }): string {
  if (it.check_key && /^pm:/.test(it.check_key)) return it.check_key;
  const meeting = meetingItem(it.action);
  if (meeting) return meeting.key;
  const norm = actionKey(it.action);
  return norm ? `action:${norm}` : `id:${it.id}`;
}

/**
 * Collapse duplicate rows without deleting them. Newest updated_at wins.
 * Notice duplicates should already have been folded; this also folds meeting confirmations
 * and identical actions that were inserted on every PM meeting.
 */
export function dedupeOpenRows<T extends FeedRow>(items: T[]): T[] {
  const ranked = [...items].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.id.localeCompare(a.id));
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const it of ranked) {
    const key = dedupeKey(it);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(it);
  }
  kept.sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || itemName(a.action).localeCompare(itemName(b.action)));
  return kept;
}

export function countOpenItems(items: { needed_by?: string | null; due_date?: string | null; due?: string | null }[], today: string): OpenCounts {
  const end = addDays(today, 7);
  let overdue = 0;
  let dueIn7 = 0;
  for (const it of items) {
    const due = dueOf(it);
    if (!due) continue;
    if (due < today) overdue += 1;
    else if (due <= end) dueIn7 += 1;
  }
  return { open: items.length, overdue, due_in_7_days: dueIn7 };
}

export function openItemFeed<T extends FeedRow>(items: T[], today: string): { items: T[]; counts: OpenCounts } {
  const kept = dedupeOpenRows(items);
  return { items: kept, counts: countOpenItems(kept, today) };
}

export function openItemsHeader(counts: OpenCounts): string {
  return `Open items: ${counts.open} open, ${counts.overdue} overdue, ${counts.due_in_7_days} due in 7 days.`;
}

export function isOverdue(it: FeedRow, today: string): boolean {
  const due = dueOf(it);
  return !!due && due < today;
}

export function isDueIn7(it: FeedRow, today: string): boolean {
  const due = dueOf(it);
  if (!due || due < today) return false;
  return due <= addDays(today, 7);
}

export function openItemsCard(job: string, items: (FeedRow & DelayNoticeFields)[], counts: OpenCounts, today: string): CardModel {
  return {
    state: "result",
    show_state: false,
    title: "Open items",
    job,
    kpis: [
      { label: "Open", value: String(counts.open) },
      { label: "Overdue", value: String(counts.overdue), flag: counts.overdue ? "overdue" : null },
      { label: "Due in 7 days", value: String(counts.due_in_7_days) },
    ],
    sections: [{
      heading: "Items",
      kind: "list",
      rows: items.map((it) => ({
        cells: [formatBillingText(itemName(it.action)), it.accountable ?? it.owner ?? "Needed", dueOf(it) || "Needed"],
        flag: taskListFlag(it, isOverdue(it, today)),
        refId: it.id,
      })),
    }],
    alerts: counts.overdue ? [{ level: "overdue", text: `${counts.overdue} overdue` }] : [],
    next_move: null,
  };
}
