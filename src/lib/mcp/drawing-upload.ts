// One-time direct upload for drawing PDFs. The card sends the file to the app's own
// upload route instead of a base64 tool argument, then confirms with a small tool call.
import { DRAWING_BUCKET, DRAWING_MAX_BYTES } from "./drawing-set";

export const DRAWING_UPLOAD_ORIGIN = "https://app.meetathena.io";
export const DRAWING_UPLOAD_PATH = "/r/drawing-upload/";
export const DRAWING_UPLOAD_SECONDS = 30 * 60;
export const STAGED_PATH_RE = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/drawing-([0-9a-f]{64})\/source\.pdf$/;

export type DrawingUploadClaim = { company_id: string; job_id: string; exp: number; nonce: string };

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (text: string) => {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export function drawingUploadSecret(): string | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.SUPABASE_SERVICE_ROLE_KEY || null;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signDrawingUpload(
  job: { company_id: string; job_id: string },
  secret: string,
  now = Date.now(),
): Promise<{ token: string; url: string; expires_at: string; max_bytes: number }> {
  const claim: DrawingUploadClaim = {
    company_id: job.company_id,
    job_id: job.job_id,
    exp: Math.floor(now / 1000) + DRAWING_UPLOAD_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const body = b64url(enc.encode(JSON.stringify(claim)));
  const token = `${body}.${b64url(await hmac(secret, body))}`;
  return {
    token,
    url: `${DRAWING_UPLOAD_ORIGIN}${DRAWING_UPLOAD_PATH}${token}`,
    expires_at: new Date(claim.exp * 1000).toISOString(),
    max_bytes: DRAWING_MAX_BYTES,
  };
}

export async function verifyDrawingUpload(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<DrawingUploadClaim | null> {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const want = await hmac(secret, body);
    const got = unb64url(sig);
    if (got.length !== want.length) return null;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want[i] ^ got[i];
    if (diff) return null;
    const claim = JSON.parse(new TextDecoder().decode(unb64url(body))) as DrawingUploadClaim;
    if (typeof claim.company_id !== "string" || typeof claim.job_id !== "string" || typeof claim.exp !== "number")
      return null;
    if (claim.exp * 1000 <= now) return null;
    return claim;
  } catch {
    return null;
  }
}

/** A staged object path is valid only for the job the token was issued for. */
export function stagedPathFor(claim: DrawingUploadClaim, path: string): string | null {
  const m = STAGED_PATH_RE.exec(path);
  if (!m || m[1] !== claim.company_id || m[2] !== claim.job_id) return null;
  return m[3];
}

export { DRAWING_BUCKET };
