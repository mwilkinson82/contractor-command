// Morning brief web push. The cron caller is the service role, every 5 minutes.
// Members use their own sign-in token. No email.
// VAPID keys are ATHENA_VAPID_PUBLIC_KEY and ATHENA_VAPID_PRIVATE_KEY. They are not committed.
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { renderHtml } from "@/lib/mcp/cards/html";
import { vapidConfig } from "@/lib/mcp/field-push";
import type { Sb } from "@/lib/mcp/guard";
import { buildMorningBrief, ensureBriefCard } from "@/lib/mcp/morning-brief";
import { briefJobsFromFeed, loadBriefJobs, readBriefSettings } from "@/lib/mcp/morning-brief-load";
import { briefPageMarkup, dispatchMorningBriefs, MORNING_BRIEF_CRON } from "@/lib/mcp/morning-brief-push";
import type { PushSendLog } from "@/lib/mcp/field-push-send";

function envUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function userClient(base: string, pub: string, token: string): SupabaseClient {
  return createClient(base, pub, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function pushLog(admin: SupabaseClient, entry: PushSendLog): Promise<void> {
  const saved = await admin.rpc("mcp_push_log_send", {
    _subscription: entry.subscriptionId,
    _user: entry.userId,
    _job: entry.jobId,
    _status: entry.status,
    _http: entry.httpCode,
    _error: entry.errorText,
    _kind: entry.payloadKind,
  });
  if (saved.error) throw new Error("Could not write the push log.");
}

export const Route = createFileRoute("/api/athena/morning-brief")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = bearer(request);
        const pub = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const base = envUrl();
        if (!token || !pub || !base) return Response.json({ error: "Sign in first." }, { status: 401 });
        const sb = userClient(base, pub, token);
        const { data, error } = await sb.auth.getUser(token);
        if (error || !data.user) return Response.json({ error: "Sign in first." }, { status: 401 });
        const url = new URL(request.url);
        if (url.searchParams.get("vapid") === "1") {
          const keys = vapidConfig();
          if (!keys) return Response.json({ error: "Morning briefing is not configured yet." }, { status: 503 });
          return Response.json({ publicKey: keys.publicKey });
        }
        if (url.searchParams.get("status") === "1") {
          const subscribed = await sb.rpc("mcp_user_push_subscribed");
          return Response.json({ subscribed: subscribed.data === true });
        }
        try {
          const gate = sb as unknown as Sb;
          const loaded = await loadBriefJobs(gate);
          const settings = await readBriefSettings(gate);
          const built = buildMorningBrief({ jobs: loaded.jobs, hasCompany: loaded.hasCompany, settings });
          return Response.json({ html: briefPageMarkup(renderHtml(ensureBriefCard(built.card))) });
        } catch {
          return Response.json({ error: "Could not open today's brief." }, { status: 400 });
        }
      },
      POST: async ({ request }) => {
        const token = bearer(request);
        const base = envUrl();
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!token || !base) return Response.json({ error: "Unauthorized" }, { status: 401 });
        let body: {
          action?: string;
          subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad request." }, { status: 400 });
        }
        if (body.action === "dispatch") {
          if (!serviceKey || token !== serviceKey) return Response.json({ error: "Forbidden" }, { status: 403 });
          const admin = createClient(base, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await admin.rpc("mcp_morning_brief_candidates");
          if (error) return Response.json({ error: "Could not read morning briefs." }, { status: 500 });
          const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
          const origin = new URL(request.url).origin;
          const result = await dispatchMorningBriefs({
            rows,
            origin,
            loadBrief: async (userId) => {
              const feed = await admin.rpc("mcp_morning_brief_feed_for", { _user: userId });
              if (feed.error) throw new Error("Could not read the morning brief.");
              const jobs = briefJobsFromFeed((Array.isArray(feed.data) ? feed.data : []) as Parameters<typeof briefJobsFromFeed>[0]);
              return { jobs, hasCompany: true };
            },
            markSent: async (userId, day, text) => {
              const marked = await admin.rpc("mcp_morning_brief_mark_sent", {
                _user: userId,
                _day: day,
                _body: text,
              });
              if (marked.error) throw new Error("Could not record the morning brief.");
              return (marked.data as { marked?: boolean } | null)?.marked === true;
            },
            logSend: (entry) => pushLog(admin, entry),
            markDead: async (id) => {
              const saved = await admin.rpc("mcp_user_push_mark_dead", { _id: id });
              if (saved.error) throw new Error("Could not turn off the dead subscription.");
            },
          });
          return Response.json({ sent: result.sent, failed: result.failed, cron: MORNING_BRIEF_CRON });
        }
        const pub = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!pub) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const sb = userClient(base, pub, token);
        const { data: userData, error: userError } = await sb.auth.getUser(token);
        if (userError || !userData.user) return Response.json({ error: "Sign in first." }, { status: 401 });
        if (body.action === "subscribe") {
          if (!body.subscription?.endpoint || !body.subscription.keys?.p256dh || !body.subscription.keys.auth) {
            return Response.json({ error: "Missing subscription." }, { status: 400 });
          }
          const saved = await sb.rpc("mcp_user_push_subscription_save", {
            _endpoint: body.subscription.endpoint,
            _p256dh: body.subscription.keys.p256dh,
            _auth: body.subscription.keys.auth,
          });
          if (saved.error) return Response.json({ error: "Could not save the morning briefing." }, { status: 400 });
          return Response.json({ saved: true });
        }
        return Response.json({ error: "Unknown action." }, { status: 400 });
      },
    },
  },
});
