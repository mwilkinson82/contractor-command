import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — ALP Contractor Circle" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-ink text-cream font-display text-[13px]">A</span>
          <span className="font-display text-[14px]">Contractor Circle</span>
        </Link>
        <h1 className="mt-8 font-display text-3xl">Sign in.</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Members only. Use the email tied to your membership.</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Field label="Email" type="email" value={email} onChange={setEmail} required autoFocus />
          <Field label="Password" type="password" value={password} onChange={setPassword} required />
          {err && <p className="text-[12px] text-red-600">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-[12px] text-muted-foreground">
          New member?{" "}
          <Link to="/signup" className="underline hover:text-foreground">Create your account</Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  label, type, value, onChange, required, autoFocus,
}: { label: string; type: string; value: string; onChange: (v: string) => void; required?: boolean; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</span>
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
