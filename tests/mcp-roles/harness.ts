import { visibleProblems } from "../../src/lib/mcp/visible";
// TEST-only harness: real /mcp handler (OAuth verification with requireOAuthClientClaim ON) + real tools,
// backed by an in-process Postgres loaded with the real migrations. TEST company and TEST users only.
import { vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "./db";
import { fakeClient } from "./fake-supabase";

export const ISSUER = "https://qcbbjjjxcacrscfhgfmf.supabase.co/auth/v1";
export const ROLES = ["owner", "pm", "finance", "contracts", "estimating", "super"] as const;
export type Role = (typeof ROLES)[number];
export const TOOLS = ["onboarding", "intake", "next_question", "answer", "report", "carry_forward", "list_open_items", "resolve_item"] as const;
export const user = (r: Role | "pm2" | "outsider") => ({ id: `00000000-0000-4000-8000-0000000000${String(["owner", "pm", "finance", "contracts", "estimating", "super", "pm2", "outsider"].indexOf(r) + 10)}`, email: `${r}@pm-agent-roles.test.invalid` });

export const state: { db?: PGlite } = {};

export async function setupKeysAndFetch() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (process.env.FETCH_DEBUG) process.stderr.write(`FETCH ${url}\n`);
    if (url.startsWith(ISSUER.replace("/auth/v1", "")) && url.includes("jwks")) return Response.json({ keys: [jwk] });
    if (url.startsWith(ISSUER.replace("/auth/v1", "")) && url.includes(".well-known"))
      return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json`, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token`, response_types_supported: ["code"] });
    if (url.startsWith("http://test.local") || url.includes("supabase.co")) throw new Error(`unexpected fetch ${url}`);
    return realFetch(input as RequestInfo, init);
  });
  return async (r: Role | "pm2" | "outsider", opts: { clientId?: string | null } = {}) => {
    const u = user(r);
    const claims: Record<string, unknown> = { sub: u.id, email: u.email, role: "authenticated", aud: "authenticated" };
    if (opts.clientId !== null) claims.client_id = opts.clientId ?? "test-connector-client";
    return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" }).setIssuer(ISSUER).setIssuedAt().setExpirationTime("10m").sign(privateKey);
  };
}

/** Supabase client stand-in: decodes the verified bearer the tool context carries and runs as that user in PGlite. */
export function mockedSupabaseForUser(ctx: { getToken(): string | undefined }) {
  const token = ctx.getToken();
  if (!token) throw new Error("Verified OAuth token required");
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  return fakeClient(state.db!, { sub: claims.sub, email: claims.email, role: "authenticated", client_id: claims.client_id });
}

export async function bootDb() {
  const db = await makeDb();
  state.db = db;
  const all = ["owner", "pm", "finance", "contracts", "estimating", "super", "pm2", "outsider"] as const;
  for (const r of all) await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [user(r).id, user(r).email]);
  for (const r of all.filter((x) => x !== "outsider")) await db.query(`INSERT INTO public.test_active_members VALUES ($1)`, [user(r).id]);
  return db;
}

let rpcId = 1;
export async function callTool(handler: (c: { request: Request }) => Promise<Response>, token: string | null, name: string, args: Record<string, unknown>) {
  const res = await handler({
    request: new Request("http://test.local/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } }),
    }),
  });
  const raw = await res.text();
  let body: any = null;
  const m = raw.match(/^data: (.*)$/m);
  try { body = JSON.parse(m ? m[1] : raw); } catch { body = raw; }
  const result = body?.result;
  const textOut = result?.content?.map((c: any) => c.text ?? "").join("\n") ?? body?.error?.message ?? "";
  const guidance: string[] = Array.isArray(result?.structuredContent?.assistant_guidance) ? result.structuredContent.assistant_guidance : [];
  // Every tool result in every role test: the visible text a PM reads carries no host-directed instructions or internal codes.
  if (process.env.DUMP_VISIBLE) (await import("node:fs")).appendFileSync(process.env.DUMP_VISIBLE, `\n##### ${name}\n${String(textOut)}\n----- guidance\n${guidance.join("\n")}\n`);
  const problems = visibleProblems(String(textOut));
  if (problems.length) throw new Error(`Visible text from ${name} has host-directed instructions or internal codes:\n${problems.join("\n")}`);
  return {
    status: res.status, isError: Boolean(result?.isError || body?.error), text: String(textOut), structured: result?.structuredContent, wwwAuth: res.headers.get("www-authenticate"),
    /** Assistant-only guidance (structuredContent.assistant_guidance / _meta). */
    guidance: guidance.join("\n"),
    /** Visible text plus guidance, for tests that check what the assistant is told. */
    all: `${String(textOut)}\n${guidance.join("\n")}`,
    meta: result?._meta as Record<string, unknown> | undefined,
  };
}
