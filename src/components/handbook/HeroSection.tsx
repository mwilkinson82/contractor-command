import React from 'react';
import bookCoverV2 from '@/assets/handbook/book-cover-v2.jpg';
import ExpandableImage from './ExpandableImage';
import Eyebrow from '@/components/editorial/Eyebrow';

type Jump = {
  id: string;
  chapter?: string;
  title: string;
  badge: 'New in V2' | 'Reorganized' | 'Updated';
};

const newInV2: Jump[] = [
  { id: 'volume-2-intro', title: 'Why the Operating System', badge: 'New in V2' },
  { id: 'chapter-27', chapter: '4', title: 'A Contracting Company Cannot Run on the Owner', badge: 'New in V2' },
  { id: 'chapter-28', chapter: '5', title: 'Hierarchy Is Not Accountability', badge: 'New in V2' },
  { id: 'chapter-29', chapter: '6', title: 'The Six Components of a Contracting Operating System', badge: 'New in V2' },
  { id: 'chapter-30', chapter: '7', title: 'Weekly Execution Is Where the Company Is Won', badge: 'New in V2' },
  { id: 'chapter-31', chapter: '8', title: 'Systems Remove Personality from the Business', badge: 'New in V2' },
  { id: 'chapter-32', chapter: '9', title: 'Why AOS Belongs in an Application', badge: 'New in V2' },
];

const reorganized: Jump[] = [
  { id: 'chapter-7', chapter: '13', title: 'Operations as Margin Protection', badge: 'Reorganized' },
  { id: 'chapter-13', chapter: '16', title: 'Notices & Playing Offense', badge: 'Reorganized' },
  { id: 'chapter-14', chapter: '17', title: 'Scheduling, Start–Stop Work, and the Cost of Disorder', badge: 'Reorganized' },
  { id: 'chapter-8', chapter: '18', title: 'General Conditions: From Invisible Cost to Profit Center', badge: 'Reorganized' },
  { id: 'chapter-16', chapter: '20', title: 'Financial Command and Financial Authority', badge: 'Reorganized' },
  { id: 'chapter-9', chapter: '21', title: 'The ALP Decision Matrix', badge: 'Reorganized' },
];

const updated: Jump[] = [
  { id: 'foreword', title: 'Foreword / Author\u2019s Note', badge: 'Updated' },
  { id: 'how-to-use', title: 'How to Use This Handbook', badge: 'Updated' },
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
    <div className="pt-8 pb-20">
      {/* Hero: cover + intro */}
      <div className="grid md:grid-cols-[minmax(0,260px)_1fr] gap-12 md:gap-16 items-center">
        <ExpandableImage
          src={bookCoverV2}
          alt="The ALP Handbook, Volume 2 — by Marshall Wilkinson"
          className="w-full max-w-[260px] mx-auto md:mx-0 h-auto shadow-2xl rounded-sm"
        />

        <div>
          <Eyebrow accent className="mb-6">Volume II · Now Live</Eyebrow>
          <h1
            className="font-serif text-4xl md:text-5xl lg:text-6xl leading-[0.95] mb-6"
            style={{ fontWeight: 400, letterSpacing: '-0.025em' }}
          >
            The Operating System edition.
          </h1>
          <p className="body-text max-w-xl opacity-80">
            Volume 2 introduces <strong>AOS</strong> — the operating system a contracting company runs on once it outgrows the owner. New chapters, reorganized systems, and a sharper through-line from doctrine to execution.
          </p>
        </div>
      </div>

      {/* What's new */}
      <div className="mt-24">
        <div className="flex items-baseline justify-between gap-6 flex-wrap mb-6">
          <Eyebrow accent>New in V2 — The Operating System</Eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-50">
            Part II · 7 entries
          </span>
        </div>
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

      {/* Scroll cue */}
      <div className="mt-20 flex justify-center animate-bounce opacity-30">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
};

export default HeroSection;
