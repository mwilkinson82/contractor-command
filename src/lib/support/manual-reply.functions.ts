import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin reply on an existing ticket, from that ticket's support address, signed by it.
 * mode preview sends the same email to Marshall only; customer sends it to the ticket's
 * sender and needs the address the page showed. Members can never call this.
 * Server modules load inside the handler so the page bundle never includes them.
 */
export const sendSupportTicketReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      ticketId: string;
      message: string;
      mode: "preview" | "customer";
      expectTo?: string;
    }) =>
      z
        .object({
          ticketId: z.string().uuid(),
          message: z.string().trim().min(1).max(8000),
          mode: z.enum(["preview", "customer"]),
          expectTo: z.string().trim().max(320).optional(),
        })
        .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireSupportAdmin } = await import("./dashboard.server");
    const { sendManualSupportReply } = await import("./process.ts");
    const { supabaseSupportReplyStore, supabaseSupportStore } = await import("./store.server.ts");
    await requireSupportAdmin(supabaseAdmin, context.userId);
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
    return sendManualSupportReply({
      ticketId: data.ticketId,
      message: data.message,
      mode: data.mode,
      expectTo: data.expectTo ?? null,
      staffUserId: context.userId,
      apiKey,
      store: supabaseSupportStore,
      replies: supabaseSupportReplyStore,
    });
  });
