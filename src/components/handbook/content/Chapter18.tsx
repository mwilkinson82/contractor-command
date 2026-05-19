import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import IdentityParable from '../IdentityParable';

const Chapter18: React.FC = () => {
  return (
    <div id="chapter-18" className="pt-4 pb-12">
      <h3 className="section-heading mt-4 mb-8">CPM Schedules and the Cost of Disorder</h3>


      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most contractors treat schedules as a formality.
        </p>
        <p>
          Something required by the owner.<br />
          Something submitted once.<br />
          Something referenced occasionally.
        </p>
        <p>
          That misunderstanding costs more profit than almost any other operational failure.
        </p>
        <p>
          A schedule is not paperwork.
        </p>
        <p className="body-text-emphasis">
          A schedule is time control.
        </p>
        <p>
          And time is the most expensive input on a construction project.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="Why Time Is the Only Resource You Cannot Recover">
        <p>
          Labor can be replaced.<br />
          Materials can be reordered.<br />
          Money can be borrowed.
        </p>
        <p className="body-text-emphasis">
          Time cannot be recovered.
        </p>
        <p>
          Every lost day compounds:
        </p>
        <DoctrineList items={[
          "Supervision costs",
          "General conditions",
          "Management effort",
          "Financing pressure",
          "Morale degradation"
        ]} />
        <p>
          When contractors lose control of time, everything else deteriorates shortly after.
        </p>
      </Section>

      <Section title="What a CPM Schedule Actually Is">
        <p>
          A CPM (Critical Path Method) schedule is not a calendar.
        </p>
        <p>
          It is a <strong>logic model</strong>.
        </p>
        <p>
          It defines:
        </p>
        <DoctrineList items={[
          "What must happen",
          "In what sequence",
          "With what dependencies",
          "And which activities control completion"
        ]} />
        <p>
          The critical path is not theoretical.
        </p>
        <p className="body-text-emphasis">
          It is the chain of events that governs cash flow, risk, and exposure.
        </p>
        <p>
          If you do not control the critical path, you do not control the job.
        </p>
      </Section>

      <Section title="Why Schedules Fail in the Real World">
        <p>
          Schedules fail for predictable reasons:
        </p>
        <DoctrineList items={[
          "They are created to satisfy a contract requirement, not to run the job",
          "They are not updated when conditions change",
          "They are disconnected from field reality",
          "They are treated as static instead of living tools"
        ]} />
        <p>
          When a schedule is not respected, it becomes fiction.
        </p>
        <p className="body-text-emphasis">
          And fiction cannot protect profit.
        </p>
      </Section>

      <Section title="Start–Stop Work Is a Scheduling Failure">
        <p>
          Start–stop work is not bad luck.<br />
          It is not lazy labor.<br />
          It is not "just construction."
        </p>
        <p className="body-text-emphasis">
          It is disorder caused by broken sequencing.
        </p>
        <p>
          Start–stop work happens when:
        </p>
        <DoctrineList items={[
          "Trades are stacked without separation",
          "Materials arrive out of sequence",
          "Access is not controlled",
          "Decisions lag behind work",
          "Dependencies are ignored"
        ]} />
        <p>
          Every stop resets momentum.
        </p>
        <p>
          Momentum is productivity.<br />
          Productivity is margin.
        </p>
      </Section>

      <Section title="The Hidden Cost of Start–Stop Work">
        <p>
          Start–stop work creates losses that never show up cleanly in reports:
        </p>
        <DoctrineList items={[
          "Crews lose rhythm",
          "Supervisors spend time re-explaining work",
          "Rework increases",
          "Safety risk rises",
          "Morale erodes"
        ]} />
        <p>
          The job still "moves," but efficiency collapses.
        </p>
        <p className="body-text-emphasis">
          This is how jobs that look fine on paper quietly die.
        </p>
      </Section>

      <Section title="Scheduling as a Financial Weapon">
        <p>
          A properly managed schedule does three critical things:
        </p>
        <DoctrineList items={[
          "Protects productivity",
          "Documents disruption",
          "Creates entitlement"
        ]} />
        <p>
          When disruption occurs, the schedule answers:
        </p>
        <DoctrineList items={[
          "What was planned",
          "What changed",
          "Who caused it",
          "And what it cost"
        ]} />
        <p>
          Without a schedule, you have opinions.
        </p>
        <p className="body-text-emphasis">
          With a schedule, you have proof.
        </p>
      </Section>

      <Section title="Why Contractors Avoid Real Scheduling">
        <p>
          Real scheduling forces discipline.
        </p>
        <p>
          It requires:
        </p>
        <DoctrineList items={[
          "Thinking ahead",
          "Defining logic",
          "Committing to sequence",
          "Updating reality honestly"
        ]} />
        <p>
          Many contractors avoid this because:
        </p>
        <DoctrineList items={[
          "It exposes weak planning",
          "It removes excuses",
          "It demands accountability"
        ]} />
        <p>
          But avoiding discipline does not remove cost.
        </p>
        <p className="body-text-emphasis">
          It simply hides it until it is unrecoverable.
        </p>
      </Section>

      <Section title="Field Alignment Is Non-Negotiable">
        <p>
          A schedule that lives only in the office is useless.
        </p>
        <p>
          Field leadership must:
        </p>
        <DoctrineList items={[
          "Understand the sequence",
          "Enforce separation",
          "Anticipate constraints",
          "Communicate changes immediately"
        ]} />
        <p>
          When the field operates independently of the schedule, disorder takes over.
        </p>
        <p className="body-text-emphasis">
          Strong operators ensure the schedule leads the field, not the other way around.
        </p>
      </Section>

      <Section title="CPM and Change Orders">
        <p>
          Schedules are foundational to change order velocity.
        </p>
        <p>
          If work is disrupted and you cannot show:
        </p>
        <DoctrineList items={[
          "Critical path impact",
          "Resource stacking",
          "Resequencing",
          "Extended durations"
        ]} />
        <p>
          You will struggle to monetize change.
        </p>
        <p>
          Owners do not pay for inconvenience.<br />
          They pay for <strong>demonstrated time impact</strong>.
        </p>
        <p className="body-text-emphasis">
          That proof comes from the schedule.
        </p>
      </Section>

      <Section title="The Cost of Disorder">
        <p>
          Disorder is expensive.
        </p>
        <p>
          It looks like:
        </p>
        <DoctrineList items={[
          "Crowded sites",
          "Conflicting instructions",
          "Constant firefighting",
          "Emotional supervision",
          "Reactive decisions"
        ]} />
        <p>
          Order feels slow at first.
        </p>
        <p>
          It is not.
        </p>
        <p className="body-text-emphasis">
          Order accelerates execution by removing friction.
        </p>
      </Section>

      <Section title="The Operator's Responsibility">
        <p>
          The entrepreneur must insist on scheduling discipline.
        </p>
        <p>
          Not perfection.<br />
          Discipline.
        </p>
        <p>
          That means:
        </p>
        <DoctrineList items={[
          "Treating schedules as operational tools",
          "Updating them when reality changes",
          "Using them to drive decisions",
          "Defending them contractually"
        ]} />
        <p>
          If the schedule is ignored, time is lost.<br />
          If time is lost, margin pays the price.
        </p>
      </Section>

      <Section title="Bringing It Back to the Stool">
        <p>
          Scheduling sits at the intersection of:
        </p>
        <DoctrineList items={[
          "Operations",
          "General conditions",
          "Financial command",
          "Change entitlement"
        ]} />
        <p>
          Weak scheduling destabilizes the stool.
        </p>
        <p className="body-text-emphasis">
          Strong scheduling reinforces every leg.
        </p>
      </Section>

      <div className="parable-container">
        <div className="parable-label">Example</div>
        <h4 className="subsection-heading italic">The One-Day Delay That Cost Three Weeks</h4>
        <div className="body-text space-y-4">
          <p>
            A job was scheduled tightly but logically.
          </p>
          <p>
            One delivery slipped by a single day.<br />
            No notice was issued.<br />
            The schedule wasn't updated.<br />
            The crew improvised.
          </p>
          <p>
            That one-day slip stacked trades.<br />
            Access became contested.<br />
            Work started and stopped.<br />
            Rework followed.
          </p>
          <p>
            By the time the dust settled, the project was three weeks behind.
          </p>
          <p>
            No single moment felt catastrophic.<br />
            No one decision looked fatal.
          </p>
          <p className="body-text-emphasis">
            But time drifted — unchecked.
          </p>
          <p>
            When the contractor later attempted to recover costs, the owner asked:<br />
            "Where is the schedule impact?"
          </p>
          <p>
            There wasn't one.
          </p>
          <p>
            The delay was real.<br />
            The cost was real.<br />
            But without time control, the loss was <strong>unrecoverable</strong>.
          </p>
          <p className="body-text-emphasis">
            Schedules don't prevent problems.<br />
            They prevent unpaid problems.
          </p>
        </div>
      </div>

      <IdentityParable id="identity-parable-18" title="The Operator Who Hated Planning">
        <p>
          An operator avoided scheduling.
        </p>
        <p>
          He said:<br />
          "I like to stay flexible."<br />
          "I don't want to overcomplicate things."<br />
          "We'll figure it out in the field."
        </p>
        <p>
          But the truth was simpler.
        </p>
        <p>
          Planning made him confront reality.<br />
          Planning exposed tradeoffs.<br />
          Planning removed excuses.
        </p>
        <p>
          Without a schedule, failure felt external.<br />
          With a schedule, failure felt personal.
        </p>
        <p className="body-text-emphasis">
          So he avoided structure.
        </p>
        <p>
          And time drifted.<br />
          And margin eroded.<br />
          And blame multiplied.
        </p>
        <p className="body-text-emphasis">
          Order is uncomfortable for people whose identity relies on improvisation.
        </p>
        <p>
          Professionals choose order anyway.
        </p>
      </IdentityParable>

      <Section title="Final Truth">
        <p>
          Jobs do not fail because people are incapable.
        </p>
        <p className="body-text-emphasis">
          They fail because time is allowed to drift without control.
        </p>
        <p>
          A CPM schedule is not bureaucracy.
        </p>
        <p>
          It is how professionals impose order on chaos — and protect profit while doing it.
        </p>
        <p>
          Those who respect time control outcomes.
        </p>
        <p>
          Those who don't spend their careers chasing lost days.
        </p>
      </Section>
    </div>
  );
};

export default Chapter18;
