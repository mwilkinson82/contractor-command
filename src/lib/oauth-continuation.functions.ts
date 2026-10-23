import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const resolveOAuthContinuation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      continuation: z.string().max(2048),
      tokenHash: z.string().max(512),
      accessToken: z.string().max(8192),
    }).parse,
  )
  .handler(async ({ data }): Promise<string | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyOAuthContinuation } = await import("./oauth-continuation.server");
    // Never trust user IDs or emails from browser storage or token decoding.
    const { data: identity, error } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (error || !identity.user) return null;
    return verifyOAuthContinuation(data.continuation, identity.user.id, data.tokenHash);
  });
