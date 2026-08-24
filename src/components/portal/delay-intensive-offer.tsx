import { ArrowUpRight, CalendarDays, TicketCheck } from "lucide-react";

const MEMBER_ENROLLMENT_URL =
  "https://alpcontractorcircle.com/delay-intensive/member?utm_source=contractor_circle_hub&utm_medium=member_dashboard&utm_campaign=delay_intensive_2026";
const EARLY_DEADLINE = new Date("2026-08-31T03:59:59.000Z").getTime();
const ENROLLMENT_CLOSE = new Date("2026-09-03T16:00:00.000Z").getTime();

export function DelayIntensiveOffer() {
  const now = Date.now();
  if (now >= ENROLLMENT_CLOSE) return null;
  const early = now <= EARLY_DEADLINE;

  return (
    <section className="relative px-4 pb-8 sm:px-6 sm:pb-10">
      <div className="mx-auto w-full max-w-[1180px] overflow-hidden rounded-xl border border-ink/15 bg-ink text-cream shadow-[0_24px_70px_-48px_color-mix(in_oklab,var(--ink)_70%,transparent)]">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-clay">
                <TicketCheck className="h-3.5 w-3.5" /> Contractor Circle private rate
              </span>
              <span className="rounded-full border border-cream/15 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-cream/60">
                10 companies
              </span>
            </div>
            <h2 className="mt-5 max-w-[760px] font-display text-[2.25rem] leading-[.98] tracking-[-0.035em] sm:text-[3.35rem]">
              Stop carrying a six-figure claim in your head.
            </h2>
            <p className="mt-5 max-w-[680px] text-[14px] leading-relaxed text-cream/70 sm:text-[15px]">
              Marshall’s live Delay &amp; Damages Intensive runs September 4–6. Build the notice,
              schedule proof, damages model, and claim package in one working weekend—with a private
              rate reserved for current Contractor Circle members.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={MEMBER_ENROLLMENT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-clay px-5 text-[11px] font-semibold text-white hover:bg-clay/90"
              >
                Open member enrollment <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-cream/50">
                {early
                  ? "Early member rate ends August 30"
                  : "Member enrollment closes September 3"}
              </span>
            </div>
          </div>

          <div className="grid border-t border-cream/15 bg-cream/[.035] sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-t-0">
            <div className="border-b border-cream/15 px-5 py-5 sm:border-b-0 sm:border-r lg:border-b lg:border-r-0 lg:px-7 lg:py-6">
              <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-cream/45">
                {early ? "Member lock-in · through Aug 30" : "Contractor Circle member rate"}
              </p>
              <div className="mt-3 flex items-baseline gap-3">
                <strong className="font-display text-[2rem] font-normal text-cream">
                  {early ? "$2,000" : "$2,800"}
                </strong>
                <span className="text-[11px] text-cream/55">individual</span>
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <strong className="font-display text-[2rem] font-normal text-cream">
                  {early ? "$2,800" : "$4,000"}
                </strong>
                <span className="text-[11px] text-cream/55">company · 2 seats</span>
              </div>
            </div>
            <div className="px-5 py-5 lg:px-7 lg:py-6">
              <p className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.18em] text-cream/45">
                <CalendarDays className="h-3.5 w-3.5 text-clay" /> September 4–6 · Live via Zoom
              </p>
              <p className="mt-3 text-[12px] leading-relaxed text-cream/65">
                Purchase includes a private e-ticket, attendee portal, secure live-claim intake,
                reminders, and controlled material release before class.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
