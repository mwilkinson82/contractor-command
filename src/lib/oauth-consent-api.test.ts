import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getAuthorizationDetails, decideAuthorization, getAuthUser } from "./oauth-consent-api";
import { relayConsentOnServer } from "./oauth-consent-relay.functions";

const env = { url: "https://x.supabase.co", key: "pk" };
const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("consent API never waits on the auth lock", () => {
  it("details uses the validated token directly", async () => {
    let seen: [string, RequestInit] | null = null;
    const f = (async (u: string, i: RequestInit) => { seen = [u, i]; return new Response(JSON.stringify({ client: { name: "Grok Bot" } })); }) as unknown as typeof fetch;
    const r = await getAuthorizationDetails("abc", "tok", { fetch: f, env });
    expect(r.data.client.name).toBe("Grok Bot");
    expect(seen![0]).toBe("https://x.supabase.co/auth/v1/oauth/authorizations/abc");
    expect((seen![1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("approve posts action=approve and returns redirect_url", async () => {
    let body = "";
    const f = (async (_u: string, i: RequestInit) => { body = String(i.body); return new Response(JSON.stringify({ redirect_url: "https://cb" })); }) as unknown as typeof fetch;
    const r = await decideAuthorization("abc", "tok", true, { fetch: f, env });
    expect(JSON.parse(body)).toEqual({ action: "approve" });
    expect(r.data.redirect_url).toBe("https://cb");
  });
  it("a hung request ends as a 408 timeout instead of spinning", async () => {
    const f = ((_u: string, i: RequestInit) => new Promise((_, rej) => i.signal!.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))) as unknown as typeof fetch;
    const r = await getAuthUser("tok", { fetch: f, env, timeoutMs: 20 });
    expect(r.error?.status).toBe(408);
  });
  it("401 surfaces status so consent signs in again", async () => {
    const r = await getAuthUser("tok", { fetch: ok({ msg: "bad jwt" }, 401), env });
    expect(r.error).toEqual({ message: "bad jwt", status: 401 });
  });
  it("does not send a browser Origin, which the auth server would reject off the Site URL", async () => {
    let headers: Record<string, string> = {};
    const f = (async (_u: string, i: RequestInit) => {
      headers = i.headers as Record<string, string>;
      return new Response(JSON.stringify({ client: { name: "Cursor" }, redirect_url: "cursor://auth" }));
    }) as unknown as typeof fetch;
    const r = await relayConsentOnServer(
      { path: "/oauth/authorizations/abc/consent", accessToken: "tok", method: "POST", body: { action: "approve" } },
      { fetch: f, env },
    );
    expect(r.data.redirect_url).toBe("cursor://auth");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers.Origin).toBeUndefined();
    expect(headers.origin).toBeUndefined();
  });
  it("refuses to relay anything except the consent endpoints", async () => {
    const f = (async () => new Response("{}")) as unknown as typeof fetch;
    const bad = await relayConsentOnServer(
      { path: "/user", accessToken: "tok", method: "POST" },
      { fetch: f, env },
    );
    expect(bad.error?.status).toBe(400);
  });
  it("consent route no longer uses SDK oauth helpers or getUser", () => {
    const s = readFileSync("src/routes/oauth.consent.tsx", "utf8");
    expect(s).not.toMatch(/\.oauth\b|approveAuthorization|auth\.getUser\(/);
    expect(s).toMatch(/getAuthorizationDetails\(id, accessToken\)/);
    expect(s).toMatch(/decideAuthorization\(authorization_id, accessToken, approve\)/);
    expect(s).toMatch(/redirect\(\{ to: "\/login", search: \{ redirect: consentReturnPath\(/);
  });
});
