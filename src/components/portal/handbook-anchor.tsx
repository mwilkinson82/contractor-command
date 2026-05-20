import { Link } from "@tanstack/react-router";
import { ArrowUpRight, BookOpen, Headphones, ListOrdered, Infinity as InfinityIcon } from "lucide-react";
import deviceMockup from "@/assets/handbook/handbook-device-mockup.png";

/**
 * HandbookAnchor — full-bleed editorial section that anchors the home page.
 * DDB/Ogilvy print-ad lens × minimal tech. Lives below Command tools as the
 * "reflect" counterweight to the "operate" stack above.
 */
export function HandbookAnchor() {
  return (
    <section className="relative border-t border-border bg-[hsl(var(--hb-paper,40_24%_96%))]">
      <div className="mx-auto grid w-full max-w-[1180px] gap-10 px-6 py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:py-24">
        {/* LEFT — device + bulldozer artwork */}
        <div className="relative flex items-center justify-center lg:justify-start">
          <img
            src={deviceMockup}
            alt="The ALP Handbook — open on a tablet beside a bulldozer"
            className="w-full max-w-[620px] select-none"
            draggable={false}
          />
        </div>

        {/* RIGHT — editorial copy */}
        <div className="flex flex-col justify-center">
          <p className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-foreground/55">
            <span className="h-px w-8 bg-foreground/40" />
            The ALP Handbook
          </p>

          <h2 className="mt-5 font-serif text-[clamp(2.4rem,4.6vw,3.75rem)] font-normal leading-[1.04] tracking-[-0.01em] text-foreground">
            A field manual<br />
            for building<br />
            the company<br />
            behind the projects.
          </h2>

          <div className="mt-7 h-px w-16 bg-foreground/30" />

          <p className="mt-6 max-w-[44ch] text-[14.5px] leading-[1.7] text-foreground/70">
            Doctrine, not theory. Read the chapters, follow the operating system,
            and listen to selected audio sections while you work. V2 adds the AOS
            edition — the operating layer behind every tool in this app.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/handbook"
              className="group inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3.5 text-[12.5px] font-medium uppercase tracking-[0.14em] text-cream transition-opacity hover:opacity-90"
            >
              Open the Handbook
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/handbook"
              hash="volume-2-intro"
              className="inline-flex items-center gap-2 rounded-full border border-foreground/25 px-6 py-3.5 text-[12.5px] font-medium uppercase tracking-[0.14em] text-foreground/80 hover:bg-foreground/5"
            >
              Start with Why the OS
            </Link>
          </div>

          {/* Feature row */}
          <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-7 border-t border-foreground/15 pt-8 sm:grid-cols-4">
            <Feature
              icon={<BookOpen className="h-4 w-4" />}
              label="Field manual format"
              desc="Built to use during real decisions."
            />
            <Feature
              icon={<ListOrdered className="h-4 w-4" />}
              label="AOS edition"
              desc="Includes the operating-system section."
            />
            <Feature
              icon={<Headphones className="h-4 w-4" />}
              label="Audio chapters"
              desc="Listen while you work."
            />
            <Feature
              icon={<InfinityIcon className="h-4 w-4" />}
              label="Lifetime access"
              desc="One payment. Keep the system."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Feature({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-foreground/70">{icon}</span>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/80 leading-[1.4]">
        {label}
      </p>
      <p className="text-[12px] leading-[1.55] text-foreground/55">{desc}</p>
    </div>
  );
}
