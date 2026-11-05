/**
 * The board's client messages panel data layer, kept in one small file so the function names can follow the SQL in
 * supabase/migrations/20261105160000_athena_portal_messages.sql (another worker's piece).
 *   list:  mcp_job_messages_list(_job) -> { threads: [{ customer_name, access_id, messages: [...] }] }
 *   reply: mcp_job_message_reply(_job, _access, _body, _about_item) -> { id }
 */
import { rpcMessage, type NoticeRpc } from "./board-notices";

export const MESSAGES_LIST_RPC = "mcp_job_messages_list";
export const MESSAGES_REPLY_RPC = "mcp_job_message_reply";
export const REPLY_MAX = 2000;

export type JobMessage = {
  id: string;
  author_kind: "client" | "team";
  author_name: string | null;
  body: string;
  about_label: string | null;
  created_at: string;
};
export type MessageThread = {
  customer_name: string;
  access_id: string;
  messages: JobMessage[];
};

function cleanMessage(raw: unknown): JobMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.body !== "string" || typeof m.created_at !== "string")
    return null;
  return {
    id: m.id,
    author_kind: m.author_kind === "team" ? "team" : "client",
    author_name: typeof m.author_name === "string" && m.author_name.trim() ? m.author_name : null,
    body: m.body,
    about_label: typeof m.about_label === "string" && m.about_label.trim() ? m.about_label : null,
    created_at: m.created_at,
  };
}

/** Threads with the newest activity first; messages oldest first so a thread reads top to bottom. */
export function parseThreads(data: unknown): MessageThread[] | null {
  if (!data || typeof data !== "object" || !Array.isArray((data as { threads?: unknown }).threads))
    return null;
  const threads: MessageThread[] = [];
  for (const raw of (data as { threads: unknown[] }).threads) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    if (typeof t.access_id !== "string") continue;
    const messages = (Array.isArray(t.messages) ? t.messages : [])
      .map(cleanMessage)
      .filter((m): m is JobMessage => !!m)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    threads.push({
      customer_name:
        typeof t.customer_name === "string" && t.customer_name.trim() ? t.customer_name : "Client",
      access_id: t.access_id,
      messages,
    });
  }
  const last = (t: MessageThread) => t.messages[t.messages.length - 1]?.created_at ?? "";
  return threads.sort((a, b) => last(b).localeCompare(last(a)));
}

/** A thread waits on the team when the client wrote last. */
export function threadWaiting(t: MessageThread): boolean {
  return t.messages[t.messages.length - 1]?.author_kind === "client";
}

/** What the latest client message was about, so a reply stays on the same item. */
export function lastAbout(t: MessageThread): string | null {
  for (let i = t.messages.length - 1; i >= 0; i--)
    if (t.messages[i].author_kind === "client") return t.messages[i].about_label;
  return null;
}

export async function listJobMessages(rpc: NoticeRpc, jobId: string): Promise<MessageThread[]> {
  const { data, error } = await rpc(MESSAGES_LIST_RPC, { _job: jobId });
  const threads = error ? null : parseThreads(data);
  if (!threads) throw new Error(rpcMessage(error, "Client messages are unavailable right now."));
  return threads;
}

export function replyProblem(body: string): string | null {
  const text = body.trim();
  if (!text) return "Write your reply first.";
  if (text.length > REPLY_MAX) return `Keep the reply under ${REPLY_MAX} characters.`;
  return null;
}

export async function replyJobMessage(
  rpc: NoticeRpc,
  input: { jobId: string; accessId: string; body: string; aboutItem?: string | null },
): Promise<{ id: string }> {
  const problem = replyProblem(input.body);
  if (problem) throw new Error(problem);
  const { data, error } = await rpc(MESSAGES_REPLY_RPC, {
    _job: input.jobId,
    _access: input.accessId,
    _body: input.body.trim(),
    _about_item: input.aboutItem ?? null,
  });
  const id = data && typeof data === "object" ? (data as { id?: unknown }).id : null;
  if (error || typeof id !== "string")
    throw new Error(rpcMessage(error, "Your reply was not sent. Try again."));
  return { id };
}
