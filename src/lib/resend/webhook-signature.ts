// Verifies Resend webhook signatures (Resend signs webhooks with Svix).
//
// Signed content is `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with
// the base64-decoded part of the `whsec_...` signing secret. The
// `svix-signature` header is a space-separated list of `v1,<base64>` entries.
// Uses WebCrypto so it runs on the Cloudflare Worker runtime.

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookSignatureHeaders = {
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
};

export type WebhookVerifyFailure =
  | "missing_headers"
  | "missing_secret"
  | "invalid_secret"
  | "stale_timestamp"
  | "invalid_signature";

export type WebhookVerifyResult = { ok: true } | { ok: false; reason: WebhookVerifyFailure };

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hasWebhookSignatureHeaders(headers: WebhookSignatureHeaders): boolean {
  return Boolean(headers.id?.trim() && headers.timestamp?.trim() && headers.signature?.trim());
}

export async function computeWebhookSignature(
  secret: string,
  id: string,
  timestamp: string,
  payload: string,
): Promise<string> {
  const keyBytes = base64ToBytes(secret.trim().replace(/^whsec_/, ""));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
  );
  return bytesToBase64(new Uint8Array(signed));
}

export async function verifyResendWebhook({
  payload,
  headers,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
}: {
  payload: string;
  headers: WebhookSignatureHeaders;
  secret: string | null | undefined;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<WebhookVerifyResult> {
  if (!hasWebhookSignatureHeaders(headers)) return { ok: false, reason: "missing_headers" };
  if (!secret?.trim()) return { ok: false, reason: "missing_secret" };

  const id = headers.id!.trim();
  const timestamp = headers.timestamp!.trim();
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) {
    return { ok: false, reason: "stale_timestamp" };
  }

  let expected: string;
  try {
    expected = await computeWebhookSignature(secret, id, timestamp, payload);
  } catch {
    return { ok: false, reason: "invalid_secret" };
  }

  const candidates = headers
    .signature!.trim()
    .split(/\s+/)
    .map((entry) => {
      const comma = entry.indexOf(",");
      return comma === -1
        ? { version: "", sig: "" }
        : { version: entry.slice(0, comma), sig: entry.slice(comma + 1) };
    })
    .filter((c) => c.version === "v1" && c.sig);

  const matched = candidates.some((c) => constantTimeEqual(c.sig, expected));
  return matched ? { ok: true } : { ok: false, reason: "invalid_signature" };
}
