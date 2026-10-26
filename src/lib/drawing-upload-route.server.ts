// Direct drawing upload. The signed token is the capability; the PDF streams to
// athena-drawings at its content-hash path and is registered by a later confirm call.
import { createClient } from "@supabase/supabase-js";
import { FileRejected, sha256Hex, storagePath } from "./mcp/file-share";
import { readBounded } from "./mcp/file-upload";
import { DRAWING_BUCKET, DRAWING_MAX_BYTES, drawingTooBigMessage } from "./mcp/drawing-set";
import { drawingUploadSecret, verifyDrawingUpload } from "./mcp/drawing-upload";

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
    bytes = await readBounded(req, DRAWING_MAX_BYTES);
  } catch (e) {
    const message = e instanceof FileRejected ? (/over \d+ MB/.test(e.message) ? drawingTooBigMessage() : e.message) : "The upload did not finish. Nothing was stored.";
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
  return json(200, { stored: true, path, content_hash: hash, size: bytes.length });
}
