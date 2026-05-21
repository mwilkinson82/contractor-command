import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { requestPasswordReset } from "@/lib/password-reset.functions";
import { AuthCard, AuthField, AuthSubmit } from "@/components/auth/auth-card";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — ALP Contractor Circle" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const reset = useServerFn(requestPasswordReset);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await reset({ data: { email: email.trim() } });
      setSent(true);
      toast.success("Reset link requested", {
        description: "If that email has access, the link is on its way.",
      });
    } catch (e: any) {
      const msg = e?.message || "Something went wrong";
      setErr(msg);
      toast.error("Reset email failed", { description: msg });
    } finally {
      setBusy(false);
    }
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
        {err && <p className="text-[12px] text-[color:var(--danger-warm)]">{err}</p>}
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
