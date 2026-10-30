export class SupportDeliveryError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "SupportDeliveryError";
    this.retryable = retryable;
  }
}

export function retryableStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  );
}

type SendResult = { id: string; duplicate: boolean };

function errorName(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const name = (body as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

export async function postResendEmail(
  apiKey: string,
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new SupportDeliveryError(
      `Resend send failed: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (res.status === 409 && errorName(parsed) === "invalid_idempotent_request") {
    throw new SupportDeliveryError("Idempotency payload conflict requires review", false);
  }
  if (!res.ok) {
    throw new SupportDeliveryError(
      `Resend send failed (${res.status})`,
      retryableStatus(res.status),
    );
  }
  const id = parsed && typeof parsed === "object" ? (parsed as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id) throw new SupportDeliveryError("Send outcome uncertain", true);
  return { id, duplicate: false };
}

// Resend may replace a caller-supplied Message-ID. Only its authenticated sent
// email response establishes the identity a recipient will actually reply to.
export async function getDeliveredMessageId(
  apiKey: string,
  fetchImpl: typeof fetch,
  emailId: string,
  expected: Record<string, unknown>,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/emails/" + encodeURIComponent(emailId), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new SupportDeliveryError("Sent email metadata unavailable", true);
  }
  if (!res.ok)
    throw new SupportDeliveryError("Sent email metadata unavailable (" + res.status + ")", true);
  let body: Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    throw new SupportDeliveryError("Sent email metadata unavailable", true);
  }
  const address = (value: unknown) => {
    if (typeof value !== "string") return "";
    return (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase();
  };
  if (
    !body ||
    body.id !== emailId ||
    address(body.from) !== address(expected.from) ||
    !Array.isArray(body.to) ||
    !Array.isArray(expected.to) ||
    JSON.stringify(body.to.map(address)) !== JSON.stringify(expected.to.map(address)) ||
    (Array.isArray(body.cc) && body.cc.length > 0) ||
    (Array.isArray(body.bcc) && body.bcc.length > 0)
  )
    throw new SupportDeliveryError("Sent email identity mismatch requires review", false);
  const messageId = body.message_id;
  if (typeof messageId !== "string" || !/^<[^<>\s]{1,996}>$/.test(messageId))
    throw new SupportDeliveryError("Sent email Message-ID not available yet", true);
  return messageId;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
