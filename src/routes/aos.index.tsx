// AOS Gateway — the threshold between Circle (the room) and AOS (the
// operating system). Cinematic on purpose: most Circle members walking
// through this door are entering AOS for the first time. The page mints a
// short-lived signed token via `mintAosSsoToken` and full-page-navigates
// to the AOS consume endpoint, which sets a session cookie and drops the
// member inside AOS already signed in.

import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Compass, Sparkles, Loader2, Users, Building2 } from "lucide-react";
import { mintAosSsoToken } from "@/lib/aos.functions";
import { useAuth } from "@/hooks/use-auth";
import { useCompany } from "@/hooks/use-company";
import { useAosLimits } from "@/hooks/use-aos-limits";

export const Route = createFileRoute("/aos/")({
  head: () => ({
    meta: [
      { title: "AOS — Cross the threshold" },
      {
        name: "description",
        content:
          "Step from Circle into AOS — your operating system. One click, one login.",
      },
    ],
  }),
  component: AosGateway,
});

function AosGateway() {
  const { user, loading: authLoading } = useAuth();
  const { company } = useCompany();
  const { limits, loading: limitsLoading, hasAccess, isUnlimited } = useAosLimits();
  const mint = useServerFn(mintAosSsoToken);

  const [phase, setPhase] = useState<"idle" | "minting" | "opened">("idle");
  const [error, setError] = useState<string | null>(null);
  const [previouslyLinked, setPreviouslyLinked] = useState<boolean | null>(null);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);

  // Probe link state on mount so we can swap the copy ("First time? We'll set
  // you up." vs. "Welcome back."). The probe itself doesn't redirect — it
  // just calls the same fn we'd call on click and discards the URL.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const res = await mint();
      if (!alive) return;
      if (res.ok) {
        setPreviouslyLinked(res.previously_linked);
        setLinkedEmail(res.aos_email);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleEnter = useCallback(async () => {
    setError(null);
    setPhase("minting");
    // Open the tab synchronously so popup blockers stay out of the way.
    const popup = typeof window !== "undefined" ? window.open("about:blank", "_blank", "noopener") : null;
    const res = await mint();
    if (!res.ok) {
      if (popup) popup.close();
      setError(res.error);
      setPhase("idle");
      return;
    }
    // AOS opens in a NEW TAB. Circle stays here so the member always has a
    // way back — no more "stuck on AOS after login" reports.
    if (popup) {
      popup.location.href = res.url;
    } else {
      // Popup blocked — last-resort same-tab navigation so they're not stranded.
      window.location.assign(res.url);
      return;
    }
    setPhase("opened");
  }, [mint]);


  const headline =
    previouslyLinked === true
      ? "Welcome back. Step inside."
      : "You've run the diagnostics. Now run the company.";

  const sub =
    previouslyLinked === true
      ? `Picking up your AOS session as ${linkedEmail ?? "you"}.`
      : "AOS is where Circle becomes operational — vision, scorecard, rocks, weekly L10. One click and you're inside.";

  const reassurance =
    previouslyLinked === false
      ? "First time? We'll set up your AOS workspace automatically."
      : previouslyLinked === true && company?.name
      ? `Continuing with ${company.name}.`
      : null;

  const handingOff = phase === "minting";

  return (
    <>
    {handingOff && (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-ink text-cream"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--cream) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 left-1/2 h-[120%] w-[80%] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, var(--gold), transparent 70%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-6 text-center">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-gold/40 animate-ping" />
            <span className="absolute inset-2 rounded-full border border-gold/60" />
            <Compass className="h-6 w-6 text-gold" />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-cream/55">
              Opening the door
            </p>
            <p className="mt-3 font-display text-2xl tracking-tight sm:text-3xl">
              Opening AOS in a new tab…
            </p>
            <p className="mt-2 text-[13px] text-cream/60">
              Signing you in{linkedEmail ? ` as ${linkedEmail}` : ""}. Keep this tab open.
            </p>
          </div>
        </div>
      </div>
    )}
    <section className="relative isolate -m-4 min-h-[calc(100svh-4rem)] overflow-hidden bg-ink text-cream sm:-m-6 md:-m-8">
      {/* Ambient field — same grammar as AosHero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--cream) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[30%] right-[-15%] h-[120%] w-[70%] rounded-full opacity-[0.22] blur-3xl gateway-glow"
        style={{
          background:
            "radial-gradient(closest-side, var(--gold), transparent 70%)",
        }}
      />
      {/* Slow sweeping scan line */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent gateway-scan"
      />

      <div className="relative mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl grid-rows-[1fr_auto] px-6 py-16 sm:px-10 sm:py-24 lg:grid-cols-[1.4fr_1fr] lg:grid-rows-1 lg:gap-16">
        {/* Left: the threshold */}
        <div className="flex flex-col justify-center">
          <p
            className="label-mono !text-cream/55 opacity-0 gateway-reveal"
            style={{ animationDelay: "60ms" }}
          >
            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle animate-signal-pulse" />
            Step 02 · Cross the threshold
          </p>

          <h1
            className="mt-6 font-display text-[2.5rem] leading-[1.04] tracking-tight text-cream opacity-0 gateway-reveal sm:text-[3.75rem]"
            style={{ animationDelay: "280ms" }}
          >
            {headline}
          </h1>

          <p
            className="mt-6 max-w-xl text-[15px] leading-relaxed text-cream/75 opacity-0 gateway-reveal sm:text-[16px]"
            style={{ animationDelay: "520ms" }}
          >
            {sub}
          </p>

          <div
            className="mt-10 flex flex-col gap-4 opacity-0 gateway-reveal"
            style={{ animationDelay: "780ms" }}
          >
            <button
              type="button"
              onClick={handleEnter}
              disabled={
                authLoading || !user || phase === "minting" || (!limitsLoading && !hasAccess)
              }
              className="group relative inline-flex w-fit items-center gap-3 rounded-md bg-gold px-7 py-4 text-[15px] font-medium text-ink shadow-[0_0_0_0_var(--gold)] transition-all duration-300 hover:shadow-[0_0_40px_-4px_var(--gold)] disabled:opacity-60"
            >
              {phase === "minting" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Opening AOS…
                </>
              ) : phase === "opened" ? (
                <>
                  <Compass className="h-4 w-4" />
                  Reopen AOS
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </>
              ) : (
                <>
                  <Compass className="h-4 w-4" />
                  Enter AOS
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </>
              )}
            </button>

            {/* Allowance pill — shows the user what their plan grants in AOS. */}
            {limits && hasAccess && (
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-cream/70">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cream/15 bg-cream/[0.04] px-3 py-1">
                  <Building2 className="h-3 w-3 text-gold" />
                  {isUnlimited
                    ? "Unlimited workspaces"
                    : `${limits.workspaceLimit} workspace${limits.workspaceLimit === 1 ? "" : "s"}`}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cream/15 bg-cream/[0.04] px-3 py-1">
                  <Users className="h-3 w-3 text-gold" />
                  {isUnlimited
                    ? "Unlimited seats"
                    : `${limits.seatLimit} seat${limits.seatLimit === 1 ? "" : "s"}`}
                </span>
                {!isUnlimited && (
                  <Link
                    to="/upgrade"
                    className="text-cream/55 underline-offset-4 hover:text-cream/85 hover:underline"
                  >
                    Need more? Upgrade →
                  </Link>
                )}
              </div>
            )}

            {/* No access — user has no active subscription that grants AOS. */}
            {!limitsLoading && !hasAccess && user && (
              <p className="max-w-md text-[13px] text-cream/70">
                Your plan doesn't include AOS access yet.{" "}
                <Link
                  to="/upgrade"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  See your options →
                </Link>
              </p>
            )}

            {reassurance && hasAccess && (
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/55">
                {reassurance}
              </p>
            )}

            {error && (
              <p className="text-[13px] text-rose-300/90">
                {error}{" "}
                <button
                  type="button"
                  onClick={handleEnter}
                  className="underline underline-offset-2 hover:text-rose-200"
                >
                  Try again
                </button>
              </p>
            )}

            <Link
              to="/aos/link"
              className="text-[12px] text-cream/55 underline-offset-4 transition-colors hover:text-cream/85 hover:underline"
            >
              Different email on AOS already? Link your existing account →
            </Link>
          </div>
        </div>

        {/* Right: what lights up */}
        <div
          className="mt-12 flex items-center opacity-0 gateway-reveal lg:mt-0"
          style={{ animationDelay: "980ms" }}
        >
          <div className="w-full rounded-2xl border border-cream/10 bg-cream/[0.03] p-6 backdrop-blur-sm">
            <p className="flex items-center gap-2 label-mono !text-cream/55">
              <Sparkles className="h-3 w-3 text-gold" /> What lights up inside
            </p>
            <ul className="mt-5 space-y-4 text-[13px] text-cream/85">
              {[
                ["Vision", "Where the company is going and why it matters."],
                ["Scorecard", "Weekly numbers that prove the engine moves."],
                ["Rocks", "On-track vs. off-track this quarter."],
                ["Issues", "Surfaced, prioritized, solved."],
                ["Process", "How the work actually gets done — written down."],
                ["Traction", "Meeting rhythm. Accountability over time."],
              ].map(([title, body]) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                  <div>
                    <p className="font-medium text-cream">{title}</p>
                    <p className="text-cream/60">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-cream/10 pt-4 text-[11px] leading-relaxed text-cream/55">
              You sign in once on Circle. AOS opens with you already inside.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes gatewayReveal {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .gateway-reveal {
          animation: gatewayReveal 700ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes gatewayGlow {
          0%, 100% { opacity: 0.18; transform: scale(1); }
          50% { opacity: 0.28; transform: scale(1.04); }
        }
        .gateway-glow { animation: gatewayGlow 8s ease-in-out infinite; }
        @keyframes gatewayScan {
          0% { transform: translateY(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        .gateway-scan { animation: gatewayScan 9s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .gateway-reveal { animation: none; opacity: 1; transform: none; }
          .gateway-glow, .gateway-scan { animation: none; }
        }
      `}</style>
    </section>
    </>
  );
}
