import { createServerFn } from "@tanstack/react-start";
import Stripe from "stripe";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  return new Stripe(secret, { apiVersion: "2024-12-18.acacia" as never });
}

export type AdminMetrics = {
  members: {
    total: number;
    active: number;
    comped: number;
    founding: number;
    trialing: number;
    canceled: number;
  };
  revenue: {
    mrrCents: number;
    activeSubscriptionsCount: number;
    intensiveLast30Cents: number;
    intensiveLast30Count: number;
    intensiveAllTimeCents: number;
    intensiveAllTimeCount: number;
    stripeAvailable: boolean;
  };
  library: { templates: number; templatesPublished: number; replays: number; replaysPublished: number };
  topics: { pending: number; selected: number };
  signups: { last7: number; last30: number };
  intensiveLeads: number;
  billingQuestions: number;
};

export const getAdminMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminMetrics> => {
    const { userId } = context;
    // Admin gate
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    // ----- Members / subscriptions -----
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("status,is_comped,is_founding");
    const members = {
      total: subs?.length ?? 0,
      active: (subs ?? []).filter((s) => s.status === "active").length,
      comped: (subs ?? []).filter((s) => s.is_comped).length,
      founding: (subs ?? []).filter((s) => s.is_founding).length,
      trialing: (subs ?? []).filter((s) => s.status === "trialing").length,
      canceled: (subs ?? []).filter((s) => s.status === "canceled").length,
    };

    // ----- Library -----
    const [{ data: tpls }, { data: reps }] = await Promise.all([
      supabaseAdmin.from("templates").select("published"),
      supabaseAdmin.from("replays").select("published"),
    ]);
    const library = {
      templates: tpls?.length ?? 0,
      templatesPublished: (tpls ?? []).filter((t) => t.published).length,
      replays: reps?.length ?? 0,
      replaysPublished: (reps ?? []).filter((r) => r.published).length,
    };

    // ----- Topics -----
    const { data: topics } = await supabaseAdmin
      .from("call_topics")
      .select("status");
    const topicsCount = {
      pending: (topics ?? []).filter((t) => t.status === "pending").length,
      selected: (topics ?? []).filter((t) => t.status === "selected").length,
    };

    // ----- Signups -----
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const since7 = new Date(now - 7 * day).toISOString();
    const since30 = new Date(now - 30 * day).toISOString();
    const [{ count: last7 }, { count: last30 }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since7),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since30),
    ]);

    // ----- Vault counters -----
    const [{ count: intensiveLeads }, { count: billingQuestions }] = await Promise.all([
      supabaseAdmin.from("vault_packets").select("id", { count: "exact", head: true }).eq("kind", "intensive_lead"),
      supabaseAdmin.from("vault_packets").select("id", { count: "exact", head: true }).eq("kind", "billing_question"),
    ]);

    // ----- Stripe revenue -----
    let mrrCents = 0;
    let activeSubscriptionsCount = 0;
    let intensiveLast30Cents = 0;
    let intensiveLast30Count = 0;
    let intensiveAllTimeCents = 0;
    let intensiveAllTimeCount = 0;
    const stripe = getStripe();
    const stripeAvailable = !!stripe;

    if (stripe) {
      try {
        // Active subscriptions MRR
        const subsList = await stripe.subscriptions.list({
          status: "active",
          limit: 100,
          expand: ["data.items.data.price"],
        });
        for (const s of subsList.data) {
          activeSubscriptionsCount += 1;
          for (const item of s.items.data) {
            const price = item.price;
            const amount = price.unit_amount ?? 0;
            const interval = price.recurring?.interval;
            const intervalCount = price.recurring?.interval_count ?? 1;
            const qty = item.quantity ?? 1;
            let monthly = 0;
            if (interval === "month") monthly = (amount * qty) / intervalCount;
            else if (interval === "year") monthly = (amount * qty) / (12 * intervalCount);
            else if (interval === "week") monthly = (amount * qty * 4.345) / intervalCount;
            else if (interval === "day") monthly = (amount * qty * 30) / intervalCount;
            mrrCents += monthly;
          }
        }

        // Intensive one-time charges (payment_intents with metadata.kind = "intensive")
        const since30Sec = Math.floor((now - 30 * day) / 1000);
        const recent = await stripe.checkout.sessions.list({
          limit: 100,
          created: { gte: since30Sec },
        });
        for (const sess of recent.data) {
          if (sess.payment_status !== "paid") continue;
          if (sess.metadata?.kind !== "intensive") continue;
          intensiveLast30Count += 1;
          intensiveLast30Cents += sess.amount_total ?? 0;
        }
        const allTime = await stripe.checkout.sessions.list({ limit: 100 });
        for (const sess of allTime.data) {
          if (sess.payment_status !== "paid") continue;
          if (sess.metadata?.kind !== "intensive") continue;
          intensiveAllTimeCount += 1;
          intensiveAllTimeCents += sess.amount_total ?? 0;
        }
      } catch (err) {
        console.error("[admin.metrics] stripe error", err);
      }
    }

    return {
      members,
      revenue: {
        mrrCents: Math.round(mrrCents),
        activeSubscriptionsCount,
        intensiveLast30Cents,
        intensiveLast30Count,
        intensiveAllTimeCents,
        intensiveAllTimeCount,
        stripeAvailable,
      },
      library,
      topics: topicsCount,
      signups: { last7: last7 ?? 0, last30: last30 ?? 0 },
      intensiveLeads: intensiveLeads ?? 0,
      billingQuestions: billingQuestions ?? 0,
    };
  });
