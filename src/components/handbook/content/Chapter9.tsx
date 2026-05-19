import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';
import ExpandableImage from '../ExpandableImage';
import alpDecisionMatrix from '@/assets/alp-decision-matrix.png';

const Chapter9: React.FC = () => {
  return (
    <div id="chapter-9" className="py-24 border-t border-chapter-divider">
      <ChapterHeader 
        number={9} 
        title="The ALP Decision Matrix" 
      />

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most operators don't suffer from a lack of information.
        </p>
        <p>
          They suffer from poor decision sequencing under pressure.
        </p>
        <p>
          They know what's happening.<br />
          They sense what's wrong.<br />
          They feel the risk.
        </p>
        <p>
          But they hesitate.<br />
          They react emotionally.<br />
          They delay.<br />
          They make partial moves.<br />
          They let problems drift.
        </p>
        <p className="body-text-emphasis">
          ALP exists to eliminate that drift.
        </p>
        <p>
          The Decision Matrix is not philosophy.
        </p>
        <p>
          It is an operating system for real-time command.
        </p>
      </div>

      <figure className="my-16">
        <ExpandableImage 
          src={alpDecisionMatrix} 
          alt="The ALP Decision Matrix - Altitude (Zoom Out) → Logic (Define Reality) → Pressure (Take Action). Think Clearly. Move Decisively." 
          className="w-full max-w-2xl mx-auto rounded-lg shadow-lg"
        />
      </figure>

      <div className="chapter-divider" />

      <Section title="Why Decisions Break Down Under Pressure">
        <p>
          Pressure doesn't remove intelligence.
        </p>
        <p className="body-text-emphasis">
          It removes order.
        </p>
        <p>
          Under pressure, operators tend to:
        </p>
        <DoctrineList items={[
          "React instead of diagnose",
          "Solve symptoms instead of causes",
          "Delegate decisions they should own",
          "Delay decisions they should make",
          "Make emotional trades to relieve discomfort"
        ]} />
        <p>
          This is not a character flaw.
        </p>
        <p>
          It is a sequencing failure.
        </p>
        <p className="body-text-emphasis">
          The ALP Decision Matrix exists to enforce sequence when pressure tries to collapse it.
        </p>
      </Section>

      <Section title="The Three-Step Decision Constraint">
        <p>
          Every meaningful decision must pass through three gates — in order:
        </p>
        <DoctrineList items={[
          "Altitude — Step back",
          "Logic — Define reality",
          "Pressure — Act decisively"
        ]} />
        <p>
          Skipping a step always creates downstream chaos.
        </p>
        <p className="body-text-emphasis">
          Doing them out of order guarantees it.
        </p>
      </Section>

      <Section title="Step One: Altitude — Creating Separation From the Noise">
        <p>
          Altitude is not analysis.
        </p>
        <p className="body-text-emphasis">
          It is separation.
        </p>
        <p>
          Under pressure, operators get trapped inside:
        </p>
        <DoctrineList items={[
          "Emotions",
          "Urgency",
          "Other people's expectations",
          "Noise from the field",
          "Incomplete information"
        ]} />
        <p>
          Altitude forces one question first:
        </p>
        <p className="blockquote-doctrine">
          "What is actually happening here — beyond the noise?"
        </p>
        <p>
          This step requires distance.
        </p>
        <p>
          Distance from:
        </p>
        <DoctrineList items={[
          "The last phone call",
          "The loudest voice",
          "The most recent problem",
          "The emotional temperature of the job"
        ]} />
        <p className="body-text-emphasis">
          Altitude is how you prevent urgency from hijacking authority.
        </p>
      </Section>

      <Section title="Why Most Operators Skip Altitude">
        <p>
          Altitude feels like delay.
        </p>
        <p>
          And under pressure, delay feels dangerous.
        </p>
        <p>
          So operators jump straight into action.
        </p>
        <p className="body-text-emphasis">
          That's the mistake.
        </p>
        <p>
          Action without altitude is motion without direction.
        </p>
        <p>
          You move fast.<br />
          You feel busy.<br />
          You feel involved.
        </p>
        <p className="body-text-emphasis">
          But you're not in control.
        </p>
      </Section>

      <Section title="Step Two: Logic — Defining the Actual Problem">
        <p>
          Once altitude is achieved, logic begins.
        </p>
        <p>
          Logic is not opinion.<br />
          It is not instinct.<br />
          It is not experience alone.
        </p>
        <p>
          Logic asks:
        </p>
        <DoctrineList items={[
          "What exactly is broken?",
          "What is causing it?",
          "What constraints exist?",
          "What options are real?",
          "What consequences follow each option?"
        ]} />
        <p>
          This step strips emotion from the decision.
        </p>
        <p>
          It replaces:
        </p>
        <DoctrineList items={[
          '"I feel like…"',
          '"They\'re upset…"',
          '"We\'ve always done it this way…"'
        ]} />
        <p>
          With:
        </p>
        <DoctrineList items={[
          "Facts",
          "Constraints",
          "Cause-and-effect"
        ]} />
        <p className="body-text-emphasis">
          Logic forces clarity before commitment.
        </p>
      </Section>

      <Section title="The Danger of Partial Logic">
        <p>
          Many operators think they use logic.
        </p>
        <p>
          But they only apply it selectively.
        </p>
        <p>
          They:
        </p>
        <DoctrineList items={[
          "Ignore schedule impact",
          "Ignore documentation requirements",
          "Ignore entitlement risk",
          "Ignore downstream consequences"
        ]} />
        <p>
          That's not logic.
        </p>
        <p className="body-text-emphasis">
          That's rationalization.
        </p>
        <p>
          Logic must account for the entire system, not just the immediate discomfort.
        </p>
      </Section>

      <Section title="Step Three: Pressure — Making the Decision Real">
        <p>
          Pressure is the most misunderstood step.
        </p>
        <p>
          Pressure is not aggression.<br />
          It is not manipulation.<br />
          It is not force.
        </p>
        <p className="body-text-emphasis">
          Pressure is responsibility made visible.
        </p>
        <p>
          Pressure means:
        </p>
        <DoctrineList items={[
          "Choosing",
          "Declaring",
          "Enforcing",
          "Acting"
        ]} />
        <p>
          Once altitude and logic are complete, pressure becomes mandatory.
        </p>
        <p className="body-text-emphasis">
          A decision that is not enforced is not a decision.
        </p>
        <p>
          It is a thought.
        </p>
      </Section>

      <Section title="Why Operators Avoid Pressure">
        <p>
          Pressure creates consequences.
        </p>
        <p>
          It creates:
        </p>
        <DoctrineList items={[
          "Conflict",
          "Accountability",
          "Visibility",
          "Ownership"
        ]} />
        <p>
          Many operators delay pressure to:
        </p>
        <DoctrineList items={[
          "Avoid upsetting people",
          "Avoid being wrong",
          "Avoid confrontation",
          "Avoid commitment"
        ]} />
        <p className="body-text-emphasis">
          But pressure avoided now becomes chaos later.
        </p>
        <p>
          Every time.
        </p>
      </Section>

      <Parable id="parable-deferred-call" title="The Deferred Call">
        <p>
          A job began slipping.
        </p>
        <p>
          The superintendent flagged it.<br />
          The PM mentioned concerns.<br />
          Everyone sensed a problem.
        </p>
        <p>
          The operator waited.
        </p>
        <p className="blockquote-doctrine">
          "Let's see if it corrects itself."
        </p>
        <p>
          It didn't.
        </p>
        <p>
          Two weeks later:
        </p>
        <DoctrineList items={[
          "Schedule was broken",
          "Trades were stacked",
          "GC's expanded",
          "Documentation was weak"
        ]} />
        <p>
          The cost of delay exceeded the discomfort of the original decision — by orders of magnitude.
        </p>
        <p>
          The failure wasn't judgment.
        </p>
        <p className="body-text-emphasis">
          It was hesitation at the pressure step.
        </p>
      </Parable>

      <Section title="The Matrix in Real Time">
        <p>
          Here's what the Matrix looks like on an actual job:
        </p>
        <p>
          <strong>Problem:</strong> Owner-caused delay impacting sequence.
        </p>
        <p>
          <strong>Altitude:</strong><br />
          Step back. This is not a "bad day." This is a time-impact event.
        </p>
        <p>
          <strong>Logic:</strong><br />
          Identify cause. Define duration impact. Check contract language. Assess entitlement. Update schedule.
        </p>
        <p>
          <strong>Pressure:</strong><br />
          Issue notice. Enforce resequencing. Protect GC's. Make the call uncomfortable if needed.
        </p>
        <p className="body-text-emphasis">
          Miss any step — and profit leaks.
        </p>
      </Section>

      <Section title="Clean Decisions Stabilize Systems">
        <p>
          Strong operators don't make more decisions.
        </p>
        <p className="body-text-emphasis">
          They make cleaner ones.
        </p>
        <p>
          Clean decisions:
        </p>
        <DoctrineList items={[
          "Reduce noise",
          "Reduce rework",
          "Reduce emotional drain",
          "Reduce firefighting"
        ]} />
        <p>
          Teams relax when decisions are decisive.
        </p>
        <p>
          Chaos decreases when leadership is clear.
        </p>
      </Section>

      <Section title="The Cost of Indecision">
        <p>
          Indecision is not neutral.
        </p>
        <p>
          It actively damages:
        </p>
        <DoctrineList items={[
          "Schedule",
          "Margin",
          "Authority",
          "Credibility"
        ]} />
        <p className="body-text-emphasis">
          Every delayed decision taxes the system.
        </p>
        <p>
          Eventually, the system collapses under that weight.
        </p>
      </Section>

      <Section title="The Operator Is the Final Constraint">
        <p>
          No system outruns the operator's willingness to decide.
        </p>
        <p>
          You can have:
        </p>
        <DoctrineList items={[
          "Schedules",
          "Contracts",
          "Documentation",
          "Teams"
        ]} />
        <p>
          But if the operator hesitates under pressure, none of it holds.
        </p>
        <p className="body-text-emphasis">
          The ALP Decision Matrix exists to remove that hesitation.
        </p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p>
          <strong>Altitude</strong> creates command perspective.<br />
          <strong>Logic</strong> creates clarity.<br />
          <strong>Pressure</strong> converts clarity into reality.
        </p>
        <p className="body-text-emphasis">
          Remove any one — and decision-making collapses.
        </p>
      </Section>

      <Section title="Final Truth">
        <p>
          Most problems don't destroy businesses.
        </p>
        <p className="body-text-emphasis">
          Delayed decisions do.
        </p>
        <p>
          The ALP Decision Matrix is not about being right.
        </p>
        <p>
          It is about being decisive, structured, and accountable when it matters most.
        </p>
        <p className="body-text-emphasis">
          Under pressure, clarity wins.
        </p>
        <p>
          And clarity only exists when decisions are made —<br />
          not discussed endlessly.
        </p>
        <p>
          Command requires action.
        </p>
        <p className="body-text-emphasis">
          ALP ensures that action is clean.
        </p>
      </Section>
    </div>
  );
};

export default Chapter9;
