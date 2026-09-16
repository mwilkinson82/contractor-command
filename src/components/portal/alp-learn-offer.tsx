import { ArrowUpRight, GraduationCap, Library, PlayCircle } from "lucide-react";

const LEARN_URL = "https://learn.alpcontractorcircle.com";

export function AlpLearnOffer() {
  return (
    <section className="relative px-4 pb-8 sm:px-6 sm:pb-10" aria-label="ALP Learn access">
      <div className="mx-auto w-full max-w-[1180px] overflow-hidden rounded-xl border border-clay bg-clay text-white shadow-[0_28px_75px_-40px_color-mix(in_oklab,var(--clay)_85%,transparent)] ring-1 ring-clay/20">
        <div className="h-1 w-full bg-cream" />
        <div className="grid lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-white">
                <GraduationCap className="h-3.5 w-3.5" /> ALP Learn · Course Library
              </span>
              <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-white/80">
                Member access
              </span>
            </div>

            <h2 className="mt-4 font-display text-[2.15rem] leading-none tracking-[-0.03em] sm:text-[3rem]">
              ALP Learn
            </h2>
            <p className="mt-3 flex items-center gap-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-white/75 sm:text-[10px]">
              <Library className="h-3.5 w-3.5 text-white" /> learn.alpcontractorcircle.com
            </p>
            <p className="mt-5 max-w-[690px] text-[14px] leading-relaxed text-white/85 sm:text-[15px]">
              The ALP course library — structured lessons and course material you can work through at
              your own pace, on top of the live Contractor Circle sessions.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={LEARN_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-[11px] font-semibold text-cream shadow-sm hover:bg-ink/90"
              >
                Open ALP Learn <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-white/70">
                Sign in with your member login
              </span>
            </div>
          </div>

          <div className="border-t border-cream/15 bg-ink px-5 py-6 text-cream sm:px-8 lg:border-l lg:border-t-0 lg:px-7 lg:py-8">
            <p className="flex items-center gap-2 font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-clay">
              <PlayCircle className="h-3.5 w-3.5" /> What is inside
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-cream/65">
              Your Learn account holds the course material tied to your membership.
            </p>
            <ul className="mt-5 space-y-2 text-[12px] leading-relaxed text-cream/75">
              <li className="rounded-lg border border-cream/12 bg-cream/[.035] p-3">
                Structured courses and lessons
              </li>
              <li className="rounded-lg border border-cream/12 bg-cream/[.035] p-3">
                Course workbooks and working files
              </li>
              <li className="rounded-lg border border-cream/12 bg-cream/[.035] p-3">
                Progress you can return to any time
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
