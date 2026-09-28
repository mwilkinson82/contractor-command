// Forwards mail received by Resend Receiving (MX for alpcontractorcircle.com)
// to Marshall's inbox. Called by the `email.received` webhook route at
// src/routes/api/public/resend/inbound.ts.
//
// Resend webhooks only carry metadata, so we fetch the full message (html,
// text, headers) and its attachments from the Receiving API, then send a new
// email through the Resend send API. Attachments are re-attached by URL
// (`path`), so Resend downloads them itself and the Worker never buffers them.
//
// Idempotency: the send uses a Resend `Idempotency-Key` derived from the
// received email id, so webhook retries within Resend's 24h window cannot
// produce a second copy.

const RESEND_API = "https://api.resend.com";

export const INBOUND_FORWARD_TO = "marshall@marshallwilkinson.com";
export const INBOUND_RELAY_FROM = "ALP Inbox Relay <marshall@alpcontractorcircle.com>";
/** Stamped on every relayed message; inbound mail carrying it is never re-forwarded. */
export const INBOUND_RELAY_HEADER = "X-ALP-Inbox-Relay";

export type ResendFetch = typeof fetch;

export type ReceivedEmailAttachmentMeta = {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  content_id?: string | null;
  size?: number | null;
};

export type ReceivedEmailAttachment = ReceivedEmailAttachmentMeta & {
  download_url?: string | null;
  expires_at?: string | null;
};

export type ReceivedEmail = {
  id: string;
  from: string;
  to?: string[] | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  reply_to?: string[] | null;
  received_for?: string[] | null;
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, unknown> | null;
  created_at?: string | null;
  message_id?: string | null;
  attachments?: ReceivedEmailAttachmentMeta[] | null;
};

export type ForwardOptions = {
  apiKey: string;
  fetch?: ResendFetch;
  to?: string;
  from?: string;
};

export type ForwardResult =
  | { status: "forwarded"; resendId: string | null; attachments: number; droppedAttachments: number }
  | { status: "duplicate" }
  | { status: "skipped"; reason: "not_found" | "relay_loop" };

export class InboundForwardError extends Error {
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  constructor(message: string, retryable: boolean, httpStatus: number | null = null) {
    super(message);
    this.name = "InboundForwardError";
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

type ResendJson = { status: number; ok: boolean; body: Record<string, unknown> | null };

async function resendRequest(
  path: string,
  init: RequestInit,
  apiKey: string,
  fetchFn: ResendFetch,
): Promise<ResendJson> {
  let res: Response;
  try {
    res = await fetchFn(`${RESEND_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new InboundForwardError(
      `Resend request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
  }
  return { status: res.status, ok: res.ok, body };
}

function isRetryableStatus(status: number): boolean {
  // 401/403 are retryable on purpose: a missing/rotated RESEND_API_KEY is a
  // config problem, and Resend's webhook retries should succeed once it's fixed.
  return status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function headerValue(
  headers: Record<string, unknown> | null | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === "string") return value.trim() || null;
    if (Array.isArray(value)) {
      const joined = value.filter((v) => typeof v === "string").join(", ").trim();
      return joined || null;
    }
    return null;
  }
  return null;
}

function cleanList(values: string[] | null | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean);
}

function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

export function replyToFor(email: ReceivedEmail): string[] {
  const replyTo = cleanList(email.reply_to);
  if (replyTo.length > 0) return replyTo;
  return cleanList([email.from]);
}

type HeaderLine = { label: string; value: string };

export function buildHeaderLines(email: ReceivedEmail): HeaderLine[] {
  const lines: HeaderLine[] = [];
  lines.push({ label: "Original From", value: headerValue(email.headers, "from") ?? email.from });

  const to = cleanList(email.to);
  lines.push({ label: "Original To", value: to.length ? to.join(", ") : "(none)" });

  const cc = cleanList(email.cc);
  if (cc.length) lines.push({ label: "Cc", value: cc.join(", ") });

  // Bcc / forwarded delivery: the address it actually landed on isn't in To/Cc.
  const visible = new Set([...to, ...cc].map(bareAddress));
  const deliveredTo = cleanList(email.received_for).filter((a) => !visible.has(bareAddress(a)));
  if (deliveredTo.length) lines.push({ label: "Delivered To", value: deliveredTo.join(", ") });

  const date = headerValue(email.headers, "date") ?? email.created_at ?? null;
  if (date) lines.push({ label: "Date", value: date });
  return lines;
}

function headerBlockHtml(lines: HeaderLine[], notice: string | null): string {
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#555;white-space:nowrap;vertical-align:top;"><strong>${escapeHtml(l.label)}:</strong></td><td style="padding:2px 0;color:#111;">${escapeHtml(l.value)}</td></tr>`,
    )
    .join("");
  const noticeHtml = notice
    ? `<p style="margin:8px 0 0;color:#a15c00;">${escapeHtml(notice)}</p>`
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;border:1px solid #d9d9d9;background:#f6f6f6;padding:10px 12px;margin:0 0 16px;border-radius:4px;"><div style="color:#777;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Forwarded by ALP Inbox Relay</div><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">${rows}</table>${noticeHtml}</div>`;
}

function headerBlockText(lines: HeaderLine[], notice: string | null): string {
  const body = lines.map((l) => `${l.label}: ${l.value}`).join("\n");
  return `---------- Forwarded by ALP Inbox Relay ----------\n${body}\n${notice ? `${notice}\n` : ""}---------------------------------------------------\n\n`;
}

function insertAfterBodyTag(html: string, block: string): string {
  const match = html.match(/<body[^>]*>/i);
  if (!match || match.index === undefined) return block + html;
  const at = match.index + match[0].length;
  return html.slice(0, at) + block + html.slice(at);
}

export type OutgoingAttachment = {
  filename: string;
  path: string;
  content_type?: string;
  content_id?: string;
};

export function toOutgoingAttachments(attachments: ReceivedEmailAttachment[]): OutgoingAttachment[] {
  const out: OutgoingAttachment[] = [];
  attachments.forEach((a, index) => {
    if (!a.download_url) return;
    const item: OutgoingAttachment = {
      filename: a.filename?.trim() || `attachment-${index + 1}`,
      path: a.download_url,
    };
    if (a.content_type) item.content_type = a.content_type;
    // Keep content ids so `cid:` references in the html keep rendering inline.
    const cid = a.content_id?.trim().replace(/^<|>$/g, "");
    if (cid) item.content_id = cid;
    out.push(item);
  });
  return out;
}

export function buildForwardPayload(
  email: ReceivedEmail,
  attachments: OutgoingAttachment[],
  opts: { to?: string; from?: string; notice?: string | null } = {},
): Record<string, unknown> {
  const lines = buildHeaderLines(email);
  const notice = opts.notice ?? null;
  const blockHtml = headerBlockHtml(lines, notice);
  const blockText = headerBlockText(lines, notice);

  const originalHtml = email.html?.trim() ? email.html : null;
  const originalText = email.text?.trim() ? email.text : null;

  const html = originalHtml
    ? insertAfterBodyTag(originalHtml, blockHtml)
    : `${blockHtml}<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtml(originalText ?? "(empty message)")}</pre>`;
  const text = blockText + (originalText ?? "(This message has no plain-text part. See the HTML version.)");

  const payload: Record<string, unknown> = {
    from: opts.from ?? INBOUND_RELAY_FROM,
    to: [opts.to ?? INBOUND_FORWARD_TO],
    subject: email.subject && email.subject.length > 0 ? email.subject : "(no subject)",
    html,
    text,
    headers: {
      [INBOUND_RELAY_HEADER]: "1",
      "X-ALP-Original-Email-Id": email.id,
    },
  };
  const replyTo = replyToFor(email);
  if (replyTo.length) payload.reply_to = replyTo;
  if (attachments.length) payload.attachments = attachments;
  return payload;
}

async function fetchReceivedEmail(
  emailId: string,
  apiKey: string,
  fetchFn: ResendFetch,
): Promise<ReceivedEmail | null> {
  const res = await resendRequest(
    `/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`,
    { method: "GET" },
    apiKey,
    fetchFn,
  );
  if (res.status === 404) return null;
  if (!res.ok || !res.body) {
    throw new InboundForwardError(
      `Resend get received email failed (${res.status}): ${JSON.stringify(res.body)}`,
      isRetryableStatus(res.status),
      res.status,
    );
  }
  return res.body as unknown as ReceivedEmail;
}

async function fetchAttachments(
  emailId: string,
  apiKey: string,
  fetchFn: ResendFetch,
): Promise<ReceivedEmailAttachment[]> {
  const res = await resendRequest(
    `/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
    { method: "GET" },
    apiKey,
    fetchFn,
  );
  if (!res.ok || !res.body) {
    throw new InboundForwardError(
      `Resend list received attachments failed (${res.status}): ${JSON.stringify(res.body)}`,
      isRetryableStatus(res.status),
      res.status,
    );
  }
  const data = res.body.data;
  if (res.body.has_more === true) {
    console.warn("[resend-inbound] attachment list has more pages; forwarding first page only", {
      emailId,
    });
  }
  return Array.isArray(data) ? (data as ReceivedEmailAttachment[]) : [];
}

async function sendForward(
  payload: Record<string, unknown>,
  idempotencyKey: string,
  apiKey: string,
  fetchFn: ResendFetch,
): Promise<ResendJson> {
  return resendRequest(
    "/emails",
    {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Idempotency-Key": idempotencyKey },
    },
    apiKey,
    fetchFn,
  );
}

function errorName(body: Record<string, unknown> | null): string {
  const name = body?.name;
  return typeof name === "string" ? name : "";
}

export async function forwardReceivedEmail(
  emailId: string,
  opts: ForwardOptions,
): Promise<ForwardResult> {
  const fetchFn = opts.fetch ?? fetch;
  const email = await fetchReceivedEmail(emailId, opts.apiKey, fetchFn);
  if (!email) return { status: "skipped", reason: "not_found" };

  if (headerValue(email.headers, INBOUND_RELAY_HEADER)) {
    return { status: "skipped", reason: "relay_loop" };
  }

  const expected = email.attachments?.length ?? 0;
  const received = expected > 0 ? await fetchAttachments(emailId, opts.apiKey, fetchFn) : [];
  const attachments = toOutgoingAttachments(received);
  const missing = Math.max(0, expected - attachments.length);

  const baseKey = `alp-inbound-forward/${emailId}`;
  const notice =
    missing > 0
      ? `${missing} attachment(s) could not be re-attached. The original is in Resend > Emails > Receiving (id ${emailId}).`
      : null;
  let res = await sendForward(
    buildForwardPayload(email, attachments, { to: opts.to, from: opts.from, notice }),
    baseKey,
    opts.apiKey,
    fetchFn,
  );
  let dropped = missing;
  let sentAttachments = attachments.length;

  // Validation failure with attachments (e.g. over Resend's 40MB limit):
  // still deliver the message, without attachments, and say so at the top.
  if (!res.ok && (res.status === 400 || res.status === 422) && attachments.length > 0) {
    console.warn("[resend-inbound] send rejected with attachments; retrying without them", {
      emailId,
      status: res.status,
      error: res.body,
    });
    dropped = expected;
    sentAttachments = 0;
    res = await sendForward(
      buildForwardPayload(email, [], {
        to: opts.to,
        from: opts.from,
        notice: `${expected} attachment(s) could not be re-attached. The original is in Resend > Emails > Receiving (id ${emailId}).`,
      }),
      `${baseKey}/no-attachments`,
      opts.apiKey,
      fetchFn,
    );
  }

  if (res.ok) {
    const id = res.body?.id;
    return {
      status: "forwarded",
      resendId: typeof id === "string" ? id : null,
      attachments: sentAttachments,
      droppedAttachments: dropped,
    };
  }

  // Same idempotency key already used (with a payload that differs only by
  // fresh signed attachment URLs): this email was already forwarded.
  if (res.status === 409 && errorName(res.body) === "invalid_idempotent_request") {
    return { status: "duplicate" };
  }

  throw new InboundForwardError(
    `Resend send failed (${res.status}): ${JSON.stringify(res.body)}`,
    isRetryableStatus(res.status),
    res.status,
  );
}
