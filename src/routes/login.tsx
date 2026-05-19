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
    <div className="flex min-h-screen w-full bg-cream text-ink font-sans selection:bg-ink selection:text-cream">
      {/* Form side */}
      <div className="flex w-full flex-col md:w-1/2">
        {/* Top brand */}
        <header className="px-12 pt-12 lg:px-20 lg:pt-16">
          <Link to="/" className="inline-flex items-center gap-3">
            <span className="grid h-7 w-7 place-items-center">
              <svg viewBox="0 0 40 40" className="h-full w-full text-ink" fill="none" aria-hidden>
                <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1.25" />
                <circle cx="20" cy="20" r="6" fill="currentColor" />
              </svg>
            </span>
            <span className="text-[11px] uppercase tracking-[0.22em]">Contractor Circle</span>
          </Link>
        </header>

        {/* Center form */}
        <div className="flex flex-1 items-center px-12 lg:px-20">
          <div className="w-full max-w-[380px]">
            <h1 className="font-display text-[88px] leading-[0.95] tracking-[-0.02em]">
              Sign in.
            </h1>
            <p className="mt-6 max-w-[300px] text-[13px] leading-relaxed text-ink/55">
              Your private operating system. Enter to continue.
            </p>

            <form onSubmit={onSubmit} className="mt-16 space-y-10">
              <Field
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="name@company.com"
                required
                autoFocus
              />

              <Field
                id="password"
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                required
                trailing={
                  <a href="#" className="text-[11px] tracking-wide text-ink/40 transition-colors hover:text-ink">
                    Forgot?
                  </a>
                }
              />

              {err && <p className="text-[12px] text-[#b8442a]">{err}</p>}

              <button
                type="submit"
                disabled={busy}
                className="group mt-4 flex w-full items-center justify-between border-b border-ink py-4 text-left transition-opacity disabled:opacity-50"
              >
                <span className="text-[13px] uppercase tracking-[0.22em]">
                  {busy ? "Entering" : "Enter"}
                </span>
                <svg width="22" height="14" viewBox="0 0 22 14" fill="none" className="transition-transform group-hover:translate-x-1.5" aria-hidden>
                  <path d="M1 7h20m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1" strokeLinecap="square" />
                </svg>
              </button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <footer className="px-12 pb-12 lg:px-20 lg:pb-16">
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
            ALP &nbsp;·&nbsp; Private Operating System
          </p>
        </footer>
      </div>

      {/* Visual side — Apple/Ogilvy editorial */}
      <div className="relative hidden flex-col justify-between bg-cream md:flex md:w-1/2">
        {/* Hairline divider */}
        <div className="pointer-events-none absolute left-0 top-16 bottom-16 w-px bg-ink/10" aria-hidden />

        {/* Top corner mark */}
        <div className="flex justify-end px-12 pt-12 lg:px-20 lg:pt-16">
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
            Vol. I &nbsp;·&nbsp; MMXXVI
          </span>
        </div>

        {/* Center tagline */}
        <div className="px-12 lg:px-20">
          <p className="font-display text-[72px] italic leading-[1.02] tracking-[-0.015em] text-ink lg:text-[88px]">
            Build the<br />company<br />behind the<br />projects.
          </p>
        </div>

        {/* Bottom attribution */}
        <div className="flex items-end justify-between px-12 pb-12 lg:px-20 lg:pb-16">
          <p className="max-w-[260px] text-[12px] leading-relaxed text-ink/55">
            A quiet system for the operator who would rather think than scramble.
          </p>
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
            — AOS
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
  autoFocus,
  trailing,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-end justify-between">
        <label htmlFor={id} className="block text-[10px] uppercase tracking-[0.22em] text-ink/50">
          {label}
        </label>
        {trailing}
      </div>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        className="mt-3 w-full border-b border-ink/20 bg-transparent pb-3 text-[15px] outline-none transition-colors placeholder:text-ink/25 focus:border-ink"
      />
    </div>
  );
}
