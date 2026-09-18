import { ArrowUpRight, GraduationCap } from "lucide-react";

export const ALP_LEARN_URL = "https://learn.alpcontractorcircle.com";

export function AlpLearnOffer() {
  return (
    <section className="relative px-4 sm:px-6 pb-10" aria-label="ALP Learn">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="rounded-2xl border border-border bg-card p-6 md:p-7">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-3.5 w-3.5 text-clay" />
            <p className="label-mono">Featured · ALP Learn</p>
          </div>
          <div className="mt-3 max-w-2xl">
            <h2 className="font-display text-2xl leading-tight md:text-[26px]">
              IOR and AOS live in ALP Learn.
            </h2>
            <p className="mt-2 text-[13.5px] text-muted-foreground">
              Open the library for IOR and AOS reference and education. Keep Replays for working
              sessions — not for hunting the curriculum.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={ALP_LEARN_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-cream hover:opacity-90"
              >
                Open ALP Learn <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
