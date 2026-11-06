import type { SupportBrand } from "./ticket.ts";

export type SupportTicket = {
  id: string;
  ticket_number: string;
  brand: SupportBrand;
  from_email: string;
  subject: string | null;
  message_id: string | null;
  received_at: string;
  status: string;
  raw_summary: string | null;
  resend_email_id: string;
  autoreply_sent_at: string | null;
  notify_sent_at: string | null;
  autoreply_suppressed_reason: string | null;
};

export type OpenedSupportTicket = SupportTicket & {
  inserted: boolean;
  messageRecordId: string;
  receiptMessageId: string;
  reviewReason: string | null;
  ackPreview: boolean;
  legacyImport: boolean;
};

export type OpenTicketInput = {
  resendEmailId: string;
  brand: SupportBrand;
  fromEmail: string;
  subject: string | null;
  messageId: string | null;
  receivedAt: string;
  rawSummary: string | null;
  evidence?: Record<string, unknown>;
  references?: string[];
  reviewReason?: string | null;
  preview?: boolean;
  senderVerified?: boolean;
  suppressedReason?: string | null;
};

export type SupportTicketStore = {
  open(input: OpenTicketInput): Promise<OpenedSupportTicket>;
  markAutoreplySent(id: string, at: string): Promise<void>;
  markNotifySent(id: string, at: string): Promise<void>;
  markAutoreplySuppressed(id: string, reason: string): Promise<void>;
  get(id: string): Promise<SupportTicket | null>;
  markReplied(id: string): Promise<void>;
  claimDelivery(
    messageId: string,
    kind: "ack" | "owner",
    payload: Record<string, unknown>,
  ): Promise<{
    state: "ready" | "sent" | "busy" | "review";
    token: string | null;
    payload: Record<string, unknown>;
    providerEmailId: string | null;
  }>;
  rememberDelivery(
    messageId: string,
    kind: "ack" | "owner",
    token: string,
    providerEmailId: string,
  ): Promise<void>;
  completeDelivery(
    messageId: string,
    kind: "ack" | "owner",
    token: string,
    providerMessageId: string | null,
  ): Promise<void>;
  finishDelivery(
    messageId: string,
    kind: "ack" | "owner",
    token: string,
    result: "sent" | "retry" | "review",
  ): Promise<void>;
};

export type SupportReplyMode = "preview" | "customer";

/** Message-IDs already in the customer's thread, oldest first. */
export type SupportThreadContext = {
  customerMessageIds: string[];
  receiptMessageIds: string[];
  replyMessageIds: string[];
};

export type SupportReplyClaimInput = {
  ticketId: string;
  staffUserId: string;
  mode: SupportReplyMode;
  to: string;
  from: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string | null;
  idempotencyKey: string;
};

export type SupportReplyStore = {
  threadContext(ticketId: string): Promise<SupportThreadContext>;
  claim(input: SupportReplyClaimInput): Promise<{
    state: "ready" | "sent" | "busy" | "review";
    id: string;
    providerEmailId: string | null;
  }>;
  finish(
    replyId: string,
    result: "accepted" | "sent" | "failed" | "review",
    providerEmailId: string | null,
    providerMessageId: string | null,
    error: string | null,
  ): Promise<void>;
};
