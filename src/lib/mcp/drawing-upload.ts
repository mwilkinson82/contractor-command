// One-time direct upload for drawing PDFs. The card sends the file to the app's own
// upload route instead of a base64 tool argument, then confirms with a small tool call.
import { DRAWING_BUCKET, DRAWING_MAX_BYTES } from "./drawing-set";

export const DRAWING_UPLOAD_ORIGIN = "https://app.meetathena.io";
export const DRAWING_UPLOAD_PATH = "/r/drawing-upload/";
export const DRAWING_UPLOAD_SECONDS = 30 * 60;
export const STAGED_PATH_RE = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/drawing-([0-9a-f]{64})\/source\.pdf$/;

export type DrawingUploadClaim = { company_id: string; job_id: string; exp: number; nonce: string; kind?: "upload" };
/** Signed by the upload route after it stored the bytes: the confirm call trusts this, not a re-download. */
export type DrawingUploadReceipt = {
  kind: "receipt";
  company_id: string;
  job_id: string;
  path: string;
  content_hash: string;
  size: number;
  exp: number;
};

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
    kind: "upload",
  };
  const token = await signPayload(claim, secret);
  return {
    token,
    url: `${DRAWING_UPLOAD_ORIGIN}${DRAWING_UPLOAD_PATH}${token}`,
    expires_at: new Date(claim.exp * 1000).toISOString(),
    max_bytes: DRAWING_MAX_BYTES,
  };
}

async function signPayload(payload: object, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

async function verifyPayload<T extends { exp: number }>(token: string, secret: string, now: number): Promise<T | null> {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const want = await hmac(secret, body);
    const got = unb64url(sig);
    if (got.length !== want.length) return null;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want[i] ^ got[i];
    if (diff) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body))) as T;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyDrawingUpload(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<DrawingUploadClaim | null> {
  const claim = await verifyPayload<DrawingUploadClaim>(token, secret, now);
  if (!claim || claim.kind !== "upload" || typeof claim.company_id !== "string" || typeof claim.job_id !== "string")
    return null;
  return claim;
}

export async function signDrawingReceipt(
  claim: DrawingUploadClaim,
  stored: { path: string; content_hash: string; size: number },
  secret: string,
): Promise<string> {
  const receipt: DrawingUploadReceipt = {
    kind: "receipt",
    company_id: claim.company_id,
    job_id: claim.job_id,
    path: stored.path,
    content_hash: stored.content_hash,
    size: stored.size,
    exp: claim.exp,
  };
  return signPayload(receipt, secret);
}

export async function verifyDrawingReceipt(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<DrawingUploadReceipt | null> {
  const r = await verifyPayload<DrawingUploadReceipt>(token, secret, now);
  if (!r || r.kind !== "receipt" || typeof r.size !== "number" || typeof r.path !== "string") return null;
  const m = STAGED_PATH_RE.exec(r.path);
  if (!m || m[1] !== r.company_id || m[2] !== r.job_id || m[3] !== r.content_hash) return null;
  return r;
}

/** A staged object path is valid only for the job the token was issued for. */
export function stagedPathFor(claim: DrawingUploadClaim, path: string): string | null {
  const m = STAGED_PATH_RE.exec(path);
  if (!m || m[1] !== claim.company_id || m[2] !== claim.job_id) return null;
  return m[3];
}

export { DRAWING_BUCKET };

/**
 * The card PUTs from the host's sandboxed origin, so the app's cross-origin guard
 * must let this one route through. It uses no cookies: the signed token is the
 * only authority, and the route answers with CORS headers and JSON errors.
 */
export function isDrawingUploadPut(method: string, pathname: string): boolean {
  return method === "PUT" && /^\/r\/drawing-upload\/[A-Za-z0-9_.-]+$/.test(pathname);
}
