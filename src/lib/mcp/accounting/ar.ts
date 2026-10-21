// AR (D11 addendum + standing behavior, Marshall 2026-10-20 11:25 PM): once a pay app or invoice is logged as sent, Athena
// tracks the receivable on its own and keeps AR aging, the AR report and the collections report current in place.
// Due-soon and overdue items show up unprompted in every morning briefing and PM nudge. At each escalation step (due date,
// 30, 60, 90 days overdue) Athena offers a collection email draft with the pay app or invoice attached as a real file.
// The user reviews and sends it; nothing is ever sent automatically.
import { ALERT_COLOR } from "../alert-color";
import { diffDays } from "../deadlines";
import { fmt, sum } from "./cents";
import { AGING_BUCKETS, agingBucket, type AgingBucket } from "./payment-terms";

export type Receivable = {
  job_number: string; job_name: string; customer: string | null;
  ref: string; // "App 03" or an invoice number
  kind: "pay_app" | "invoice";
  sent_on: string; // logged as sent: tracking starts here
  due: string | null; due_estimated: boolean;
  amount: number; received: number; // cents
  file_name: string | null; // the PDF to attach to a collection draft
};

export const open = (r: Receivable) => Math.max(0, r.amount - r.received);

export type AgingRow = { key: string; current: number; "1-30": number; "31-60": number; "61-90": number; "90+": number; needed: number; total: number; overdue: number };

function rowsBy(items: Receivable[], asOf: string, keyOf: (r: Receivable) => string): AgingRow[] {
  const m = new Map<string, AgingRow>();
  for (const r of items) {
    const o = open(r);
    if (o <= 0) continue;
    const k = keyOf(r);
    const row = m.get(k) ?? { key: k, current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, needed: 0, total: 0, overdue: 0 };
    const b = agingBucket(r.due, asOf);
    row[b.bucket ?? "needed"] += o;
    row.total += o;
    if (b.overdue) row.overdue += o;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.overdue - a.overdue || a.key.localeCompare(b.key));
}

/** AR aging by job and by customer, plus the totals row. All cents. */
export function arAging(items: Receivable[], asOf: string) {
  const byJob = rowsBy(items, asOf, (r) => `${r.job_number} ${r.job_name}`);
  const byCustomer = rowsBy(items, asOf, (r) => r.customer ?? "Customer Needed");
  const total = byJob.reduce(
    (t, r) => ({ ...t, current: t.current + r.current, "1-30": t["1-30"] + r["1-30"], "31-60": t["31-60"] + r["31-60"], "61-90": t["61-90"] + r["61-90"], "90+": t["90+"] + r["90+"], needed: t.needed + r.needed, total: t.total + r.total, overdue: t.overdue + r.overdue }),
    { key: "Total", current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, needed: 0, total: 0, overdue: 0 } as AgingRow,
  );
  return { byJob, byCustomer, total };
}

/** Default reminder offsets (days before due), adjustable in the job cadence. */
export const DEFAULT_REMINDER_OFFSETS = [7, 1];

/** "Payment on job 2701 is due in 7 days" on the offset days; the calendar event the host adds after the connect check. */
export function dueReminders(items: Receivable[], asOf: string, offsets: number[] = DEFAULT_REMINDER_OFFSETS) {
  return items
    .filter((r) => open(r) > 0 && r.due && offsets.includes(diffDays(r.due, asOf)))
    .map((r) => {
      const n = diffDays(r.due!, asOf);
      return { job_number: r.job_number, ref: r.ref, due: r.due!, days: n, text: `Payment on job ${r.job_number} is due in ${n} day${n === 1 ? "" : "s"} (${r.ref}, ${fmt(open(r))}${r.due_estimated ? ", Estimated date" : ""}).` };
    });
}

/** Calendar events for every reminder offset on every open receivable (the host adds them after the connect check). */
export function reminderEvents(items: Receivable[], offsets: number[] = DEFAULT_REMINDER_OFFSETS) {
  return items.filter((r) => open(r) > 0 && r.due).flatMap((r) =>
    offsets.map((n) => ({ date: addDaysIso(r.due!, -n), title: `Payment on job ${r.job_number} is due in ${n} day${n === 1 ? "" : "s"}`, detail: `${r.ref} · ${fmt(open(r))} · due ${r.due}${r.due_estimated ? " (Estimated)" : ""}` })),
  );
}
const addDaysIso = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Escalation steps by days overdue: 1 (past due), 30, 60, 90. */
export const ESCALATION_STEPS = [1, 30, 60, 90] as const;
export function escalationStep(daysOverdue: number): (typeof ESCALATION_STEPS)[number] | null {
  let s: (typeof ESCALATION_STEPS)[number] | null = null;
  for (const x of ESCALATION_STEPS) if (daysOverdue >= x) s = x;
  return s;
}

export type FollowupOffer = { job_number: string; ref: string; days_overdue: number; step: number; ask: string; lien_check: boolean; attach: string | null };

/**
 * The collection follow-up ask for each overdue receivable whose current step hasn't been offered yet.
 * offered: "2701|App 03" -> the highest step already offered (so the ask repeats only at 30, 60 and 90).
 */
export function followupOffers(items: Receivable[], asOf: string, offered: Record<string, number> = {}): FollowupOffer[] {
  const out: FollowupOffer[] = [];
  for (const r of items) {
    if (open(r) <= 0) continue;
    const b = agingBucket(r.due, asOf);
    if (!b.overdue) continue;
    const step = escalationStep(b.days_overdue)!;
    if ((offered[`${r.job_number}|${r.ref}`] ?? 0) >= step) continue;
    const lien = b.days_overdue >= 60;
    out.push({
      job_number: r.job_number, ref: r.ref, days_overdue: b.days_overdue, step, lien_check: lien, attach: r.file_name,
      ask: `Payment on job ${r.job_number} is ${b.days_overdue} days overdue. Should I draft an AR collection follow-up email?${lien ? " It's past 60 days, so it's also time to check the lien and notice deadlines and the contract's payment-default remedies." : ""}`,
    });
  }
  return out;
}

/** Direction for the collection draft. Athena directs; the host builds the email card with the real file attached. */
export function collectionDraftSpec(o: FollowupOffer): string[] {
  return [
    `Draft a short, firm AR collection follow-up for ${o.ref} on job ${o.job_number}, ${o.days_overdue} days overdue. Call email_draft and show its draft card (To, Cc, Subject, body).`,
    o.attach ? `Attach ${o.attach} as a real file (an "Attachment:" chip). If your email tool can't attach files, call file_share with the file and put the link in the body; never say "attached" unless it really is.` : "No file is on record for this item; ask which file to attach.",
    "Nothing sends without the user's separate yes on the draft card (email_confirm_send). Never send it yourself.",
  ];
}

/** "AR due and overdue" section for the morning briefing and the PM meeting. */
export function arSection(items: Receivable[], asOf: string, offsets: number[] = DEFAULT_REMINDER_OFFSETS, offered: Record<string, number> = {}) {
  const overdue = items.filter((r) => open(r) > 0 && agingBucket(r.due, asOf).overdue).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const soon = items.filter((r) => open(r) > 0 && r.due && diffDays(r.due, asOf) >= 0 && diffDays(r.due, asOf) <= Math.max(...offsets, 0));
  const lines = [
    "AR due and overdue",
    ...overdue.map((r) => `- OVERDUE · job ${r.job_number} · ${r.ref} · ${fmt(open(r))} · ${agingBucket(r.due, asOf).days_overdue} days overdue`),
    ...soon.map((r) => `- Due ${r.due}${r.due_estimated ? " (Estimated)" : ""} · job ${r.job_number} · ${r.ref} · ${fmt(open(r))} · in ${diffDays(r.due!, asOf)} days`),
  ];
  if (lines.length === 1) lines.push("- Nothing due in the next week and nothing overdue.");
  return { lines, overdue, soon, offers: followupOffers(items, asOf, offered) };
}

const GREETING = /^\s*(?:good\s+(?:morning|afternoon|evening)|morning|hi|hey|hello)\b/i;

/**
 * Standing behavior: on a plain greeting or any briefing ask, AR rides along without being asked.
 * Returns null only when the message is neither (a direct question gets the direct answer).
 */
export function standingAr(message: string, items: Receivable[], asOf: string, offsets?: number[], offered?: Record<string, number>) {
  const isBriefing = GREETING.test(message) || /\b(?:brief(?:ing)?|what'?s (?:up|on)|today|pm meeting|nudge)\b/i.test(message);
  if (!isBriefing) return null;
  const s = arSection(items, asOf, offsets, offered);
  if (!s.overdue.length && !s.soon.length) return null;
  return { section: s.lines, offers: s.offers.map((o) => o.ask) };
}

export const AR_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – AR AGING: ONE styled report, never plain text.",
  "1. Navy header bar with a white title \"AR Aging · as of DATE\", then Last updated.",
  `2. KPI tiles: total open, current, overdue (the overdue tile in ${ALERT_COLOR}), oldest item.`,
  `3. Table by job, then by customer: ${AGING_BUCKETS.join(", ")}, Needed, Total. Amounts in overdue buckets in ${ALERT_COLOR}; current in blue #2563EB; labels gray. Estimated due dates carry a gray "Estimated" chip.`,
  "4. Offer Excel or PDF export (AR-Aging-DATE.xlsx with By job, By customer and Items tabs; AR-Aging-DATE.pdf).",
];

export const AR_STANDING_RULE =
  "AR is a standing behavior: once a pay app or invoice is logged as sent, Athena tracks it. On every greeting, morning briefing, PM meeting and nudge, call ar_aging for the user's jobs and include the \"AR due and overdue\" section unprompted, and at each escalation step (due date, 30, 60 and 90 days overdue) offer the collection email draft with the pay app or invoice attached as a real file. Payment-due reminders (7 and 1 days before by default, adjustable in the job cadence) go on the calendar after the connect check. Never send a collection email without the user's yes.";

export const bucketTotal = (rows: AgingRow[], b: AgingBucket) => sum(rows.map((r) => r[b]));
