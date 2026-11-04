import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TOKEN_RE, tokenHash } from "./mcp/file-share";
import { customerProposalSchema } from "./selections/proposal";
import {
  PROPOSAL_PAGE_HEADERS,
  proposalGoneHtml,
  renderProposalDocument,
  type ProposalPagePayload,
} from "./selections/proposal-page";

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};
const env = (names: string[]) => {
  const r = globalThis as RuntimeGlobals;
  for (const n of names) {
    const v = r.process?.env?.[n]?.trim();
    if (v) return v;
  }
  return undefined;
};
export type ProposalResolver = (hash: string) => Promise<unknown>;

/** Anon client: mcp_selection_proposal_share_open is SECURITY DEFINER, hash in, the frozen customer view out (or NULL). */
const defaultResolver: ProposalResolver = async (hash) => {
  const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = env([
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  ]);
  if (!url || !key) throw new Error("Backend not configured");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>
  )("mcp_selection_proposal_share_open", { _token_hash: hash });
  if (error) throw new Error("lookup failed");
  return data ?? null;
};

// Strict: a frozen view with any unexpected field (a cost, a note) is refused, not shown.
const payloadSchema = z
  .object({
    company: z.string().nullable(),
    job_name: z.string().nullable(),
    expires_at: z.string().nullable(),
    board_version: z.number().int().positive(),
    proposal: customerProposalSchema,
  })
  .strict();

const gone = (status: number, head: boolean) =>
  new Response(head ? null : proposalGoneHtml(), { status, headers: PROPOSAL_PAGE_HEADERS });

export async function openProposalShare(
  token: string,
  method: "GET" | "HEAD",
  resolve: ProposalResolver = defaultResolver,
): Promise<Response> {
  const head = method === "HEAD";
  if (!TOKEN_RE.test(token)) return gone(404, head);
  if (head) return new Response(null, { status: 200, headers: PROPOSAL_PAGE_HEADERS }); // HEAD never counts a view
  let raw: unknown;
  try {
    raw = await resolve(await tokenHash(token));
  } catch {
    return new Response("Try again in a moment.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!raw) return gone(410, false);
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success)
    return new Response("This proposal can't be shown right now.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  const payload: ProposalPagePayload = parsed.data;
  return new Response(renderProposalDocument(payload), {
    status: 200,
    headers: PROPOSAL_PAGE_HEADERS,
  });
}
