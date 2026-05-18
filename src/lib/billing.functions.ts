import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Stripe from "stripe";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const INTENSIVE_AMOUNT_CENTS = 500_000; // $5,000 USD
const INTENSIVE_NAME = "Six-Week Contractor Intensive";
const INTENSIVE_DESC = "Six private working sessions with Marshall.";

function getStripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe is not configured.");
  return new Stripe(secret, { apiVersion: "2024-12-18.acacia" as never });
}

function originFromRequest(req: Request): string {
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
  .handler(async ({ data, context, request }): Promise<{ url: string }> => {
    const stripe = getStripe();
    const { userId, supabase } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email,full_name")
      .eq("id", userId)
      .maybeSingle();

    const email = profile?.email ?? undefined;
    const origin = originFromRequest(request);

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
  .handler(async ({ context, request }): Promise<{ url: string }> => {
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

    const origin = originFromRequest(request);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account`,
    });
    return { url: portal.url };
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
