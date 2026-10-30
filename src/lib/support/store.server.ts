import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SupportDeliveryError } from "./resend-send.ts";
import type { SupportBrand } from "./ticket.ts";
import type {
  OpenedSupportTicket,
  OpenTicketInput,
  SupportTicket,
  SupportTicketStore,
} from "./store.ts";

type RpcError = { message: string; code?: string } | null;

type SupportClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: RpcError }>;
    };
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{ data: unknown; error: RpcError }>;
      };
    };
  };
};

const COLUMNS =
  "id,ticket_number,brand,from_email,subject,message_id,received_at,status,raw_summary,resend_email_id,autoreply_sent_at,notify_sent_at,autoreply_suppressed_reason";

function client(): SupportClient {
  return supabaseAdmin as unknown as SupportClient;
}

function asBrand(value: unknown): SupportBrand {
  if (value === "athena" || value === "circle") return value;
  throw new Error("Ticket brand is not a support inbox");
}

function asNullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function asTicket(row: Record<string, unknown>): SupportTicket {
  return {
    id: String(row.id),
    ticket_number: String(row.ticket_number),
    brand: asBrand(row.brand),
    from_email: String(row.from_email),
    subject: asNullable(row.subject),
    message_id: asNullable(row.message_id),
    received_at: String(row.received_at),
    status: String(row.status),
    raw_summary: asNullable(row.raw_summary),
    resend_email_id: String(row.resend_email_id),
    autoreply_sent_at: asNullable(row.autoreply_sent_at),
    notify_sent_at: asNullable(row.notify_sent_at),
    autoreply_suppressed_reason: asNullable(row.autoreply_suppressed_reason),
  };
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  }
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

async function updateTicket(id: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await client().from("support_tickets").update(values).eq("id", id);
  if (error) throw new Error(error.message);
}

export const supabaseSupportStore: SupportTicketStore = {
  async open(input: OpenTicketInput): Promise<OpenedSupportTicket> {
    const { data, error } = await client().rpc("record_support_message", {
      _resend_email_id: input.resendEmailId,
      _brand: input.brand,
      _from_email: input.fromEmail,
      _subject: input.subject,
      _message_id: input.messageId,
      _received_at: input.receivedAt,
      _raw_summary: input.rawSummary,
      _evidence: input.evidence ?? {},
      _references: input.references ?? [],
      _review_reason: input.reviewReason ?? null,
      _preview: input.preview ?? true,
      _sender_verified: input.senderVerified === true,
      _suppressed_reason: input.suppressedReason ?? null,
    });
    if (error) throw new Error("Unable to record support message");
    const row = firstRow(data);
    if (!row) throw new Error("open_support_ticket returned no row");
    return {
      ...asTicket(row),
      inserted: row.inserted === true,
      messageRecordId: String(row.message_record_id),
      receiptMessageId: String(row.receipt_message_id),
      reviewReason: asNullable(row.review_reason),
      ackPreview: row.ack_preview !== false,
      legacyImport: row.legacy_import === true,
    };
  },
  async markAutoreplySent(id: string, at: string) {
    await updateTicket(id, { autoreply_sent_at: at });
  },
  async markNotifySent(id: string, at: string) {
    await updateTicket(id, { notify_sent_at: at });
  },
  async markAutoreplySuppressed(id: string, reason: string) {
    await updateTicket(id, { autoreply_suppressed_reason: reason });
  },
  async get(id: string) {
    const { data, error } = await client()
      .from("support_tickets")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || typeof data !== "object") return null;
    return asTicket(data as Record<string, unknown>);
  },
  async markReplied(id: string) {
    await updateTicket(id, { status: "replied" });
  },
  async claimDelivery(messageId, kind, payload) {
    const { data, error } = await client().rpc("claim_support_delivery", {
      _message_id: messageId,
      _kind: kind,
      _payload: payload,
    });
    if (error) throw new Error("Unable to claim support delivery");
    const row = firstRow(data);
    if (!row || !["ready", "sent", "busy", "review"].includes(String(row.state)))
      throw new Error("Invalid delivery claim");
    return {
      state: row.state as "ready" | "sent" | "busy" | "review",
      token: asNullable(row.token),
      payload: row.payload as Record<string, unknown>,
      providerEmailId: asNullable(row.provider_email_id),
    };
  },
  async rememberDelivery(messageId, kind, token, providerEmailId) {
    const { error } = await client().rpc("remember_support_delivery", {
      _message_id: messageId,
      _kind: kind,
      _token: token,
      _provider_email_id: providerEmailId,
    });
    if (error)
      throw new SupportDeliveryError(
        "Unable to retain accepted support delivery",
        !["23505", "P0001"].includes(error.code ?? ""),
      );
  },
  async completeDelivery(messageId, kind, token, providerMessageId) {
    const { error } = await client().rpc("complete_support_delivery", {
      _message_id: messageId,
      _kind: kind,
      _token: token,
      _provider_message_id: providerMessageId,
    });
    if (error)
      throw new SupportDeliveryError(
        "Unable to record support delivery identity",
        !["23505", "P0001"].includes(error.code ?? ""),
      );
  },
  async finishDelivery(messageId, kind, token, result) {
    const { error } = await client().rpc("finish_support_delivery", {
      _message_id: messageId,
      _kind: kind,
      _token: token,
      _result: result,
    });
    if (error) throw new Error("Unable to record support delivery outcome");
  },
};
