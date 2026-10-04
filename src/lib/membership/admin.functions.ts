import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reconcileCircleAudience, drainCircleAudienceSync } from "./reconcile.server";
import { membershipDb } from "./circle.server";

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

/** Exact owner-reviewed identity mapping; it never creates a comp or paid period. */
export const setCircleSourceAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        confirm: z.literal("apply-reviewed-circle-source-alias"),
        source: z.object({
          id: z.string().uuid(),
          stripeSubscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/),
          stripeCustomerId: z.string().regex(/^cus_[A-Za-z0-9]+$/),
          userId: z.string().uuid().nullable(),
          email: z.string().trim().toLowerCase().email(),
        }),
        targetUserId: z.string().uuid(),
        targetEmail: z.string().trim().toLowerCase().email(),
        billingEmail: z.string().trim().toLowerCase().email(),
        enabled: z.boolean(),
        reason: z.string().trim().min(1).max(2000),
        expiresAt: z.string().datetime().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { data: aliasId, error } = await membershipDb(supabaseAdmin).rpc(
      "set_circle_source_alias",
      {
        _source_id: data.source.id,
        _expected_stripe_subscription_id: data.source.stripeSubscriptionId,
        _expected_stripe_customer_id: data.source.stripeCustomerId,
        _expected_source_user_id: data.source.userId,
        _expected_source_email: data.source.email,
        _target_user_id: data.targetUserId,
        _target_email: data.targetEmail,
        _billing_email: data.billingEmail,
        _actor: context.userId,
        _enabled: data.enabled,
        _reason: data.reason,
        _expires_at: data.expiresAt ?? null,
      },
    );
    if (error) throw new Error(error.message);
    return { aliasId };
  });
