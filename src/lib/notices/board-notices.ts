import { JOB_PAGES } from "@/lib/report-pages";
import { NOTICE_TOPICS, TOPIC_LABEL, type NoticeTopic } from "./send";

/**
 * Reading job notices for the team: the project board's Notifications panel and bell, the account page and the
 * morning brief. Every read is a signed-in member call (mcp_job_notices_list, mcp_my_notices); a board share link
 * alone never reads notices, the same as job communications.
 */
export type BoardNotice = {
  id: string;
  job_id?: string;
  topic: NoticeTopic;
  kind: string;
  title: string;
  detail: string | null;
  actor: string | null;
  facts: Record<string, unknown>;
  board_page: string | null;
  created_at: string;
  read: boolean;
};
export type NoticeList = { notices: BoardNotice[]; unread: number };
export type MyNotice = BoardNotice & { job_id: string; job_number: string; job_name: string | null };

export type NoticeRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

/** The board shows 5 and expands to 30, so one read of 30 feeds the panel, the bell and the nav. */
export const BOARD_NOTICE_LIMIT = 30;
export const BOARD_NOTICE_SHOWN = 5;
export const NOTICE_POLL_MS = 25_000;

export const EMPTY_NOTICES =
  "Nothing new yet. Client approvals, questions, submittal replies and confirmed dates show up here.";

const isTopic = (t: unknown): t is NoticeTopic =>
  typeof t === "string" && (NOTICE_TOPICS as readonly string[]).includes(t);

function cleanNotice(raw: unknown): BoardNotice | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.created_at !== "string")
    return null;
  if (!isTopic(n.topic)) return null;
  return {
    id: n.id,
    ...(typeof n.job_id === "string" ? { job_id: n.job_id } : {}),
    topic: n.topic,
    kind: typeof n.kind === "string" ? n.kind : "notice",
    title: n.title,
    detail: typeof n.detail === "string" && n.detail.trim() ? n.detail : null,
    actor: typeof n.actor === "string" && n.actor.trim() ? n.actor : null,
    facts: n.facts && typeof n.facts === "object" ? (n.facts as Record<string, unknown>) : {},
    board_page: typeof n.board_page === "string" ? n.board_page : null,
    created_at: n.created_at,
    read: n.read === true,
  };
}

/** A reply only counts when it has the notices array; anything else is unavailable, never zero. */
export function parseNoticeList(data: unknown): NoticeList | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as { notices?: unknown; unread?: unknown };
  if (!Array.isArray(d.notices)) return null;
  const notices = d.notices.map(cleanNotice).filter((n): n is BoardNotice => !!n);
  const unread =
    typeof d.unread === "number" && Number.isFinite(d.unread)
      ? d.unread
      : typeof d.unread === "string" && /^\d+$/.test(d.unread)
        ? Number(d.unread)
        : notices.filter((n) => !n.read).length;
  return { notices, unread };
}

export function parseMyNotices(data: unknown): MyNotice[] | null {
  const list = parseNoticeList(data);
  if (!list) return null;
  const raw = (data as { notices: Record<string, unknown>[] }).notices;
  const out: MyNotice[] = [];
  for (const n of list.notices) {
    const src = raw.find((r) => r && r.id === n.id) ?? {};
    if (typeof src.job_id !== "string") continue;
    out.push({
      ...n,
      job_id: src.job_id,
      job_number: typeof src.job_number === "string" ? src.job_number : "",
      job_name: typeof src.job_name === "string" && src.job_name.trim() ? src.job_name : null,
    });
  }
  return out;
}

/** Strips the database's MCP_BAD: prefix so the member reads the plain sentence. */
export function rpcMessage(error: unknown, fallback: string): string {
  const m =
    error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  const plain = m.replace(/^MCP_[A-Z_]+:/, "").trim();
  return m.startsWith("MCP_") && plain ? plain : fallback;
}

export async function readJobNotices(
  rpc: NoticeRpc,
  jobId: string,
  limit = BOARD_NOTICE_LIMIT,
): Promise<NoticeList> {
  const { data, error } = await rpc("mcp_job_notices_list", { _job: jobId, _limit: limit });
  const list = error ? null : parseNoticeList(data);
  if (!list) throw new Error(rpcMessage(error, "Notifications are unavailable right now."));
  return list;
}

/** Marks the named notices read for the caller, or every notice on the job when ids is null. */
export async function markJobNoticesRead(
  rpc: NoticeRpc,
  jobId: string,
  ids: string[] | null,
): Promise<number> {
  if (ids && !ids.length) return 0;
  const { data, error } = await rpc("mcp_job_notices_mark_read", { _job: jobId, _ids: ids });
  if (error) throw new Error(rpcMessage(error, "That could not be marked read. Try again."));
  return typeof data === "number" ? data : 0;
}

export async function readMyNotices(
  rpc: NoticeRpc,
  opts: { since?: string | null; unreadOnly?: boolean; limit?: number } = {},
): Promise<MyNotice[]> {
  const { data, error } = await rpc("mcp_my_notices", {
    _since: opts.since ?? null,
    _unread_only: opts.unreadOnly ?? false,
    _limit: opts.limit ?? 30,
  });
  const list = error ? null : parseMyNotices(data);
  if (!list) throw new Error(rpcMessage(error, "Your notifications are unavailable right now."));
  return list;
}

/** Board pages a notice can point at. Old or other workers' spellings map to the page that exists. */
const PAGE_ALIAS: Record<string, string> = {
  cos: "cos",
  "change-orders": "cos",
  "change-order-log": "cos",
  submittals: "submittals",
  "submittal-log": "submittals",
  billing: "payment-applications",
  "pay-apps": "payment-applications",
  payapps: "payment-applications",
  "payment-applications": "payment-applications",
  lookahead: "lookahead",
  "look-ahead": "lookahead",
  field: "field",
  "field-board": "field",
  rfis: "rfis",
  rfcs: "rfcs",
  items: "items",
  daily: "daily",
  photos: "photos",
  schedule: "schedule",
  "purchase-orders": "purchase-orders",
  buyout: "buyout",
};
/** Member-only pages never carry a share token, the same as the board's own links. */
const MEMBER_ONLY = new Set([
  "accounting",
  "purchase-orders",
  "billing-records",
  "payment-applications",
  "production",
  "daily-log",
  "buyout",
]);
export const MESSAGES_ANCHOR = "job-messages";
export const NOTICE_EMAILS_ANCHOR = "notice-emails";

const OPEN_LABEL: Record<string, string> = {
  cos: "Open change orders",
  submittals: "Open submittal log",
  "payment-applications": "Open pay apps",
  lookahead: "Open look-ahead",
  field: "Open field board",
  messages: "Open messages",
};

/** Where a notice opens on the board, or null when its page does not exist. */
export function noticeBoardHref(
  jobId: string,
  boardPage: string | null,
  token?: string,
): { href: string; label: string } | null {
  if (!boardPage) return null;
  const key = boardPage.toLowerCase();
  if (key === "messages" || key === "client-messages")
    return {
      href: `/r/job/${jobId}/home${token ? `?t=${encodeURIComponent(token)}` : ""}#${MESSAGES_ANCHOR}`,
      label: OPEN_LABEL.messages,
    };
  const page = PAGE_ALIAS[key];
  if (!page) return null;
  const known =
    (JOB_PAGES as readonly string[]).includes(page) ||
    ["cos", "rfis", "rfcs", "payment-applications", "purchase-orders", "buyout"].includes(page);
  if (!known) return null;
  const carry = token && !MEMBER_ONLY.has(page) ? `?t=${encodeURIComponent(token)}` : "";
  return { href: `/r/job/${jobId}/${page}${carry}`, label: OPEN_LABEL[page] ?? "Open" };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short times for a list: just now, 5 min ago, 3 hr ago, yesterday, 4 days ago, then the date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const diff = Math.max(0, now - at);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} hr ago`;
  }
  const days = Math.floor(diff / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const d = new Date(at);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Marks that the member made on this page before the next read comes back. */
export type LocalReads = { ids: ReadonlySet<string>; allAt: string | null };
export const NO_LOCAL_READS: LocalReads = { ids: new Set(), allAt: null };

export function isLocallyRead(n: BoardNotice, local: LocalReads): boolean {
  return local.ids.has(n.id) || (!!local.allAt && n.created_at <= local.allAt);
}

/** The list with this page's marks applied, and the unread count that goes with it. */
export function withLocalReads(list: NoticeList, local: LocalReads): NoticeList {
  let cleared = 0;
  const notices = list.notices.map((n) => {
    if (n.read || !isLocallyRead(n, local)) return n;
    cleared += 1;
    return { ...n, read: true };
  });
  if (local.allAt) {
    // Mark all read clears every notice on the job, including ones past the read limit.
    const after = notices.filter((n) => !n.read && n.created_at > local.allAt!).length;
    return { notices, unread: after };
  }
  return { notices, unread: Math.max(0, list.unread - cleared) };
}

export function badgeText(unread: number): string {
  return unread > 99 ? "99+" : String(unread);
}

export function bellLabel(unread: number | null): string {
  if (!unread) return "Notifications";
  return `Notifications, ${badgeText(unread)} new`;
}

/** Groups a member's notices by job, newest job first, keeping each job's notices newest first. */
export function groupNoticesByJob(notices: MyNotice[]): {
  job_id: string;
  job_number: string;
  job_name: string | null;
  notices: MyNotice[];
  unread: number;
}[] {
  const groups = new Map<
    string,
    { job_id: string; job_number: string; job_name: string | null; notices: MyNotice[]; unread: number }
  >();
  const sorted = [...notices].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const n of sorted) {
    const g = groups.get(n.job_id) ?? {
      job_id: n.job_id,
      job_number: n.job_number,
      job_name: n.job_name,
      notices: [],
      unread: 0,
    };
    g.notices.push(n);
    if (!n.read) g.unread += 1;
    groups.set(n.job_id, g);
  }
  return [...groups.values()];
}

export function jobLabel(n: { job_number: string; job_name: string | null }): string {
  const num = n.job_number.trim();
  const name = (n.job_name ?? "").trim();
  if (!name) return num || "Job";
  if (!num || name.startsWith(num)) return name;
  return `${num} ${name}`;
}

export const topicLabel = (t: NoticeTopic) => TOPIC_LABEL[t];
