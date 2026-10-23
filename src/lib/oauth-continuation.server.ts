import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { oauthConsentReturn } from "./oauth-return-path";

const TTL = 30 * 60 * 1000;
export function assertOAuthContinuationConfigured(): void {
  const secret = process.env.OAUTH_CONTINUATION_SECRET;
  if (!secret || secret.length < 32) {
    // Fixed operator signal only: never log the value, length, token, identity,
    // or request URL. Public responses remain anti-enumerating.
    console.error("[oauth-continuation] configuration_error", {
      code: "OAUTH_CONTINUATION_NOT_CONFIGURED",
      action:
        "Configure OAUTH_CONTINUATION_SECRET in this project's Lovable Cloud Secrets before releasing connector sign-in.",
    });
    throw new Error("OAuth continuation is not configured");
  }
}
function key() {
  assertOAuthContinuationConfigured();
  return process.env.OAUTH_CONTINUATION_SECRET!;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sign = (payload: string) =>
  createHmac("sha256", key()).update(`athena-consent-v1.${payload}`).digest();

// This is a signed routing hint, never an authorization grant. The provider's
// one-time token must succeed first; consent then revalidates the authorization
// ID and requires the signed-in user to explicitly approve the displayed client.
export function createOAuthContinuation(
  path: string,
  userId: string,
  tokenHash: string,
  now = Date.now(),
): string {
  const safe = oauthConsentReturn(path);
  if (!safe || !userId || !tokenHash) throw new Error("Invalid continuation");
  const payload = Buffer.from(
    JSON.stringify({ v: 1, path: safe, uid: userId, token: digest(tokenHash), expires: now + TTL }),
  ).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}

export function verifyOAuthContinuation(
  value: string,
  userId: string,
  tokenHash: string,
  now = Date.now(),
): string | null {
  try {
    if (value.length > 2048) return null;
    const parts = value.split(".");
    if (parts.length !== 2) return null;
    const expected = sign(parts[0]);
    const supplied = Buffer.from(parts[1], "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (
      p.v !== 1 ||
      p.uid !== userId ||
      p.token !== digest(tokenHash) ||
      !Number.isFinite(p.expires) ||
      p.expires <= now ||
      p.expires > now + TTL
    )
      return null;
    return oauthConsentReturn(p.path) ?? null;
  } catch {
    return null;
  }
}
