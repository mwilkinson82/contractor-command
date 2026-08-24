import { ArrowUpRight, BadgePercent, CalendarDays, TicketCheck } from "lucide-react";

const MEMBER_ENROLLMENT_URL =
  "https://alpcontractorcircle.com/delay-intensive/member?utm_source=contractor_circle_hub&utm_medium=member_dashboard&utm_campaign=delay_intensive_2026";
const EARLY_DEADLINE = new Date("2026-08-31T03:59:59.000Z").getTime();
const ENROLLMENT_CLOSE = new Date("2026-09-03T16:00:00.000Z").getTime();

export function DelayIntensiveOffer() {
  const now = Date.now();
  if (now >= ENROLLMENT_CLOSE) return null;
  const early = now <= EARLY_DEADLINE;

  return (
    <section
      className="relative px-4 pb-8 sm:px-6 sm:pb-10"
      aria-label="ALP Program Intensive alert"
    >
      <div className="mx-auto w-full max-w-[1180px] overflow-hidden rounded-xl border border-clay/35 bg-ink text-cream shadow-[0_24px_70px_-48px_color-mix(in_oklab,var(--ink)_70%,transparent)]">
        <div className="h-1 w-full bg-clay" />
        <div className="grid lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-clay">
                <TicketCheck className="h-3.5 w-3.5" /> ALP Program · Intensive Alert
              </span>
              <span className="rounded-full border border-cream/15 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-cream/60">
                Limited to 10 companies
              </span>
            </div>

            <h2 className="mt-4 font-display text-[2.15rem] leading-none tracking-[-0.03em] sm:text-[3rem]">
              Delay &amp; Damages Intensive
            </h2>
            <p className="mt-3 flex items-center gap-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-cream/60 sm:text-[10px]">
              <CalendarDays className="h-3.5 w-3.5 text-clay" /> September 4–6, 2026 · Live via Zoom
            </p>
            <p className="mt-5 max-w-[690px] text-[14px] leading-relaxed text-cream/72 sm:text-[15px]">
              Build the notice, schedule proof, damages model, and claim package in one working
              weekend. Contractor Circle members receive private discounted enrollment.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={MEMBER_ENROLLMENT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-clay px-5 text-[11px] font-semibold text-white hover:bg-clay/90"
              >
                Learn more and enroll <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-cream/50">
                {early
                  ? "Member lock-in pricing ends August 30"
                  : "Member enrollment closes September 3"}
              </span>
            </div>
          </div>

          <div className="border-t border-cream/15 bg-cream/[.045] px-5 py-6 sm:px-8 lg:border-l lg:border-t-0 lg:px-7 lg:py-8">
            <p className="flex items-center gap-2 font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-clay">
              <BadgePercent className="h-3.5 w-3.5" /> Contractor Circle member discount
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-cream/65">
              {early
                ? "Lock in the early member rate through August 30."
                : "Private member pricing remains available until enrollment closes."}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-cream/12 bg-cream/[.035] p-4">
                <p className="font-mono text-[7px] uppercase tracking-[0.16em] text-cream/45">
                  Individual
                </p>
                <strong className="mt-2 block font-display text-[1.9rem] font-normal leading-none text-cream">
                  {early ? "$2,000" : "$2,800"}
                </strong>
              </div>
              <div className="rounded-lg border border-cream/12 bg-cream/[.035] p-4">
                <p className="font-mono text-[7px] uppercase tracking-[0.16em] text-cream/45">
                  Company · 2 seats
                </p>
                <strong className="mt-2 block font-display text-[1.9rem] font-normal leading-none text-cream">
                  {early ? "$2,800" : "$4,000"}
                </strong>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-cream/50">
              Includes the attendee portal, e-ticket, agenda, live-claim intake, reminders, and
              controlled material release.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
