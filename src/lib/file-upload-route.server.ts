// Short-lived upload link. The token is the capability; only its hash is stored.
import { createClient } from "@supabase/supabase-js";
import { FileRejected, TOKEN_RE, tokenHash, sha256Hex } from "./mcp/file-share";
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
  claimFinancial?(session: Session, tokenHash: string): Promise<void>;
};

const LABEL: Record<UploadPurpose, string> = {
  contract: "Contract",
  spec: "Specification",
  submittal_piece: "Submittal piece",
  financial_document: "Financial document",
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
      if (data) return data as Session;
      const financial = await admin
        .from("mcp_billing_uploads")
        .select("id,filename,mime_type,storage_path,status,expires_at")
        .eq("token_hash", hash)
        .maybeSingle();
      if (financial.error) throw new Error("Upload lookup unavailable");
      return financial.data
        ? ({
            ...financial.data,
            purpose: "financial_document",
            bucket: "athena-financial-documents",
          } as Session)
        : null;
    },
    async claimFinancial(session, hash) {
      const { data, error } = await admin.rpc("mcp_billing_upload_claim", {
        _id: session.id,
        _actor: null,
        _token_hash: hash,
      });
      if (
        error ||
        !data ||
        data.id !== session.id ||
        data.storage_path !== session.storage_path ||
        data.filename !== session.filename ||
        data.mime_type !== session.mime_type
      )
        throw new Error("Upload authorization unavailable");
    },
    async put(bucket, path, bytes, mime) {
      const up = await admin.storage
        .from(bucket)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error && !/already exists|duplicate/i.test(up.error.message))
        throw new Error(up.error.message);
      if (up.error && bucket === "athena-financial-documents") {
        const existing = await admin.storage.from(bucket).download(path);
        if (existing.error || !existing.data)
          throw new Error("The existing original could not be checked.");
        const previous = new Uint8Array(await existing.data.arrayBuffer());
        if (
          previous.length !== bytes.length ||
          (await sha256Hex(previous)) !== (await sha256Hex(bytes))
        )
          throw new FileRejected(
            "A different file is already stored for this upload. Start a new upload.",
          );
      }
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
  const hash = await tokenHash(token);
  let session: Session | null;
  try {
    session = await deps.lookup(hash);
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
    if (session.purpose === "financial_document") {
      if (!deps.claimFinancial) throw new Error("Upload authorization unavailable");
      await deps.claimFinancial(session, hash);
    }
    const bytes =
      req.method === "PUT"
        ? await readBounded(req, uploadMaxBytes(session.purpose))
        : await formBytes(
            req,
            uploadMaxBytes(session.purpose),
            session.purpose === "financial_document",
          );
    const checked = assertUploadBytes(bytes, session.filename, session.purpose);
    if (session.purpose === "financial_document" && checked.mime !== session.mime_type)
      throw new FileRejected("The file type does not match this upload. Nothing was stored.");
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

async function formBytes(req: Request, max: number, bounded: boolean): Promise<Uint8Array> {
  // Limit the entire multipart body before the parser can allocate it. The small allowance
  // covers multipart headers and boundaries; file.size is checked against the exact max below.
  const form = bounded
    ? await new Request(req.url, {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") ?? "" },
        body: (await readBounded(req, max + 64 * 1024)) as BodyInit,
      }).formData()
    : await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new FileRejected("Choose a file. Nothing was stored.");
  if (file.size > max)
    throw new FileRejected(
      `That file is over ${Math.round(max / 1024 / 1024)} MB. Nothing was stored.`,
    );
  return new Uint8Array(await file.arrayBuffer());
}
