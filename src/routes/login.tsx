import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AuthCard, AuthField, AuthSubmit } from "@/components/auth/auth-card";
import { supabase } from "@/integrations/supabase/client";
import { sendTransactionalEmail } from "@/lib/email/send";
import { requestMemberMagicLink } from "@/lib/magic-link.functions";

import { athenaPageReturn } from "@/lib/athena-page-return";
import { oauthReturnPath, oauthConsentReturn } from "@/lib/oauth-return-path";
import { onAthenaHost, currentHostname } from "@/lib/athena-host-current";
import { isLovableHost } from "@/lib/athena-host";
import { normalizeOtpCode } from "@/lib/login-otp";
import { loginCopy } from "@/lib/login-copy";
import { boundedStep } from "@/lib/consent-loading";
import { postLoginDestination } from "@/lib/post-login-destination";

const safeRedirect = oauthReturnPath;

export const Route = createFileRoute("/login")({
  // Context typed loosely to avoid a circular inference with validateSearch.
  head: (ctx: { match?: { search?: unknown } }) => {
    const redirectTo = (ctx.match?.search as { redirect?: string } | undefined)?.redirect;
    if (onAthenaHost() || isLovableHost(currentHostname()) || oauthConsentReturn(redirectTo)) {
      return { meta: [{ title: "Sign in — Athena" }, { name: "robots", content: "noindex, nofollow" }] };
    }
    return {
      meta: [
        { title: "Sign in — ALP Contractor Circle" },
        { name: "robots", content: "noindex, nofollow" },
      ],
      links: [{ rel: "canonical", href: "https://alpcontractorcircle.com" }],
    };
  },
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? safeRedirect(search.redirect) : undefined,
  }),
  beforeLoad: async ({ search }) => {
    // Bounded: on a domain where the auth lock or a stale token stalls getSession (seen on app.meetathena.io when
    // the Site URL moved consent there), show the sign-in form instead of spinning forever.
    let hasSession = false;
    try {
      const { data } = await boundedStep("session", () => supabase.auth.getSession(), 6_000);
      hasSession = !!data.session;
    } catch {
      hasSession = false;
    }
    if (hasSession) throw redirect({ href: postLoginDestination(currentHostname(), search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const requestMagicLink = useServerFn(requestMemberMagicLink);
  const { redirect: redirectTo } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fromConnect = !!oauthConsentReturn(redirectTo);
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [magicRequested, setMagicRequested] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [code, setCode] = useState("");

  function requestMagicLinkWithTimeout(emailAddress: string) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("That took too long. Please try again.")),
        18_000,
      );
    });

    return Promise.race([
      requestMagicLink({
        data: {
          email: emailAddress,
          continuation: oauthConsentReturn(redirectTo),
          return_to: athenaPageReturn(redirectTo),
        },
      }),
      timeout,
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      if (session && mode === "password") {
        router.invalidate();
        const next = postLoginDestination(window.location.hostname, redirectTo);
        if (next.includes("?") || next.includes("#")) window.location.assign(next);
        else navigate({ to: next });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, navigate, redirectTo, mode]);

  async function onMagicSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !isHydrated) return;
    setBusy(true);
    setErr(null);
    try {
      await requestMagicLinkWithTimeout(email.trim());
      setMagicRequested(true);
    } catch {
      setErr("We could not confirm your request. Please try again, or sign in with your password.");
    } finally {
      setBusy(false);
    }
  }

  // v0.8.19: finish the connect in this same tab with the code from the email,
  // so a phone never has to switch tabs, browsers or hosts.
  async function onCodeSubmit(event: React.FormEvent) {
    event.preventDefault();
    const token = normalizeOtpCode(code);
    if (busy || !token) {
      setErr("Enter the code from the email.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { error } = await boundedStep("session", () =>
        supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" }),
      );
      if (error) throw error;
      window.location.assign(postLoginDestination(window.location.hostname, redirectTo));
    } catch {
      setErr("That code didn't work. Use the newest email, or tap the link in it.");
      setBusy(false);
    }
  }

  async function onPasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !isHydrated) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error)
      setErr("We could not sign you in. Check your details or request a secure sign-in link.");
    if (data?.user) {
      const user = data.user;
      const metadata = user.user_metadata as { full_name?: unknown };
      const fullName = typeof metadata.full_name === "string" ? metadata.full_name : undefined;
      void sendTransactionalEmail({
        templateName: "admin-activity-notice",
        recipientEmail: "[REDACTED]",
        idempotencyKey: `login-${user.id}-${Date.now()}`,
        templateData: {
          event: "Member signed in",
          memberEmail: user.email,
          memberName: fullName,
          occurredAt: new Date().toISOString(),
        },
      }).catch((notifyError) => console.warn("admin notify (login) failed", notifyError));
    }
    setBusy(false);
  }

  // The lovable.app host only serves Athena connects; never show the Hub brand there.
  const athenaBrand = fromConnect || onAthenaHost() || isLovableHost(currentHostname());
  const copy = loginCopy({ athena: athenaBrand, fromConnect, magicRequested, email });

  return (
    <AuthCard
      brand={athenaBrand ? "athena" : "hub"}
      title={copy.title}
      subtitle={copy.subtitle}
    >
      {magicRequested ? (
        <div>
          <div className="rounded-xl border border-border bg-muted/45 p-5 text-[13px] leading-relaxed text-foreground/75">
            Check your inbox and spam folder. Open the newest email only; each secure link works
            once.
          </div>
          {athenaBrand && (
            <form onSubmit={onCodeSubmit} className="mt-5 space-y-4">
              <AuthField
                id="otp"
                label="Or type the code from the email"
                type="text"
                value={code}
                onChange={setCode}
                placeholder="123456"
                required
              />
              {err && <p className="text-[12px] text-[color:var(--danger-warm)]">{err}</p>}
              <AuthSubmit busy={busy} label="Continue" busyLabel="Checking code" />
            </form>
          )}
          <button
            type="button"
            className="mx-auto mt-5 block text-[12px] font-medium text-clay hover:underline"
            onClick={() => setMagicRequested(false)}
          >
            Try a different email
          </button>
        </div>
      ) : mode === "magic" ? (
        <form onSubmit={onMagicSubmit} className="space-y-5">
          <AuthField
            id="email"
            label="Work email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="name@company.com"
            required
            autoFocus
          />
          {err && <p className="text-[12px] text-[color:var(--danger-warm)]">{err}</p>}
          <AuthSubmit
            busy={busy || !isHydrated}
            label={isHydrated ? "Email me a secure sign-in link" : "Loading"}
            busyLabel={isHydrated ? "Sending secure link" : "Loading"}
          />
          <button
            type="button"
            className="mx-auto block text-[12px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setErr(null);
              setMode("password");
            }}
          >
            Prefer a password? <strong>Use password instead</strong>
          </button>
        </form>
      ) : (
        <form onSubmit={onPasswordSubmit} className="space-y-5">
          <AuthField
            id="email"
            label="Work email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="name@company.com"
            required
            autoFocus
          />
          <AuthField
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            required
            hint={
              <Link to="/forgot-password" className="text-[12px] text-clay hover:underline">
                Forgot password?
              </Link>
            }
          />
          {err && <p className="text-[12px] text-[color:var(--danger-warm)]">{err}</p>}
          <AuthSubmit
            busy={busy || !isHydrated}
            label={isHydrated ? "Enter the command center" : "Loading"}
            busyLabel={isHydrated ? "Signing in" : "Loading"}
          />
          <button
            type="button"
            className="mx-auto block text-[12px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setErr(null);
              setMode("magic");
            }}
          >
            Email me a secure sign-in link
          </button>
        </form>
      )}
    </AuthCard>
  );
}
