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
    <div className="flex min-h-screen w-full bg-cream text-ink selection:bg-signal selection:text-cream">
      {/* Form side */}
      <div className="flex w-full flex-col justify-center px-8 sm:px-12 md:w-1/2 lg:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-12">
            <Link to="/" className="mb-10 flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center">
                <svg viewBox="0 0 40 40" className="h-full w-full text-ink" fill="none" aria-hidden>
                  <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="20" cy="20" r="8" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M20 2v36M2 20h36" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.3" />
                </svg>
              </span>
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.15em]">Contractor Circle</span>
            </Link>
            <h1 className="font-display text-6xl leading-tight">Sign in.</h1>
          </div>

          <form onSubmit={onSubmit} className="space-y-8">
            <Field
              id="email"
              label="Email address"
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
                <a href="#" className="font-mono text-[10px] font-medium tracking-tight hover:text-signal transition-colors">
                  FORGOT?
                </a>
              }
            />

            {err && <p className="font-mono text-[11px] text-signal">{err}</p>}

            <button
              type="submit"
              disabled={busy}
              className="group flex w-full items-center justify-between bg-ink px-7 py-5 text-cream transition-all hover:bg-black disabled:opacity-50"
            >
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
                {busy ? "Entering…" : "Enter system"}
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="transition-transform group-hover:translate-x-1" aria-hidden>
                <path d="M5 12h14m-7-7 7 7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>

          <div className="mt-16">
            <p className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.2em] opacity-40">
              Private Operating System.<br />
              Better Decisions. Stronger Business.
            </p>
          </div>
        </div>
      </div>

      {/* Visual side */}
      <div className="relative hidden w-1/2 flex-col items-center justify-center overflow-hidden bg-[oklch(0.93_0.008_80)] md:flex">
        {/* Architectural grid */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(var(--ink) 1px, transparent 1px), linear-gradient(90deg, var(--ink) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
          aria-hidden
        />
        {/* Decorative frame */}
        <div className="pointer-events-none absolute inset-12 border border-ink/5" aria-hidden />

        {/* Command Packet card */}
        <div className="relative z-10 w-[360px] overflow-hidden border border-white/5 bg-ink p-10 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_10px_15px_-3px_rgba(0,0,0,0.1),0_20px_25px_-5px_rgba(0,0,0,0.1),0_40px_80px_-15px_rgba(0,0,0,0.35)]">
          {/* Noise + glow + 1px inner highlight */}
          <div
            className="pointer-events-none absolute inset-0 opacity-15 mix-blend-soft-light"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08)_0%,transparent_60%)]"
            aria-hidden
          />
          {/* tactile 1px inner highlight */}
          <div
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.04)" }}
            aria-hidden
          />

          <div className="relative z-10">
            <div className="mb-10 flex items-center justify-between border-b border-white/10 pb-6">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full border border-white/30 ring-4 ring-white/5" />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">
                  Command Packet
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_8px_rgba(228,87,61,0.5)]" />
                <span className="font-mono text-[8px] font-bold uppercase tracking-widest text-white/60">Active</span>
              </div>
            </div>

            <div className="space-y-8">
              <div className="space-y-2">
                <p className="font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-white/20">Growth Status</p>
                <p className="font-display text-2xl italic text-white/90">Target is supportable.</p>
              </div>

              <div className="space-y-1">
                <p className="font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-white/20">Revenue Gap</p>
                <p className="font-mono text-2xl font-light tracking-tight text-signal drop-shadow-[0_2px_4px_rgba(228,87,61,0.15)]">
                  $4,000,000
                </p>
              </div>

              <div className="space-y-3 pt-4">
                <p className="font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-white/20">Decision Path</p>
                <div className="flex items-center justify-between border border-white/10 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                  <p className="font-display text-xl text-white/90">Carry into AOS</p>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--signal)" strokeWidth="1.5" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <path d="m10 8 4 4-4 4" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Brand statement */}
        <div className="absolute bottom-16 left-16 right-16">
          <p className="max-w-[320px] font-display text-4xl leading-[1.1] tracking-tight opacity-90">
            Build the company behind the projects.
          </p>
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
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <label htmlFor={id} className="block font-mono text-[10px] font-bold uppercase tracking-[0.1em] opacity-50">
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
        className="w-full border-b border-ink/15 bg-transparent py-4 text-sm outline-none transition-all placeholder:opacity-30 focus:border-signal"
      />
    </div>
  );
}
