import {
  collectAddresses,
  headerValue,
  SUPPORT_ADDRESS_INDEX,
  bareAddress,
  type InboundMail,
  type SupportInbox,
} from "./ticket.ts";

export function routeSupport(mail: InboundMail, hint?: SupportInbox | null) {
  const addresses = collectAddresses(mail.to, mail.cc, mail.bcc, mail.received_for);
  const inboxes = [
    ...new Map(
      addresses
        .map((a) => SUPPORT_ADDRESS_INDEX[bareAddress(a)])
        .filter(Boolean)
        .map((i) => [i.brand, i]),
    ).values(),
  ];
  const inbox = inboxes[0] ?? hint ?? null;
  const review =
    inboxes.length > 1
      ? "mixed_brand"
      : hint && inbox && hint.brand !== inbox.brand
        ? "recipient_mismatch"
        : !inboxes.length && hint
          ? "recipient_unconfirmed"
          : null;
  return { inbox, review };
}

// Header references are correlation hints, never sender authentication. Only a
// server-generated receipt capability AND matching sender/brand can continue.
export function replyReferences(mail: InboundMail): string[] {
  const raw = [headerValue(mail.headers, "in-reply-to"), headerValue(mail.headers, "references")]
    .filter(Boolean)
    .join(" ");
  return [...new Set(raw.match(/<[^<>\s]{1,996}>/g) ?? [])].slice(-50);
}

export function originalEvidence(mail: InboundMail) {
  // Deliberately exclude arbitrary headers (authorization/cookies/provider secrets).
  // HTML is stored as evidence and attached as text, never rendered or executed.
  return {
    from: mail.from,
    provider_authentication: senderAuthentication(mail),
    to: mail.to ?? [],
    cc: mail.cc ?? [],
    bcc: mail.bcc ?? [],
    received_for: mail.received_for ?? [],
    subject: mail.subject ?? "",
    date: mail.created_at ?? null,
    original_date: headerValue(mail.headers, "date"),
    reply_to: headerValue(mail.headers, "reply-to"),
    message_id: mail.message_id ?? headerValue(mail.headers, "message-id"),
    in_reply_to: headerValue(mail.headers, "in-reply-to"),
    references: headerValue(mail.headers, "references"),
    text: mail.text ?? "",
    html_source: mail.html ?? "",
    attachments: (mail.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      content_type: a.content_type,
    })),
  };
}

// Resend Receiving documents these fields as receiver-computed, not headers.
// DKIM pass is aligned with From; DMARC fail takes precedence. SPF alone does
// not prove From alignment. No Athena account or application login is required.
export function senderAuthentication(mail: InboundMail) {
  const allowed = new Set(["pass", "fail", "gray", "processing_failed", "unknown"]);
  const value = (v: unknown) => (typeof v === "string" && allowed.has(v) ? v : "unknown");
  const verdict = {
    spf: value(mail.authentication?.spf),
    dkim: value(mail.authentication?.dkim),
    dmarc: value(mail.authentication?.dmarc),
  };
  const failed = verdict.dmarc === "fail";
  return {
    ...verdict,
    verified: !failed && (verdict.dmarc === "pass" || verdict.dkim === "pass"),
    failed,
  };
}
