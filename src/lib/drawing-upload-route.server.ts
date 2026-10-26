// Direct drawing upload. The signed token is the capability; the PDF streams to
// athena-drawings at its content-hash path and is registered by a later confirm call.
import { createClient } from "@supabase/supabase-js";
import { FileRejected, sha256Hex, storagePath } from "./mcp/file-share";
import { DRAWING_BUCKET, DRAWING_MAX_BYTES, drawingTooBigMessage } from "./mcp/drawing-set";
import { drawingUploadSecret, signDrawingReceipt, verifyDrawingUpload } from "./mcp/drawing-upload";

export type DrawingUploadDeps = {
  secret: string | null;
  put(bucket: string, path: string, bytes: Uint8Array): Promise<void>;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "PUT, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

const tooBig = () => new FileRejected(drawingTooBigMessage());

/**
 * One copy of the PDF in memory: when content-length is known the body is read
 * straight into a buffer of that size instead of collecting chunks and joining them.
 */
export async function readDrawingBody(req: Request, max = DRAWING_MAX_BYTES): Promise<Uint8Array> {
  const claimed = Number(req.headers.get("content-length") ?? "0");
  if (claimed > max) throw tooBig();
  if (!req.body) throw new FileRejected("The file is empty. Nothing was stored.");
  const reader = req.body.getReader();
  if (claimed > 0) {
    const out = new Uint8Array(claimed);
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > claimed) {
        await reader.cancel();
        throw new FileRejected("The upload was larger than announced. Nothing was stored.");
      }
      out.set(value, n);
      n += value.length;
    }
    if (n !== claimed) throw new FileRejected("The upload did not finish. Nothing was stored.");
    return out;
  }
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel();
      throw tooBig();
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const part of parts.splice(0)) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function drawingUploadDepsFromEnv(): DrawingUploadDeps {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  return {
    secret: drawingUploadSecret(),
    async put(bucket, path, bytes) {
      if (!url || !key) throw new Error("Backend unavailable");
      const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const up = await admin.storage
        .from(bucket)
        .upload(path, bytes, { contentType: "application/pdf", upsert: false, cacheControl: "no-store" });
      // The path is the content hash, so an existing object already holds these bytes.
      if (up.error && !/already exists|duplicate/i.test(up.error.message)) throw new Error(up.error.message);
    },
  };
}

export async function handleDrawingUpload(
  req: Request,
  token: string,
  deps: DrawingUploadDeps = drawingUploadDepsFromEnv(),
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "PUT") return json(405, { stored: false, error: "Send the PDF with PUT. Nothing was stored." });
  const claim = deps.secret ? await verifyDrawingUpload(token, deps.secret) : null;
  if (!claim)
    return json(403, { stored: false, error: "This upload link is not valid or has expired. Start again from the card. Nothing was stored." });
  let bytes: Uint8Array;
  try {
    bytes = await readDrawingBody(req);
  } catch (e) {
    const message = e instanceof FileRejected ? e.message : "The upload did not finish. Nothing was stored.";
    return json(400, { stored: false, error: message });
  }
  if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-")
    return json(400, { stored: false, error: "A drawing set has to be a PDF. Nothing was stored." });
  const hash = await sha256Hex(bytes);
  const path = storagePath(claim.company_id, claim.job_id, `drawing-${hash}`, "source.pdf");
  try {
    await deps.put(DRAWING_BUCKET, path, bytes);
  } catch {
    return json(502, { stored: false, error: "Athena couldn't store that drawing right now. Try again in a moment." });
  }
  const size = bytes.length;
  const receipt = await signDrawingReceipt(claim, { path, content_hash: hash, size }, deps.secret!);
  return json(200, { stored: true, path, content_hash: hash, size, receipt });
}
