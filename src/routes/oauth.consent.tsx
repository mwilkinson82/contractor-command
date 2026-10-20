import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard } from "@/components/auth/auth-card";
import { checkAthenaEntitlement, NO_ENTITLEMENT_MESSAGE, type RpcClient } from "@/lib/mcp/entitlement";
import { boundedStep, ConsentStepError, consentReturnPath } from "@/lib/consent-loading";

type OAuthResult = { data: any; error: { message: string } | null };
type OAuthApi = {
  getAuthorizationDetails(id: string): Promise<OAuthResult>;
  approveAuthorization(id: string): Promise<OAuthResult>;
  denyAuthorization(id: string): Promise<OAuthResult>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm who you are",
  email: "Share your email address",
  profile: "Share your basic profile",
  offline_access: "Stay connected (refresh access without signing in again)",
  phone: "Share your phone number",
};

export const Route = createFileRoute("/oauth/consent")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Approve connection — Athena powered by ALP, construction agents" },
      { name: "description", content: "Approve or deny an app connecting to Athena." },
      { property: "og:title", content: "Approve connection — Athena powered by ALP, construction agents" },
      { property: "og:description", content: "Approve or deny an app connecting to Athena." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    // Athena mark on the consent page only; the Hub's own favicon is unchanged.
    links: [
      { rel: "icon", type: "image/svg+xml", sizes: "any", href: "/brand/athena/athena-mark-mono-blue.svg" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/brand/athena/athena-mono-blue-512.png" },
      { rel: "apple-touch-icon", sizes: "512x512", href: "/brand/athena/athena-mono-blue-512.png" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search }) => {
    // v0.8.9.1: no cross-domain hop. Stay on the origin Supabase sent us to so
    // the login session and magic-link callback share one localStorage.
    if (!search.authorization_id) throw new Error("This connection request is missing its ID. Start again from the app you're connecting.");
    const { data, error } = await boundedStep("session", () => supabase.auth.getSession());
    if (error) throw new ConsentStepError("session", "failed");
    // getSession() only reads localStorage. A stale/revoked session made
    // Supabase reject getAuthorizationDetails (403) and show "invalid or
    // expired". Validate with the server; if not live, clear it and sign in.
    let live = false;
    if (data.session) {
      const { data: u, error: userError } = await supabase.auth.getUser();
      live = !userError && !!u?.user?.id;
      if (!live) await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
    if (!live) {
      throw redirect({ to: "/login", search: { redirect: consentReturnPath(search.authorization_id) } });
    }
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await boundedStep("details", () => oauth().getAuthorizationDetails(id));
    if (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || /jwt|bearer/i.test(error.message ?? "")) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        throw redirect({ to: "/login", search: { redirect: consentReturnPath(id) } });
      }
      throw new ConsentStepError("details", "failed");
    }
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      window.location.href = immediate;
      return null;
    }
    const { data: u, error: userError } = await boundedStep("identity", () => supabase.auth.getUser());
    // Fail closed: no confirmed identity means no consent screen.
    if (userError || !u?.user?.id) throw new ConsentStepError("identity", "failed");
    // Same membership entitlement the /mcp server enforces. Fails closed.
    let entitled = false;
    try {
      const ent = await boundedStep("identity", () => checkAthenaEntitlement(supabase as unknown as RpcClient));
      entitled = ent.allowed;
    } catch {
      entitled = false;
    }
    return { details: data, email: u.user.email ?? "", userId: u.user.id, entitled };
  },
  component: Consent,
  pendingComponent: () => (
    <AuthCard brand="athena" title="Loading connection request…" subtitle="One moment.">
      <div />
    </AuthCard>
  ),
  errorComponent: ({ error }) => (
    <AuthCard brand="athena" title="Can't load this request." subtitle={error instanceof Error ? error.message : "It may have expired."}>
      <p className="text-[13px] text-foreground/70">Start the connection again from the app you're connecting.</p>
    </AuthCard>
  ),
});

function Consent() {
  const loaded = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  if (!loaded) return null;
  const { details, email, userId, entitled } = loaded;
  const allowed = entitled === true;
  async function switchAccount() {
    setBusy(true);
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorization_id)}`;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) { setError("Could not switch accounts. Please try again."); setBusy(false); return; }
    navigate({ to: "/login", search: { redirect: next }, replace: true });
  }
  const clientName: string = details?.client?.name ?? details?.client?.client_name ?? "An app";
  const redirectUri: string | undefined = details?.redirect_uri ?? details?.client?.redirect_uri;
  const scopes: string[] = String(details?.scope ?? details?.scopes ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data: identity, error: identityError } = await supabase.auth.getUser();
    if (identityError || !identity.user || identity.user.id !== userId) {
      setError("Your signed-in account changed. Reload this request before approving.");
      setBusy(false);
      return;
    }
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message || (approve ? "Approval failed." : "Couldn't cancel."));
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No return address came back. Try again from the app you're connecting.");
      return;
    }
    window.location.href = target;
  }

  let host: string | undefined;
  try {
    host = redirectUri ? new URL(redirectUri).host : undefined;
  } catch {
    host = redirectUri;
  }

  return (
    <AuthCard brand="athena"
      title={`Connect ${clientName} to Athena`}
      subtitle={`This lets ${clientName} use Athena as you.`}
    >
      <div className="space-y-4 text-[13px] text-foreground/80">
        {!allowed && (
          <div role="alert" className="space-y-3 rounded-lg border-2 border-destructive/60 bg-destructive/5 p-4">
            <p className="text-[14px] font-semibold text-destructive">
              Signed in as {email || "an unknown account"} — switch to your Circle account
            </p>
            <p className="text-foreground/75">{NO_ENTITLEMENT_MESSAGE} Approve is turned off.</p>
            <button
              type="button"
              disabled={busy}
              onClick={switchAccount}
              className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-60"
            >
              Switch account
            </button>
          </div>
        )}
        <p>
          Signed in as <span className="font-medium text-foreground">{email || "unknown account"}</span>{" "}
          <button type="button" disabled={busy} onClick={switchAccount} className="ml-1 underline underline-offset-2 disabled:opacity-60">
            Use a different account
          </button>
        </p>
        {host && (
          <p>
            Returns to <span className="font-medium text-foreground">{host}</span>
          </p>
        )}
        {scopes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5">
            {scopes.map((s) => (
              <li key={s}>{SCOPE_LABELS[s] ?? `Additional permission requested: ${s}`}</li>
            ))}
          </ul>
        )}
        <p className="text-foreground/60">This doesn't get around the Hub's own access rules.</p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            disabled={busy || !allowed}
            onClick={() => decide(true)}
            className={`flex-1 rounded-lg px-4 py-2.5 font-medium disabled:opacity-60 ${allowed ? "bg-primary text-primary-foreground" : "border border-border"}`}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 font-medium disabled:opacity-60"
          >
            Deny
          </button>
        </div>
      </div>
    </AuthCard>
  );
}
