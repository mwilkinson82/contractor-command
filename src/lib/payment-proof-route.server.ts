import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseForToken } from "./mcp/supabase";
import { assertUploadBytes, readBounded, FINANCIAL_MAX_BYTES } from "./mcp/file-upload";
import { FileRejected, sha256Hex } from "./mcp/file-share";
import { readBoundedFinancialStoragePath } from "./mcp/billing-original.server";

/**
 * Proof of payment (check image, wire confirmation, remittance) for one recorded supplier-bill or
 * expense payment. The member's own token runs every scope and link check in the database; the
 * service role only stores bytes at the path those checks allow. A proof is the team's document,
 * never a bank verification.
 */
export const PROOF_BUCKET = "athena-financial-documents";
const PROOF_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const uuid = z.string().uuid();

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
export type ProofDeps = {
  member: (token: string) => Promise<{ rpc: Rpc; verified: boolean }>;
  put: (path: string, bytes: Uint8Array, mime: string) => Promise<{ error: unknown }>;
  remove: (path: string) => Promise<void>;
  read: (path: string) => Promise<Uint8Array>;
  newId: () => string;
};
type Scope = { company_id: string; job_id: string; can_attach: boolean };
type ProofRow = {
  id: string;
  company_id: string;
  job_id: string;
  payment_id: string;
  filename: string;
  mime_type: string;
  storage_path: string;
  size_bytes: number;
  sha256: string;
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
function cleanMessage(error: { message?: string } | null | undefined, fallback: string) {
  const m = error?.message?.match(/MCP_BAD:([^\n]+)/)?.[1];
  return m ?? fallback;
}

function serviceClient() {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Proof storage is temporarily unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export const liveProofDeps: ProofDeps = {
  member: async (token) => {
    const sb = supabaseForToken(token);
    const who = await sb.auth.getUser(token);
    return {
      rpc: sb.rpc.bind(sb) as unknown as Rpc,
      verified: !who.error && !!who.data.user?.id,
    };
  },
  put: async (path, bytes, mime) =>
    serviceClient().storage.from(PROOF_BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: false,
    }),
  remove: async (path) => {
    await serviceClient().storage.from(PROOF_BUCKET).remove([path]);
  },
  read: (path) => readBoundedFinancialStoragePath(path),
  newId: () => crypto.randomUUID(),
};

function bearer(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? null;
}

/** POST /api/payment-proof?job=&record=&payment=&filename= with the file as the raw body. */
export async function handlePaymentProofUpload(
  request: Request,
  deps: ProofDeps = liveProofDeps,
): Promise<Response> {
  const token = bearer(request);
  if (!token) return json(401, { stored: false, message: "Sign in to attach proof." });
  const url = new URL(request.url);
  const job = uuid.safeParse(url.searchParams.get("job"));
  const record = uuid.safeParse(url.searchParams.get("record"));
  const payment = uuid.safeParse(url.searchParams.get("payment"));
  const rawName = url.searchParams.get("filename") ?? "";
  if (!job.success || !record.success || !payment.success || !rawName)
    return json(400, { stored: false, message: "This payment link is incomplete." });
  try {
    const user = await deps.member(token);
    if (!user.verified) return json(401, { stored: false, message: "Sign in to attach proof." });
    const scoped = await user.rpc("mcp_cost_payment_proof_scope", {
      _job: job.data,
      _record: record.data,
      _payment: payment.data,
    });
    if (scoped.error || !scoped.data)
      return json(404, {
        stored: false,
        message: cleanMessage(scoped.error, "That payment is not available on this project."),
      });
    const scope = scoped.data as Scope;
    if (!scope.can_attach)
      return json(403, {
        stored: false,
        message: "Only the company owner or accounts payable can attach payment proof.",
      });
    const bytes = await readBounded(request, FINANCIAL_MAX_BYTES);
    const file = assertUploadBytes(bytes, rawName, "financial_document");
    if (!PROOF_MIME.has(file.mime))
      return json(415, {
        stored: false,
        message: "Attach a PDF, JPEG or PNG of the check, wire confirmation or remittance.",
      });
    const sha = await sha256Hex(bytes);
    const id = deps.newId();
    const path = `${scope.company_id}/${job.data}/${id}/${file.name}`;
    const stored = await deps.put(path, bytes, file.mime);
    if (stored.error) return json(502, { stored: false, message: "The file could not be stored." });
    const linked = await user.rpc("mcp_cost_payment_proof_link", {
      _job: job.data,
      _record: record.data,
      _payment: payment.data,
      _id: id,
      _filename: file.name,
      _mime: file.mime,
      _size: bytes.length,
      _sha256: sha,
    });
    if (linked.error || !linked.data) {
      await deps.remove(path).catch(() => undefined);
      return json(409, {
        stored: false,
        message: cleanMessage(linked.error, "The proof could not be linked. Nothing was attached."),
      });
    }
    const row = linked.data as { id: string; filename: string };
    // Same file already attached: keep the first copy and drop the duplicate bytes.
    if (row.id !== id) await deps.remove(path).catch(() => undefined);
    return json(200, {
      stored: true,
      duplicate: row.id !== id,
      proof: { id: row.id, filename: row.filename },
    });
  } catch (error) {
    if (error instanceof FileRejected) return json(400, { stored: false, message: error.message });
    return json(500, {
      stored: false,
      message: "The proof could not be attached. Nothing was linked.",
    });
  }
}

/** Bytes for one proof, re-checked against its recorded type, size and fingerprint. */
export async function readPaymentProof(
  token: string,
  job: string,
  id: string,
  deps: ProofDeps = liveProofDeps,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const user = await deps.member(token);
  if (!user.verified) throw new Error("Verified member required.");
  const got = await user.rpc("mcp_cost_payment_proof_get", { _job: job, _id: id });
  if (got.error || !got.data) throw new Error("Proof unavailable.");
  const proof = got.data as ProofRow;
  if (
    proof.id !== id ||
    proof.storage_path !== `${proof.company_id}/${proof.job_id}/${proof.id}/${proof.filename}` ||
    proof.storage_path.includes("..")
  )
    throw new Error("Proof unavailable.");
  const bytes = await deps.read(proof.storage_path);
  const checked = assertUploadBytes(bytes, proof.filename, "financial_document");
  if (
    checked.mime !== proof.mime_type ||
    bytes.length !== proof.size_bytes ||
    (await sha256Hex(bytes)) !== proof.sha256
  )
    throw new Error("Proof does not match its recorded fingerprint.");
  return { filename: proof.filename, bytes };
}
