// Landing page after a migration invite link is clicked. Supabase auto-
// consumes the recovery/invite tokens from the URL hash and creates a
// session, then we ask the member to set their password.

import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard, AuthField, AuthSubmit } from "@/components/auth/auth-card";

export const Route = createFileRoute("/welcome")({
  head: () => ({ meta: [{ title: "Welcome — Contractor Circle" }] }),
  component: WelcomePage,
});

function WelcomePage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"checking" | "set-password" | "no-session">(
    "checking",
  );
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user) {
        setEmail(data.session.user.email ?? null);
        setPhase("set-password");
      } else {
        setPhase("no-session");
      }
    };
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (cancelled) return;
      if (s?.user) {
        setEmail(s.user.email ?? null);
        setPhase("set-password");
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    navigate({ to: "/" });
  }

  if (phase === "checking") {
    return (
      <AuthCard title="One moment." subtitle="Confirming your invite…">
        <div />
      </AuthCard>
    );
  }

  if (phase === "no-session") {
    return (
      <AuthCard
        title="Invite expired."
        subtitle="This invite link may have expired or already been used."
      >
        <p className="text-[13px] leading-relaxed text-ink/65">
          If you've already set up your account, sign in. Otherwise reach out
          and we'll resend the invite.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            to="/login"
            className="inline-flex flex-1 items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="inline-flex flex-1 items-center justify-center rounded-full border border-ink/15 bg-transparent px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-ink transition-colors hover:border-ink/40"
          >
            Create account
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Welcome aboard."
      subtitle={
        email
          ? `Signed in as ${email}. Set a password to finish setup.`
          : "Set a password to finish setup."
      }
    >
      <form onSubmit={onSubmit} className="space-y-6">
        <AuthField
          id="password"
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          required
          autoFocus
        />
        <AuthField
          id="confirm"
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          placeholder="••••••••"
          required
        />
        {err && <p className="text-[12px] text-[#b8442a]">{err}</p>}
        <AuthSubmit busy={busy} label="Enter the portal" busyLabel="Saving" />
      </form>
      <p className="mt-6 text-[11px] leading-relaxed text-ink/45">
        By continuing you're confirming this is your account.
      </p>
    </AuthCard>
  );
}
