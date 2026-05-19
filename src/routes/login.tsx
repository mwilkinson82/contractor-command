import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import ccMark from "@/assets/cc-mark.png";


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
    <div className="relative grid min-h-screen w-full grid-cols-1 bg-paper-edge/60 p-6 text-ink font-sans selection:bg-ink selection:text-cream md:grid-cols-2 lg:p-10">
      {/* Tiny corner mark — Apple-style */}
      <Link to="/" className="absolute left-6 top-6 z-10 inline-flex items-center lg:left-10 lg:top-10" aria-label="Contractor Circle">
        <img src={ccMark} alt="" className="h-28 w-28 object-contain" />
      </Link>

      {/* Left: centered sign-in card */}
      <div className="flex items-center justify-center">
        <div className="w-full max-w-[460px] rounded-3xl border border-ink/10 bg-cream shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12),0_24px_48px_-24px_rgba(0,0,0,0.18)]">
          <div className="px-10 pt-14 pb-10 text-center">
            <h1 className="font-display text-[64px] leading-[0.95]">
              Sign in.
            </h1>
            <p className="mx-auto mt-5 max-w-[300px] text-[13px] leading-relaxed text-ink/55">
              Your private operating system. Enter to continue.
            </p>

            <form onSubmit={onSubmit} className="mt-10 space-y-8 text-left">
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
                className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Entering" : "Enter"}
              </button>
            </form>
          </div>

          <footer className="px-10 pb-10 text-center">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
              Contractor Circle
            </p>
          </footer>
        </div>
      </div>


      {/* Right: open background with editorial tagline */}
      <div className="relative hidden flex-col items-center justify-center md:flex">
        <div className="px-10 text-center">
          <p className="font-display text-[44px] leading-[1.05] tracking-normal text-ink lg:text-[52px] [text-shadow:0_1px_1px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.08)]">
            Build the company<br />behind the projects.
          </p>
          <p className="mt-6 font-display text-[20px] leading-relaxed text-ink/35">
            $2.5 billion in construction.
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
