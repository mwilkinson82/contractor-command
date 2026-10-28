import {
  forwardReceivedEmail,
  InboundForwardError,
  type ForwardOptions,
  type ForwardResult,
} from "@/lib/resend/inbound-forward";
import {
  hasWebhookSignatureHeaders,
  verifyResendWebhook,
  type WebhookSignatureHeaders,
} from "@/lib/resend/webhook-signature";
import { processSupportInbound, type SupportProcessResult } from "@/lib/support/process";
import { SupportDeliveryError } from "@/lib/support/resend-send";
import { supabaseSupportStore } from "@/lib/support/store.server";
import { collectAddresses, supportInboxForAddresses } from "@/lib/support/ticket";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type ReceivedEvent = {
  type?: unknown;
  data?: {
    email_id?: unknown;
    to?: unknown;
    cc?: unknown;
    bcc?: unknown;
    received_for?: unknown;
  } | null;
};

export type InboundHttpDeps = {
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  nowSeconds?: number;
  forward: (emailId: string, opts: ForwardOptions) => Promise<ForwardResult>;
  processSupport: (
    emailId: string,
    opts: {
      apiKey: string;
      env: NodeJS.ProcessEnv;
      hint: ReturnType<typeof supportInboxForAddresses>;
    },
  ) => Promise<SupportProcessResult>;
};

let cachedWebhookSecret: string | undefined;

class WebhookConfigurationError extends Error {
  constructor(readonly reason: string, status?: number) {
    super("Webhook not configured");
    console.error("[resend-inbound] webhook configuration", { reason, status });
  }
}

async function resolveWebhookSecret(deps: InboundHttpDeps): Promise<string> {
  const apiKey = deps.env.RESEND_API_KEY;
  if (!apiKey) throw new WebhookConfigurationError("no_api_key");
  if (cachedWebhookSecret) return cachedWebhookSecret;

  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(
      "https://api.resend.com/webhooks/035b0a5b-a721-48c3-92d6-1bc0304e2c6f",
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
    );
  } catch {
    throw new WebhookConfigurationError("resend_fetch_failed");
  }
  if (!response.ok) {
    throw new WebhookConfigurationError(`resend_http_${response.status}`, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WebhookConfigurationError("no_secret_field", response.status);
  }
  const fields = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const secret = [fields.signing_secret, fields.secret].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (!secret) throw new WebhookConfigurationError("no_secret_field", response.status);
  cachedWebhookSecret = secret;
  return secret;
}

function defaultDeps(overrides?: Partial<InboundHttpDeps>): InboundHttpDeps {
  return {
    env: overrides?.env ?? process.env,
    nowSeconds: overrides?.nowSeconds,
    fetchImpl: overrides?.fetchImpl,
    forward: overrides?.forward ?? ((emailId, opts) => forwardReceivedEmail(emailId, opts)),
    processSupport:
      overrides?.processSupport ??
      ((emailId, opts) =>
        processSupportInbound(emailId, {
          apiKey: opts.apiKey,
          env: opts.env,
          hint: opts.hint,
          store: supabaseSupportStore,
        })),
  };
}

export async function handleResendInboundPost(
  request: Request,
  overrides?: Partial<InboundHttpDeps>,
): Promise<Response> {
  const deps = defaultDeps(overrides);
  const payload = await request.text();
  const headers: WebhookSignatureHeaders = {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };

  if (!hasWebhookSignatureHeaders(headers)) {
    return json({ ok: false, error: "Missing webhook signature" }, 401);
  }

  const usingCachedSecret = !deps.env.RESEND_WEBHOOK_SECRET && !!cachedWebhookSecret;
  let verified: Awaited<ReturnType<typeof verifyResendWebhook>>;
  try {
    const secret = deps.env.RESEND_WEBHOOK_SECRET || await resolveWebhookSecret(deps);
    verified = await verifyResendWebhook({
      payload,
      headers,
      secret,
      nowSeconds: deps.nowSeconds,
    });
    if (!verified.ok && usingCachedSecret) {
      cachedWebhookSecret = undefined;
      const refreshedSecret = await resolveWebhookSecret(deps);
      verified = await verifyResendWebhook({
        payload,
        headers,
        secret: refreshedSecret,
        nowSeconds: deps.nowSeconds,
      });
    }
  } catch (err) {
    if (!(err instanceof WebhookConfigurationError)) throw err;
    return json({ ok: false, error: "Webhook not configured", reason: err.reason }, 500);
  }
  if (!verified.ok) {
    console.warn("[resend-inbound] rejected webhook", {
      reason: verified.reason,
      svixId: headers.id,
    });
    return json({ ok: false, error: "Invalid webhook signature" }, 401);
  }

  let event: ReceivedEvent;
  try {
    event = JSON.parse(payload) as ReceivedEvent;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (event.type !== "email.received") {
    return json({ ok: true, ignored: true, type: event.type ?? null }, 200);
  }

  const emailId = event.data?.email_id;
  if (typeof emailId !== "string" || !emailId) {
    return json({ ok: false, error: "Missing data.email_id" }, 400);
  }

  const apiKey = deps.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[resend-inbound] RESEND_API_KEY is not configured", { emailId });
    return json({ ok: false, error: "Forwarder not configured" }, 500);
  }

  const hint = supportInboxForAddresses(
    collectAddresses(event.data?.to, event.data?.cc, event.data?.bcc, event.data?.received_for),
  );
  if (hint) {
    try {
      const result = await deps.processSupport(emailId, { apiKey, env: deps.env, hint });
      if (result.status !== "not_support") {
        console.log("[resend-inbound] support", {
          emailId,
          svixId: headers.id,
          status: result.status,
          ticketNumber: "ticketNumber" in result ? result.ticketNumber : null,
        });
        return json({ ok: true, emailId, ...result }, 200);
      }
    } catch (err) {
      const retryable = err instanceof SupportDeliveryError ? err.retryable : true;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[resend-inbound] support failed", {
        emailId,
        svixId: headers.id,
        retryable,
        error: message.slice(0, 300),
      });
      if (retryable) return json({ ok: false, error: "Support ticket failed; retry" }, 500);
      return json({ ok: false, emailId, error: "Support ticket failed permanently" }, 200);
    }
  }

  try {
    const result = await deps.forward(emailId, { apiKey });
    console.log("[resend-inbound] processed", { emailId, svixId: headers.id, ...result });
    return json({ ok: true, emailId, ...result }, 200);
  } catch (err) {
    const retryable = err instanceof InboundForwardError ? err.retryable : true;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[resend-inbound] forward failed", {
      emailId,
      svixId: headers.id,
      retryable,
      error: message.slice(0, 1000),
    });
    if (retryable) return json({ ok: false, error: "Forward failed; retry" }, 500);
    return json({ ok: false, emailId, error: "Forward failed permanently" }, 200);
  }
}
