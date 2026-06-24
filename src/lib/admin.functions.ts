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
  askMarshall: AskMarshallMetrics;
  intensiveLeads: number;
  billingQuestions: number;
};

export type AskMarshallTopUser = {
  userId: string;
  email: string | null;
  fullName: string | null;
  messages30d: number;
  lastMessageAt: string;
};

export type AskMarshallMetrics = {
  userMessages7d: number;
  userMessages30d: number;
  userMessagesAllTime: number;
  activeUsers7d: number;
  activeUsers30d: number;
  activeUsersAllTime: number;
  threads7d: number;
  threads30d: number;
  dashboardThreads30d: number;
  latestUserMessageAt: string | null;
  topUsers30d: AskMarshallTopUser[];
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

const TERMINAL_EMAIL_LOG_STATUSES = [
  "sent",
  "suppressed",
  "failed",
  "bounced",
  "complained",
  "dlq",
] as const;

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
  stalePendingCount: number;
  recentFailures: EmailDeliveryLogRow[];
  actionableFailures: EmailDeliveryLogRow[];
  recentPublicMagicLinks: EmailDeliveryLogRow[];
};

export type EmailQueueAuditTotals = {
  total: number;
  visibleNow: number;
  hiddenUntilVisible: number;
  wouldSend: number;
  wouldMoveToDlq: number;
  wouldSkipDuplicate: number;
  wouldSuppress: number;
  missingQueuedAt: number;
  missingRequiredFields: number;
  maxRetriesExceeded: number;
  ttlExpired: number;
};

export type EmailQueueAuditSummaryRow = {
  queueName: string;
  total: number;
  visibleNow: number;
  wouldSend: number;
  wouldMoveToDlq: number;
  wouldSkipDuplicate: number;
  wouldSuppress: number;
};

export type EmailQueueAuditTemplateRow = EmailQueueAuditSummaryRow & {
  templateName: string;
};

export type EmailQueueAuditSampleRow = {
  queueName: string;
  msgId: number;
  templateName: string;
  recipientEmail: string | null;
  visibleNow: boolean;
  queuedAt: string | null;
  outcome:
    | "would_send"
    | "ttl_expired"
    | "missing_required_fields"
    | "max_retries_exceeded"
    | "already_sent_duplicate"
    | "would_suppress"
    | "hidden_until_visible"
    | "needs_review";
};

export type EmailQueueAudit = {
  generatedAt: string;
  ttlMinutes: {
    auth_emails: number;
    transactional_emails: number;
  };
  totals: EmailQueueAuditTotals;
  queues: EmailQueueAuditSummaryRow[];
  templates: EmailQueueAuditTemplateRow[];
  samples: EmailQueueAuditSampleRow[];
  recommendation:
    | "empty"
    | "would_send_live_email"
    | "safe_to_drain"
    | "waiting_for_visibility"
    | "needs_review";
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

function isTerminalEmailLogStatus(status: string): boolean {
  return TERMINAL_EMAIL_LOG_STATUSES.includes(
    status as (typeof TERMINAL_EMAIL_LOG_STATUSES)[number],
  );
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

function isExpiredQueueHistory(row: EmailDeliveryLogRow): boolean {
  return (
    row.status === "dlq" &&
    (row.reason === "ttl_exceeded" || row.errorMessage?.startsWith("TTL exceeded") === true)
  );
}

function isLegacyProviderFailure(row: EmailDeliveryLogRow): boolean {
  return row.status === "failed" && row.errorMessage?.includes("missing_unsubscribe") === true;
}

function isActionableDeliveryProblem(row: EmailDeliveryLogRow): boolean {
  if (isLegacyProviderFailure(row)) {
    return false;
  }
  if (row.status === "dlq") {
    return !isExpiredQueueHistory(row);
  }
  return ["failed", "bounced", "complained"].includes(row.status);
}

async function assertAdminUser(userId: string): Promise<void> {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

function emptyAskMarshallMetrics(): AskMarshallMetrics {
  return {
    userMessages7d: 0,
    userMessages30d: 0,
    userMessagesAllTime: 0,
    activeUsers7d: 0,
    activeUsers30d: 0,
    activeUsersAllTime: 0,
    threads7d: 0,
    threads30d: 0,
    dashboardThreads30d: 0,
    latestUserMessageAt: null,
    topUsers30d: [],
  };
}

async function buildAskMarshallMetrics(
  since7: string,
  since30: string,
): Promise<AskMarshallMetrics> {
  try {
    const [
      { count: userMessages7d },
      { count: userMessages30d },
      { count: userMessagesAllTime },
      { count: threads7d },
      { count: threads30d },
      { count: dashboardThreads30d, error: dashboardThreadsError },
      { data: recentMessages, error: recentMessagesError },
      { data: allUserMessages, error: allUserMessagesError },
    ] = await Promise.all([
      supabaseAdmin
        .from("ask_messages")
        .select("id", { count: "exact", head: true })
        .eq("role", "user")
        .gte("created_at", since7),
      supabaseAdmin
        .from("ask_messages")
        .select("id", { count: "exact", head: true })
        .eq("role", "user")
        .gte("created_at", since30),
      supabaseAdmin
        .from("ask_messages")
        .select("id", { count: "exact", head: true })
        .eq("role", "user"),
      supabaseAdmin
        .from("ask_threads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7),
      supabaseAdmin
        .from("ask_threads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since30),
      supabaseAdmin
        .from("ask_threads")
        .select("id", { count: "exact", head: true })
        .eq("source" as never, "dashboard_hero")
        .gte("created_at", since30),
      supabaseAdmin
        .from("ask_messages")
        .select("user_id,created_at")
        .eq("role", "user")
        .gte("created_at", since30)
        .order("created_at", { ascending: false })
        .range(0, 9999),
      supabaseAdmin
        .from("ask_messages")
        .select("user_id")
        .eq("role", "user")
        .range(0, 9999),
    ]);

    if (recentMessagesError) {
      console.error("[admin.ask-usage] recent messages lookup failed", recentMessagesError);
    }
    if (allUserMessagesError) {
      console.error("[admin.ask-usage] all-time user lookup failed", allUserMessagesError);
    }
    if (dashboardThreadsError) {
      console.error("[admin.ask-usage] dashboard source lookup failed", dashboardThreadsError);
    }

    const recentRows = (recentMessages ?? []) as Array<{ user_id: string; created_at: string }>;
    const allRows = (allUserMessages ?? []) as Array<{ user_id: string }>;
    const since7Ms = new Date(since7).getTime();
    const activeUsers7d = new Set(
      recentRows
        .filter((row) => new Date(row.created_at).getTime() >= since7Ms)
        .map((row) => row.user_id),
    );
    const activeUsers30d = new Set(recentRows.map((row) => row.user_id));
    const activeUsersAllTime = new Set(allRows.map((row) => row.user_id));
    const topCounts = new Map<string, { messages30d: number; lastMessageAt: string }>();

    for (const row of recentRows) {
      const current = topCounts.get(row.user_id);
      if (!current) {
        topCounts.set(row.user_id, { messages30d: 1, lastMessageAt: row.created_at });
        continue;
      }
      current.messages30d += 1;
      if (new Date(row.created_at).getTime() > new Date(current.lastMessageAt).getTime()) {
        current.lastMessageAt = row.created_at;
      }
    }

    const topUserIds = Array.from(topCounts.entries())
      .sort((a, b) => {
        if (b[1].messages30d !== a[1].messages30d) {
          return b[1].messages30d - a[1].messages30d;
        }
        return new Date(b[1].lastMessageAt).getTime() - new Date(a[1].lastMessageAt).getTime();
      })
      .slice(0, 5)
      .map(([userId]) => userId);

    const { data: profiles, error: profilesError } =
      topUserIds.length > 0
        ? await supabaseAdmin.from("profiles").select("id,email,full_name").in("id", topUserIds)
        : { data: [], error: null };

    if (profilesError) {
      console.error("[admin.ask-usage] profile lookup failed", profilesError);
    }

    const profileById = new Map(
      ((profiles ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>).map(
        (profile) => [profile.id, profile],
      ),
    );
    const topUsers30d = topUserIds.map((userId) => {
      const usage = topCounts.get(userId)!;
      const profile = profileById.get(userId);
      return {
        userId,
        email: profile?.email ?? null,
        fullName: profile?.full_name ?? null,
        messages30d: usage.messages30d,
        lastMessageAt: usage.lastMessageAt,
      };
    });

    return {
      userMessages7d: userMessages7d ?? 0,
      userMessages30d: userMessages30d ?? 0,
      userMessagesAllTime: userMessagesAllTime ?? 0,
      activeUsers7d: activeUsers7d.size,
      activeUsers30d: activeUsers30d.size,
      activeUsersAllTime: activeUsersAllTime.size,
      threads7d: threads7d ?? 0,
      threads30d: threads30d ?? 0,
      dashboardThreads30d: dashboardThreadsError ? 0 : (dashboardThreads30d ?? 0),
      latestUserMessageAt: recentRows[0]?.created_at ?? null,
      topUsers30d,
    };
  } catch (error) {
    console.error("[admin.ask-usage] metrics failed", error);
    return emptyAskMarshallMetrics();
  }
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
    const [{ count: last7 }, { count: last30 }, askMarshall] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since30),
      buildAskMarshallMetrics(since7, since30),
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
      askMarshall,
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

    const pendingCandidateIds = Array.from(
      new Set(
        rows
          .filter((row) => row.status === "pending" && row.createdAt < staleBefore && row.messageId)
          .map((row) => row.messageId as string),
      ),
    );
    const terminalMessageIds = new Set(
      rows
        .filter((row) => row.messageId && isTerminalEmailLogStatus(row.status))
        .map((row) => row.messageId as string),
    );

    if (pendingCandidateIds.length > 0) {
      const { data: terminalLogs, error: terminalLogsError } = await supabaseAdmin
        .from("email_send_log")
        .select("message_id,status")
        .in("message_id", pendingCandidateIds)
        .in("status", [...TERMINAL_EMAIL_LOG_STATUSES]);

      if (terminalLogsError) {
        console.error("[admin.email-health] terminal log lookup failed", terminalLogsError);
      }

      for (const terminalLog of terminalLogs ?? []) {
        if (terminalLog.message_id) {
          terminalMessageIds.add(terminalLog.message_id);
        }
      }
    }

    const stalePending = rows.filter(
      (row) =>
        row.status === "pending" &&
        row.createdAt < staleBefore &&
        (!row.messageId || !terminalMessageIds.has(row.messageId)),
    );
    const recentFailures = rows.filter((row) =>
      ["failed", "bounced", "complained", "dlq"].includes(row.status),
    );
    const actionableFailures = recentFailures.filter(isActionableDeliveryProblem);

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
      stalePending: stalePending.slice(0, 12),
      stalePendingCount: stalePending.length,
      recentFailures: recentFailures.slice(0, 12),
      actionableFailures: actionableFailures.slice(0, 12),
      recentPublicMagicLinks: rows
        .filter((row) => row.templateName === "login-nudge" && row.channel === "public_magic_link")
        .slice(0, 12),
    };
  });

export const getEmailQueueAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailQueueAudit> => {
    await assertAdminUser(context.userId);

    const { data, error } = await supabaseAdmin.rpc("audit_email_queues");
    if (error) {
      console.error("[admin.email-queue-audit] query failed", error);
      throw new Error("Email queue audit is unavailable. Confirm the latest migration is applied.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Email queue audit returned an unexpected payload.");
    }

    return data as EmailQueueAudit;
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
