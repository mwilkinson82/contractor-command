// Field-page web push. The cron caller is the service role. Members use their own sign-in token.
// VAPID keys are ATHENA_VAPID_PUBLIC_KEY and ATHENA_VAPID_PRIVATE_KEY. They are not committed.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { fieldManifest, pushIsDue, pushPayload, vapidConfig, type PushCandidate } from "@/lib/mcp/field-push";
import { sendFieldPush } from "@/lib/mcp/field-push-send";
import { zonedClock } from "@/lib/mcp/field-reminder";
import { isUuid } from "@/lib/report-pages";

function envUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

export const Route = createFileRoute("/api/athena/field-push")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("manifest") === "1") {
          const job = url.searchParams.get("job") ?? "";
          if (!isUuid(job)) return Response.json({ error: "Missing job." }, { status: 400 });
          const origin = url.origin;
          return Response.json(fieldManifest(job, origin), { headers: { "content-type": "application/manifest+json" } });
        }
        const token = bearer(request);
        const pub = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const base = envUrl();
        if (!token || !pub || !base) return Response.json({ error: "Sign in first." }, { status: 401 });
        const sb = createClient(base, pub, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
        const { data, error } = await sb.auth.getUser(token);
        if (error || !data.user) return Response.json({ error: "Sign in first." }, { status: 401 });
        const keys = vapidConfig();
        if (!keys) return Response.json({ error: "Reminders are not configured yet." }, { status: 503 });
        return Response.json({ publicKey: keys.publicKey });
      },
      POST: async ({ request }) => {
        const token = bearer(request);
        const base = envUrl();
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!token || !base) return Response.json({ error: "Unauthorized" }, { status: 401 });
        let body: { action?: string; jobId?: string; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad request." }, { status: 400 });
        }
        if (body.action === "dispatch") {
          if (!serviceKey || token !== serviceKey) return Response.json({ error: "Forbidden" }, { status: 403 });
          const admin = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
          const { data, error } = await admin.rpc("mcp_push_due");
          if (error) return Response.json({ error: "Could not read reminders." }, { status: 500 });
          const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
          const now = new Date();
          let sent = 0;
          for (const raw of rows) {
            const row: PushCandidate = {
              id: String(raw.id),
              jobNumber: String(raw.job_number ?? ""),
              jobName: String(raw.job_name ?? ""),
              endpoint: String(raw.endpoint ?? ""),
              p256dh: String(raw.p256dh ?? ""),
              auth: String(raw.auth ?? ""),
              enabled: raw.enabled === true,
              sendLocal: String(raw.send_local ?? "14:30"),
              timeZone: String(raw.time_zone ?? "America/New_York"),
              dailyToday: raw.daily_today === true,
              lastSentOn: raw.last_sent_on ? String(raw.last_sent_on).slice(0, 10) : null,
            };
            if (!pushIsDue(row, now)) continue;
            const day = zonedClock(row.timeZone, now).date;
            const marked = await admin.rpc("mcp_push_mark_sent", { _id: row.id, _day: day });
            if (marked.error || !(marked.data as { marked?: boolean } | null)?.marked) continue;
            const result = await sendFieldPush(row, pushPayload(String(raw.job_id), row.jobNumber, new URL(request.url).origin));
            if (result === "sent") sent += 1;
          }
          return Response.json({ sent });
        }
        const pub = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!pub) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const sb = createClient(base, pub, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
        const { data: userData, error: userError } = await sb.auth.getUser(token);
        if (userError || !userData.user) return Response.json({ error: "Sign in first." }, { status: 401 });
        if (body.action === "subscribe") {
          if (!isUuid(body.jobId) || !body.subscription?.endpoint || !body.subscription.keys?.p256dh || !body.subscription.keys.auth) {
            return Response.json({ error: "Missing subscription." }, { status: 400 });
          }
          const saved = await sb.rpc("mcp_push_subscription_save", {
            _job: body.jobId,
            _endpoint: body.subscription.endpoint,
            _p256dh: body.subscription.keys.p256dh,
            _auth: body.subscription.keys.auth,
          });
          if (saved.error) return Response.json({ error: "Could not save the reminder." }, { status: 400 });
          return Response.json({ saved: true });
        }
        if (body.action === "test") {
          if (!isUuid(body.jobId)) return Response.json({ error: "Missing job." }, { status: 400 });
          const targets = await sb.rpc("mcp_push_test_targets", { _job: body.jobId });
          if (targets.error) return Response.json({ error: "Test notifications are only for job 2701." }, { status: 400 });
          const list = (Array.isArray(targets.data) ? targets.data : []) as Record<string, unknown>[];
          let sent = 0;
          for (const raw of list) {
            const result = await sendFieldPush(
              { endpoint: String(raw.endpoint), p256dh: String(raw.p256dh), auth: String(raw.auth) },
              pushPayload(body.jobId, "2701", new URL(request.url).origin),
            );
            if (result === "unconfigured") return Response.json({ error: "Reminders are not configured yet." }, { status: 503 });
            sent += 1;
          }
          return Response.json({ sent });
        }
        return Response.json({ error: "Unknown action." }, { status: 400 });
      },
    },
  },
});
