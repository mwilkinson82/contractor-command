import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';

const Chapter12 = () => {
  return (
    <section id="chapter-12" className="chapter-section">
      <ChapterHeader number={12} title="Documentation, Entitlement, and Proof" />
      
      <p className="body-text">Most contractors believe documentation exists for disputes.</p>
      
      <p className="body-text">That belief is too small — and too late.</p>
      
      <p className="body-text font-semibold">Documentation does not exist to fight.</p>
      
      <p className="body-text">It exists to prove.</p>
      
      <p className="body-text">
        And in construction, proof is the only currency that converts disruption into money.
      </p>

      <Section title="The Fatal Misunderstanding About Documentation">
        <p className="body-text">Most operators treat documentation as:</p>
        
        <DoctrineList items={[
          "A defensive habit",
          "A back-office task",
          "Something you \"clean up later\"",
          "A burden imposed by lawyers"
        ]} />
        
        <p className="body-text">That mindset guarantees one outcome:</p>
        
        <p className="body-text font-semibold">
          You will work harder — and get paid less — than the contract allows.
        </p>
        
        <p className="body-text">Documentation is not administrative.</p>
        
        <p className="body-text font-semibold">It is financial infrastructure.</p>
      </Section>

      <Section title="Entitlement Is Not Fairness">
        <p className="body-text">This is one of the most important truths in this handbook:</p>
        
        <p className="body-text font-semibold">
          You are not paid based on what is fair.<br />
          You are paid based on what is provable.
        </p>
        
        <p className="body-text">
          Entitlement is not emotion.<br />
          It is not effort.<br />
          It is not inconvenience.
        </p>
        
        <p className="body-text">Entitlement exists only when three things align:</p>
        
        <DoctrineList items={[
          "Contract language",
          "Documented facts",
          "Demonstrated impact"
        ]} />
        
        <p className="body-text font-semibold">Miss any one — and entitlement collapses.</p>
      </Section>

      <Section title="Why Contractors Lose Entitlement They Technically Have">
        <p className="body-text">Most contractors lose valid entitlement because they fail at proof.</p>
        
        <p className="body-text">They:</p>
        
        <DoctrineList items={[
          "Document late",
          "Document inconsistently",
          "Document emotionally",
          "Document without structure",
          "Document without tying cause to effect"
        ]} />
        
        <p className="body-text">By the time money is discussed, the record is already broken.</p>
        
        <p className="body-text font-semibold">And broken records don't get paid.</p>
      </Section>

      <Section title="Documentation Is a Real-Time Discipline">
        <p className="body-text">Documentation only works while the job is happening.</p>
        
        <p className="body-text">
          Not after.<br />
          Not at closeout.<br />
          Not when lawyers are involved.
        </p>
        
        <p className="body-text">Documentation must occur:</p>
        
        <DoctrineList items={[
          "When disruption happens",
          "When access is denied",
          "When sequence breaks",
          "When decisions lag",
          "When start–stop work begins"
        ]} />
        
        <p className="body-text">
          Memory decays.<br />
          Narratives harden.<br />
          Positions calcify.
        </p>
        
        <p className="body-text font-semibold">
          Real-time documentation preserves truth before it gets rewritten.
        </p>
      </Section>

      <Parable id="parable-unwritten-delay" title="The Unwritten Delay">
        <p className="body-text">A project suffered months of owner-caused disruption.</p>
        
        <p className="body-text">
          Everyone knew it.<br />
          Everyone felt it.<br />
          Everyone talked about it.
        </p>
        
        <p className="body-text">But nothing was documented clearly.</p>
        
        <p className="body-text">At the end:</p>
        
        <DoctrineList items={[
          "The owner denied responsibility",
          "The schedule didn't show impact",
          "Notices were late",
          "The contractor absorbed the loss"
        ]} />
        
        <p className="body-text">The problem wasn't entitlement.</p>
        
        <p className="body-text font-semibold">It was proof.</p>
      </Parable>

      <Section title="Proof Requires Cause and Effect">
        <p className="body-text">Documentation without structure is noise.</p>
        
        <p className="body-text">Strong documentation always answers four questions:</p>
        
        <DoctrineList items={[
          "What happened?",
          "Why did it happen?",
          "What did it affect?",
          "How long did the effect last?"
        ]} />
        
        <p className="body-text">
          Photos without context are useless.<br />
          Emails without timelines are weak.<br />
          Daily reports without causation are incomplete.
        </p>
        
        <p className="body-text font-semibold">Proof is not volume.</p>
        
        <p className="body-text">Proof is clarity.</p>
      </Section>

      <Section title="Documentation Is Not Complaining">
        <p className="body-text">
          Many operators avoid documentation because they fear it feels adversarial.
        </p>
        
        <p className="body-text">That fear is misplaced.</p>
        
        <p className="body-text">
          Clear documentation is not aggressive.<br />
          It is not emotional.<br />
          It is not hostile.
        </p>
        
        <p className="body-text font-semibold">It is factual.</p>
        
        <p className="body-text">And facts reduce conflict — they don't create it.</p>
        
        <p className="body-text">Disputes escalate when:</p>
        
        <DoctrineList items={[
          "Records are vague",
          "Facts are missing",
          "Positions are argued instead of demonstrated"
        ]} />
        
        <p className="body-text font-semibold">
          Strong documentation short-circuits arguments before they form.
        </p>
      </Section>

      <Section title="Entitlement Lives in the Schedule">
        <p className="body-text">
          No matter how much documentation you have, entitlement dies without schedule support.
        </p>
        
        <p className="body-text">Schedules:</p>
        
        <DoctrineList items={[
          "Show sequence",
          "Prove dependency",
          "Demonstrate delay",
          "Quantify duration impact"
        ]} />
        
        <p className="body-text font-semibold">Documentation and scheduling are inseparable.</p>
        
        <p className="body-text">
          One records events.<br />
          The other proves impact.
        </p>
        
        <p className="body-text">Together, they create entitlement.</p>
      </Section>

      <Section title="Why Owners Resist Documentation">
        <p className="body-text">Owners don't resist documentation because it's annoying.</p>
        
        <p className="body-text font-semibold">They resist it because it limits flexibility.</p>
        
        <p className="body-text">Once something is documented:</p>
        
        <DoctrineList items={[
          "Responsibility becomes visible",
          "Time impact becomes traceable",
          "Narrative control weakens"
        ]} />
        
        <p className="body-text">
          This is why pushback increases when documentation improves.
        </p>
        
        <p className="body-text font-semibold">
          That pushback is confirmation — not a warning.
        </p>
      </Section>

      <Section title="Documentation Is an Offensive Tool">
        <p className="body-text">Most contractors document defensively.</p>
        
        <p className="body-text font-semibold">Strong operators document offensively.</p>
        
        <p className="body-text">They document to:</p>
        
        <DoctrineList items={[
          "Preserve leverage",
          "Force decisions",
          "Protect time",
          "Control narrative",
          "Monetize disruption"
        ]} />
        
        <p className="body-text">
          When documentation is consistent and unemotional, it changes behavior upstream.
        </p>
        
        <p className="body-text">
          People decide faster.<br />
          Access improves.<br />
          Interference decreases.
        </p>
        
        <p className="body-text">Not because you argued — but because proof existed.</p>
      </Section>

      <Section title="The Operator Sets the Standard">
        <p className="body-text">Documentation culture does not come from the field.</p>
        
        <p className="body-text font-semibold">It comes from leadership.</p>
        
        <p className="body-text">If leadership:</p>
        
        <DoctrineList items={[
          "Minimizes documentation",
          "Delays review",
          "Ignores incomplete records",
          "Avoids notice"
        ]} />
        
        <p className="body-text">The team will too.</p>
        
        <p className="body-text">If leadership demands:</p>
        
        <DoctrineList items={[
          "Daily clarity",
          "Cause-and-effect language",
          "Schedule alignment",
          "Immediate escalation"
        ]} />
        
        <p className="body-text font-semibold">Documentation becomes automatic.</p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p className="body-text">
          <strong>Altitude</strong> allows you to see documentation as leverage, not paperwork.<br />
          <strong>Logic</strong> forces cause, effect, and proof to align.<br />
          <strong>Pressure</strong> requires you to document even when it feels uncomfortable.
        </p>
        
        <p className="body-text">Remove any one — and entitlement erodes.</p>
      </Section>

      <Section title="Final Truth">
        <p className="body-text font-semibold">
          Most contractors don't lose money because entitlement didn't exist.
        </p>
        
        <p className="body-text">They lose money because proof didn't.</p>
        
        <p className="body-text">
          Documentation is not about protecting yourself from the worst case.
        </p>
        
        <p className="body-text font-semibold">
          It is about ensuring you get paid for the reality that actually occurred.
        </p>
        
        <p className="body-text">In this business:</p>
        
        <p className="body-text">
          Work is easy to forget<br />
          Disruption is easy to deny<br />
          Time is easy to steal
        </p>
        
        <p className="body-text font-semibold">Unless it's documented.</p>
        
        <p className="body-text">
          Proof turns truth into leverage.<br />
          Leverage turns disruption into money.
        </p>
        
        <p className="body-text font-semibold">And money only moves where proof exists.</p>
      </Section>
    </section>
  );
};

export default Chapter12;
