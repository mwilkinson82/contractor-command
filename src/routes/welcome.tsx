// Landing page after a migration invite link is clicked. Supabase auto-
// consumes the recovery/invite tokens from the URL hash and creates a
// session, then we ask the member to set their password.

import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [{ title: "Welcome — Contractor Circle" }],
  }),
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
    // The supabase client picks up tokens from the URL hash automatically
    // (detectSessionInUrl). Give it a tick, then check.
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

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-ink text-cream font-display text-[13px]">
            A
          </span>
          <span className="font-display text-[14px]">Contractor Circle</span>
        </Link>

        {phase === "checking" && (
          <p className="mt-10 text-[13px] text-muted-foreground">
            Confirming your invite…
          </p>
        )}

        {phase === "no-session" && (
          <>
            <h1 className="mt-8 font-display text-3xl">Invite link expired.</h1>
            <p className="mt-3 text-[14px] text-muted-foreground">
              Your invite link may have expired or already been used. If you've
              already set up your account, sign in below. Otherwise reach out
              and we'll resend it.
            </p>
            <div className="mt-6 flex gap-3">
              <Link
                to="/login"
                className="inline-flex items-center rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                className="inline-flex items-center rounded-md border border-border px-4 py-2.5 text-[13px] font-medium hover:bg-card"
              >
                Create account
              </Link>
            </div>
          </>
        )}

        {phase === "set-password" && (
          <>
            <h1 className="mt-8 font-display text-3xl">
              Welcome to the new portal.
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {email
                ? `Signed in as ${email}. Set a password to finish setup.`
                : "Set a password to finish setup."}
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4">
              <Field
                label="New password"
                type="password"
                value={password}
                onChange={setPassword}
                required
                autoFocus
              />
              <Field
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={setConfirm}
                required
              />
              {err && <p className="text-[12px] text-red-600">{err}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Set password & enter portal"}
              </button>
            </form>

            <p className="mt-6 text-[12px] text-muted-foreground">
              By continuing you're confirming this is your account.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  required,
  autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
      />
    </label>
  );
}
