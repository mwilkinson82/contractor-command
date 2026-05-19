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
    <div className="grid min-h-screen w-full grid-cols-1 bg-paper-edge/60 p-6 text-ink font-sans selection:bg-ink selection:text-cream md:grid-cols-2 lg:p-10">
      {/* Left: centered sign-in card */}
      <div className="flex items-center justify-center">
        <div className="w-full max-w-[460px] rounded-3xl border border-ink/10 bg-cream shadow-elegant">
          <header className="px-10 pt-10">
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

          <div className="px-10 py-10">
            <h1 className="font-display text-[64px] leading-[0.95]">
              Sign in.
            </h1>
            <p className="mt-5 max-w-[300px] text-[13px] leading-relaxed text-ink/55">
              Your private operating system. Enter to continue.
            </p>

            <form onSubmit={onSubmit} className="mt-10 space-y-8">
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

          <footer className="px-10 pb-10">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
              ALP &nbsp;·&nbsp; Private Operating System
            </p>
          </footer>
        </div>
      </div>

      {/* Right: open background with editorial tagline */}
      <div className="relative hidden flex-col justify-between md:flex">
        <div className="flex justify-end px-10 pt-6">
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
            Vol. I &nbsp;·&nbsp; MMXXVI
          </span>
        </div>

        <div className="px-10">
          <p className="font-display text-[44px] leading-[1.05] tracking-normal text-ink lg:text-[52px]">
            Build the company<br />behind the projects.
          </p>
        </div>

        <div className="flex items-end justify-between px-10 pb-6">
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
