import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';
import ExpandableImage from '../ExpandableImage';
import chaosToControl from '@/assets/chaos-to-control.png';

const Chapter10: React.FC = () => {
  return (
    <div id="chapter-10" className="py-24 border-t border-chapter-divider">
      <ChapterHeader 
        number={14} 
        title="From Chaos to Control" 
      />

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most contractors think chaos is accidental.
        </p>
        <p>
          It isn't.
        </p>
        <p>
          Chaos is predictable, repeatable, and almost always self-inflicted.
        </p>
        <p>
          It doesn't arrive suddenly.<br />
          It builds slowly.<br />
          And by the time people call it "out of control," it has already been tolerated for weeks or months.
        </p>
        <p className="body-text-emphasis">
          This chapter exists to make that visible — and reversible.
        </p>
      </div>

      <figure className="my-16">
        <ExpandableImage 
          src={chaosToControl} 
          alt="From Chaos to Control - See Clearly (Financial Command) → Decide Correctly (Decision Matrix) → Apply Pressure (Operational Discipline) → Profit Freely (Margin Protection)" 
          className="w-full max-w-4xl mx-auto rounded-lg shadow-lg"
        />
      </figure>

      <div className="chapter-divider" />

      <Section title="Chaos Is a Leadership Condition">
        <p>
          Chaos is not a people problem.<br />
          It is not a market problem.<br />
          It is not a "this job is different" problem.
        </p>
        <p className="body-text-emphasis">
          Chaos is a leadership condition.
        </p>
        <p>
          Specifically, it is the absence of:
        </p>
        <DoctrineList items={[
          "Clear standards",
          "Enforced sequence",
          "Timely decisions",
          "Ownership under pressure"
        ]} />
        <p className="body-text-emphasis">
          Where leadership hesitates, chaos fills the gap.
        </p>
        <p>
          Every time.
        </p>
      </Section>

      <Section title="How Chaos Actually Forms">
        <p>
          Chaos does not start with a crisis.
        </p>
        <p>
          It starts with small allowances.
        </p>
        <DoctrineList items={[
          "One decision delayed",
          "One standard softened",
          "One notice not sent",
          "One sequence violated",
          "One behavior tolerated"
        ]} />
        <p>
          Each one feels reasonable.<br />
          Each one feels harmless.
        </p>
        <p>
          Until they stack.
        </p>
        <p className="body-text-emphasis">
          Chaos is simply the compound effect of undecided leadership.
        </p>
      </Section>

      <Section title="Why Chaos Feels Normal on the Inside">
        <p>
          Here's why chaos is so dangerous:
        </p>
        <p>
          From inside the business, it feels like:
        </p>
        <DoctrineList items={[
          '"We\'re just busy"',
          '"This is construction"',
          '"Everyone\'s doing their best"',
          '"It\'ll calm down after this phase"'
        ]} />
        <p>
          From the outside, it looks like:
        </p>
        <DoctrineList items={[
          "Disorganization",
          "Poor planning",
          "Weak control",
          "Emotional leadership"
        ]} />
        <p>
          The longer chaos persists, the more it gets normalized.
        </p>
        <p className="body-text-emphasis">
          And normalized chaos is extremely expensive.
        </p>
      </Section>

      <Section title="Noise Is the First Symptom">
        <p>
          Chaos announces itself through noise.
        </p>
        <DoctrineList items={[
          "Constant phone calls",
          "Fire drills",
          "Meetings that solve nothing",
          "Repeated explanations",
          "People asking the same questions"
        ]} />
        <p>
          Noise is not productivity.
        </p>
        <p className="body-text-emphasis">
          Noise is friction caused by missing structure.
        </p>
        <p>
          If your operation is loud, something is undefined or unenforced.
        </p>
      </Section>

      <Section title="Control Is Not Micromanagement">
        <p>
          This is where most operators get it wrong.
        </p>
        <p>
          They avoid control because they confuse it with micromanagement.
        </p>
        <p className="body-text-emphasis">
          They are not the same.
        </p>
        <p>
          Micromanagement focuses on people.<br />
          Control focuses on systems.
        </p>
        <p>
          Control means:
        </p>
        <DoctrineList items={[
          "Clear expectations",
          "Defined sequence",
          "Documented standards",
          "Predictable responses",
          "Known consequences"
        ]} />
        <p>
          People don't resist control.
        </p>
        <p className="body-text-emphasis">
          They resist unclear control.
        </p>
      </Section>

      <Section title="Control Creates Psychological Safety">
        <p>
          This may surprise you:
        </p>
        <p className="body-text-emphasis">
          Strong control actually reduces stress.
        </p>
        <p>
          When control exists:
        </p>
        <DoctrineList items={[
          "Teams know what matters",
          "Decisions are predictable",
          "Priorities are clear",
          "Accountability is fair"
        ]} />
        <p>
          People relax when leadership is consistent.
        </p>
        <p>
          Chaos exhausts everyone.<br />
          Control stabilizes everyone.
        </p>
      </Section>

      <Parable id="parable-noisy-jobsite" title="The Noisy Jobsite">
        <p>
          A project felt out of control.
        </p>
        <p>
          Phones ringing constantly.<br />
          Trades frustrated.<br />
          PM overwhelmed.<br />
          Owner anxious.
        </p>
        <p>
          Everyone was "working hard."
        </p>
        <p>
          The operator stepped in and did three things:
        </p>
        <DoctrineList items={[
          "Reasserted sequence",
          "Clarified decision authority",
          "Enforced start–stop rules"
        ]} />
        <p>
          Within a week:
        </p>
        <DoctrineList items={[
          "Noise dropped",
          "Progress increased",
          "Tension eased"
        ]} />
        <p>
          Nothing magical happened.
        </p>
        <p className="body-text-emphasis">
          Structure replaced drift.
        </p>
      </Parable>

      <Section title="Control Is Built, Not Announced">
        <p>
          You cannot declare control.
        </p>
        <p className="body-text-emphasis">
          You must build it.
        </p>
        <p>
          Control is established through:
        </p>
        <DoctrineList items={[
          "Repetition",
          "Enforcement",
          "Follow-through",
          "Predictability"
        ]} />
        <p>
          The first time you enforce a standard, people test it.<br />
          The second time, they watch.<br />
          The third time, they comply.
        </p>
        <p className="body-text-emphasis">
          Control compounds the same way chaos does.
        </p>
      </Section>

      <Section title="Why Operators Avoid Control">
        <p>
          Control requires discomfort.
        </p>
        <p>
          It requires:
        </p>
        <DoctrineList items={[
          "Saying no",
          "Holding lines",
          "Creating friction",
          "Being disliked temporarily"
        ]} />
        <p>
          Many operators avoid this to preserve peace.
        </p>
        <p>
          But peace without structure is fake.
        </p>
        <p className="body-text-emphasis">
          It always collapses.
        </p>
      </Section>

      <Section title="Chaos Always Costs More Than Control">
        <p>
          Operators often avoid control to "keep things moving."
        </p>
        <p>
          But chaos costs:
        </p>
        <DoctrineList items={[
          "Time",
          "Margin",
          "Energy",
          "Reputation",
          "Authority"
        ]} />
        <p>
          Control may slow things down briefly.
        </p>
        <p className="body-text-emphasis">
          Chaos slows everything down permanently.
        </p>
      </Section>

      <Section title="Control Protects the Entire Stool">
        <p>
          When control exists:
        </p>
        <DoctrineList items={[
          "Marketing stays confident",
          "Sales stays disciplined",
          "Operations stay sequenced",
          "General Conditions stay protected",
          "Decisions stay clean"
        ]} />
        <p>
          When control breaks, every leg weakens.
        </p>
        <p className="body-text-emphasis">
          This is why control is not optional.
        </p>
        <p>
          It is foundational.
        </p>
      </Section>

      <Section title="The Operator Is the Source of Order">
        <p>
          Here is the uncomfortable truth:
        </p>
        <p className="blockquote-doctrine">
          The level of control in the business never exceeds<br />
          the level of control the operator is willing to enforce.
        </p>
        <p>
          If you avoid decisions, chaos grows.<br />
          If you delay enforcement, chaos spreads.<br />
          If you tolerate disorder, chaos becomes culture.
        </p>
        <p className="body-text-emphasis">
          Order flows from the top — or it doesn't exist at all.
        </p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p>
          <strong>Altitude</strong> allows you to see chaos forming early.<br />
          <strong>Logic</strong> lets you identify the true cause.<br />
          <strong>Pressure</strong> forces you to act before damage compounds.
        </p>
        <p className="body-text-emphasis">
          Remove any one — and chaos wins.
        </p>
      </Section>

      <Section title="Final Truth">
        <p>
          Chaos is not bad luck.
        </p>
        <p className="body-text-emphasis">
          It is unclaimed responsibility.
        </p>
        <p>
          And control is not domination.
        </p>
        <p className="body-text-emphasis">
          It is leadership made visible.
        </p>
        <p>
          Every business is either drifting toward chaos<br />
          or being pulled toward order.
        </p>
        <p>
          ALP exists to ensure you choose the latter —<br />
          early, deliberately, and without apology.
        </p>
      </Section>
    </div>
  );
};

export default Chapter10;
