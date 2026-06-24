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

    const urlHasAuthError = () => {
      if (typeof window === "undefined") return false;
      const qs = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      return Boolean(qs.get("error") || hash.get("error"));
    };

    if (urlHasAuthError()) {
      setPhase("expired");
      return;
    }

    const finish = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        navigate({ to: redirect ?? "/", replace: true });
        return;
      }
      setPhase("expired");
    };

    const timeout = window.setTimeout(() => {
      if (!cancelled) setPhase("expired");
    }, 6000);

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled || !session) return;
      window.clearTimeout(timeout);
      navigate({ to: redirect ?? "/", replace: true });
    });

    void finish().finally(() => window.clearTimeout(timeout));

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