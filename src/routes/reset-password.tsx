import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard, AuthField, AuthSubmit } from "@/components/auth/auth-card";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set new password — ALP Contractor Circle" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"checking" | "ready" | "no-session" | "done">(
    "checking",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Supabase auto-consumes the recovery tokens from the URL hash. Wait one
  // tick, check for a session, and surface the right state.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setPhase(data.session ? "ready" : "no-session");
    };
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (cancelled) return;
      if (s) setPhase("ready");
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
    setPhase("done");
    setTimeout(() => navigate({ to: "/" }), 1200);
  }

  if (phase === "checking") {
    return (
      <AuthCard title="One moment." subtitle="Confirming your reset link…">
        <div />
      </AuthCard>
    );
  }

  if (phase === "no-session") {
    return (
      <AuthCard
        title="Link expired."
        subtitle="This reset link is no longer valid. Request a new one."
      >
        <Link
          to="/forgot-password"
          className="inline-flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90"
        >
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  if (phase === "done") {
    return (
      <AuthCard title="Done." subtitle="Password updated. Taking you in…">
        <div />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="New password." subtitle="Pick something you'll actually remember.">
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
        <AuthSubmit busy={busy} label="Update password" busyLabel="Saving" />
      </form>
    </AuthCard>
  );
}
