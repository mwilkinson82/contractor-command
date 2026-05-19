import React from 'react';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import AudioPlayer from '../AudioPlayer';
import authorsNoteAudio from '@/assets/audio/authors-note.mp3';

const Foreword: React.FC = () => {
  return (
    <div id="foreword" className="py-24 border-t border-chapter-divider">
      <header className="mb-16">
        <div className="text-sm uppercase tracking-widest opacity-50 mb-4 font-sans" style={{ letterSpacing: '0.2em' }}>
          Foreword
        </div>
        <h2 className="chapter-heading">Author's Note</h2>
        <div className="flex justify-center mt-8">
          <AudioPlayer src={authorsNoteAudio} title="Listen to the Author's Note" />
        </div>
      </header>

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          This handbook was not written to impress you.
        </p>
        <p>
          It was written because too many capable entrepreneurs lose control of businesses that should have worked.
        </p>
        <p>
          I've watched it happen repeatedly — to smart operators, hard workers, disciplined professionals. People who knew their craft. People who cared. People who showed up every day.
        </p>
        <p>
          They didn't fail because they lacked skill.
        </p>
        <p className="body-text-emphasis">
          They failed because they lacked command under pressure.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="Where ALP Comes From">
        <p>
          ALP was not created in a classroom.
        </p>
        <p>
          It was forged inside real businesses, real projects, real negotiations, and real consequences.
        </p>
        <p>
          High-stakes environments where:
        </p>
        <DoctrineList items={[
          "Time is unforgiving",
          "Money moves fast",
          "Pressure is constant",
          "Excuses do not survive contact with reality"
        ]} />
        <p>
          In those environments, theory collapses quickly.
        </p>
        <p>
          Only what works remains.
        </p>
        <p className="pt-4">
          ALP is not a framework.<br />
          It is a distillation — of what consistently held when everything else broke down.
        </p>
      </Section>

      <Section title="What This Handbook Is — and Is Not">
        <p>
          This is not a motivational book.<br />
          It will not hype you up.<br />
          It will not tell you everything will be fine.
        </p>
        <p className="body-text-emphasis">
          It is a control doctrine.
        </p>
        <p>
          It exists to help you:
        </p>
        <DoctrineList items={[
          "See clearly when things feel chaotic",
          "Decide correctly when pressure rises",
          "Enforce standards without apology",
          "Scale without losing yourself or the business"
        ]} />
        <p>
          If you are looking for shortcuts, this is not your handbook.
        </p>
        <p>
          If you are looking for clarity — it is.
        </p>
      </Section>

      <Section title="The Problem This Handbook Solves">
        <p>
          Most entrepreneurs don't fail from lack of effort.
        </p>
        <p>
          They fail because:
        </p>
        <DoctrineList items={[
          "They react instead of diagnose",
          "They confuse motion with progress",
          "They delay decisions to avoid discomfort",
          "They compromise standards to preserve peace",
          "They lose command as volume increases"
        ]} />
        <p>
          This handbook exists to correct that pattern.
        </p>
        <p>
          Not gently.<br />
          Precisely.
        </p>
      </Section>

      <Section title="How to Use This Handbook">
        <p>
          Do not read this passively.
        </p>
        <p>
          Use it:
        </p>
        <DoctrineList items={[
          "When something feels off",
          "When pressure increases",
          "When decisions feel heavy",
          "When growth strains the system",
          "When leadership is tested"
        ]} />
        <p>
          Return to it often.
        </p>
        <p className="body-text-emphasis">
          Clarity compounds.
        </p>
      </Section>

      <Section title="A Word on Responsibility">
        <p>
          ALP demands responsibility.
        </p>
        <p>
          Not blame.<br />
          Not guilt.<br />
          Responsibility.
        </p>
        <p>
          If you adopt this doctrine, you are choosing to:
        </p>
        <DoctrineList items={[
          "Stop outsourcing blame",
          "Stop avoiding decisions",
          "Stop negotiating standards",
          "Stop hiding behind complexity"
        ]} />
        <p>
          That choice is uncomfortable.
        </p>
        <p>
          It is also freeing.
        </p>
      </Section>

      <Section title="Final Note Before We Begin">
        <p>
          You will not agree with everything in this handbook immediately.
        </p>
        <p>
          That's expected.
        </p>
        <p>
          ALP challenges identity before it improves outcomes.
        </p>
        <p>
          Sit with it.<br />
          Test it.<br />
          Apply it under pressure.
        </p>
        <p>
          The results will speak for themselves.
        </p>
        <p className="pt-8 body-text-emphasis">
          This is not a handbook about business.
        </p>
        <p className="body-text-emphasis">
          It is a handbook about command.
        </p>
        <p className="pt-8 text-right italic font-serif text-xl">
          — Marshall Wilkinson
        </p>
      </Section>
    </div>
  );
};

export default Foreword;
