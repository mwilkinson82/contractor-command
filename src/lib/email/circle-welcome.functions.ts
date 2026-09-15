// Admin-only backfill: send the Circle welcome email to a specific address.
// Useful when a member signed up before the welcome was wired into the
// Stripe webhook, or when re-sending after a bounce.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  email: z.string().email(),
  firstName: z.string().trim().max(100).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const sendCircleWelcomeBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enqueueCircleWelcome } = await import("@/lib/email/enqueue-circle-welcome");
    const { appOrigin, ensureMagicLinkForMember } = await import("@/lib/email/ensure-magic-link");

    const email = data.email.toLowerCase();
    const loginUrl = await ensureMagicLinkForMember(supabaseAdmin, email, appOrigin());
    const result = await enqueueCircleWelcome({
      supabaseAdmin,
      email,
      firstName: data.firstName ?? null,
      loginUrl,
      idempotencyKey: data.idempotencyKey ?? `circle-welcome-backfill-${email}`,
    });

    return result;
  });
