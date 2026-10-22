import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard } from "@/components/auth/auth-card";
import { checkAthenaEntitlement, NO_ENTITLEMENT_MESSAGE, type RpcClient } from "@/lib/mcp/entitlement";
import { boundedStep, ConsentStepError, consentReturnPath, isAppHandoff } from "@/lib/consent-loading";
import { consentClientLabel, consentConnectTitle } from "@/lib/consent-client-label";
import { getAuthorizationDetails, decideAuthorization, getAuthUser } from "@/lib/oauth-consent-api";
import { TERMS_LINK_TEXT, TERMS_REQUIRED_MESSAGE, TERMS_TEXT_AFTER, TERMS_TEXT_BEFORE, TERMS_URL, canApproveConnect, recordTermsAcceptance, type AccountDb } from "@/lib/account-team";
import { AthenaStartTip } from "@/components/athena/start-tip";


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
    // The lovable.app host is replaced with app.meetathena.io before this route
    // runs (src/lib/lovable-auth-redirect.ts). Sign-in stays on this host, so the
    // session, the magic link, and approve/deny share one origin.
    if (!search.authorization_id) throw new Error("This connection request is missing its ID. Start again from the app you're connecting.");
    const { data, error } = await boundedStep("session", () => supabase.auth.getSession());
    if (error) throw new ConsentStepError("session", "failed");
    // getSession() only reads localStorage. A stale/revoked session made
    // Supabase reject getAuthorizationDetails (403) and show "invalid or
    // expired". Validate with the server; if not live, clear it and sign in.
    // v0.8.18: validate with the server by a direct, bounded /user call using
    // the stored token (no auth-lock wait). A stale/revoked token signs in again.
    let live = false;
    let consentUser: { id: string; email?: string | null } | null = null;
    const accessToken = data.session?.access_token ?? "";
    if (accessToken) {
      const u = await getAuthUser(accessToken);
      if (u.error?.status === 408 || u.error?.status === 0) throw new ConsentStepError("identity", "timeout");
      live = !u.error && !!u.data?.id;
      if (live) consentUser = { id: u.data.id, email: u.data.email ?? null };
      if (!live) await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
    if (!live) {
      throw redirect({ to: "/login", search: { redirect: consentReturnPath(search.authorization_id) } });
    }
    return { consentUser, accessToken };
  },
  loader: async ({ location, context }) => {
    const id = new URLSearchParams(location.search).get("authorization_id")!;
    // v0.8.12: the entitlement read starts in parallel with the details call instead of after it.
    const entP = boundedStep("identity", () => checkAthenaEntitlement(supabase as unknown as RpcClient)).then((e) => e.allowed === true, () => false);
    const ctx = context as { consentUser?: { id: string; email?: string | null } | null; accessToken?: string } | undefined;
    const accessToken = ctx?.accessToken ?? "";
    const user = ctx?.consentUser ?? null;
    // Fail closed: no confirmed identity means no consent screen.
    if (!user?.id || !accessToken) throw new ConsentStepError("identity", "failed");
    const { data, error } = await getAuthorizationDetails(id, accessToken);
    if (error) {
      const status = error.status;
      if (status === 401 || status === 403 || /jwt|bearer/i.test(error.message ?? "")) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        throw redirect({ to: "/login", search: { redirect: consentReturnPath(id) } });
      }
      throw new ConsentStepError("details", status === 408 || status === 0 ? "timeout" : "failed");
    }
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      window.location.href = immediate;
      return null;
    }
    // Same membership entitlement the /mcp server enforces. Fails closed.
    const entitled = await entP;
    return { details: data, email: user.email ?? "", userId: user.id, entitled, accessToken };
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
  const [handoff, setHandoff] = useState<string | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  const navigate = useNavigate();
  if (!loaded) return null;
  const { details, email, userId, entitled, accessToken } = loaded;
  const allowed = entitled === true;
  const canApprove = canApproveConnect(allowed, termsChecked);
  async function switchAccount() {
    setBusy(true);
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorization_id)}`;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) { setError("Could not switch accounts. Please try again."); setBusy(false); return; }
    navigate({ to: "/login", search: { redirect: next }, replace: true });
  }
  const clientLabel = consentClientLabel({
    name: details?.client?.name ?? details?.client?.client_name,
    redirectUri: details?.redirect_uri ?? details?.client?.redirect_uri,
  });
  const scopes: string[] = String(details?.scope ?? details?.scopes ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const identity = await getAuthUser(accessToken);
    if (identity.error || identity.data?.id !== userId) {
      setError(identity.error?.status === 408 || identity.error?.status === 0
        ? "That took too long. Check your connection and tap again."
        : "Your signed-in account changed. Reload this request before approving.");
      setBusy(false);
      return;
    }
    if (approve) {
      // v0.8.22: the Terms box is required, and the agreement (who + when) is recorded before the connect goes through.
      if (!termsChecked) { setError(TERMS_REQUIRED_MESSAGE); setBusy(false); return; }
      const saved = await recordTermsAcceptance(supabase as unknown as AccountDb, authorization_id, typeof navigator === "undefined" ? null : navigator.userAgent);
      if (!saved.ok) { setError(saved.error); setBusy(false); return; }
    }
    const { data, error } = await decideAuthorization(authorization_id, accessToken, approve);
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
    // Desktop apps (Codex, Cursor, Claude Desktop) return via a custom scheme
    // or localhost. The browser may ask "Open <app>?" and stay here, so keep a
    // tap-to-return link on screen instead of a dead page.
    if (isAppHandoff(target)) setHandoff(target);
    window.location.assign(target);
  }

  if (handoff) {
    return (
      <AuthCard brand="athena" title={`Returning to ${clientLabel}…`} subtitle="If your browser asks to open the app, choose Open.">
        <a href={handoff} className="block w-full rounded-lg bg-primary px-4 py-2.5 text-center font-medium text-primary-foreground">
          Return to {clientLabel}
        </a>
        <p className="mt-3 text-[13px] text-foreground/70">You can close this tab once {clientLabel} shows Athena connected.</p>
        <div className="mt-6">
          <AthenaStartTip />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard brand="athena"
      title={consentConnectTitle(clientLabel)}
      subtitle={`This lets ${clientLabel} use Athena as you.`}
    >
      <div className="space-y-4 text-[13px] text-foreground/80">
        {!allowed && (
          <div role="alert" className="space-y-3 rounded-lg border-2 border-destructive/60 bg-destructive/5 p-4">
            <p className="text-[14px] font-semibold text-destructive">
              Signed in as {email || "an unknown account"} — switch accounts
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
        {scopes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5">
            {scopes.map((s) => (
              <li key={s}>{SCOPE_LABELS[s] ?? `Additional permission requested: ${s}`}</li>
            ))}
          </ul>
        )}
        <p className="text-foreground/60">Your company's Athena access rules still apply.</p>
        <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-foreground/85">
          <input
            type="checkbox"
            required
            checked={termsChecked}
            disabled={busy || !allowed}
            onChange={(e) => { setTermsChecked(e.target.checked); if (e.target.checked) setError(null); }}
            className="mt-0.5 h-4 w-4"
            aria-describedby="athena-terms"
          />
          <span id="athena-terms">
            {TERMS_TEXT_BEFORE}
            <a href={TERMS_URL} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">{TERMS_LINK_TEXT}</a>
            {TERMS_TEXT_AFTER}
          </span>
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            disabled={busy || !canApprove}
            onClick={() => decide(true)}
            className={`flex-1 rounded-lg px-4 py-2.5 font-medium disabled:opacity-60 ${canApprove ? "bg-primary text-primary-foreground" : "border border-border"}`}
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
