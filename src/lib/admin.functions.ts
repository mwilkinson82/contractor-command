import { createServerFn } from "@tanstack/react-start";
import Stripe from "stripe";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processEmailQueues, type ProcessEmailQueueResult } from "@/lib/email/process-queue.server";

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
  library: {
    templates: number;
    templatesPublished: number;
    replays: number;
    replaysPublished: number;
  };
  topics: { pending: number; selected: number };
  signups: { last7: number; last30: number };
  intensiveLeads: number;
  billingQuestions: number;
};

const EMAIL_LOG_STATUSES = [
  "pending",
  "sent",
  "suppressed",
  "failed",
  "bounced",
  "complained",
  "dlq",
] as const;

type EmailLogStatus = (typeof EMAIL_LOG_STATUSES)[number];

export type EmailDeliveryLogRow = {
  id: string;
  createdAt: string;
  messageId: string | null;
  templateName: string;
  recipientEmail: string;
  status: string;
  errorMessage: string | null;
  channel: string | null;
  reason: string | null;
};

export type EmailDeliveryHealth = {
  generatedAt: string;
  config: {
    lovableApiConfigured: boolean;
    customSendUrlConfigured: boolean;
  };
  sendState: {
    retryAfterUntil: string | null;
    rateLimitedNow: boolean;
    batchSize: number | null;
    sendDelayMs: number | null;
    authEmailTtlMinutes: number | null;
    transactionalEmailTtlMinutes: number | null;
  } | null;
  totalsLast24h: Record<EmailLogStatus, number>;
  publicMagicLinksLast24h: Record<EmailLogStatus, number>;
  suppressedAllTime: number;
  suppressedLast30d: number;
  stalePending: EmailDeliveryLogRow[];
  recentFailures: EmailDeliveryLogRow[];
  recentPublicMagicLinks: EmailDeliveryLogRow[];
};

function emptyStatusCounts(): Record<EmailLogStatus, number> {
  return EMAIL_LOG_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {} as Record<EmailLogStatus, number>,
  );
}

function statusKey(status: string): EmailLogStatus | null {
  return EMAIL_LOG_STATUSES.includes(status as EmailLogStatus) ? (status as EmailLogStatus) : null;
}

function metadataValue(metadata: unknown, key: "channel" | "reason"): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function mapEmailLogRow(row: {
  id: string;
  created_at: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  metadata: unknown;
}): EmailDeliveryLogRow {
  return {
    id: row.id,
    createdAt: row.created_at,
    messageId: row.message_id,
    templateName: row.template_name,
    recipientEmail: row.recipient_email,
    status: row.status,
    errorMessage: row.error_message,
    channel: metadataValue(row.metadata, "channel"),
    reason: metadataValue(row.metadata, "reason"),
  };
}

async function assertAdminUser(userId: string): Promise<void> {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

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
    const { data: topics } = await supabaseAdmin.from("call_topics").select("status");
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
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since30),
    ]);

    // ----- Vault counters -----
    const [{ count: intensiveLeads }, { count: billingQuestions }] = await Promise.all([
      supabaseAdmin
        .from("vault_packets")
        .select("id", { count: "exact", head: true })
        .eq("kind", "intensive_lead"),
      supabaseAdmin
        .from("vault_packets")
        .select("id", { count: "exact", head: true })
        .eq("kind", "billing_question"),
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

export const getEmailDeliveryHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailDeliveryHealth> => {
    const { userId } = context;
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const staleBefore = new Date(now - 10 * 60 * 1000).toISOString();

    const [
      { data: state },
      { data: recentLogs },
      { count: suppressedAllTime },
      { count: suppressedLast30d },
    ] = await Promise.all([
      supabaseAdmin
        .from("email_send_state")
        .select(
          "retry_after_until,batch_size,send_delay_ms,auth_email_ttl_minutes,transactional_email_ttl_minutes",
        )
        .eq("id", 1)
        .maybeSingle(),
      supabaseAdmin
        .from("email_send_log")
        .select(
          "id,created_at,message_id,template_name,recipient_email,status,error_message,metadata",
        )
        .gte("created_at", since24h)
        .order("created_at", { ascending: false })
        .limit(250),
      supabaseAdmin.from("suppressed_emails").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("suppressed_emails")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since30d),
    ]);

    const rows = (recentLogs ?? []).map(mapEmailLogRow);
    const totalsLast24h = emptyStatusCounts();
    const publicMagicLinksLast24h = emptyStatusCounts();

    for (const row of rows) {
      const key = statusKey(row.status);
      if (!key) continue;
      totalsLast24h[key] += 1;
      if (row.templateName === "login-nudge" && row.channel === "public_magic_link") {
        publicMagicLinksLast24h[key] += 1;
      }
    }

    const sentMessageIds = new Set(
      rows
        .filter((row) => row.status === "sent" && row.messageId)
        .map((row) => row.messageId as string),
    );

    return {
      generatedAt: new Date(now).toISOString(),
      config: {
        lovableApiConfigured: Boolean(process.env.LOVABLE_API_KEY),
        customSendUrlConfigured: Boolean(process.env.LOVABLE_SEND_URL),
      },
      sendState: state
        ? {
            retryAfterUntil: state.retry_after_until,
            rateLimitedNow: Boolean(
              state.retry_after_until && new Date(state.retry_after_until).getTime() > now,
            ),
            batchSize: state.batch_size,
            sendDelayMs: state.send_delay_ms,
            authEmailTtlMinutes: state.auth_email_ttl_minutes,
            transactionalEmailTtlMinutes: state.transactional_email_ttl_minutes,
          }
        : null,
      totalsLast24h,
      publicMagicLinksLast24h,
      suppressedAllTime: suppressedAllTime ?? 0,
      suppressedLast30d: suppressedLast30d ?? 0,
      stalePending: rows
        .filter(
          (row) =>
            row.status === "pending" &&
            row.createdAt < staleBefore &&
            (!row.messageId || !sentMessageIds.has(row.messageId)),
        )
        .slice(0, 12),
      recentFailures: rows
        .filter((row) => ["failed", "bounced", "complained", "dlq"].includes(row.status))
        .slice(0, 12),
      recentPublicMagicLinks: rows
        .filter((row) => row.templateName === "login-nudge" && row.channel === "public_magic_link")
        .slice(0, 12),
    };
  });

export const processEmailQueueNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProcessEmailQueueResult> => {
    await assertAdminUser(context.userId);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY is not configured in this environment.");
    }

    return processEmailQueues({
      supabase: supabaseAdmin,
      apiKey,
      sendUrl: process.env.LOVABLE_SEND_URL,
      maxCycles: 8,
    });
  });
