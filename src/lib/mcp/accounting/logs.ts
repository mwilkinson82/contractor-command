// Phase 3: living logs (RFI, submittal, change order, transmittal, pay app, notice). One master per log per job, updated
// in place with a version, Last updated stamp and a change log line on every confirmed change. Viewing makes a private
// view; it never changes the master. The alert color only on open items past due, and (D6) on condition-precedent notices
// 3 days or less from their deadline or past it.
import { ALERT_COLOR } from "../alert-color";
import { diffDays } from "../deadlines";
import { seqLabel } from "./foundations";

export const LOG_TYPES = ["rfi", "submittal", "change_order", "transmittal", "pay_app", "notice"] as const;
export type LogType = (typeof LOG_TYPES)[number];
export const LOG_LABEL: Record<LogType, string> = { rfi: "RFI Log", submittal: "Submittal Log", change_order: "Change Order Log", transmittal: "Transmittal Log", pay_app: "Pay App Log", notice: "Notice Log" };

export type LogEntry = {
  log_type: LogType;
  number: string; // RFI-005, 262726-001.0, CO-002, T-006, App 03, N-002
  title: string;
  opened: string; // date sent / submitted
  due: string | null; // from the contract clause; null shows "Needed"
  closed: string | null;
  status: string;
  ball_in_court: { name: string; company: string | null } | null;
  // notice only
  condition_precedent?: boolean;
  sent?: string | null;
  fields?: Record<string, string | number | boolean | null | string[] | Record<string, string | number | null>[]>;
};

/** D6 (Marshall, 2026-10-20): condition-precedent notices go to the alert color at 3 days or less before the deadline. */
export const NOTICE_ALERT_DAYS = 3;

export const daysOpen = (e: LogEntry, asOf: string) => diffDays(e.closed ?? asOf, e.opened);

export function daysOverdue(e: LogEntry, asOf: string): number {
  if (e.closed || !e.due) return 0;
  if (e.log_type === "notice" && e.sent) return 0;
  return Math.max(0, diffDays(asOf, e.due));
}

/** Alert flag and its reason. Everything else is gray or blue. */
export function alert(e: LogEntry, asOf: string): { on: boolean; reason: string | null } {
  const od = daysOverdue(e, asOf);
  if (e.log_type === "notice") {
    if (e.closed || e.sent || !e.due) return { on: false, reason: null };
    const left = diffDays(e.due, asOf);
    if (left < 0) return { on: true, reason: `${-left} day${left === -1 ? "" : "s"} past the deadline; the notice window may be lost` };
    if (e.condition_precedent && left <= NOTICE_ALERT_DAYS) return { on: true, reason: `${left} day${left === 1 ? "" : "s"} left on a condition-precedent notice` };
    return { on: false, reason: null };
  }
  return od > 0 ? { on: true, reason: `${od} days overdue` } : { on: false, reason: null };
}

/** Summary strip: open, overdue, closed this month, average days to answer (closed entries, one decimal). */
export function summary(entries: LogEntry[], asOf: string) {
  const closed = entries.filter((e) => e.closed);
  const avg = closed.length ? Math.round((closed.reduce((s, e) => s + daysOpen(e, asOf), 0) / closed.length) * 10) / 10 : null;
  return {
    open: entries.filter((e) => !e.closed).length,
    overdue: entries.filter((e) => alert(e, asOf).on).length,
    closed_this_month: closed.filter((e) => e.closed!.slice(0, 7) === asOf.slice(0, 7)).length,
    avg_days_to_answer: avg,
  };
}

/** "What's overdue on 2701?": every alert across all logs, most overdue first. */
export function overdueAcross(entries: LogEntry[], asOf: string) {
  return entries
    .map((e) => ({ e, a: alert(e, asOf), od: daysOverdue(e, asOf) }))
    .filter((x) => x.a.on)
    .sort((a, b) => b.od - a.od)
    .map(({ e, a, od }) => ({ log_type: e.log_type, number: e.number, title: e.title, days_overdue: od, reason: a.reason, ball_in_court: e.ball_in_court }));
}

/** Number label for a new entry. Submittals number by spec section, sequence and revision. */
export function entryNumber(t: LogType, n: number, opts: { spec_section?: string; revision?: number; approved?: boolean } = {}): string {
  if (t === "rfi") return seqLabel("RFI-", n);
  if (t === "submittal") return `${(opts.spec_section ?? "000000").replace(/\D/g, "")}-${String(n).padStart(3, "0")}.${opts.revision ?? 0}`;
  if (t === "change_order") return seqLabel(opts.approved ? "CO-" : "PCO-", n);
  if (t === "transmittal") return seqLabel("T-", n);
  if (t === "pay_app") return `App ${String(n).padStart(2, "0")}`;
  return seqLabel("N-", n);
}

export const LOG_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – LOG: ONE styled view per log, never plain text.",
  "1. Navy header bar with a white title: \"<Log> · <job> · v<n> · Last updated <stamp>\".",
  `2. Summary strip: open, overdue (count in ${ALERT_COLOR}), closed this month, average days to answer.`,
  `3. Rows newest first: number, title, ball in court (name, company), due, days open, status chip (gray). Overdue rows in ${ALERT_COLOR} with "X days overdue". A due date that isn't on file shows "Needed".`,
  "4. \"All logs\" view: one card per log with its open and overdue counts, then the overdue list across all logs.",
  "5. Files on request: <job>-Logs-<date>.pdf (one section per log) and <job>-Logs-<date>.xlsx (one tab per log).",
];

export function nextMoveFor(over: ReturnType<typeof overdueAcross>): string {
  const top = over[0];
  if (!top) return "Nothing is overdue. Want the weekly log review added to the job cadence?";
  return `${top.number} is ${top.reason}${top.ball_in_court ? ` with ${top.ball_in_court.name}` : ""}. Want a short follow-up drafted?`;
}
