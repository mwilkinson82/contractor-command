import { ArrowUpRight, BadgePercent, CalendarDays, TicketCheck } from "lucide-react";

const MEMBER_ENROLLMENT_URL =
  "https://alpcontractorcircle.com/cpm-intensive/member?utm_source=contractor_circle_hub&utm_medium=member_dashboard&utm_campaign=cpm_intensive_2026";
// Hide only after the class ends: Sep 26, 2026 11:59:59 PM Eastern (EDT, UTC-4).
const ENROLLMENT_CLOSE = new Date("2026-09-27T03:59:59.000Z").getTime();

export function CpmIntensiveOffer() {
  if (Date.now() >= ENROLLMENT_CLOSE) return null;

  return (
    <section
      className="relative px-4 pb-8 sm:px-6 sm:pb-10"
      aria-label="CPM Schedule Intensive alert"
    >
      <div className="mx-auto w-full max-w-[1180px] overflow-hidden rounded-xl border border-clay bg-clay text-white shadow-[0_28px_75px_-40px_color-mix(in_oklab,var(--clay)_85%,transparent)] ring-1 ring-clay/20">
        <div className="h-1 w-full bg-cream" />
        <div className="grid lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-white">
                <TicketCheck className="h-3.5 w-3.5" /> ALP Program · CPM Intensive
              </span>
              <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-white/80">
                Live working session
              </span>
            </div>

            <h2 className="mt-4 font-display text-[2.15rem] leading-none tracking-[-0.03em] sm:text-[3rem]">
              CPM Schedule Intensive (2-Day)
            </h2>
            <p className="mt-3 flex items-center gap-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-white/75 sm:text-[10px]">
              <CalendarDays className="h-3.5 w-3.5 text-white" /> September 25–26, 2026 · Live online
            </p>
            <p className="mt-5 max-w-[690px] text-[14px] leading-relaxed text-white/85 sm:text-[15px]">
              Two working days, 10 a.m.–5 p.m. Eastern. Day 1: build and update a real CPM/P6
              schedule. Day 2: delay analysis — measure it, prove it, and defend it. Contractor
              Circle members receive private discounted enrollment.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={MEMBER_ENROLLMENT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-[11px] font-semibold text-cream shadow-sm hover:bg-ink/90"
              >
                Learn more and enroll <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-white/70">
                Member rate $1,497 · seats limited
              </span>
            </div>
          </div>

          <div className="border-t border-cream/15 bg-ink px-5 py-6 text-cream sm:px-8 lg:border-l lg:border-t-0 lg:px-7 lg:py-8">
            <p className="flex items-center gap-2 font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-clay">
              <BadgePercent className="h-3.5 w-3.5" /> Contractor Circle member discount
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-cream/65">
              Private member pricing on the 2-day CPM and P6 intensive.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-cream/12 bg-cream/[.035] p-4">
                <p className="font-mono text-[7px] uppercase tracking-[0.16em] text-cream/45">
                  Circle member
                </p>
                <strong className="mt-2 block font-display text-[1.9rem] font-normal leading-none text-cream">
                  $1,497
                </strong>
              </div>
              <div className="rounded-lg border border-cream/12 bg-cream/[.035] p-4">
                <p className="font-mono text-[7px] uppercase tracking-[0.16em] text-cream/45">
                  Public
                </p>
                <strong className="mt-2 block font-display text-[1.9rem] font-normal leading-none text-cream/45 line-through">
                  $1,997
                </strong>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-cream/50">
              Includes both live days, the schedule and delay-analysis working files, and the
              recording for later reference.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
