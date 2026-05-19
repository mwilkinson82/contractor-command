import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard, AuthField, AuthSubmit } from "@/components/auth/auth-card";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — ALP Contractor Circle" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your inbox."
        subtitle={`If an account exists for ${email}, a reset link is on its way.`}
      >
        <p className="text-[13px] leading-relaxed text-ink/65">
          The link expires in one hour. If you don't see it in a few minutes,
          check your spam folder.
        </p>
        <div className="mt-8">
          <Link
            to="/login"
            className="inline-flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90"
          >
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset password."
      subtitle="Enter the email on your account. We'll send a secure link."
    >
      <form onSubmit={onSubmit} className="space-y-6">
        <AuthField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="name@company.com"
          required
          autoFocus
        />
        {err && <p className="text-[12px] text-[#b8442a]">{err}</p>}
        <AuthSubmit busy={busy} label="Send reset link" busyLabel="Sending" />
      </form>
      <p className="mt-6 text-center text-[12px] text-ink/55">
        Remembered it?{" "}
        <Link to="/login" className="font-display italic text-ink hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
