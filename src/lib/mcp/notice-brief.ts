// "Since yesterday" for the morning brief, the per-job morning hitlist and hello: the member's unread job notices
// (client approvals, client questions, submittal replies, confirmed dates, sub signatures), short lines grouped by job.
// Reads only; nothing is marked read here, the board and the account page do that.
import type { CardRow, CardSection } from "./cards/model";
import { jobLabel, parseMyNotices, type MyNotice } from "../notices/board-notices";

export const SINCE_YESTERDAY = "Since yesterday";
/** Token budget: the brief prints at most this many lines, then "and N more". */
export const BRIEF_NOTICE_LINES = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

type Rpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * The window start: the last brief shown before today, or 24 hours, whichever reaches back further, and never more
 * than a week. A Monday brief after a quiet weekend still picks up Friday's unread client question.
 */
export function noticeSince(lastBrief: string | null, now: number = Date.now()): string {
  const day = now - DAY_MS;
  const last = lastBrief ? Date.parse(lastBrief) : NaN;
  const start = Number.isFinite(last) ? Math.min(last, day) : day;
  return new Date(Math.max(start, now - WEEK_MS)).toISOString();
}

/** One short line: "2810 Willow Creek: Rosa Delgado approved CO-003". */
export function noticeLine(n: MyNotice): string {
  const line = `${jobLabel(n)}: ${n.title}`.replace(/\s+/g, " ").trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

/**
 * Client questions waiting on a reply come first. The rest are grouped by job, the job with the newest notice
 * first, each job newest first.
 */
export function orderBriefNotices(notices: MyNotice[]): MyNotice[] {
  const unread = notices.filter((n) => !n.read);
  const newest = (a: MyNotice, b: MyNotice) => b.created_at.localeCompare(a.created_at);
  const questions = unread.filter((n) => n.topic === "client_message").sort(newest);
  const rest = unread.filter((n) => n.topic !== "client_message").sort(newest);
  const jobOrder: string[] = [];
  for (const n of rest) if (!jobOrder.includes(n.job_id)) jobOrder.push(n.job_id);
  return [...questions, ...jobOrder.flatMap((id) => rest.filter((n) => n.job_id === id))];
}

export function noticeBriefRows(notices: MyNotice[], max = BRIEF_NOTICE_LINES): CardRow[] {
  const ordered = orderBriefNotices(notices);
  const shown = ordered.slice(0, max);
  const rows: CardRow[] = shown.map((n) => ({
    cells: [noticeLine(n)],
    flag: n.topic === "client_message" ? "callout" : null,
    refId: n.id,
  }));
  if (ordered.length > shown.length)
    rows.push({ cells: [`and ${ordered.length - shown.length} more`], raw: true });
  return rows;
}

export function noticeBriefSection(notices: MyNotice[], max = BRIEF_NOTICE_LINES): CardSection | null {
  const rows = noticeBriefRows(notices, max);
  return rows.length ? { heading: SINCE_YESTERDAY, kind: "list", rows } : null;
}

type ShowsTable = {
  from: (table: string) => {
    select: (cols: string) => {
      lt: (col: string, v: string) => {
        order: (col: string, o: { ascending: boolean }) => {
          limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
};

/** When the member last saw a brief, before today's. Unknown is fine: the window falls back to 24 hours. */
async function lastBriefShown(sb: unknown, now: number): Promise<string | null> {
  try {
    const res = await (sb as ShowsTable)
      .from("mcp_morning_brief_shows")
      .select("shown_at")
      .lt("shown_at", new Date(now - 12 * 60 * 60 * 1000).toISOString())
      .order("shown_at", { ascending: false })
      .limit(1);
    const row = Array.isArray(res?.data) ? (res.data[0] as { shown_at?: unknown } | undefined) : undefined;
    return !res?.error && typeof row?.shown_at === "string" ? row.shown_at : null;
  } catch {
    return null;
  }
}

/**
 * The member's unread notices since the last brief, for every job they can see, or one job when jobId is given.
 * Returns null when there is nothing new or the notice read is unavailable, so a missing feature never blocks a brief.
 */
export async function loadNoticeBrief(
  sb: Rpc,
  opts: { jobId?: string; max?: number; now?: number } = {},
): Promise<CardSection | null> {
  const now = opts.now ?? Date.now();
  try {
    const since = noticeSince(await lastBriefShown(sb, now), now);
    const res = await sb.rpc("mcp_my_notices", { _since: since, _unread_only: true, _limit: 100 });
    if (res.error) return null;
    const notices = parseMyNotices(res.data);
    if (!notices) return null;
    const mine = opts.jobId ? notices.filter((n) => n.job_id === opts.jobId) : notices;
    return noticeBriefSection(mine, opts.max ?? BRIEF_NOTICE_LINES);
  } catch {
    return null;
  }
}
