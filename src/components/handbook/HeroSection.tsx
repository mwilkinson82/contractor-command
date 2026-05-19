import React from 'react';
import bookCoverV2 from '@/assets/handbook/book-cover-v2.png';
import bulldozer from '@/assets/handbook/hero-bulldozer.png';
import ExpandableImage from './ExpandableImage';
import Eyebrow from '@/components/editorial/Eyebrow';

type Jump = {
  id: string;
  chapter?: string;
  title: string;
};

const newInV2: Jump[] = [
  { id: 'volume-2-intro', title: 'Why the Operating System' },
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
    className="group text-left w-full p-4 border border-[hsl(var(--hb-border))] hover:border-[hsl(var(--hb-brand-accent))] bg-[hsl(var(--hb-bg))] hover:bg-[hsl(var(--hb-accent))] transition-colors rounded-sm"
  >
    <div className="flex items-baseline gap-3">
      {item.chapter && (
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-50 shrink-0">
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
      {/* Editorial hero — bulldozer + tagline */}
      <div className="relative">
        <img
          src={bulldozer}
          alt=""
          aria-hidden="true"
          className="w-full max-w-[640px] ml-auto block h-auto select-none pointer-events-none"
          style={{ mixBlendMode: 'multiply' }}
        />

        <div className="mt-8 md:-mt-12 grid md:grid-cols-[200px_1fr] gap-8 md:gap-12 items-end">
          <div className="space-y-2">
            <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.32em] opacity-70">
              ALP · Contractor Circle
            </div>
            <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.32em] opacity-70">
              Members Only
            </div>
          </div>

          <h1
            className="font-serif text-5xl md:text-6xl lg:text-7xl leading-[0.95]"
            style={{ fontWeight: 400, letterSpacing: '-0.025em' }}
          >
            Build the company<br />behind the projects.
          </h1>
        </div>

        {/* Three-column editorial blurb */}
        <div className="mt-14 grid md:grid-cols-3 gap-8 md:gap-10 md:pl-[212px]">
          <div className="md:pr-8 md:border-r md:border-[hsl(var(--hb-border))]">
            <p className="font-serif text-base leading-snug mb-3" style={{ fontWeight: 500 }}>
              You didn't start this company to run jobs forever.
            </p>
            <p className="text-sm leading-relaxed opacity-75">
              The work will always be there. The question is whether your company will.
            </p>
          </div>
          <div className="md:pr-8 md:border-r md:border-[hsl(var(--hb-border))]">
            <p className="font-serif text-base leading-snug mb-3" style={{ fontWeight: 500 }}>
              Great operators build systems, not schedules.
            </p>
            <p className="text-sm leading-relaxed opacity-75">
              Clarity, accountability, and structure create companies that outlast the founders.
            </p>
          </div>
          <div>
            <p className="font-serif text-base leading-snug mb-3" style={{ fontWeight: 500 }}>
              The project is temporary. The company is the real asset.
            </p>
            <p className="text-sm leading-relaxed opacity-75">
              We exist to help you build it intentionally, lead it confidently, and scale it sustainably.
            </p>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-[hsl(var(--hb-border))] flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] opacity-50">
            alpcc.com
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] opacity-50">
            Second Edition · AOS
          </span>
        </div>
      </div>

      {/* What's new in V2 */}
      <div className="mt-28">
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
          {newInV2.map((item) => (
            <JumpButton key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* Reorganized */}
      <div className="mt-16">
        <div className="flex items-baseline justify-between gap-6 flex-wrap mb-6">
          <Eyebrow>Reorganized in V2</Eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-50">
            Merged & re-sequenced
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {reorganized.map((item) => (
            <JumpButton key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* Updated front matter */}
      <div className="mt-16">
        <Eyebrow className="mb-6">Updated front matter</Eyebrow>
        <div className="grid sm:grid-cols-2 gap-3">
          {updated.map((item) => (
            <JumpButton key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* The cover — Second Edition */}
      <div className="mt-24 pt-16 border-t border-[hsl(var(--hb-chapter-divider))] grid md:grid-cols-[260px_1fr] gap-12 items-center">
        <ExpandableImage
          src={bookCoverV2}
          alt="The ALP Handbook, Second Edition — by Marshall Wilkinson"
          className="w-full max-w-[260px] mx-auto md:mx-0 h-auto shadow-2xl rounded-sm"
        />
        <div>
          <Eyebrow accent className="mb-4">Second Edition · AOS</Eyebrow>
          <h2 className="font-serif text-3xl md:text-4xl leading-tight mb-4" style={{ fontWeight: 400, letterSpacing: '-0.02em' }}>
            The field manual, fully revised.
          </h2>
          <p className="body-text opacity-80 max-w-xl">
            Operating doctrine for Vision, People, Data, Issues, Process, and Traction — the company behind the projects, laid out in one book.
          </p>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="mt-16 flex justify-center animate-bounce opacity-30">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
};

export default HeroSection;
