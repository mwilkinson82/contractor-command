import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendManualSupportReply } from "./process.ts";
import { supabaseSupportStore } from "./store.server.ts";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((role) => role.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

/** Admin reply on an existing ticket, from that ticket's support address. */
export const sendSupportTicketReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ticketId: string; message: string }) =>
    z
      .object({
        ticketId: z.string().uuid(),
        message: z.string().trim().min(1).max(8000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
    return sendManualSupportReply({
      ticketId: data.ticketId,
      message: data.message,
      apiKey,
      store: supabaseSupportStore,
      env: process.env,
    });
  });
