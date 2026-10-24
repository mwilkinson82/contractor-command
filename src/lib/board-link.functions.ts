import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TOKEN_RE, tokenHash } from "@/lib/mcp/file-share";
import { BOARD_PAGES, type BoardLinkStatus } from "@/lib/mcp/board-link";
import type { PagePayload } from "@/lib/report-pages";
import type { SubmittalRecordPayload } from "@/lib/submittal-record-page";
import { submittalRecordFile } from "@/lib/submittal-record-page";

const PHOTO_BUCKET = "athena-progress";

const Input = z.object({
  token: z.string().trim().max(80),
  jobId: z.string().uuid(),
  page: z.enum(BOARD_PAGES),
});

/** payload is JSON text so the server function stays serializable. The page parses it. */
export type BoardOpen =
  { status: Exclude<BoardLinkStatus, "ok">; payload: null } | { status: "ok"; payload: string };

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function env(names: string[]): string | undefined {
  const r = globalThis as RuntimeGlobals;
  for (const name of names) {
    const value = r.process?.env?.[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Signed image URLs for the photos page. The anon open cannot sign storage, so this uses the service role only after the token already authorized this job. */
async function withPhotoUrls(payload: PagePayload): Promise<PagePayload> {
  if (payload.page !== "photos" || !payload.photos?.length) return payload;
  const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = env(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!url || !key) return payload;
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const photos = await Promise.all(
    payload.photos.map(async (ph) => {
      const path = ph.storage_path ?? "";
      if (ph.url || !path || path.includes("..") || path.startsWith("/")) return ph;
      const signed = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
      return { ...ph, url: signed.data?.signedUrl ?? null };
    }),
  );
  return { ...payload, photos };
}

const RecordInput = z.object({
  token: z.string().trim().max(80),
  jobId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
});

const SUBMITTAL_BUCKET = "athena-submittals";

/** Signed file links for a token reader, service role only after the token already authorized this job's record. */
async function withSubmittalUrls(payload: SubmittalRecordPayload): Promise<SubmittalRecordPayload> {
  const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = env(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!url || !key) return payload;
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const sign = async (fileRef: string | null) => {
    const file = submittalRecordFile(payload, fileRef);
    if (!file) return null;
    const signed = await sb.storage.from(file.bucket).createSignedUrl(file.path, 3600);
    return signed.data?.signedUrl ?? null;
  };
  const packages = await Promise.all(
    (payload.packages ?? []).map(async (p) => ({
      ...p,
      url: p.revoked_at ? null : await sign(`${SUBMITTAL_BUCKET}/${p.path}`),
    })),
  );
  const items = await Promise.all(
    (payload.current.package_items ?? []).map(async (item) => {
      return { ...item, url: await sign(item.file_ref ?? null) };
    }),
  );
  return { ...payload, packages, current: { ...payload.current, package_items: items } };
}

/** The submittal record behind a log row, opened with the job's board token. Same checks as the log page. */
export const openSubmittalRecord = createServerFn({ method: "GET" })
  .inputValidator(RecordInput.parse)
  .handler(async ({ data }): Promise<BoardOpen> => {
    if (!TOKEN_RE.test(data.token)) return { status: "unknown", payload: null };
    const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
    const key = env([
      "SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY",
    ]);
    if (!url || !key) return { status: "unknown", payload: null };
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: row, error } = await (
      sb.rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    )("mcp_submittal_record_open", {
      _token_hash: await tokenHash(data.token),
      _job: data.jobId,
      _number: data.number,
    });
    if (error || !row || typeof row !== "object") return { status: "unknown", payload: null };
    const status = (row as { status?: string }).status;
    if (status !== "ok") {
      const refused =
        status === "expired" ||
        status === "revoked" ||
        status === "wrong_job" ||
        status === "denied"
          ? status
          : "unknown";
      return { status: refused, payload: null };
    }
    const payload = (row as { payload?: SubmittalRecordPayload | null }).payload;
    if (!payload || payload.page !== "submittal") return { status: "denied", payload: null };
    return { status: "ok", payload: JSON.stringify(await withSubmittalUrls(payload)) };
  });

/** GET so the CSRF guard is unchanged. The token is the secret; the database stores only its hash. */
export const openBoardPage = createServerFn({ method: "GET" })
  .inputValidator(Input.parse)
  .handler(async ({ data }): Promise<BoardOpen> => {
    if (!TOKEN_RE.test(data.token)) return { status: "unknown", payload: null };
    const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
    const key = env([
      "SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY",
    ]);
    if (!url || !key) return { status: "unknown", payload: null };
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: row, error } = await (
      sb.rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    )("mcp_board_link_open", {
      _token_hash: await tokenHash(data.token),
      _job: data.jobId,
      _page: data.page,
    });
    if (error || !row || typeof row !== "object") return { status: "unknown", payload: null };
    const status = (row as { status?: string }).status;
    if (status !== "ok") {
      const refused =
        status === "expired" ||
        status === "revoked" ||
        status === "wrong_job" ||
        status === "denied"
          ? status
          : "unknown";
      return { status: refused, payload: null };
    }
    const payload = (row as { payload?: PagePayload | null }).payload;
    if (!payload || payload.page !== data.page) return { status: "denied", payload: null };
    return { status: "ok", payload: JSON.stringify(await withPhotoUrls(payload)) };
  });
