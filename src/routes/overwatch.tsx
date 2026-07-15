import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BadgeDollarSign,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ShieldCheck,
} from "lucide-react";
import { useTier } from "@/hooks/use-tier";
import { startHereExperience } from "@/lib/start-here-access";

export const Route = createFileRoute("/overwatch")({
  head: () => ({
    meta: [
      { title: "OverWatch - IOR Project Control" },
      {
        name: "description",
        content:
          "Open OverWatch Free or included Contractor Circle access for schedule, risk, billing, and indicated gross profit.",
      },
    ],
  }),
  component: OverwatchGateway,
});

const OVERWATCH_LOGIN_URL = "https://overwatch.alpcontractorcircle.com/auth";

const signals = [
  { label: "GP at risk", value: "$231,750", tone: "text-signal" },
  { label: "E-Hold", value: "$62,500", tone: "text-crit" },
  { label: "C-Hold", value: "$65,000", tone: "text-good" },
  { label: "Schedule", value: "+8 wk", tone: "text-ink" },
];

const flow = [
  {
    icon: CalendarClock,
    title: "Schedule first",
    body: "Confirm completion date, critical path movement, and delayed decisions before pricing the exposure.",
  },
  {
    icon: BadgeDollarSign,
    title: "Price the exposure",
    body: "Separate E-Holds from C-Holds, assign likely dollars, treatment path, owner, and action plan.",
  },
  {
    icon: ClipboardList,
    title: "Leave with decisions",
    body: "Convert risks into To-Dos, IOR reports, and billing posture for project meetings.",
  },
];

const ledgerRows = [
  ["Forecasted Final Contract", "$3.53M"],
  ["Forecasted Final Cost", "$3.18M"],
  ["GP before holds", "$350K"],
  ["Risk allocated", "$127K"],
  ["Indicated GP", "$223K"],
];

function OverwatchGateway() {
  const { tier } = useTier();
  const isCircleExperience = startHereExperience(tier) === "circle";

  return (
    <main className="-m-4 min-h-[calc(100svh-4rem)] overflow-x-hidden bg-cream text-ink sm:-m-6 md:-m-8">
      <section className="mx-auto w-full max-w-[1500px] px-5 py-6 sm:px-8 sm:py-8">
        <div className="overflow-hidden border border-paper-edge bg-card">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,0.58fr)_minmax(25rem,0.42fr)]">
            <div className="px-6 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-14 xl:px-16">
              <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.34em] text-clay">
                <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-clay align-middle" />
                {isCircleExperience
                  ? "OverWatch / Indicated Outcome Reports"
                  : "OverWatch Free / Indicated Outcome Reports"}
              </p>
              <h1 className="mt-8 max-w-3xl font-display text-[clamp(3.25rem,8vw,6.4rem)] font-normal leading-[0.92] tracking-[-0.02em]">
                Run the job through the money.
              </h1>
              <p className="mt-7 max-w-2xl text-[15px] leading-relaxed text-foreground/75 sm:text-[16px]">
                Overwatch is the project operating record for IOR. It pulls the schedule of values,
                schedule movement, risk holds, billing posture, and indicated gross profit into one
                place so the meeting starts with what the job is actually telling you.
              </p>

              <p className="mt-5 max-w-2xl border-l-2 border-clay pl-4 text-[13px] leading-relaxed text-foreground/70">
                {isCircleExperience
                  ? "Contractor Circle and Hardcore members receive OverWatch Pro access with membership."
                  : "Handbook buyers can use OverWatch Free on one real project, with two internal seats, before deciding whether to upgrade."}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={OVERWATCH_LOGIN_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-3 bg-ink px-8 text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-cream transition-colors hover:bg-ink-panel"
                >
                  {isCircleExperience ? "Open OverWatch" : "Open OverWatch Free"}
                  <ArrowUpRight className="h-4 w-4" />
                </a>
                <p className="flex max-w-sm items-center text-[12px] leading-relaxed text-muted-foreground">
                  Use the same email you use for the Hub. OverWatch will send a secure magic link.
                </p>
              </div>
            </div>

            <div className="border-t border-paper-edge bg-paper-deep/55 p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.28em] text-good">
                    Live IOR reading
                  </p>
                  <h2 className="mt-3 font-display text-[2.15rem] leading-none">Margin at risk</h2>
                </div>
                <span className="inline-flex h-11 w-11 items-center justify-center border border-ink/15 bg-card">
                  <ShieldCheck className="h-5 w-5 text-ink" />
                </span>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3">
                {signals.map((signal) => (
                  <div key={signal.label} className="border border-paper-edge bg-card px-4 py-3">
                    <p className="text-[9px] font-mono font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      {signal.label}
                    </p>
                    <p className={`mt-2 font-display text-[1.65rem] leading-none ${signal.tone}`}>
                      {signal.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 border border-paper-edge bg-card">
                <div className="grid grid-cols-[1fr_5.5rem] border-b border-paper-edge bg-cream/60 px-4 py-3 text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  <span>Financial path</span>
                  <span className="text-right">Value</span>
                </div>
                {ledgerRows.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[1fr_5.5rem] border-b border-paper-edge px-4 py-3 text-[13px] last:border-b-0"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-right font-semibold text-ink">{value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 border border-clay/30 bg-clay/[0.07] px-4 py-3">
                <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-clay">
                  Meeting question
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-foreground/75">
                  What has to happen this week to release dollars back into gross profit?
                </p>
              </div>
            </div>
          </div>

          <div className="grid border-t border-paper-edge md:grid-cols-3">
            {flow.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="border-b border-paper-edge px-6 py-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 lg:px-8"
                >
                  <div className="flex items-start gap-4">
                    <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center border border-clay/25 bg-clay/[0.07] text-clay">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-display text-[1.55rem] leading-none">{item.title}</h3>
                      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[0.64fr_0.36fr]">
          <div className="border border-paper-edge bg-card px-6 py-6 sm:px-8">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.28em] text-clay">
              Start here
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["1", isCircleExperience ? "Open OverWatch" : "Open OverWatch Free"],
                ["2", "Confirm the magic link"],
                ["3", "Create a project and load the SOV"],
              ].map(([step, label]) => (
                <div
                  key={step}
                  className="flex items-center gap-3 border border-paper-edge bg-cream/65 px-4 py-3"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/15 text-[11px] font-semibold">
                    {step}
                  </span>
                  <span className="text-[13px] font-medium text-foreground/80">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-paper-edge bg-card px-6 py-6 sm:px-8">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-good" />
              <p className="text-[13px] leading-relaxed text-foreground/75">
                OverWatch is separate from the Hub. The Hub explains your access and sends you to
                OverWatch for the project records, reports, and secure login.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
