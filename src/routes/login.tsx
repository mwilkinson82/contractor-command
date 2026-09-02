import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AuthCard, AuthField, AuthSubmit } from "@/components/auth/auth-card";
import { supabase } from "@/integrations/supabase/client";
import { sendTransactionalEmail } from "@/lib/email/send";
import { requestMemberMagicLink } from "@/lib/magic-link.functions";

function safeRedirect(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — ALP Contractor Circle" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "canonical", href: "https://alpcontractorcircle.com" }],
  }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? safeRedirect(search.redirect) : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: search.redirect ?? "/" });
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
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [magicSent, setMagicSent] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  function requestMagicLinkWithTimeout(emailAddress: string) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("That took too long. Please try again.")),
        18_000,
      );
    });

    return Promise.race([requestMagicLink({ data: { email: emailAddress } }), timeout]).finally(
      () => {
        if (timeoutId) clearTimeout(timeoutId);
      },
    );
  }

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) {
        router.invalidate();
        navigate({ to: redirectTo });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, navigate, redirectTo]);

  async function onMagicSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !isHydrated) return;
    setBusy(true);
    setErr(null);
    try {
      await requestMagicLinkWithTimeout(email.trim());
      setMagicSent(true);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onPasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !isHydrated) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    if (data?.user) {
      const user = data.user;
      const metadata = user.user_metadata as { full_name?: unknown };
      const fullName = typeof metadata.full_name === "string" ? metadata.full_name : undefined;
      void sendTransactionalEmail({
        templateName: "admin-activity-notice",
        recipientEmail: "wilkinson.marshall@gmail.com",
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

  return (
    <AuthCard
      title={magicSent ? "Check your inbox." : "Sign in to the Hub."}
      subtitle={
        magicSent
          ? `If ${email} is attached to active access, the newest secure sign-in link is on its way.`
          : "One secure login routes you to every ALP resource, application, and member space included in your access."
      }
    >
      {magicSent ? (
        <div>
          <div className="rounded-xl border border-border bg-muted/45 p-5 text-[13px] leading-relaxed text-foreground/75">
            Check your inbox and spam folder. Open the newest email only; each secure link works
            once.
          </div>
          <button
            type="button"
            className="mx-auto mt-5 block text-[12px] font-medium text-clay hover:underline"
            onClick={() => setMagicSent(false)}
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
            label={isHydrated ? "Enter the command center" : "Loading"}
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
