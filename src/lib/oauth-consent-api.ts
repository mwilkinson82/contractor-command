// Direct, bounded calls to the auth server's OAuth consent endpoints.
// v0.8.18: the SDK's oauth.* helpers wait on the client auth lock/session
// recovery. Right after a magic link signs in (fresh session + auto-refresh
// starting), that wait could outlast the 15s consent timer, so the request was
// never even sent (no user attached to the authorization) and the member saw
// "The connection request timed out". These helpers use the access token the
// consent page already validated and never touch the auth lock.
export type ConsentApiResult = { data: any; error: { message: string; status?: number } | null };

export const CONSENT_FETCH_TIMEOUT_MS = 12_000;

type Env = { url: string; key: string };
function env(): Env {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";
  return { url: url.replace(/\/$/, ""), key };
}

export async function consentRequest(
  path: string,
  accessToken: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  deps: { fetch?: typeof fetch; env?: Env; timeoutMs?: number } = {},
): Promise<ConsentApiResult> {
  const { url, key } = deps.env ?? env();
  const doFetch = deps.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? CONSENT_FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(`${url}/auth/v1${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Supabase-Api-Version": "2024-01-01",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { data: null, error: { message: json?.msg ?? json?.message ?? json?.error_description ?? "Request failed", status: res.status } };
    }
    return { data: json, error: null };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    return { data: null, error: { message: aborted ? "timeout" : "network", status: aborted ? 408 : 0 } };
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;
export const getAuthorizationDetails = (id: string, token: string, deps?: Parameters<typeof consentRequest>[3]) =>
  consentRequest(`/oauth/authorizations/${enc(id)}`, token, {}, deps);
export const decideAuthorization = (id: string, token: string, approve: boolean, deps?: Parameters<typeof consentRequest>[3]) =>
  consentRequest(`/oauth/authorizations/${enc(id)}/consent`, token, { method: "POST", body: { action: approve ? "approve" : "deny" } }, deps);
export const getAuthUser = (token: string, deps?: Parameters<typeof consentRequest>[3]) =>
  consentRequest(`/user`, token, {}, deps);
