import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const readSupportDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ticketId?: string; page: number }) =>
    z
      .object({ ticketId: z.string().uuid().optional(), page: z.number().int().min(0).max(100000) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { supportDashboard } = await import("./dashboard.server");
    return supportDashboard(supabaseAdmin, context.userId, data.ticketId, data.page);
  });
export const readSupportAttachment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { messageId: string; index: number }) =>
    z.object({ messageId: z.string().uuid(), index: z.number().int().min(0).max(100) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { supportAttachment } = await import("./dashboard.server");
    return supportAttachment(supabaseAdmin, context.userId, data.messageId, data.index);
  });

export const listSupportAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { messageId: string }) =>
    z.object({ messageId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { supportAttachmentList } = await import("./dashboard.server");
    return supportAttachmentList(supabaseAdmin, context.userId, data.messageId);
  });
