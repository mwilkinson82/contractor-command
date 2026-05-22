import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import Stripe from "stripe";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAllowedReturnTo } from "@/lib/return-to";

function appendReturnTo(url: string, returnTo?: string): string {
  const ok = isAllowedReturnTo(returnTo ?? null);
  if (!ok) return url;
  return `${url}${url.includes("?") ? "&" : "?"}return_to=${encodeURIComponent(ok)}`;
}

const INTENSIVE_AMOUNT_CENTS = 500_000; // $5,000 USD
const INTENSIVE_NAME = "Six-Week Contractor Intensive";
const INTENSIVE_DESC = "Six private working sessions with Marshall.";

function getStripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe is not configured.");
  return new Stripe(secret, { apiVersion: "2024-12-18.acacia" as never });
}

function originFromRequest(): string {
  const req = getRequest();
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export const createIntensiveCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      source: z.enum(["intensive_page", "ask_marshall", "packet"]).default("intensive_page"),
      threadId: z.string().uuid().optional(),
    }).parse,
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const stripe = getStripe();
    const { userId, supabase } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email,full_name")
      .eq("id", userId)
      .maybeSingle();

    const email = profile?.email ?? undefined;
    const origin = originFromRequest();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: INTENSIVE_AMOUNT_CENTS,
            product_data: {
              name: INTENSIVE_NAME,
              description: INTENSIVE_DESC,
            },
          },
        },
      ],
      success_url: `${origin}/work-with-marshall?intensive=success`,
      cancel_url: `${origin}/work-with-marshall?intensive=cancelled`,
      metadata: {
        user_id: userId,
        kind: "intensive",
        source: data.source,
        thread_id: data.threadId ?? "",
      },
    });

    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    return { url: session.url };
  });

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const stripe = getStripe();
    const { userId, supabase } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    const email = profile?.email;
    if (!email) throw new Error("No email on file.");

    // Find the most recent subscription's customer id
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .ilike("email", email)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let customerId = sub?.stripe_customer_id as string | undefined;
    if (!customerId) {
      // Fallback: look up by email in Stripe
      const list = await stripe.customers.list({ email, limit: 1 });
      customerId = list.data[0]?.id;
    }
    if (!customerId) throw new Error("No Stripe customer found for your account.");

    const origin = originFromRequest();
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account`,
    });
    return { url: portal.url };
  });

export const createCircleCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ returnTo: z.string().url().optional() }).parse)
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const stripe = getStripe();
    const priceId = process.env.STRIPE_PRICE_ID_CIRCLE;
    if (!priceId) {
      throw new Error(
        "Circle pricing isn't configured yet. Reach out to support and we'll get you in.",
      );
    }
    const { userId, supabase } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    const origin = originFromRequest();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: profile?.email ?? undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: appendReturnTo(`${origin}/?circle=welcome`, data.returnTo),
      cancel_url: `${origin}/upgrade?circle=cancelled`,
      metadata: { user_id: userId, kind: "circle", product: "circle" },
      subscription_data: {
        metadata: { user_id: userId, kind: "circle", product: "circle" },
      },
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    return { url: session.url };
  });

export const submitBillingQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      subject: z.string().min(1).max(160),
      message: z.string().min(1).max(4000),
    }).parse,
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("vault_packets").insert({
      user_id: userId,
      kind: "billing_question",
      source: "Account · Billing",
      status: "Open",
      title: data.subject,
      payload: {
        subject: data.subject,
        message: data.message,
        captured_at: new Date().toISOString(),
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Capture interest for SKUs that aren't wired to Stripe yet
// (Book Buyer, Hardcore).
export const requestUpsellInterest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      sku: z.enum(["book_buyer", "hardcore"]),
      note: z.string().max(1000).optional(),
    }).parse,
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email,full_name")
      .eq("id", userId)
      .maybeSingle();
    const { error } = await supabase.from("vault_packets").insert({
      user_id: userId,
      kind: "upsell_interest",
      source: "Upgrade · Interest",
      status: "Open",
      title: `Interest: ${data.sku}`,
      payload: {
        sku: data.sku,
        note: data.note ?? "",
        email: profile?.email ?? "",
        full_name: profile?.full_name ?? "",
        captured_at: new Date().toISOString(),
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Generic checkout for any plan with a configured Stripe price ID.
// Mode is detected from the Stripe price (recurring → subscription,
// one_time → payment). Metadata is set so the webhook can map the
// purchase to the correct tier (or skip tier assignment for call packs).
const PLAN_MAP: Record<
  string,
  { env: string; product: string; success: string; cancel: string }
> = {
  power_hour_month: {
    env: "STRIPE_PRICE_ID_POWER_HOUR_MONTH",
    product: "power_hour",
    success: "/?upsell=power_hour",
    cancel: "/upgrade?upsell=cancelled",
  },
  power_hour_quarter: {
    env: "STRIPE_PRICE_ID_POWER_HOUR_QUARTER",
    product: "power_hour",
    success: "/?upsell=power_hour",
    cancel: "/upgrade?upsell=cancelled",
  },
  sm_school_month: {
    env: "STRIPE_PRICE_ID_SM_SCHOOL_MONTH",
    product: "sm_school",
    success: "/?upsell=sm_school",
    cancel: "/upgrade?upsell=cancelled",
  },
  sm_school_quarter: {
    env: "STRIPE_PRICE_ID_SM_SCHOOL_QUARTER",
    product: "sm_school",
    success: "/?upsell=sm_school",
    cancel: "/upgrade?upsell=cancelled",
  },
  contractor_school_month: {
    env: "STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_MONTH",
    product: "contractor_school",
    success: "/?upsell=contractor_school",
    cancel: "/upgrade?upsell=cancelled",
  },
  contractor_school_quarter: {
    env: "STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_QUARTER",
    product: "contractor_school",
    success: "/?upsell=contractor_school",
    cancel: "/upgrade?upsell=cancelled",
  },
  call_1: {
    env: "STRIPE_PRICE_ID_CALL_1",
    product: "calls",
    success: "/work-with-marshall?calls=success",
    cancel: "/work-with-marshall?calls=cancelled",
  },
  call_3: {
    env: "STRIPE_PRICE_ID_CALL_3",
    product: "calls",
    success: "/work-with-marshall?calls=success",
    cancel: "/work-with-marshall?calls=cancelled",
  },
  call_6: {
    env: "STRIPE_PRICE_ID_CALL_6",
    product: "calls",
    success: "/work-with-marshall?calls=success",
    cancel: "/work-with-marshall?calls=cancelled",
  },
};

export const createSkuCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      plan: z.enum([
        "power_hour_month",
        "power_hour_quarter",
        "sm_school_month",
        "sm_school_quarter",
        "contractor_school_month",
        "contractor_school_quarter",
        "call_1",
        "call_3",
        "call_6",
      ]),
      returnTo: z.string().url().optional(),
    }).parse,
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const stripe = getStripe();
    const cfg = PLAN_MAP[data.plan];
    const priceId = process.env[cfg.env];
    if (!priceId) {
      throw new Error(`Pricing isn't configured for ${data.plan}. Reach out to support.`);
    }
    const { userId, supabase } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    // Detect mode from the price object.
    const price = await stripe.prices.retrieve(priceId);
    const mode: "subscription" | "payment" = price.recurring ? "subscription" : "payment";

    const origin = originFromRequest();
    const meta = {
      user_id: userId,
      kind: cfg.product,
      product: cfg.product,
      plan: data.plan,
    };

    const session = await stripe.checkout.sessions.create({
      mode,
      customer_email: profile?.email ?? undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: appendReturnTo(`${origin}${cfg.success}`, data.returnTo),
      cancel_url: `${origin}${cfg.cancel}`,
      metadata: meta,
      ...(mode === "subscription"
        ? { subscription_data: { metadata: meta } }
        : { payment_intent_data: { metadata: meta } }),
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    return { url: session.url };
  });


// ---------------------------------------------------------------------------
// AOS add-ons (extra seats / workspaces). Monthly recurring, quantity-based.
// Today these are only offered to book buyers via the panel on /aos and
// /upgrade. The DB function get_user_aos_limits() stacks aos_addons quantity
// on top of the buyer's base 1 ws / 2 seats.
// ---------------------------------------------------------------------------

type AosAddonKind = "seat" | "workspace";

const AOS_ADDON_PRICE_ENV: Record<AosAddonKind, string> = {
  seat: "STRIPE_PRICE_ID_AOS_SEAT_MONTH",
  workspace: "STRIPE_PRICE_ID_AOS_WORKSPACE_MONTH",
};

export const createAosAddonCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      kind: z.enum(["seat", "workspace"]),
      quantity: z.number().int().min(1).max(50),
      returnTo: z.string().url().optional(),
    }).parse,
  )
  .handler(
    async ({ data, context }): Promise<{ url: string; mode: "checkout" | "portal" }> => {
      const stripe = getStripe();
      const priceId = process.env[AOS_ADDON_PRICE_ENV[data.kind]];
      if (!priceId) {
        throw new Error(
          `AOS add-on pricing isn't configured for ${data.kind}. Reach out to support.`,
        );
      }
      const { userId, supabase } = context;
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .maybeSingle();
      const email = profile?.email ?? undefined;

      // If they already have an active addon row of this kind, send them to
      // the Stripe billing portal so they can bump quantity in-place.
      const { data: existing } = await supabase
        .from("aos_addons")
        .select("stripe_customer_id,stripe_subscription_id,status")
        .eq("user_id", userId)
        .eq("kind", data.kind)
        .in("status", ["active", "trialing", "past_due"])
        .maybeSingle();

      const origin = originFromRequest();

      if (existing?.stripe_customer_id) {
        const portal = await stripe.billingPortal.sessions.create({
          customer: existing.stripe_customer_id,
          return_url: `${origin}/aos`,
        });
        return { url: portal.url, mode: "portal" };
      }

      const meta = {
        user_id: userId,
        kind: "aos_addon",
        product: "aos_addon",
        addon_kind: data.kind,
      };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: email,
        line_items: [{ price: priceId, quantity: data.quantity }],
        success_url: appendReturnTo(`${origin}/aos?addon=success`, data.returnTo),
        cancel_url: `${origin}/aos?addon=cancelled`,
        metadata: meta,
        subscription_data: { metadata: meta },
      });
      if (!session.url) throw new Error("Stripe returned no checkout URL.");
      return { url: session.url, mode: "checkout" };
    },
  );

export type AosAddonRow = {
  kind: AosAddonKind;
  quantity: number;
  status: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
};

export const getMyAosAddons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AosAddonRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("aos_addons")
      .select("kind,quantity,status,stripe_subscription_id,current_period_end")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data as AosAddonRow[] | null) ?? [];
  });
