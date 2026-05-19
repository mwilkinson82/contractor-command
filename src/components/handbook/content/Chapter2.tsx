import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';
import AudioPlayer from '../AudioPlayer';
import chapter2Audio from '@/assets/audio/chapter-2.mp3';

const Chapter2: React.FC = () => {
  return (
    <div id="chapter-2" className="py-24 border-t border-chapter-divider">
      <ChapterHeader 
        number={2} 
        title="All Problems Are Entrepreneurial Problems" 
      />
      
      <AudioPlayer src={chapter2Audio} title="Listen to Chapter 2" />

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most entrepreneurs believe their problems are arena-specific.
        </p>
        <p>
          Construction problems.<br />
          Sales problems.<br />
          People problems.<br />
          Market problems.
        </p>
        <p>
          This belief is comforting — and wrong.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="The Hard Truth">
        <p className="body-text-emphasis">
          All problems are entrepreneurial problems.
        </p>
        <p>
          The arena only reveals them.
        </p>
        <p>
          If two people face the same conditions and produce different outcomes, the arena is not the variable.
        </p>
        <p className="body-text-emphasis">
          The operator is.
        </p>
      </Section>

      <Section title="Symptoms vs. Source">
        <p>
          Arena problems are symptoms.
        </p>
        <p>
          Entrepreneurial problems are sources.
        </p>
        <p>
          Symptoms look like:
        </p>
        <DoctrineList items={[
          "Missed deadlines",
          "Cash flow stress",
          "Bad hires",
          "Scope disputes",
          "Burnout"
        ]} />
        <p>
          Sources look like:
        </p>
        <DoctrineList items={[
          "Weak decisions",
          "Avoided pressure",
          "Poor standards",
          "Inconsistent systems",
          "Unclear identity"
        ]} />
        <p>
          Fixing symptoms feels productive.<br />
          Fixing sources changes everything.
        </p>
      </Section>

      <Section title="Why This Matters">
        <p>
          When you misdiagnose the problem, you:
        </p>
        <DoctrineList items={[
          "Hire the wrong solution",
          "Install the wrong system",
          "Blame the wrong person",
          "Waste time and money"
        ]} />
        <p>
          ALP forces you to look inward first — not emotionally, but responsibly.
        </p>
      </Section>

      <Parable id="parable-broken-toolbelt" title="The Broken Toolbelt">
        <p>
          An operator replaces tools constantly.
        </p>
        <p>
          New software.<br />
          New hires.<br />
          New consultants.
        </p>
        <p>
          Nothing improves.
        </p>
        <p>
          Eventually, he realizes the issue wasn't the tools.
        </p>
        <p className="body-text-emphasis">
          It was how he used them.
        </p>
      </Parable>

      <Section title="Ownership Restores Power">
        <p>
          The moment you accept that problems originate with leadership, you regain control.
        </p>
        <p>
          Not guilt.<br />
          Not shame.<br />
          Power.
        </p>
        <p className="body-text-emphasis">
          Entrepreneurship begins where excuses end.
        </p>
      </Section>
    </div>
  );
};

export default Chapter2;
