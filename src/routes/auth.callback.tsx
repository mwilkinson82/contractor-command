import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard } from "@/components/auth/auth-card";

function safeRedirect(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing in — ALP Contractor Circle" }] }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? safeRedirect(search.redirect) : undefined,
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const { redirect } = Route.useSearch();
  const [phase, setPhase] = useState<"checking" | "expired">("checking");

  useEffect(() => {
    let cancelled = false;

    const hashParams = () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.hash.replace(/^#/, ""));

    const queryParams = () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search);

    const urlHasAuthError = () => {
      const q = queryParams();
      const h = hashParams();
      return Boolean(q.get("error") || h.get("error"));
    };

    if (urlHasAuthError()) {
      setPhase("expired");
      return;
    }

    // Hard navigation — the auth gate, company/tier loaders, and presence
    // channel all key off session state. A router-level navigate can race
    // those subscriptions and strand the user here. A full reload at the
    // destination guarantees a clean mount with the new session.
    const goHome = () => {
      const dest = redirect ?? "/";
      window.location.replace(dest);
    };

    const finish = async () => {
      // Our branded emails now link to this app route with a token hash instead
      // of linking directly to the backend /verify endpoint. That keeps email
      // security scanners from burning the one-time link before the member's
      // browser can finish sign-in.
      const q = queryParams();
      const tokenHash = q.get("token_hash");
      if (tokenHash) {
        const type = q.get("type") === "recovery" ? "recovery" : "magiclink";
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (cancelled) return;
        if (!error) {
          if (type === "recovery") window.location.replace("/reset-password");
          else goHome();
          return;
        }
        setPhase("expired");
        return;
      }

      // Implicit-flow magic + recovery links land here as
      // "#access_token=...&refresh_token=...". Set the session manually
      // rather than relying on the client's auto-detection (which can race
      // with our own read of window.location.hash).
      const h = hashParams();
      const accessToken = h.get("access_token");
      const refreshToken = h.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (!error) {
          goHome();
          return;
        }
      }

      // PKCE flow uses "?code=..." in the query string.
      const code = q.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (!error) {
          goHome();
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) goHome();
    };

    const timeout = window.setTimeout(() => {
      if (!cancelled) setPhase("expired");
    }, 8000);

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled || !session) return;
      window.clearTimeout(timeout);
      goHome();
    });

    void finish();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, [redirect]);

  if (phase === "expired") {
    return (
      <AuthCard
        title="Link expired."
        subtitle="That sign-in link was already used or opened by an email scanner. Send yourself a fresh one and open the newest email only."
      >
        <Link
          to="/login"
          className="inline-flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90"
        >
          Send a fresh sign-in link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Signing you in." subtitle="Opening your workspace…">
      <div />
    </AuthCard>
  );
}