/**
 * The board's client messages panel data layer (supabase/migrations/20261105160000_athena_portal_messages.sql).
 *   list:  mcp_job_messages_list(_job), full job access only; supers are refused and the panel hides.
 *   reply: never from the browser. replyJobMessageFn (job-messages.functions.ts) runs replyToClient as the signed-in
 *          member, which posts the reply and emails the client.
 *   read:  mcp_job_notices_mark_read(_job, [notice_id]).
 */
import { rpcMessage, type NoticeRpc } from "./board-notices";

export const MESSAGES_LIST_RPC = "mcp_job_messages_list";
/** replyToClient's limit (src/lib/customer-portal/messages.ts MESSAGE_MAX). */
export const REPLY_MAX = 4000;

export type JobMessage = {
  id: string;
  author_kind: "client" | "team";
  author_name: string | null;
  body: string;
  created_at: string;
  item_id: string | null;
  about_kind: string | null;
  about_label: string | null;
  team_read_at: string | null;
  notice_id: string | null;
  read: boolean;
};
export type MessageThread = {
  access_id: string;
  customer_name: string;
  customer_email: string | null;
  can_reply: boolean;
  last_at: string | null;
  awaiting_reply: number;
  unread: number;
  messages: JobMessage[];
};
export type JobMessages = { unread: number; awaiting_reply: number; threads: MessageThread[] };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const count = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && /^\d+$/.test(v)
      ? Number(v)
      : 0;

function cleanMessage(raw: unknown): JobMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.body !== "string" || typeof m.created_at !== "string")
    return null;
  const team = m.author_kind === "team";
  return {
    id: m.id,
    author_kind: team ? "team" : "client",
    author_name: str(m.author_name),
    body: m.body,
    created_at: m.created_at,
    item_id: str(m.item_id),
    about_kind: str(m.about_kind),
    about_label: str(m.about_label),
    team_read_at: str(m.team_read_at),
    notice_id: str(m.notice_id),
    read: team || m.read === true,
  };
}

/** The database already sends the newest thread first and each thread oldest first; this keeps that order. */
export function parseJobMessages(data: unknown): JobMessages | null {
  if (!data || typeof data !== "object" || !Array.isArray((data as { threads?: unknown }).threads))
    return null;
  const d = data as Record<string, unknown> & { threads: unknown[] };
  const threads: MessageThread[] = [];
  for (const raw of d.threads) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    if (typeof t.access_id !== "string") continue;
    const messages = (Array.isArray(t.messages) ? t.messages : [])
      .map(cleanMessage)
      .filter((m): m is JobMessage => !!m)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    threads.push({
      access_id: t.access_id,
      customer_name: str(t.customer_name) ?? "Client",
      customer_email: str(t.customer_email),
      can_reply: t.can_reply !== false,
      last_at: str(t.last_at) ?? messages[messages.length - 1]?.created_at ?? null,
      awaiting_reply: count(t.awaiting_reply),
      unread: count(t.unread),
      messages,
    });
  }
  threads.sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
  return { unread: count(d.unread), awaiting_reply: count(d.awaiting_reply), threads };
}

export function threadWaiting(t: MessageThread): boolean {
  return t.awaiting_reply > 0;
}

/** The item the client's latest message was about, so a reply stays on it. */
export function lastAbout(t: MessageThread): { id: string | null; label: string | null } {
  for (let i = t.messages.length - 1; i >= 0; i--)
    if (t.messages[i].author_kind === "client")
      return { id: t.messages[i].item_id, label: t.messages[i].about_label };
  return { id: null, label: null };
}

/** The unread notices behind a thread's client messages, to mark read when the member opens it. */
export function unreadNoticeIds(t: MessageThread): string[] {
  return t.messages
    .filter((m) => m.author_kind === "client" && !m.read && m.notice_id)
    .map((m) => m.notice_id!);
}

/** Notices for client messages still waiting on the team, for the brief to list first. */
export function awaitingNoticeIds(m: JobMessages): string[] {
  return m.threads.flatMap((t) =>
    t.messages
      .filter((x) => x.author_kind === "client" && !x.team_read_at && x.notice_id)
      .map((x) => x.notice_id!),
  );
}

/** The database's answer to a member without full access. The panel hides for them instead of erroring. */
export class MessagesNotForYou extends Error {}

export async function listJobMessages(rpc: NoticeRpc, jobId: string): Promise<JobMessages> {
  const { data, error } = await rpc(MESSAGES_LIST_RPC, { _job: jobId });
  if (error) {
    const msg = rpcMessage(error, "");
    if (/full access|access to this job/i.test(msg)) throw new MessagesNotForYou(msg);
    throw new Error(msg || "Client messages are unavailable right now.");
  }
  const parsed = parseJobMessages(data);
  if (!parsed) throw new Error("Client messages are unavailable right now.");
  return parsed;
}

export function replyProblem(body: string): string | null {
  const text = body.trim();
  if (!text) return "Write your reply first.";
  if (text.length > REPLY_MAX) return "Keep the reply to 4,000 characters.";
  return null;
}

/** What the reply server function hands back to the panel. */
export type ReplyResult = {
  message_id: string;
  customer_name: string;
  customer_email: string;
  email: "sent" | "off" | "failed";
};

export function replySentLine(r: ReplyResult): string {
  return r.email === "sent"
    ? `Sent. ${r.customer_name} sees it on their client page, and Athena emailed ${r.customer_email} that there's a reply.`
    : r.email === "off"
      ? `Sent. ${r.customer_name} sees it on their client page next time they open it. Client email is off.`
      : `Sent. ${r.customer_name} sees it on their client page next time they open it. The email didn't go out.`;
}
