import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reconcileCircleAudience, drainCircleAudienceSync } from "./reconcile.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error || !data?.some((r) => r.role === "admin")) throw new Error("Forbidden");
}
export const previewCircleReconciliation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return reconcileCircleAudience(supabaseAdmin, { apiKey: process.env.RESEND_API_KEY ?? "" });
  });
export const applyCircleReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        confirm: z.literal("apply-reviewed-circle-reconciliation"),
        reviewedPlanHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    return reconcileCircleAudience(supabaseAdmin, {
      apply: true,
      reviewedPlanHash: data.reviewedPlanHash,
      apiKey: process.env.RESEND_API_KEY ?? "",
    });
  });
export const retryCircleAudienceSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return drainCircleAudienceSync(supabaseAdmin, { apiKey: process.env.RESEND_API_KEY ?? "" });
  });
