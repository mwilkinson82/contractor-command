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

type SendResult = { id: string | null; duplicate: boolean };

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
  return { id: typeof id === "string" ? id : null, duplicate: false };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
