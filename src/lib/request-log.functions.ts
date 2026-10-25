import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TOKEN_RE, tokenHash } from "./mcp/file-share";
import type { RequestLogPayload } from "./mcp/request-log";

const input = z.object({
  token: z.string().max(80),
  jobId: z.string().uuid(),
  kind: z.enum(["rfi", "rfc"]),
});

export const openRequestLog = createServerFn({ method: "GET" })
  .inputValidator(input.parse)
  .handler(async ({ data }) => {
    if (!TOKEN_RE.test(data.token)) return { status: "unknown", payload: null };
    const env =
      (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};
    const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
    const key =
      env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY;
    if (!url || !key) return { status: "unavailable", payload: null };
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: reply, error } = await (
      sb.rpc as unknown as (
        f: string,
        p: Record<string, unknown>,
      ) => PromiseLike<{
        data: { status: string; payload?: RequestLogPayload | null } | null;
        error: unknown;
      }>
    )("mcp_request_log_open", {
      _token_hash: await tokenHash(data.token),
      _job: data.jobId,
      _kind: data.kind,
    });
    if (error || !reply) return { status: "unavailable", payload: null };
    return {
      status: reply.status,
      payload: reply.status === "ok" && reply.payload ? JSON.stringify(reply.payload) : null,
    };
  });
