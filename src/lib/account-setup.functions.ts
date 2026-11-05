// Account page setup checklist: has Athena answered this member in a connected AI app, and has the company saved a job?
// The job count reads through the member's own database rights. The AI check reads only the caller's own usage rows,
// by the signed-in user id, and returns a yes or no; nothing else from the log leaves the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SetupProgress } from "@/lib/account-profile";
import { readSetupProgress, type CallLogReader, type JobsReader } from "@/lib/account-setup";

export const getSetupProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ companyId: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<SetupProgress | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await readSetupProgress(
        context.supabase as unknown as JobsReader,
        supabaseAdmin as unknown as CallLogReader,
        context.userId,
        data.companyId,
      );
    } catch {
      return null;
    }
  });
