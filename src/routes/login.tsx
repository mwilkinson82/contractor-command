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
        <div className="w-full max-w-[420px] rounded-3xl border border-ink/[0.06] bg-cream shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_16px_-10px_rgba(0,0,0,0.08),0_18px_36px_-24px_rgba(0,0,0,0.12)]">
          <div className="px-9 pt-10 pb-6 text-center">
            <h1 className="font-display text-[52px] leading-[1.05] -tracking-[0.01em]">
              Sign in
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed text-ink/55">
              Your private operating system.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-6 text-left">
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
                className="mt-1 inline-flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Entering" : "Enter"}
              </button>
            </form>
          </div>

          <footer className="px-9 pb-5 text-center">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
              Contractor Circle
            </p>
          </footer>
        </div>

      </div>


      {/* Right: DDB-era print ad — one dry headline, three tight columns */}
      <div className="relative hidden flex-col justify-center md:flex">
        <div className="mx-auto w-full max-w-[520px] px-10">
          <h2 className="font-display text-[112px] leading-[0.95] -tracking-[0.025em] text-ink lg:text-[128px]">
            Boring<br />wins.
          </h2>

          <div className="mt-12 grid grid-cols-3 gap-5 text-[11.5px] leading-[1.55] text-ink/75">
            <p>
              The best contractors we know aren't the loudest ones. They're the
              ones with systems. The ones who go home at five. The ones whose
              crews know what to do Monday morning without being told twice.
            </p>
            <p>
              That's what this is. Not another app. An operating system for the
              company behind your projects&mdash;meetings that end, numbers
              that mean something, a team that runs without you in the room.
            </p>
            <p>
              It isn't flashy. There's no dashboard with a rocket on it.
              Just a quiet, repeatable way to run a real construction business.
              <br /><br />
              Boring, maybe. But boring is what scales.
            </p>
          </div>

          <p className="mt-10 text-[10px] uppercase tracking-[0.28em] text-ink/40">
            ALP &middot; Contractor Circle
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
        className="mt-2 w-full border-0 border-b border-ink/15 bg-transparent px-0 py-2.5 text-[15px] outline-none transition-colors placeholder:text-ink/25 focus:border-ink"
      />
    </div>
  );
}
