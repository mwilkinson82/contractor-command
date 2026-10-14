import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard } from "@/components/auth/auth-card";
import { rememberOAuthReturn } from "@/lib/oauth-return-path";

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
      { title: "Approve connection — ALP Contractor Circle" },
      { name: "description", content: "Approve or deny an app connecting to your Contractor Circle account." },
      { property: "og:title", content: "Approve connection — ALP Contractor Circle" },
      { property: "og:description", content: "Approve or deny an app connecting to your Contractor Circle account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("This connection request is missing its ID. Start again from the app you're connecting.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      rememberOAuthReturn(next);
      throw redirect({ to: "/login", search: { redirect: next } });
    }
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(id);
    if (error) throw new Error(error.message || "This connection request is invalid or has expired.");
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      window.location.href = immediate;
      return null;
    }
    const { data: u } = await supabase.auth.getUser();
    return { details: data, email: u.user?.email ?? "" };
  },
  component: Consent,
  pendingComponent: () => (
    <AuthCard title="Loading connection request…" subtitle="One moment.">
      <div />
    </AuthCard>
  ),
  errorComponent: ({ error }) => (
    <AuthCard title="Can't load this request." subtitle={error instanceof Error ? error.message : "It may have expired."}>
      <p className="text-[13px] text-foreground/70">Start the connection again from the app you're connecting.</p>
    </AuthCard>
  ),
});

function Consent() {
  const loaded = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!loaded) return null;
  const { details, email } = loaded;
  const clientName: string = details?.client?.name ?? details?.client?.client_name ?? "An app";
  const redirectUri: string | undefined = details?.redirect_uri ?? details?.client?.redirect_uri;
  const scopes: string[] = String(details?.scope ?? details?.scopes ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
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
    <AuthCard
      title={`Connect ${clientName} to Contractor Circle`}
      subtitle={`This lets ${clientName} use the Contractor Circle tools as you.`}
    >
      <div className="space-y-4 text-[13px] text-foreground/80">
        {email && (
          <p>
            Signed in as <span className="font-medium text-foreground">{email}</span>
          </p>
        )}
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
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-60"
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
