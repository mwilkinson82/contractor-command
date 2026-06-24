import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  const navigate = useNavigate();
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

    const goHome = () => navigate({ to: redirect ?? "/", replace: true });

    const finish = async () => {
      // Implicit-flow magic links land here as "#access_token=...&refresh_token=...".
      // The Supabase client is PKCE by default and will not auto-consume those,
      // so we set the session manually before checking.
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
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          goHome();
          return;
        }
      }

      // PKCE flow uses "?code=..." in the query string.
      const code = queryParams().get("code");
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
    }, 6000);

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled || !session) return;
      window.clearTimeout(timeout);
      goHome();
    });

    void finish().finally(() => {
      // Keep the timeout running until we either navigate or hit the deadline.
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, [navigate, redirect]);

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