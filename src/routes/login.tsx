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
    <div className="relative grid min-h-screen w-full grid-cols-1 bg-paper-edge/60 p-6 text-ink font-sans selection:bg-ink selection:text-cream md:grid-cols-2 md:items-center lg:p-10">
      {/* Left: the product — a tactile, modern card sitting on the paper */}
      <div className="flex justify-center md:justify-end md:pr-10 lg:pr-16">
        <div className="w-full max-w-[440px]">
          <div className="rounded-[28px] bg-cream shadow-[0_30px_80px_-40px_rgba(20,16,12,0.35),0_2px_0_rgba(20,16,12,0.04)] ring-1 ring-ink/[0.06]">
            <div className="px-10 pt-10 pb-9">
              <Link to="/" className="inline-flex items-center gap-2.5" aria-label="Contractor Circle">
                <img src={ccMark} alt="" className="h-7 w-7 object-contain" />
                <span className="text-[10px] uppercase tracking-[0.28em] text-ink/45">
                  ALP &middot; Contractor Circle
                </span>
              </Link>

              <h1 className="mt-8 font-display text-[44px] leading-[1.0] -tracking-[0.01em]">
                Sign in
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-ink/55">
                Your private operating system.
              </p>

              <form onSubmit={onSubmit} className="mt-8 space-y-6">
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
                  hint={
                    <a href="#" className="font-display italic text-[12px] text-ink/45 transition-colors hover:text-ink">
                      Forgot password?
                    </a>
                  }
                />

                {err && <p className="text-[12px] text-[#b8442a]">{err}</p>}

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Entering" : "Enter"}
                </button>
              </form>
            </div>

            <div className="border-t border-ink/[0.06] px-10 py-4 text-center">
              <span className="text-[10px] uppercase tracking-[0.28em] text-ink/35">
                Members only
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: the advertisement — paper, headline, justified columns */}
      <div className="relative hidden md:flex md:justify-start md:pl-10 lg:pl-16">
        <div className="w-full max-w-[520px]">
          <h2 className="font-display text-[112px] leading-[0.92] -tracking-[0.025em] text-ink lg:text-[128px]">
            Boring<br />wins.
          </h2>

          <div className="mt-10 grid grid-cols-3 gap-5 text-[11.5px] leading-[1.55] text-ink/75 [text-align:justify] [hyphens:auto] [text-justify:inter-word] tracking-[-0.005em]">
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

          <div className="mt-10 text-[10px] uppercase tracking-[0.28em] text-ink/35">
            An ALP publication
          </div>
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
  hint,
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
  hint?: React.ReactNode;
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
      {hint && <div className="mt-2">{hint}</div>}
    </div>
  );
}
