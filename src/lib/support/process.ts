import { postResendEmail, sha256Hex, SupportDeliveryError } from "./resend-send.ts";
import type { SupportTicketStore } from "./store.ts";
import { renderManualSupportReply, renderSupportAutoreply, escapeHtml } from "./template.ts";
import { ownerCopy } from "./owner-copy.ts";
import {
  routeSupport,
  replyReferences,
  originalEvidence,
  senderAuthentication,
} from "./conversation.ts";
import {
  assertSupportFrom,
  autoreplySubject,
  bareAddress,
  customerReplyTo,
  inboxByBrand,
  inboundDisposition,
  isEmailAddress,
  messageIdFor,
  notifySubject,
  oneLine,
  receivedAtIso,
  summarizeMail,
  SUPPORT_ADDRESS_INDEX,
  SUPPORT_PREVIEW_TO,
  threadHeaders,
  type InboundMail,
  type SupportInbox,
} from "./ticket.ts";

export type SupportProcessResult =
  | { status: "not_support" }
  | { status: "skipped"; reason: string }
  | { status: "duplicate"; ticketNumber: string }
  | {
      status: "processed";
      ticketNumber: string;
      preview: boolean;
      autoreply: "sent" | "suppressed" | "already" | "review";
      notify: "sent" | "already" | "review";
    };
export type ManualReplyResult = {
  ticketNumber: string;
  from: string;
  to: string;
  preview: boolean;
  resendId: string | null;
};

async function getReceived(
  emailId: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<InboundMail> {
  const res = await fetchImpl(
    "https://api.resend.com/emails/receiving/" + encodeURIComponent(emailId),
    {
      headers: { Authorization: "Bearer " + apiKey },
      signal: AbortSignal.timeout(30000),
    },
  );
  // Never acknowledge transient unavailability as successful intake.
  if (!res.ok)
    throw new SupportDeliveryError("Received email unavailable (" + res.status + ")", true);
  const body = await res.json();
  if (!body || typeof body.from !== "string")
    throw new SupportDeliveryError("Invalid received email", true);
  return body as InboundMail;
}

async function deliverStored(
  opts: { store: SupportTicketStore; apiKey: string; fetchImpl: typeof fetch },
  messageId: string,
  kind: "ack" | "owner",
  payload: Record<string, unknown>,
) {
  const claim = await opts.store.claimDelivery(messageId, kind, payload);
  if (claim.state === "sent") return "already" as const;
  if (claim.state === "review") return "review" as const;
  if (claim.state === "busy" || !claim.token)
    throw new SupportDeliveryError("Delivery in progress; retry", true);
  try {
    assertSupportFrom(String(claim.payload.from));
    await postResendEmail(
      opts.apiKey,
      opts.fetchImpl,
      claim.payload,
      "support-" + kind + "/" + messageId,
    );
  } catch (err) {
    const retryable = !(err instanceof SupportDeliveryError) || err.retryable;
    await opts.store.finishDelivery(messageId, kind, claim.token, retryable ? "retry" : "review");
    if (!retryable) return "review" as const;
    throw new SupportDeliveryError("Support delivery pending retry", true);
  }
  await opts.store.finishDelivery(messageId, kind, claim.token, "sent");
  return "sent" as const;
}

export async function processSupportInbound(
  emailId: string,
  opts: {
    apiKey: string;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    store: SupportTicketStore;
    now?: () => Date;
    hint?: SupportInbox | null;
    hintReview?: string | null;
  },
): Promise<SupportProcessResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const email = await getReceived(emailId, opts.apiKey, fetchImpl);
  const { inbox, review } = routeSupport(email, opts.hint);
  if (!inbox) return { status: "not_support" };
  const disposition = inboundDisposition(email);
  if (disposition.action === "ignore") return { status: "skipped", reason: disposition.reason };
  const from = bareAddress(email.from);
  const subject = email.subject ? oneLine(email.subject).slice(0, 500) : null;
  const previewState = customerReplyTo(from, opts.env ?? process.env, inbox.brand);
  const authentication = senderAuthentication(email);
  const references = replyReferences(email);
  const ticket = await opts.store.open({
    resendEmailId: emailId,
    brand: inbox.brand,
    fromEmail: from,
    subject,
    messageId: messageIdFor(email),
    receivedAt: receivedAtIso(email, opts.now?.() ?? new Date()),
    rawSummary: summarizeMail(email),
    evidence: originalEvidence(email),
    references,
    senderVerified: authentication.verified,
    reviewReason:
      opts.hintReview ??
      review ??
      (authentication.failed
        ? "sender_authentication_failed"
        : references.length && !authentication.verified
          ? "unverified_sender_for_correlation"
          : null),
    preview: previewState.preview,
    suppressedReason: disposition.action === "record_only" ? disposition.reason : null,
  });
  if (ticket.brand !== inbox.brand || ticket.from_email !== from)
    throw new SupportDeliveryError("Support identity mismatch requires review", true);
  // Backfilled evidence and delivery outcomes are immutable historical records.
  // A successful intake result stops provider retries; review never resends mail.
  if (ticket.legacyImport)
    return {
      status: "processed",
      ticketNumber: ticket.ticket_number,
      preview: true,
      autoreply: ticket.autoreply_sent_at ? "already" : "review",
      notify: ticket.notify_sent_at ? "already" : "review",
    };
  const ackAllowed = ticket.ackPreview || !previewState.preview;
  previewState.preview = ticket.ackPreview;
  previewState.to = ticket.ackPreview ? SUPPORT_PREVIEW_TO : from;
  const deliveryOpts = { store: opts.store, apiKey: opts.apiKey, fetchImpl };
  let autoreply: "sent" | "suppressed" | "already" | "review" = "already";
  let notify: "sent" | "already" | "review" = "already";
  const failures: unknown[] = [];
  // Independent attempts: owner delivery proceeds even when acknowledgment fails.
  try {
    if (ticket.autoreply_suppressed_reason || ticket.reviewReason || !ackAllowed)
      autoreply = "suppressed";
    else if (!ticket.autoreply_sent_at) {
      const rendered = renderSupportAutoreply({ inbox, ticketNumber: ticket.ticket_number });
      autoreply = await deliverStored(deliveryOpts, ticket.messageRecordId, "ack", {
        from: inbox.from,
        to: [previewState.to],
        subject: autoreplySubject(subject, ticket.ticket_number),
        ...rendered,
        headers: {
          ...threadHeaders(messageIdFor(email)),
          "Message-ID": ticket.receiptMessageId,
          "Auto-Submitted": "auto-replied",
          "X-ALP-Support-Mail": previewState.preview ? "preview" : "auto",
        },
      });
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    if (ticket.autoreply_suppressed_reason === "unverified_loop_header") {
      // Preserve review evidence without recursively notifying on forwarded notices.
      notify = "review";
    } else if (!ticket.notify_sent_at) {
      const copy = await ownerCopy(emailId, email, opts.apiKey, fetchImpl);
      const note =
        "Ticket " +
        ticket.ticket_number +
        "\nAcknowledgment: " +
        (failures.length ? "pending retry" : autoreply) +
        (previewState.preview ? " (preview requested)" : "") +
        ".\nReview: " +
        (ticket.reviewReason ??
          ticket.autoreply_suppressed_reason ??
          "proposed answer requires owner approval") +
        "\nOpen ticket: https://app.meetathena.io/admin/support?ticket=" +
        encodeURIComponent(ticket.id) +
        "\n\n";
      notify = await deliverStored(deliveryOpts, ticket.messageRecordId, "owner", {
        from: inbox.from,
        to: [SUPPORT_PREVIEW_TO],
        subject: notifySubject(subject, ticket.ticket_number),
        text: note + copy.text,
        html:
          "<pre>" +
          escapeHtml(note) +
          "</pre>" +
          '<p><a href="https://app.meetathena.io/admin/support?ticket=' +
          encodeURIComponent(ticket.id) +
          '">Open ticket in Support</a></p>' +
          copy.html,
        attachments: copy.attachments,
        headers: { "X-ALP-Support-Mail": "notice", "Auto-Submitted": "auto-generated" },
      });
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new SupportDeliveryError("Support delivery pending retry", true);
  if (!ticket.inserted && autoreply === "already" && notify === "already")
    return { status: "duplicate", ticketNumber: ticket.ticket_number };
  return {
    status: "processed",
    ticketNumber: ticket.ticket_number,
    preview: disposition.action === "reply" ? previewState.preview : false,
    autoreply,
    notify,
  };
}

export async function sendManualSupportReply(opts: {
  ticketId: string;
  message: string;
  apiKey: string;
  store: SupportTicketStore;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ManualReplyResult> {
  const ticket = await opts.store.get(opts.ticketId);
  if (!ticket) throw new Error("Ticket not found");
  const inbox = inboxByBrand(ticket.brand);
  if (!inbox) throw new Error("Invalid support brand");
  const from = bareAddress(ticket.from_email);
  if (!isEmailAddress(from) || SUPPORT_ADDRESS_INDEX[from] || from.startsWith("mailer-daemon@"))
    throw new Error("Refusing to reply to this sender");
  const message = opts.message.split("\u0000").join("").trim();
  if (!message) throw new Error("Message is empty");
  const rendered = renderManualSupportReply({ inbox, ticketNumber: ticket.ticket_number, message });
  assertSupportFrom(inbox.from);
  const sent = await postResendEmail(
    opts.apiKey,
    opts.fetchImpl ?? fetch,
    {
      from: inbox.from,
      to: [SUPPORT_PREVIEW_TO],
      subject: autoreplySubject(ticket.subject, ticket.ticket_number),
      ...rendered,
      headers: { ...threadHeaders(ticket.message_id), "X-ALP-Support-Mail": "manual-preview" },
    },
    "support-manual-preview/" + ticket.id + "/" + (await sha256Hex(message)).slice(0, 32),
  );
  return {
    ticketNumber: ticket.ticket_number,
    from: inbox.from,
    to: SUPPORT_PREVIEW_TO,
    preview: true,
    resendId: sent.id,
  };
}
