import React from 'react';
import bulldozer from '@/assets/handbook/bulldozer-hero.png';
import Eyebrow from '@/components/editorial/Eyebrow';

type Jump = { id: string; chapter?: string; title: string; featured?: boolean };

const newInV2: Jump[] = [
  { id: 'volume-2-intro', chapter: 'Start', title: 'Why the Operating System', featured: true },
  { id: 'chapter-27', chapter: '4', title: 'A Contracting Company Cannot Run on the Owner' },
  { id: 'chapter-28', chapter: '5', title: 'Hierarchy Is Not Accountability' },
  { id: 'chapter-29', chapter: '6', title: 'The Six Components of a Contracting Operating System' },
  { id: 'chapter-30', chapter: '7', title: 'Weekly Execution Is Where the Company Is Won' },
  { id: 'chapter-31', chapter: '8', title: 'Systems Remove Personality from the Business' },
  { id: 'chapter-32', chapter: '9', title: 'Why AOS Belongs in an Application' },
];

const reorganized: Jump[] = [
  { id: 'chapter-7', chapter: '13', title: 'Operations as Margin Protection' },
  { id: 'chapter-13', chapter: '16', title: 'Notices & Playing Offense' },
  { id: 'chapter-14', chapter: '17', title: 'Scheduling, Start–Stop Work, and the Cost of Disorder' },
  { id: 'chapter-8', chapter: '18', title: 'General Conditions: From Invisible Cost to Profit Center' },
  { id: 'chapter-16', chapter: '20', title: 'Financial Command and Financial Authority' },
  { id: 'chapter-9', chapter: '21', title: 'The ALP Decision Matrix' },
];

const updated: Jump[] = [
  { id: 'foreword', title: 'Foreword / Author\u2019s Note' },
  { id: 'how-to-use', title: 'How to Use This Handbook' },
];

const scrollTo = (id: string) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
};

const JumpButton: React.FC<{ item: Jump }> = ({ item }) => (
  <button
    onClick={() => scrollTo(item.id)}
    className="group text-left w-full p-4 border border-[hsl(var(--hb-border))] hover:border-[hsl(var(--hb-brand-accent))] bg-transparent hover:bg-[hsl(var(--hb-accent))] transition-colors rounded-sm"
  >
    <div className="flex items-baseline gap-3">
      {item.chapter && (
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-50 shrink-0 w-6">
          {item.chapter}
        </span>
      )}
      <span className="font-serif text-base md:text-lg leading-snug group-hover:text-[hsl(var(--hb-brand-accent))] transition-colors">
        {item.title}
      </span>
    </div>
  </button>
);

const HeroSection: React.FC = () => {
  return (
    <div className="pt-4 pb-20">
      {/* === Print-ad hero: bulldozer + tagline (DDB/Ogilvy meets minimalist tech) === */}
      <section className="relative">
        {/* Bulldozer — large, right-aligned, lots of air */}
        <div className="pt-4">
          <img
            src={bulldozer}
            alt="ALP Handbook"
            className="block ml-auto h-auto w-full max-w-[560px] md:max-w-[640px] lg:max-w-[720px] select-none pointer-events-none"
            style={{ mixBlendMode: 'multiply' }}
          />
        </div>

        {/* Headline — sits below, full-bleed serif */}
        <h1
          className="mt-10 md:mt-12 font-serif leading-[0.95]"
          style={{
            fontWeight: 400,
            letterSpacing: '-0.03em',
            fontSize: 'clamp(2.75rem, 7.5vw, 5.75rem)',
          }}
        >
          Build the company<br />
          behind the projects.
        </h1>

        {/* Three-column editorial body — Ogilvy long-copy feel, tight */}
        <div className="mt-14 grid md:grid-cols-3 gap-x-10 gap-y-8">
          <div className="md:pr-8 md:border-r md:border-[hsl(var(--hb-border))]">
            <p className="font-serif text-lg leading-snug mb-3" style={{ fontWeight: 500 }}>
              You didn't start this company to run jobs forever.
            </p>
            <p className="text-sm leading-relaxed opacity-75">
              The work will always be there. The question is whether your company will.
            </p>
          </div>
          <div className="md:pr-8 md:border-r md:border-[hsl(var(--hb-border))]">
            <p className="font-serif text-lg leading-snug mb-3" style={{ fontWeight: 500 }}>
              Great operators build systems, not schedules.
            </p>
            <p className="text-sm leading-relaxed opacity-75">
              Clarity, accountability, and structure create companies that outlast the founders.
            </p>
          </div>
          <div>
            <p className="font-serif text-lg leading-snug mb-3" style={{ fontWeight: 500 }}>
              The project is temporary. The company is the real asset.
            </p>
            <p className="text-sm leading-relaxed opacity-75">
              Build it intentionally. Lead it confidently. Scale it sustainably.
            </p>
          </div>
        </div>

        {/* Footer rule */}
        <div className="mt-14 pt-5 border-t border-[hsl(var(--hb-border))] flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] opacity-50">
            The ALP Handbook
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] opacity-50">
            Second Edition · AOS
          </span>
        </div>
      </section>

      {/* === Quick-read updates === */}
      <section className="mt-28">
        <div className="flex items-baseline justify-between gap-6 flex-wrap mb-2">
          <Eyebrow accent>New in V2 — The Operating System</Eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-50">
            Part II · 7 entries
          </span>
        </div>
        <p className="body-text max-w-2xl opacity-75 mb-8">
          Volume 2 introduces <strong>AOS</strong> — the operating system a contracting company runs on once it outgrows the owner. Jump straight to what's new.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {newInV2.map((item) => <JumpButton key={item.id} item={item} />)}
        </div>
      </section>

      <section className="mt-16">
        <div className="flex items-baseline justify-between gap-6 flex-wrap mb-6">
          <Eyebrow>Reorganized in V2</Eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-50">
            Merged & re-sequenced
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {reorganized.map((item) => <JumpButton key={item.id} item={item} />)}
        </div>
      </section>

      <section className="mt-16">
        <Eyebrow className="mb-6">Updated front matter</Eyebrow>
        <div className="grid sm:grid-cols-2 gap-3">
          {updated.map((item) => <JumpButton key={item.id} item={item} />)}
        </div>
      </section>

      <div className="mt-20 flex justify-center animate-bounce opacity-30">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
};

export default HeroSection;
