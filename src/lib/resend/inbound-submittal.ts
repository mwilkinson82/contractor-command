// Submittal reply capture for mail Resend receives at submittals+<code>@meetathena.io (the CC on every package
// email). The reply is kept on the submittal as "received, needs review" with its attachments or, without any, its
// text. It never sets a status: the PM confirms that from the board or chat. These messages are never forwarded to
// the owner as stray mail. supabase/migrations/20261105161000_athena_submittal_replies.sql has the rules.
import {
  fetchAttachments,
  fetchReceivedEmail,
  headerValue,
  INBOUND_RELAY_HEADER,
  type ReceivedEmail,
  type ReceivedEmailAttachment,
  type ResendFetch,
} from "./inbound-forward";
import type { NoticeDeps } from "../notices/send";
import { recordReplyNotice, type RecordedReply } from "../submittal-replies/notice";
import { replyCodeHash } from "../submittal-replies/reply-link";
import { RETURN_FILE_MAX_BYTES, returnFileName, sniffReturnFile } from "../submittal-replies/page";

export type SubmittalInboundDeps = {
  apiKey: string;
  fetch?: ResendFetch;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  send: NoticeDeps["send"];
};

export type SubmittalInboundResult =
  | {
      status: "submittal_reply";
      responseId: string;
      created: boolean;
      files: number;
      skippedFiles: number;
      noticed: boolean;
    }
  | { status: "submittal_ignored"; reason: string };

const MAX_FILES = 10;

/** The sender's bare address and display name from a From value like "Jordan Lee <jordan@studio.com>". */
export function parseFrom(from: string): { email: string; name: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { email: m[2]!.trim().toLowerCase(), name: m[1]!.trim() || null };
  return {
    email: from
      .trim()
      .toLowerCase()
      .replace(/^mailto:/, ""),
    name: null,
  };
}

/** Plain text of the reply: the text part, or the HTML with its tags removed. Never rendered. */
export function replyText(email: ReceivedEmail): string {
  const text = email.text?.trim();
  if (text) return text.slice(0, 8000);
  return (email.html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8000);
}

async function boundedDownload(url: string, fetchFn: ResendFetch): Promise<Uint8Array | null> {
  if (!/^https:\/\//i.test(url)) return null;
  const res = await fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(20000) }).catch(
    () => null,
  );
  if (!res?.ok || !res.body) return null;
  if (Number(res.headers.get("content-length") ?? "0") > RETURN_FILE_MAX_BYTES) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > RETURN_FILE_MAX_BYTES) {
      await reader.cancel().catch(() => null);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Stores PDF, PNG and JPEG attachments up to 25 MB each in the reply's own folder. Anything else is skipped. */
async function keepFiles(
  reply: RecordedReply,
  attachments: ReceivedEmailAttachment[],
  deps: SubmittalInboundDeps,
): Promise<{ files: Record<string, unknown>[]; skipped: number }> {
  const files: Record<string, unknown>[] = [];
  let skipped = 0;
  const names = new Set<string>();
  for (const a of attachments) {
    if (files.length >= MAX_FILES || (a.size ?? 0) > RETURN_FILE_MAX_BYTES || !a.download_url) {
      skipped++;
      continue;
    }
    const bytes = await boundedDownload(a.download_url, deps.fetch ?? fetch);
    const kind = bytes ? sniffReturnFile(bytes) : null;
    if (!bytes || !kind) {
      skipped++;
      continue;
    }
    let name = returnFileName(a.filename ?? "", kind.ext);
    for (let n = 2; names.has(name); n++) name = name.replace(/(-\d+)?\.(\w+)$/, `-${n}.$2`);
    names.add(name);
    const path = `${reply.company_id}/${reply.job_id}/returns/${reply.response_id}/${name}`;
    try {
      await deps.upload(path, bytes, kind.mime);
    } catch {
      // Already stored by an earlier try of this webhook: keep it on the record.
    }
    files.push({ path, filename: name, content_type: kind.mime, size_bytes: bytes.length });
  }
  return { files, skipped };
}

export async function processSubmittalInbound(
  emailId: string,
  code: string,
  deps: SubmittalInboundDeps,
): Promise<SubmittalInboundResult> {
  const fetchFn = deps.fetch ?? fetch;
  const email = await fetchReceivedEmail(emailId, deps.apiKey, fetchFn);
  if (!email) return { status: "submittal_ignored", reason: "not_found" };
  if (headerValue(email.headers, INBOUND_RELAY_HEADER))
    return { status: "submittal_ignored", reason: "relay_loop" };
  const from = parseFrom(headerValue(email.headers, "from") ?? email.from ?? "");
  const subject = email.subject ?? "";
  const inReply =
    !!headerValue(email.headers, "in-reply-to") || /^\s*(re|aw|sv)\s*:/i.test(subject);
  const res = (await deps.rpc("mcp_submittal_reply_email", {
    _token_hash: await replyCodeHash(code),
    _inbound_email_id: emailId,
    _message_id: email.message_id ?? headerValue(email.headers, "message-id"),
    _from: from.email,
    _from_name: from.name,
    _subject: subject,
    _text: replyText(email),
    _in_reply: inReply,
    _received_at: email.created_at ?? null,
  })) as
    | ({ status?: string; created?: boolean; files?: unknown[] } & Partial<RecordedReply>)
    | null;
  if (res?.status !== "ok" || !res.response_id)
    return { status: "submittal_ignored", reason: res?.status ?? "error" };
  const reply = res as RecordedReply;
  let kept = Array.isArray(res.files) ? res.files.length : 0;
  let skipped = 0;
  const expected = email.attachments?.length ?? 0;
  if (!kept && expected > 0) {
    const listed = await fetchAttachments(emailId, deps.apiKey, fetchFn);
    const out = await keepFiles(reply, listed, deps);
    skipped = out.skipped + Math.max(0, expected - listed.length);
    if (out.files.length) {
      const saved = (await deps.rpc("mcp_submittal_reply_files", {
        _response: reply.response_id,
        _files: out.files,
      })) as { status?: string; files?: unknown[] } | null;
      kept = saved?.status === "ok" && Array.isArray(saved.files) ? saved.files.length : 0;
    }
  }
  const notice = await recordReplyNotice(
    { rpc: deps.rpc, send: deps.send },
    { ...reply, file_count: kept },
  ).catch(() => null);
  return {
    status: "submittal_reply",
    responseId: reply.response_id,
    created: res.created === true,
    files: kept,
    skippedFiles: skipped,
    noticed: !!notice,
  };
}
