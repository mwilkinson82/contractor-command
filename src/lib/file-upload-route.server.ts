// Short-lived upload link. The token is the capability; only its hash is stored.
import { createClient } from "@supabase/supabase-js";
import { FileRejected, TOKEN_RE, tokenHash } from "./mcp/file-share";
import {
  assertUploadBytes,
  readBounded,
  uploadMaxBytes,
  uploadPage,
  type UploadPurpose,
} from "./mcp/file-upload";

type Session = {
  id: string;
  purpose: UploadPurpose;
  filename: string;
  mime_type: string;
  bucket: string;
  storage_path: string;
  status: "open" | "finished";
  expires_at: string;
};

export type UploadDeps = {
  lookup(hash: string): Promise<Session | null>;
  put(bucket: string, path: string, bytes: Uint8Array, mime: string): Promise<void>;
};

const LABEL: Record<UploadPurpose, string> = {
  contract: "Contract",
  spec: "Specification",
  submittal_piece: "Submittal piece",
};

function page(status: number, body: string) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function uploadDepsFromEnv(): UploadDeps {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Backend unavailable");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async lookup(hash) {
      const { data, error } = await admin
        .from("mcp_file_uploads")
        .select("id,purpose,filename,mime_type,bucket,storage_path,status,expires_at")
        .eq("token_hash", hash)
        .maybeSingle();
      if (error) throw new Error("Upload lookup unavailable");
      return (data ?? null) as Session | null;
    },
    async put(bucket, path, bytes, mime) {
      const up = await admin.storage
        .from(bucket)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error && !/already exists|duplicate/i.test(up.error.message))
        throw new Error(up.error.message);
    },
  };
}

function until(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the listed time";
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function live(session: Session): string | null {
  if (session.status === "finished") return "stored";
  if (new Date(session.expires_at).getTime() <= Date.now())
    return "This upload link has expired. Start again from Athena.";
  return null;
}

export async function handleFileUpload(
  req: Request,
  token: string,
  deps: UploadDeps = uploadDepsFromEnv(),
): Promise<Response> {
  if (!TOKEN_RE.test(token))
    return page(
      404,
      uploadPage({ filename: "", purpose: "", until: "", error: "This upload link is not valid." }),
    );
  let session: Session | null;
  try {
    session = await deps.lookup(await tokenHash(token));
  } catch {
    return page(
      503,
      uploadPage({
        filename: "",
        purpose: "",
        until: "",
        error: "Athena couldn't open that upload link. Try again in a moment.",
      }),
    );
  }
  if (!session)
    return page(
      404,
      uploadPage({ filename: "", purpose: "", until: "", error: "This upload link is not valid." }),
    );
  const state = live(session);
  const label = LABEL[session.purpose] ?? "File";
  if (state === "stored") {
    return req.method === "PUT"
      ? json(409, { stored: true, filename: session.filename })
      : page(
          200,
          uploadPage({
            filename: session.filename,
            purpose: label,
            until: until(session.expires_at),
            done: true,
          }),
        );
  }
  if (state)
    return page(
      410,
      uploadPage({
        filename: session.filename,
        purpose: label,
        until: until(session.expires_at),
        error: state,
      }),
    );
  if (req.method === "GET" || req.method === "HEAD")
    return page(
      200,
      uploadPage({ filename: session.filename, purpose: label, until: until(session.expires_at) }),
    );
  if (req.method !== "PUT" && req.method !== "POST")
    return page(
      405,
      uploadPage({
        filename: session.filename,
        purpose: label,
        until: until(session.expires_at),
        error: "Send the file to this link.",
      }),
    );
  try {
    const bytes =
      req.method === "PUT"
        ? await readBounded(req, uploadMaxBytes(session.purpose))
        : await formBytes(req, uploadMaxBytes(session.purpose));
    assertUploadBytes(bytes, session.filename, session.purpose);
    await deps.put(session.bucket, session.storage_path, bytes, session.mime_type);
  } catch (e) {
    const message =
      e instanceof FileRejected ? e.message : "The file could not be stored. Try again.";
    return req.method === "PUT"
      ? json(400, { stored: false, error: message })
      : page(
          400,
          uploadPage({
            filename: session.filename,
            purpose: label,
            until: until(session.expires_at),
            error: message,
          }),
        );
  }
  return req.method === "PUT"
    ? json(200, { stored: true, filename: session.filename })
    : page(
        200,
        uploadPage({
          filename: session.filename,
          purpose: label,
          until: until(session.expires_at),
          done: true,
        }),
      );
}

async function formBytes(req: Request, max: number): Promise<Uint8Array> {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new FileRejected("Choose a file. Nothing was stored.");
  if (file.size > max)
    throw new FileRejected(
      `That file is over ${Math.round(max / 1024 / 1024)} MB. Nothing was stored.`,
    );
  return new Uint8Array(await file.arrayBuffer());
}
