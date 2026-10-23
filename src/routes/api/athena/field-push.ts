// Field-page web push. The cron caller is the service role. Members use their own sign-in token.
// VAPID keys are ATHENA_VAPID_PUBLIC_KEY and ATHENA_VAPID_PRIVATE_KEY. They are not committed.
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  fieldManifest,
  pushPayload,
  VAPID_MISSING_STATUS,
  vapidConfig,
} from "@/lib/mcp/field-push";
import { dispatchFieldPushes, recordFieldPush, type PushSendLog } from "@/lib/mcp/field-push-send";
import { isUuid } from "@/lib/report-pages";

function envUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function serviceClient(): SupabaseClient | null {
  const base = envUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) return null;
  return createClient(base, serviceKey, {
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

async function pushDead(admin: SupabaseClient, id: string): Promise<void> {
  const saved = await admin.rpc("mcp_push_mark_dead", { _id: id });
  if (saved.error) throw new Error("Could not turn off the dead subscription.");
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
          return Response.json(fieldManifest(job, origin), {
            headers: { "content-type": "application/manifest+json" },
          });
        }
        const token = bearer(request);
        const pub =
          process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const base = envUrl();
        if (!token || !pub || !base)
          return Response.json({ error: "Sign in first." }, { status: 401 });
        const sb = createClient(base, pub, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await sb.auth.getUser(token);
        if (error || !data.user) return Response.json({ error: "Sign in first." }, { status: 401 });
        const keys = vapidConfig();
        if (!keys)
          return Response.json({ error: "Reminders are not configured yet." }, { status: 503 });
        return Response.json({ publicKey: keys.publicKey });
      },
      POST: async ({ request }) => {
        const token = bearer(request);
        const base = envUrl();
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!token || !base) return Response.json({ error: "Unauthorized" }, { status: 401 });
        let body: {
          action?: string;
          jobId?: string;
          subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad request." }, { status: 400 });
        }
        if (body.action === "dispatch") {
          if (!serviceKey || token !== serviceKey)
            return Response.json({ error: "Forbidden" }, { status: 403 });
          const admin = createClient(base, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await admin.rpc("mcp_push_due");
          if (error) return Response.json({ error: "Could not read reminders." }, { status: 500 });
          const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
          const result = await dispatchFieldPushes({
            rows,
            origin: new URL(request.url).origin,
            markSent: async (id, day) => {
              const marked = await admin.rpc("mcp_push_mark_sent", { _id: id, _day: day });
              if (marked.error) throw new Error("Could not record the reminder.");
              return (marked.data as { marked?: boolean } | null)?.marked === true;
            },
            logSend: (entry) => pushLog(admin, entry),
            markDead: (id) => pushDead(admin, id),
          });
          return Response.json({ sent: result.sent, failed: result.failed });
        }
        const pub =
          process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!pub) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const sb = createClient(base, pub, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userError } = await sb.auth.getUser(token);
        if (userError || !userData.user)
          return Response.json({ error: "Sign in first." }, { status: 401 });
        if (body.action === "subscribe") {
          if (
            !isUuid(body.jobId) ||
            !body.subscription?.endpoint ||
            !body.subscription.keys?.p256dh ||
            !body.subscription.keys.auth
          ) {
            return Response.json({ error: "Missing subscription." }, { status: 400 });
          }
          const saved = await sb.rpc("mcp_push_subscription_save", {
            _job: body.jobId,
            _endpoint: body.subscription.endpoint,
            _p256dh: body.subscription.keys.p256dh,
            _auth: body.subscription.keys.auth,
          });
          if (saved.error)
            return Response.json({ error: "Could not save the reminder." }, { status: 400 });
          return Response.json({ saved: true });
        }
        if (body.action === "test") {
          if (!isUuid(body.jobId)) return Response.json({ error: "Missing job." }, { status: 400 });
          const targets = await sb.rpc("mcp_push_test_targets", { _job: body.jobId });
          if (targets.error)
            return Response.json(
              { error: "Test notifications are only for job 2701." },
              { status: 400 },
            );
          const list = (Array.isArray(targets.data) ? targets.data : []) as Record<
            string,
            unknown
          >[];
          if (list.length > 0 && !vapidConfig()) {
            console.error(VAPID_MISSING_STATUS);
            const admin = serviceClient();
            if (admin) {
              try {
                await pushLog(admin, {
                  subscriptionId: null,
                  userId: userData.user.id,
                  jobId: body.jobId,
                  status: "unconfigured",
                  httpCode: null,
                  errorText: VAPID_MISSING_STATUS,
                  payloadKind: "test",
                });
              } catch {
                // The member still gets the not-configured response.
              }
            }
            return Response.json({ error: "Reminders are not configured yet." }, { status: 503 });
          }
          const admin = serviceClient();
          let sent = 0;
          let failed = 0;
          for (const raw of list) {
            const outcome = await recordFieldPush({
              target: {
                id: typeof raw.id === "string" ? raw.id : null,
                userId: userData.user.id,
                jobId: body.jobId,
                endpoint: String(raw.endpoint ?? ""),
                p256dh: String(raw.p256dh ?? ""),
                auth: String(raw.auth ?? ""),
              },
              message: pushPayload(body.jobId, "2701", new URL(request.url).origin),
              payloadKind: "test",
              logSend: admin ? (entry) => pushLog(admin, entry) : async () => {},
              markDead: admin ? (id) => pushDead(admin, id) : async () => {},
            });
            if (outcome === "sent") sent += 1;
            else failed += 1;
          }
          return Response.json({ sent, failed });
        }
        return Response.json({ error: "Unknown action." }, { status: 400 });
      },
    },
  },
});
