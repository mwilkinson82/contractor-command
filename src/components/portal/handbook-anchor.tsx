import { Link } from "@tanstack/react-router";
import { ArrowUpRight, BookOpen, Headphones, ListOrdered, Infinity as InfinityIcon, Play, Link2 } from "lucide-react";
import bookCover from "@/assets/handbook/book-cover-v2.png";

/**
 * HandbookAnchor — full-bleed editorial section that anchors the home page.
 * Recreates the print-ad mockup: a tablet device on the left showing the
 * handbook contents + cover, with a bulldozer breaking the frame, paired with
 * a serif editorial column on the right.
 */
export function HandbookAnchor() {
  return (
    <section className="relative border-t border-border bg-[hsl(40_24%_96%)]">
      <div className="mx-auto grid w-full max-w-[1180px] gap-12 px-6 py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:py-24">
        {/* LEFT — recreated tablet mockup */}
        <DeviceMockup />

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
            <Feature icon={<BookOpen className="h-4 w-4" />} label="Field manual format" desc="Built to use during real decisions." />
            <Feature icon={<ListOrdered className="h-4 w-4" />} label="AOS edition" desc="Includes the operating-system section." />
            <Feature icon={<Headphones className="h-4 w-4" />} label="Audio chapters" desc="Listen while you work." />
            <Feature icon={<InfinityIcon className="h-4 w-4" />} label="Lifetime access" desc="One payment. Keep the system." />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Device mockup ----------------------------- */

function DeviceMockup() {
  const chapters = [
    { num: "01", title: "The Company\nBehind the Projects", active: true },
    { num: "02", title: "The Operating System" },
    { num: "03", title: "Vision" },
    { num: "04", title: "People" },
    { num: "05", title: "Data" },
    { num: "06", title: "Issues" },
    { num: "07", title: "Process" },
    { num: "08", title: "Traction" },
  ];

  return (
    <div className="relative flex items-center justify-center lg:justify-start">
      {/* Tablet body */}
      <div className="relative aspect-[4/3] w-full max-w-[620px] rounded-[28px] border border-foreground/10 bg-white p-3 shadow-[0_30px_60px_-30px_rgba(20,20,18,0.35),0_2px_0_rgba(255,255,255,0.7)_inset]">
        {/* Camera dot */}
        <span className="absolute left-1/2 top-2 h-1 w-1 -translate-x-1/2 rounded-full bg-foreground/15" />

        {/* Screen */}
        <div className="relative grid h-full min-h-0 grid-cols-[34%_1fr] overflow-hidden rounded-[18px] bg-[hsl(40_22%_95%)]">
          {/* Contents sidebar */}
          <aside className="flex min-h-0 flex-col gap-3 overflow-hidden border-r border-foreground/10 p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-foreground/60">Contents</p>
              <span className="flex flex-col gap-[2px]">
                <span className="h-[1px] w-3 bg-foreground/40" />
                <span className="h-[1px] w-3 bg-foreground/40" />
                <span className="h-[1px] w-3 bg-foreground/40" />
              </span>
            </div>

            <div className="mt-1">
              <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-foreground/50">Welcome</p>
              <p className="mt-0.5 text-[9px] text-foreground/55">Start here</p>
            </div>

            <ul className="flex flex-col gap-2.5">
              {chapters.map((c) => (
                <li key={c.num} className="relative flex flex-col">
                  <span className="font-mono text-[8px] tracking-[0.18em] text-foreground/45">{c.num}</span>
                  <span
                    className={`whitespace-pre-line text-[9px] leading-[1.25] ${
                      c.active ? "text-foreground font-medium" : "text-foreground/60"
                    }`}
                  >
                    {c.title}
                  </span>
                  {c.active && (
                    <span className="absolute -right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-accent" />
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-auto">
              <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-foreground/50">Resources</p>
              <p className="mt-0.5 text-[9px] text-foreground/55">Tools & Downloads</p>
              <div className="mt-3 flex items-center gap-1.5 rounded-md border border-foreground/15 bg-white/60 px-2 py-1.5">
                <Link2 className="h-2.5 w-2.5 text-foreground/55" />
                <div className="flex flex-col leading-tight">
                  <span className="font-mono text-[7px] uppercase tracking-[0.18em] text-foreground/75">Magic Link Access</span>
                  <span className="text-[7px] text-foreground/50">Secure. Private. Yours.</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Cover pane */}
          <div className="relative grid h-full min-h-0 grid-rows-[34px_minmax(0,1fr)_96px] overflow-hidden">
            <div className="border-b border-foreground/10 px-5 pt-3 pb-2">
              <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-foreground/55">ALP Contractor Circle</p>
            </div>

            <div className="relative min-h-0 overflow-hidden p-4">
              <img
                src={bookCover}
                alt=""
                className="absolute inset-0 h-full w-full object-contain p-2"
                draggable={false}
              />
            </div>

            {/* Audio player */}
            <div className="min-h-0 overflow-hidden border-t border-foreground/10 bg-white/70 px-4 py-2.5">
              <p className="font-mono text-[7px] uppercase tracking-[0.22em] text-foreground/55">Audio chapter available</p>
              <div className="mt-1.5 flex items-center gap-2.5">
                <button className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-foreground/20 bg-white text-foreground/80">
                  <Play className="h-3 w-3 fill-current" />
                </button>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[8px] text-foreground/55">01</span>
                    <span className="text-[9px] font-medium text-foreground">The Company Behind the Projects</span>
                  </div>
                  {/* Waveform */}
                  <div className="mt-1 flex h-3 items-center gap-[1.5px]">
                    {Array.from({ length: 56 }).map((_, i) => {
                      const seed = Math.sin(i * 1.7) * 0.5 + 0.5;
                      const h = 20 + seed * 80;
                      const played = i < 14;
                      return (
                        <span
                          key={i}
                          style={{ height: `${h}%` }}
                          className={played ? "w-[1.5px] bg-brand-accent" : "w-[1.5px] bg-foreground/25"}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-0.5 flex justify-between font-mono text-[7px] text-foreground/45">
                    <span>00:00</span>
                    <span>18:42</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function Feature({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-foreground/70">{icon}</span>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/80 leading-[1.4]">{label}</p>
      <p className="text-[12px] leading-[1.55] text-foreground/55">{desc}</p>
    </div>
  );
}
