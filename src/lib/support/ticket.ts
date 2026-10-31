// Support inbox rules shared by the inbound webhook, manual replies, and the preview script.

export type SupportBrand = "athena" | "circle";

export type SupportInbox = {
  brand: SupportBrand;
  address: string;
  from: string;
  prefix: "ATH" | "CIR";
  mark: string;
  product: string;
  kicker: string;
};

export const SUPPORT_INBOXES: Record<SupportBrand, SupportInbox> = {
  athena: {
    brand: "athena",
    address: "support@meetathena.io",
    from: "Athena Support <support@meetathena.io>",
    prefix: "ATH",
    mark: "A",
    product: "Athena Support",
    kicker: "Athena",
  },
  circle: {
    brand: "circle",
    address: "support@alpcontractorcircle.com",
    from: "Circle Support <support@alpcontractorcircle.com>",
    prefix: "CIR",
    mark: "C",
    product: "Circle Support",
    kicker: "Contractor Circle",
  },
};

export const SUPPORT_ADDRESS_INDEX: Record<string, SupportInbox> = {
  [SUPPORT_INBOXES.athena.address]: SUPPORT_INBOXES.athena,
  [SUPPORT_INBOXES.circle.address]: SUPPORT_INBOXES.circle,
};

/** Preview and internal notices go here. Customer auto-replies do not, once the flag is on. */
export const SUPPORT_PREVIEW_TO = "marshall@marshallwilkinson.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  let raw = (match ? match[1] : value).trim().toLowerCase();
  raw = raw.replace(/^mailto:/, "");
  raw = raw.replace(/[\s,;]+$/g, "").replace(/\.+$/g, "");
  return raw.trim();
}

export function isEmailAddress(value: string): boolean {
  return value.length <= 320 && EMAIL_RE.test(value);
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
      const joined = value
        .filter((item) => typeof item === "string")
        .join(", ")
        .trim();
      return joined || null;
    }
    return null;
  }
  return null;
}

export function collectAddresses(...groups: unknown[]): string[] {
  const out: string[] = [];
  for (const group of groups) {
    if (typeof group === "string") out.push(group);
    else if (Array.isArray(group)) {
      for (const item of group) if (typeof item === "string") out.push(item);
    }
  }
  return out;
}

export function supportInboxForAddresses(addresses: string[]): SupportInbox | null {
  for (const address of addresses) {
    const inbox = SUPPORT_ADDRESS_INDEX[bareAddress(address)];
    if (inbox) return inbox;
  }
  return null;
}

export function inboxForMail(mail: {
  to?: string[] | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  received_for?: string[] | null;
}): SupportInbox | null {
  return supportInboxForAddresses([
    ...(mail.to ?? []),
    ...(mail.cc ?? []),
    ...(mail.bcc ?? []),
    ...(mail.received_for ?? []),
  ]);
}

export function inboxByBrand(brand: string): SupportInbox | null {
  if (brand === "athena" || brand === "circle") return SUPPORT_INBOXES[brand];
  return null;
}

/** Default false. Only the exact values "true" and "1" turn customer delivery on. */
export function isSupportAutoreplyLive(env: NodeJS.ProcessEnv, brand: SupportBrand): boolean {
  const raw = env[brand === "athena" ? "ATHENA_SUPPORT_ACK_LIVE" : "CIRCLE_SUPPORT_ACK_LIVE"];
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1";
}

export function customerReplyTo(
  fromEmail: string,
  env: NodeJS.ProcessEnv,
  brand: SupportBrand,
): { to: string; preview: boolean } {
  if (isSupportAutoreplyLive(env, brand)) return { to: fromEmail, preview: false };
  return { to: SUPPORT_PREVIEW_TO, preview: true };
}

export function assertSupportFrom(from: string): void {
  const bare = bareAddress(from);
  if (bare === SUPPORT_PREVIEW_TO || bare.startsWith("marshall@")) {
    throw new Error("Support mail cannot be sent from Marshall");
  }
  if (!SUPPORT_ADDRESS_INDEX[bare]) {
    throw new Error("Support mail must be sent from a support address");
  }
}

export type InboundMail = {
  // Set only by the authenticated Resend Receiving API, never by email headers.
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  from: string;
  to?: string[] | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  received_for?: string[] | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, unknown> | null;
  message_id?: string | null;
  created_at?: string | null;
  attachments?: Array<{
    id: string;
    filename?: string | null;
    size?: number | null;
    content_type?: string | null;
  }> | null;
};

export type InboundDisposition =
  | { action: "ignore"; reason: "own_support" | "mailer_daemon" | "invalid_from" }
  | {
      action: "record_only";
      reason: "auto_submitted" | "precedence_bulk" | "unverified_loop_header";
    }
  | { action: "reply" };

export function inboundDisposition(mail: InboundMail): InboundDisposition {
  if (
    headerValue(mail.headers, "x-alp-support-mail") ||
    headerValue(mail.headers, "x-alp-inbox-relay")
  ) {
    return { action: "record_only", reason: "unverified_loop_header" };
  }
  const from = bareAddress(mail.from ?? "");
  if (SUPPORT_ADDRESS_INDEX[from]) return { action: "ignore", reason: "own_support" };
  const local = from.split("@")[0] ?? "";
  if (local === "mailer-daemon") return { action: "ignore", reason: "mailer_daemon" };
  if (!isEmailAddress(from)) return { action: "ignore", reason: "invalid_from" };
  const auto = headerValue(mail.headers, "auto-submitted");
  if (auto && auto.toLowerCase() !== "no") {
    return { action: "record_only", reason: "auto_submitted" };
  }
  const precedence = headerValue(mail.headers, "precedence");
  if (precedence && /^(bulk|list|junk)\b/i.test(precedence.trim())) {
    return { action: "record_only", reason: "precedence_bulk" };
  }
  return { action: "reply" };
}

export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.replace(/\s/g, "");
  if (!clean) return null;
  const inner = clean.replace(/^<|>$/g, "");
  if (!inner || /[<>]/.test(inner)) return null;
  return `<${inner}>`;
}

export function messageIdFor(mail: InboundMail): string | null {
  return (
    normalizeMessageId(mail.message_id) ??
    normalizeMessageId(headerValue(mail.headers, "message-id"))
  );
}

export function oneLine(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function autoreplySubject(
  original: string | null | undefined,
  ticketNumber: string,
): string {
  let base = oneLine(original ?? "").replace(/^(?:re:\s*)+/i, "");
  const label = `[${ticketNumber}]`;
  // Only remove reply decoration for this ticket, never embedded/other ticket text.
  while (base === label || base.endsWith(` ${label}`))
    base = base.slice(0, -label.length).trimEnd();
  base ||= "(no subject)";
  const prefix = "Re: ";
  const suffix = ` [${ticketNumber}]`;
  const room = Math.max(0, 180 - prefix.length - suffix.length);
  const clipped = base.length > room ? base.slice(0, room).trimEnd() : base;
  return `${prefix}${clipped}${suffix}`;
}

export function notifySubject(original: string | null | undefined, ticketNumber: string): string {
  const base = oneLine(original ?? "") || "(no subject)";
  const prefix = `[${ticketNumber}] Support message: `;
  const room = Math.max(0, 180 - prefix.length);
  const clipped = base.length > room ? base.slice(0, room).trimEnd() : base;
  return `${prefix}${clipped}`;
}

export function threadHeaders(messageId: string | null): Record<string, string> {
  if (!messageId) return {};
  return { "In-Reply-To": messageId, References: messageId };
}

function stripNulls(value: string): string {
  return value.split("\u0000").join("");
}

export function summarizeMail(mail: InboundMail): string | null {
  const text = mail.text ? stripNulls(mail.text).replace(/\s+/g, " ").trim() : "";
  if (text) return text.slice(0, 1500);
  const html = mail.html
    ?.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!html) return null;
  return html.slice(0, 1500);
}

export function receivedAtIso(mail: InboundMail, now: Date): string {
  const raw = mail.created_at?.trim();
  if (raw && !Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  return now.toISOString();
}
