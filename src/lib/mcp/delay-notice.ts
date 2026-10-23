// A delay-notice obligation is red, the same as an overdue item or a risk.
// Classification uses the task's type, category, or check key, and the title
// phrases "delay notice" and "notice of delay". A bare "delay" is not enough.

export type DelayNoticeFields = {
  action?: string | null;
  title?: string | null;
  type?: string | null;
  item_type?: string | null;
  kind?: string | null;
  category?: string | null;
  check_key?: string | null;
};

const TITLE = /\bdelay notice\b|\bnotice of delay\b/i;

function token(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function linked(value: string | null | undefined): boolean {
  const key = token(value);
  return key === "delay" || key === "delay_notice" || key === "notice_of_delay";
}

/** True when the task is a delay notice or a notice-of-delay obligation. */
export function isDelayNoticeTask(it: DelayNoticeFields): boolean {
  const key = (it.check_key ?? "").toLowerCase();
  if (key.includes("delay_notice")) return true;
  if (linked(it.category) || linked(it.type) || linked(it.item_type) || linked(it.kind))
    return true;
  const title = `${it.action ?? ""} ${it.title ?? ""}`.replace(/\s+/g, " ");
  return TITLE.test(title);
}

/** Overdue stays overdue. A delay notice that is not overdue is delay. */
export function taskListFlag(it: DelayNoticeFields, overdue: boolean): "overdue" | "delay" | null {
  if (overdue) return "overdue";
  return isDelayNoticeTask(it) ? "delay" : null;
}
