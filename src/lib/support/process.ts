import { postResendEmail, sha256Hex, SupportDeliveryError } from "./resend-send.ts";
import type { SupportTicketStore } from "./store.ts";
import {
  renderManualSupportReply,
  renderSupportAutoreply,
  renderSupportNotice,
} from "./template.ts";
import {
  assertSupportFrom,
  autoreplySubject,
  bareAddress,
  customerReplyTo,
  inboxByBrand,
  inboxForMail,
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

const RESEND_API = "https://api.resend.com";

export type SupportProcessResult =
  | { status: "not_support" }
  | { status: "skipped"; reason: string }
  | { status: "duplicate"; ticketNumber: string }
  | {
      status: "processed";
      ticketNumber: string;
      preview: boolean;
      autoreply: "sent" | "suppressed" | "already";
      notify: "sent" | "already";
    };

export type ManualReplyResult = {
  ticketNumber: string;
  from: string;
  to: string;
  preview: boolean;
  resendId: string | null;
};

type Outbound = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

async function getReceived(
  emailId: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<InboundMail | null> {
  let res: Response;
  try {
    res = await fetchImpl(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    throw new SupportDeliveryError(
      `Resend get received email failed: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
  if (res.status === 404) return null;
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok || !body || typeof body !== "object") {
    const retryable =
      res.status === 401 ||
      res.status === 403 ||
      res.status === 408 ||
      res.status === 429 ||
      res.status >= 500;
    throw new SupportDeliveryError(`Resend get received email failed (${res.status})`, retryable);
  }
  return body as InboundMail;
}

async function deliver(
  apiKey: string,
  fetchImpl: typeof fetch,
  payload: Outbound,
  idempotencyKey: string,
): Promise<{ id: string | null }> {
  assertSupportFrom(payload.from);
  for (const recipient of payload.to) {
    if (!isEmailAddress(recipient)) {
      throw new SupportDeliveryError("Invalid recipient", false);
    }
  }
  const sent = await postResendEmail(apiKey, fetchImpl, payload, idempotencyKey);
  return { id: sent.id };
}

function autoreplyNote(
  disposition: "reply" | "record_only",
  reason: string | null,
  preview: boolean,
  customer: string,
): string {
  if (disposition === "record_only") {
    return `Auto-reply: not sent (${reason ?? "suppressed"}).`;
  }
  if (preview) return "Auto-reply: preview only, sent to you. The sender was not emailed.";
  return `Auto-reply: sent to ${customer}.`;
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
  },
): Promise<SupportProcessResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date());
  const email = await getReceived(emailId, opts.apiKey, fetchImpl);
  if (!email) return { status: "skipped", reason: "not_found" };

  const inbox = inboxForMail(email) ?? opts.hint ?? null;
  if (!inbox) return { status: "not_support" };

  const disposition = inboundDisposition(email);
  if (disposition.action === "ignore") {
    return { status: "skipped", reason: disposition.reason };
  }

  const from = bareAddress(email.from);
  const messageId = messageIdFor(email);
  const subject = email.subject ? oneLine(email.subject).slice(0, 500) : null;
  const ticket = await opts.store.open({
    resendEmailId: emailId,
    brand: inbox.brand,
    fromEmail: from,
    subject,
    messageId,
    receivedAt: receivedAtIso(email, now()),
    rawSummary: summarizeMail(email),
  });

  const previewState = customerReplyTo(from, env);
  let changed = false;
  let autoreply: "sent" | "suppressed" | "already" = "already";

  if (ticket.autoreply_sent_at) {
    autoreply = "already";
  } else if (ticket.autoreply_suppressed_reason || disposition.action === "record_only") {
    if (!ticket.autoreply_suppressed_reason && disposition.action === "record_only") {
      await opts.store.markAutoreplySuppressed(ticket.id, disposition.reason);
      changed = true;
    }
    autoreply = "suppressed";
  } else {
    const rendered = renderSupportAutoreply({ inbox, ticketNumber: ticket.ticket_number });
    await deliver(
      opts.apiKey,
      fetchImpl,
      {
        from: inbox.from,
        to: [previewState.to],
        subject: autoreplySubject(subject, ticket.ticket_number),
        html: rendered.html,
        text: rendered.text,
        headers: {
          ...threadHeaders(messageId),
          "Auto-Submitted": "auto-replied",
          "X-ALP-Support-Mail": "auto",
        },
      },
      `support-autoreply/${ticket.id}`,
    );
    await opts.store.markAutoreplySent(ticket.id, now().toISOString());
    changed = true;
    autoreply = "sent";
  }

  let notify: "sent" | "already" = "already";
  if (!ticket.notify_sent_at) {
    const note = autoreplyNote(
      disposition.action === "record_only" ? "record_only" : "reply",
      disposition.action === "record_only"
        ? disposition.reason
        : ticket.autoreply_suppressed_reason,
      previewState.preview,
      from,
    );
    const rendered = renderSupportNotice({
      inbox,
      ticketNumber: ticket.ticket_number,
      fromEmail: from,
      subject: subject ?? "(no subject)",
      summary: ticket.raw_summary,
      autoreplyNote: note,
    });
    await deliver(
      opts.apiKey,
      fetchImpl,
      {
        from: inbox.from,
        to: [SUPPORT_PREVIEW_TO],
        subject: notifySubject(subject, ticket.ticket_number),
        html: rendered.html,
        text: rendered.text,
        headers: { "X-ALP-Support-Mail": "notice" },
      },
      `support-notify/${ticket.id}`,
    );
    await opts.store.markNotifySent(ticket.id, now().toISOString());
    changed = true;
    notify = "sent";
  }

  if (!ticket.inserted && !changed) {
    return { status: "duplicate", ticketNumber: ticket.ticket_number };
  }
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
  if (!inbox) throw new Error("Ticket brand is not a support inbox");
  const from = bareAddress(ticket.from_email);
  const local = from.split("@")[0] ?? "";
  if (!isEmailAddress(from) || SUPPORT_ADDRESS_INDEX[from] || local === "mailer-daemon") {
    throw new Error("Refusing to reply to this sender");
  }
  const message = opts.message.split("\u0000").join("").trim();
  if (!message) throw new Error("Message is empty");
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const previewState = customerReplyTo(from, env);
  const rendered = renderManualSupportReply({
    inbox,
    ticketNumber: ticket.ticket_number,
    message,
  });
  const sent = await deliver(
    opts.apiKey,
    fetchImpl,
    {
      from: inbox.from,
      to: [previewState.to],
      subject: autoreplySubject(ticket.subject, ticket.ticket_number),
      html: rendered.html,
      text: rendered.text,
      headers: {
        ...threadHeaders(ticket.message_id),
        "X-ALP-Support-Mail": "manual",
      },
    },
    `support-manual/${ticket.id}/${(await sha256Hex(message)).slice(0, 32)}`,
  );
  if (!previewState.preview) await opts.store.markReplied(ticket.id);
  return {
    ticketNumber: ticket.ticket_number,
    from: inbox.from,
    to: previewState.to,
    preview: previewState.preview,
    resendId: sent.id,
  };
}
