// AOS Gateway — the threshold between Circle (the room) and AOS (the
// operating system). Visually congruent with the AOS landing page so the
// member feels they're already inside the OS the moment they click. Mints a
// short-lived signed token via `mintAosSsoToken` and opens AOS in a new tab.

import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Compass, Loader2 } from "lucide-react";
import { mintAosSsoToken } from "@/lib/aos.functions";
import { useAuth } from "@/hooks/use-auth";
import { useCompany } from "@/hooks/use-company";
import { useAosLimits } from "@/hooks/use-aos-limits";
import { useTier } from "@/hooks/use-tier";
import { AosAddonsPanel } from "@/components/portal/aos-addons-panel";

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

const proofLines = ["Built from the field.", "Not another dashboard.", "Not owner memory."];

const scoreRows: Array<[string, string, string]> = [
  ["Weekly revenue", "105", "green"],
  ["Gross margin %", "22", "hold"],
  ["Backlog weeks", "12", "miss"],
  ["Bid hit rate %", "23", "watch"],
  ["Schedule variance", "60", "red"],
];

function AosGateway() {
  const { user, loading: authLoading } = useAuth();
  const { company } = useCompany();
  const { limits, loading: limitsLoading, hasAccess, isUnlimited } = useAosLimits();
  const { isBookBuyer } = useTier();
  const mint = useServerFn(mintAosSsoToken);

  const [phase, setPhase] = useState<"idle" | "minting" | "opened">("idle");
  const [error, setError] = useState<string | null>(null);
  const [previouslyLinked, setPreviouslyLinked] = useState<boolean | null>(null);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);

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
    const popup = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    const res = await mint();
    if (!res.ok) {
      if (popup) popup.close();
      setError(res.error);
      setPhase("idle");
      return;
    }
    if (popup) {
      popup.location.href = res.url;
    } else {
      window.location.assign(res.url);
      return;
    }
    setPhase("opened");
  }, [mint]);

  const headline =
    previouslyLinked === true
      ? "Welcome back."
      : "Memory is not\nmanagement.";

  const sub =
    previouslyLinked === true
      ? `Picking up your AOS session as ${linkedEmail ?? "you"}.`
      : isBookBuyer
      ? "Your two seats are waiting. One workspace. Vision, Scorecard, Rocks, weekly L10 — start running it."
      : "Unlimited workspaces. Unlimited seats. Vision, Scorecard, Rocks, weekly L10 — your Circle plan unlocks all of it.";

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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-cream text-ink"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-ink/30 animate-ping" />
              <span className="absolute inset-2 rounded-full border border-ink/50" />
              <Compass className="h-6 w-6 text-ink" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.34em] text-signal">
                Opening the door
              </p>
              <p className="mt-4 font-display text-[clamp(2rem,5vw,3rem)] leading-[0.95] tracking-[-0.02em] text-ink">
                Opening AOS<br />in a new tab.
              </p>
              <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.28em] text-[#8e877c]">
                Signing you in{linkedEmail ? ` as ${linkedEmail}` : ""}
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="-m-4 flex min-h-[calc(100svh-4rem)] flex-col overflow-x-hidden bg-cream text-ink sm:-m-6 md:-m-8">
        <section className="mx-auto flex w-full max-w-[1500px] flex-1 px-5 py-6 sm:px-8 sm:py-8">
          <article className="grid w-full overflow-hidden border border-paper-edge bg-card px-6 py-7 sm:px-10 sm:py-9 lg:min-h-0 lg:grid-cols-[minmax(0,0.67fr)_minmax(20rem,0.33fr)] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:gap-x-12 lg:px-14 lg:py-11 xl:gap-x-16 xl:px-16">
            {/* Top eyebrow row */}
            <div className="flex items-start justify-between gap-6 lg:col-span-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.34em] text-signal">
                  <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle" />
                  Step 02 · Cross the threshold
                </p>
                <p className="mt-4 max-w-[18rem] text-[10px] font-bold uppercase leading-[1.65] tracking-[0.32em] text-[#8e877c]">
                  Vision / People / Data / Issues / Process / Traction
                </p>
              </div>
              <p className="hidden max-w-[14rem] text-right text-[10px] font-bold uppercase leading-[1.7] tracking-[0.32em] text-[#8e877c] sm:block">
                One cadence.
                <br />
                Every Monday.
              </p>
            </div>

            {/* Headline + CTAs */}
            <div className="mt-9 flex min-h-0 flex-col lg:mt-12">
              <h1 className="font-display max-w-[54rem] whitespace-pre-line text-[clamp(3.25rem,8.5vw,6rem)] font-normal leading-[0.94] tracking-[-0.025em] text-ink">
                {headline}
              </h1>

              <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-[#4d463f] sm:text-[16px]">
                {sub}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row lg:mt-9">
                <button
                  type="button"
                  onClick={handleEnter}
                  disabled={
                    authLoading || !user || phase === "minting" || (!limitsLoading && !hasAccess)
                  }
                  className="inline-flex h-12 items-center justify-center gap-3 bg-ink px-8 text-[11px] font-bold uppercase tracking-[0.24em] text-cream transition-colors hover:bg-ink-panel disabled:opacity-50"
                >
                  {phase === "minting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening AOS
                    </>
                  ) : phase === "opened" ? (
                    <>
                      Reopen AOS
                      <ArrowUpRight className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Enter AOS
                      <ArrowUpRight className="h-4 w-4" />
                    </>
                  )}
                </button>
                <Link
                  to="/aos/link"
                  className="inline-flex h-12 items-center justify-center border border-ink bg-transparent px-8 text-[11px] font-bold uppercase tracking-[0.24em] text-ink transition-colors hover:bg-paper-deep"
                >
                  Link existing account
                </Link>
              </div>

              {/* Status row */}
              <div className="mt-6 flex flex-col gap-2 text-[12px] text-[#5b554d]">
                {phase === "opened" && (
                  <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-signal">
                    AOS opened in a new tab — Circle stays right here.
                  </p>
                )}
                {limits && hasAccess && (
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#8e877c]">
                    {isUnlimited
                      ? "Unlimited workspaces · Unlimited seats"
                      : `${limits.workspaceLimit} workspace${limits.workspaceLimit === 1 ? "" : "s"} · ${limits.seatLimit} seat${limits.seatLimit === 1 ? "" : "s"}`}
                    {!isUnlimited && (
                      <>
                        {" · "}
                        <Link to="/upgrade" className="text-signal underline-offset-4 hover:underline">
                          Upgrade
                        </Link>
                      </>
                    )}
                  </p>
                )}
                {!limitsLoading && !hasAccess && user && (
                  <p>
                    Your plan doesn't include AOS access yet.{" "}
                    <Link to="/upgrade" className="text-signal underline-offset-4 hover:underline">
                      See your options →
                    </Link>
                  </p>
                )}
                {reassurance && hasAccess && (
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#8e877c]">
                    {reassurance}
                  </p>
                )}
                {error && (
                  <p className="text-[13px] text-[color:var(--danger-warm)]">
                    {error}{" "}
                    <button
                      type="button"
                      onClick={handleEnter}
                      className="underline underline-offset-2 hover:opacity-80"
                    >
                      Try again
                    </button>
                  </p>
                )}
                <p className="pt-1 text-[12px] text-[#5b554d]">
                  Different email on AOS already?{" "}
                  <Link to="/aos/link" className="text-ink underline-offset-4 hover:underline">
                    Link your existing account →
                  </Link>
                </p>
              </div>
            </div>

            {/* Right column — scorecard paper */}
            <figure className="relative mt-12 lg:mt-0 lg:min-h-0">
              <div className="relative mx-auto w-full max-w-[24rem] rotate-[-1.5deg] border border-[#cfc6b8] bg-[#fdfaf3] p-5 shadow-[0_28px_60px_-38px_rgba(17,17,17,0.72)] lg:absolute lg:inset-x-0 lg:right-0 lg:bottom-4 lg:left-auto lg:max-w-[21.25rem] xl:max-w-[23rem]">
                <div className="flex items-start justify-between border-b border-[#d7d0c4] pb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ink">
                      AOS
                    </p>
                    <p className="mt-2 font-display text-2xl leading-none text-ink">
                      13-week Scorecard
                    </p>
                  </div>
                  <p className="text-right text-[9px] font-bold uppercase leading-[1.5] tracking-[0.24em] text-[#8e877c]">
                    Monday
                    <br />
                    7:00 AM
                  </p>
                </div>

                <div className="relative mt-5">
                  <div className="grid grid-cols-[1fr_5rem_4.5rem] border-b border-[#d7d0c4] pb-2 text-[9px] font-bold uppercase tracking-[0.24em] text-[#8e877c]">
                    <span>Number</span>
                    <span>Target</span>
                    <span>Status</span>
                  </div>
                  {scoreRows.map(([name, target, status]) => (
                    <div
                      key={name}
                      className="grid grid-cols-[1fr_5rem_4.5rem] border-b border-[#ded7cc] py-3 text-sm text-ink"
                    >
                      <span className="font-semibold">{name}</span>
                      <span className="font-display -mt-1 -rotate-2 text-[1.45rem] leading-none text-[#2f2a25]">
                        {target}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5b554d]">
                        {status}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 border-t border-[#d7d0c4] pt-4">
                  <p className="font-display text-[1.4rem] leading-[1.05] text-ink">
                    Owner memory is not a system.
                  </p>
                  <p className="mt-3 text-[10px] font-bold uppercase leading-[1.6] tracking-[0.24em] text-signal">
                    Mark it. Measure it. Run it weekly.
                  </p>
                </div>
              </div>
            </figure>

            {/* Footer band */}
            <div className="mt-7 flex flex-col gap-4 border-t border-paper-edge pt-5 sm:flex-row sm:items-center sm:justify-between lg:col-span-2 lg:mt-0 lg:pt-4">
              <div className="grid gap-3 sm:grid-cols-3 sm:divide-x sm:divide-paper-edge">
                {proofLines.map((line) => (
                  <p
                    key={line}
                    className="font-display text-base leading-[1.1] text-[#4d463f] sm:px-5 sm:text-center"
                  >
                    {line}
                  </p>
                ))}
              </div>
              <p className="shrink-0 text-[10px] font-bold uppercase tracking-[0.32em] text-[#8e877c]">
                An ALP Contractor Circle Instrument
              </p>
            </div>
          </article>
        </section>
      </main>
    </>
  );
}
