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

export type OpenedSupportTicket = SupportTicket & { inserted: boolean };

export type OpenTicketInput = {
  resendEmailId: string;
  brand: SupportBrand;
  fromEmail: string;
  subject: string | null;
  messageId: string | null;
  receivedAt: string;
  rawSummary: string | null;
};

export type SupportTicketStore = {
  open(input: OpenTicketInput): Promise<OpenedSupportTicket>;
  markAutoreplySent(id: string, at: string): Promise<void>;
  markNotifySent(id: string, at: string): Promise<void>;
  markAutoreplySuppressed(id: string, reason: string): Promise<void>;
  get(id: string): Promise<SupportTicket | null>;
  markReplied(id: string): Promise<void>;
};
