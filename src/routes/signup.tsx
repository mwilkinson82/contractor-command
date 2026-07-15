import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard, AuthField, AuthSubmit } from "@/components/auth/auth-card";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — ALP Contractor Circle" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => {
      if (s) {
        router.invalidate();
        navigate({ to: "/" });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const redirectUrl = `${window.location.origin}/`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl, data: { full_name: fullName } },
    });
    if (error) setErr(error.message);
    else if (!data.session) setPending(true);
    setBusy(false);
  }

  if (pending) {
    return (
      <AuthCard title="Check your inbox." subtitle={`We sent a confirmation link to ${email}.`}>
        <p className="text-[13px] leading-relaxed text-ink/65">
          Click the link to verify your email, then come back and sign in.
        </p>
        <div className="mt-8">
          <Link
            to="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-signal px-5 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90"
          >
            Back to sign in →
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create account." subtitle="Use the email tied to your membership.">
      <form onSubmit={onSubmit} className="space-y-6">
        <AuthField
          id="fullName"
          label="Full name"
          type="text"
          value={fullName}
          onChange={setFullName}
          placeholder="Jane Contractor"
          required
          autoFocus
        />
        <AuthField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="name@company.com"
          required
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          required
        />
        {err && <p className="text-[12px] text-[color:var(--danger-warm)]">{err}</p>}
        <AuthSubmit busy={busy} label="Create account" busyLabel="Creating" />
      </form>
      <p className="mt-6 text-center text-[12px] text-ink/55">
        Already have an account?{" "}
        <Link to="/login" className="font-display italic text-ink hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
