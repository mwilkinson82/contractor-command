import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard } from "@/components/auth/auth-card";

const CALLBACK_TIMEOUT_MS = 10_000;
const AUTH_STEP_TIMEOUT_MS = 8_000;
type TokenHashOtpType = "email" | "recovery" | "invite";

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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function tokenHashOtpType(value: string | null): TokenHashOtpType {
  if (value === "recovery" || value === "invite") return value;
  return "email";
}

function AuthCallbackPage() {
  const { redirect } = Route.useSearch();
  const [phase, setPhase] = useState<"checking" | "signed-in" | "expired">("checking");
  const [continueTo, setContinueTo] = useState(redirect ?? "/");

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    const timerIds: { deadline?: number; navigation?: number } = {};

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

    const clearDeadline = () => {
      if (timerIds.deadline) window.clearTimeout(timerIds.deadline);
    };

    const clearNavigation = () => {
      if (timerIds.navigation) window.clearTimeout(timerIds.navigation);
    };

    const clearAuthFragment = () => {
      if (typeof window === "undefined" || !window.location.hash) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };

    const finishExpired = () => {
      if (cancelled || settled) return;
      settled = true;
      clearDeadline();
      clearNavigation();
      clearAuthFragment();
      setPhase("expired");
    };

    const finishSignedIn = (destination = redirect ?? "/") => {
      if (cancelled || settled) return;
      settled = true;
      clearDeadline();
      clearAuthFragment();
      setContinueTo(destination);
      setPhase("signed-in");
      // Hard navigation: auth gate, company/tier loaders, and presence all key
      // off the refreshed session. A full reload at the destination guarantees
      // a clean mount with the new session.
      timerIds.navigation = window.setTimeout(() => {
        window.location.replace(destination);
      }, 100);
    };

    timerIds.deadline = window.setTimeout(finishExpired, CALLBACK_TIMEOUT_MS);

    if (urlHasAuthError()) {
      finishExpired();
      return () => {
        cancelled = true;
        clearDeadline();
        clearNavigation();
      };
    }

    const finish = async () => {
      try {
        const q = queryParams();
        // Branded emails link to this app route with a token hash instead of
        // linking directly to the backend /verify endpoint. That keeps email
        // security scanners from burning the one-time link before the member's
        // browser can finish sign-in.
        const tokenHash = q.get("token_hash");
        if (tokenHash) {
          const type = tokenHashOtpType(q.get("type"));
          const { error } = await withTimeout(
            supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type,
            }),
            AUTH_STEP_TIMEOUT_MS,
            "Magic-link token verification",
          );
          if (cancelled) return;
          if (!error) {
            finishSignedIn(type === "recovery" ? "/reset-password" : undefined);
            return;
          }
          console.error("[auth/callback] token hash verification failed", error);
          finishExpired();
          return;
        }

        // Implicit-flow magic + recovery links land here as
        // "#access_token=...&refresh_token=...". Make the exchange explicit so
        // the route works even if auto-detection does not consume the fragment first.
        const h = hashParams();
        const accessToken = h.get("access_token");
        const refreshToken = h.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error } = await withTimeout(
            supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            }),
            AUTH_STEP_TIMEOUT_MS,
            "Magic-link session setup",
          );
          if (cancelled) return;
          if (!error) {
            finishSignedIn();
            return;
          }
          console.error("[auth/callback] implicit session failed", error);
        }

        // PKCE flow uses "?code=..." in the query string.
        const code = q.get("code");
        if (code) {
          const { error } = await withTimeout(
            supabase.auth.exchangeCodeForSession(code),
            AUTH_STEP_TIMEOUT_MS,
            "Auth code exchange",
          );
          if (cancelled) return;
          if (!error) {
            finishSignedIn();
            return;
          }
          console.error("[auth/callback] code exchange failed", error);
        }

        const { data } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_STEP_TIMEOUT_MS,
          "Session check",
        );
        if (cancelled) return;
        if (data.session) finishSignedIn();
        else finishExpired();
      } catch (error) {
        if (cancelled) return;
        console.error("[auth/callback] sign-in callback failed", error);
        finishExpired();
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled || !session) return;
      finishSignedIn();
    });

    void finish();

    return () => {
      cancelled = true;
      clearDeadline();
      clearNavigation();
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
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-signal px-5 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90"
        >
          Send a fresh sign-in link →
        </Link>
      </AuthCard>
    );
  }

  if (phase === "signed-in") {
    return (
      <AuthCard title="You're signed in." subtitle="Opening your workspace…">
        <a
          href={continueTo}
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-signal px-5 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90"
        >
          Continue to command center →
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Signing you in." subtitle="Opening your workspace…">
      <div />
    </AuthCard>
  );
}
