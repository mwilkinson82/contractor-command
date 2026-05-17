// Full-bleed "Start your AOS" hook. Shown to users whose Circle email
// isn't yet linked to an AOS workspace. AOS is the stickiest thing in
// the program — until it's running, the Command Center can't actually
// read the business, so the home page should be dominated by this hook.

import { useState } from "react";
import { AOS_URL } from "@/lib/program";
import { ArrowUpRight, Compass, Sparkles } from "lucide-react";

export function AosHero({
  previouslyLinked,
  isChecking,
  onRecheck,
}: {
  previouslyLinked: boolean;
  isChecking: boolean;
  onRecheck: () => void;
}) {
  const [opened, setOpened] = useState(false);

  const openAos = () => {
    setOpened(true);
    window.open(AOS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="relative overflow-hidden rounded-3xl bg-ink text-cream shadow-[var(--shadow-focus)]">
      {/* Ambient field */}
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
        className="pointer-events-none absolute -top-1/2 right-[-10%] h-[140%] w-[60%] rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--gold), transparent 70%)" }}
      />

      <div className="relative grid gap-8 px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
          <p className="label-mono !text-cream/55">
            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle animate-signal-pulse" />
            {previouslyLinked ? "Reconnect AOS" : "Step 01 · The operating system"}
          </p>

          <h1 className="mt-5 font-display text-[2.25rem] leading-[1.04] tracking-tight text-cream sm:text-[3.25rem]">
            {previouslyLinked
              ? "Your AOS session needs a refresh."
              : "Your business isn't visible yet."}
          </h1>

          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-cream/75">
            {previouslyLinked
              ? "We've connected your AOS before. Open it, sign back in, and we'll relight the Command Center automatically."
              : "AOS is where the business becomes legible — scorecard, rocks, issues, weekly L10. Until it's running, the Command Center is flying blind. Start it now and every tile on this page comes alive."}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openAos}
              className="inline-flex items-center gap-2 rounded-md bg-gold px-5 py-3 text-[14px] font-medium text-ink hover:opacity-90"
            >
              <Compass className="h-4 w-4" />
              {previouslyLinked ? "Open AOS to refresh" : "Start your AOS"}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRecheck}
              className="inline-flex items-center gap-2 rounded-md border border-cream/20 px-4 py-3 text-[13px] text-cream/85 hover:bg-cream/5"
            >
              {isChecking ? "Checking…" : opened ? "I've signed in — check now" : "Already started? Check now"}
            </button>
          </div>

          {opened && (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
              Waiting for AOS · auto-checking every few seconds
            </p>
          )}
        </div>

        {/* Right column: what lights up after connect */}
        <div className="lg:col-span-5">
          <div className="rounded-2xl border border-cream/10 bg-cream/[0.03] p-5">
            <p className="flex items-center gap-2 label-mono !text-cream/55">
              <Sparkles className="h-3 w-3 text-gold" /> What lights up after you connect
            </p>
            <ul className="mt-4 space-y-3 text-[13px] text-cream/85">
              {[
                ["Scorecard pulse", "Live read of your weekly numbers."],
                ["Rocks tracker", "On-track vs. off-track this quarter."],
                ["Open issues", "Pulled in for the next session."],
                ["This week's to-dos", "What you committed to in your last L10."],
              ].map(([title, sub]) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                  <div>
                    <p className="font-medium text-cream">{title}</p>
                    <p className="text-cream/60">{sub}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-cream/10 pt-4 text-[11px] text-cream/55">
              Use the <span className="text-cream/80">same email</span> on AOS that you use here.
              We match by email and connect the two workspaces automatically.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
