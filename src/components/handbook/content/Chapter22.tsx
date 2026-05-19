import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';
import IdentityParable from '../IdentityParable';

const Chapter22: React.FC = () => {
  return (
    <div id="chapter-22" className="pt-4 pb-12">
      <h3 className="section-heading mt-4 mb-8">The Decision Matrix at Scale: How Operators Decide Under Pressure</h3>


      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most entrepreneurs do not fail because they lack intelligence.
        </p>
        <p>
          They fail because they make decisions too late, too emotionally, or without context.
        </p>
        <p>
          Pressure does not reveal character.<br />
          It reveals decision quality.
        </p>
        <p className="body-text-emphasis">
          The ALP Decision Matrix exists to eliminate guesswork when stakes are high.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="Why Most Decisions Go Wrong">
        <p>
          Under pressure, operators default to instinct.
        </p>
        <p>
          Instinct feels fast.<br />
          Instinct feels confident.<br />
          Instinct feels decisive.
        </p>
        <p>
          Instinct is also shaped by:
        </p>
        <DoctrineList items={[
          "Fear",
          "Fatigue",
          "Ego",
          "Past trauma",
          "Incomplete information"
        ]} />
        <p>
          That combination produces inconsistency.
        </p>
        <p className="body-text-emphasis">
          And inconsistent decisions create unstable businesses.
        </p>
      </Section>

      <Section title="Decisions Are Not Isolated Events">
        <p>
          Every decision compounds.
        </p>
        <p>
          One delayed decision creates:
        </p>
        <DoctrineList items={[
          "Operational drift",
          "Financial exposure",
          "People confusion",
          "Lost leverage"
        ]} />
        <p>
          Another poor decision on top of that accelerates the slide.
        </p>
        <p>
          By the time the entrepreneur feels "overwhelmed," the damage has already been done.
        </p>
        <p>
          The problem wasn't workload.
        </p>
        <p className="body-text-emphasis">
          It was decision sequencing.
        </p>
      </Section>

      <Section title="The ALP Decision Matrix Explained">
        <p>
          Every meaningful decision must be filtered through three lenses:
        </p>
        <p className="body-text-emphasis">
          Altitude.<br />
          Logic.<br />
          Pressure.
        </p>
        <p>
          In that order.
        </p>
        <p>
          Skipping steps is how entrepreneurs sabotage themselves.
        </p>
      </Section>

      <Section title="Altitude — Zooming Out Before Acting">
        <p>
          Altitude means perspective.
        </p>
        <p>
          Before acting, the operator must ask:
        </p>
        <DoctrineList items={[
          "Is this a symptom or a cause?",
          "Is this temporary or structural?",
          "Is this local or systemic?",
          "What happens if nothing is done?"
        ]} />
        <p>
          Altitude prevents reactive behavior.
        </p>
        <p className="body-text-emphasis">
          Most bad decisions are made because the operator is standing too close to the problem.
        </p>
      </Section>

      <Section title="Logic — Defining the Reality Precisely">
        <p>
          Logic removes emotion.
        </p>
        <p>
          This step asks:
        </p>
        <DoctrineList items={[
          "What are the facts?",
          "What data is missing?",
          "What assumptions am I making?",
          "What are the actual options?"
        ]} />
        <p>
          Logic narrows the field.
        </p>
        <p>
          It replaces anxiety with clarity.
        </p>
        <p className="body-text-emphasis">
          If you cannot explain the problem clearly, you are not ready to decide.
        </p>
      </Section>

      <Section title="Pressure — Decisive, Responsible Action">
        <p>
          Pressure is where most entrepreneurs hesitate.
        </p>
        <p>
          Pressure is not aggression.<br />
          It is ownership.
        </p>
        <p>
          Pressure asks:
        </p>
        <DoctrineList items={[
          "What must be decided now?",
          "What decision creates momentum?",
          "What am I avoiding?"
        ]} />
        <p>
          Pressure converts clarity into motion.
        </p>
        <p>
          Avoiding pressure does not reduce risk.<br />
          It transfers risk into the future — where it grows.
        </p>
      </Section>

      <Parable id="parable-fork-in-road" title="The Fork in the Road">
        <p>
          Two operators faced the same issue:<br />
          A client refused to acknowledge disruption.
        </p>
        <p>
          One delayed.<br />
          Hoped it resolved itself.<br />
          Absorbed cost.
        </p>
        <p>
          The other applied the matrix.
        </p>
        <p>
          <strong>Altitude:</strong> This was a pattern, not a one-off.<br />
          <strong>Logic:</strong> The contract required notice and schedule impact.<br />
          <strong>Pressure:</strong> Notice issued, work paused, terms clarified.
        </p>
        <p>
          Same situation.<br />
          Different outcome.
        </p>
        <p>
          One subsidized the job.<br />
          The other preserved leverage.
        </p>
        <p className="body-text-emphasis">
          The difference was not courage.
        </p>
        <p className="body-text-emphasis">
          It was process.
        </p>
      </Parable>

      <Section title="The Matrix Eliminates Regret">
        <p>
          Regret comes from knowing you avoided something.
        </p>
        <p>
          The matrix prevents avoidance.
        </p>
        <p>
          Even hard decisions feel clean when they are:
        </p>
        <DoctrineList items={[
          "Thought through",
          "Logically framed",
          "Decisively executed"
        ]} />
        <p>
          You may not like every outcome.<br />
          But you will trust yourself.
        </p>
        <p className="body-text-emphasis">
          That trust is everything.
        </p>
      </Section>

      <Section title="The Operator's Responsibility">
        <p>
          The entrepreneur's job is not to be right every time.
        </p>
        <p className="body-text-emphasis">
          It is to decide cleanly and early.
        </p>
        <p>
          Delegation without a decision framework creates chaos.<br />
          Leadership without clarity creates fear.
        </p>
        <p>
          The matrix creates consistency —<br />
          and consistency creates confidence.
        </p>
      </Section>

      <IdentityParable id="identity-parable-22" title="The Delayer">
        <p>
          He gathered more information.<br />
          Asked for more opinions.<br />
          Waited for certainty.
        </p>
        <p>
          He told himself he was being responsible.
        </p>
        <p className="body-text-emphasis">
          In reality, he was protecting himself from blame.
        </p>
        <p>
          By delaying decisions, he avoided ownership.<br />
          By avoiding ownership, he avoided growth.
        </p>
        <p>
          Pressure does not punish indecision immediately.
        </p>
        <p className="body-text-emphasis">
          It compounds it quietly.
        </p>
        <p>
          The Decision Matrix is not a thinking tool.
        </p>
        <p>
          It is a self-confrontation tool.
        </p>
      </IdentityParable>

      <Section title="Final Truth">
        <p>
          Pressure does not ruin businesses.
        </p>
        <p className="body-text-emphasis">
          Indecision does.
        </p>
        <p>
          Those who master the decision matrix stop reacting to problems<br />
          and start commanding outcomes.
        </p>
        <p>
          This is what separates operators from owners.
        </p>
        <p>
          And owners from leaders.
        </p>
      </Section>

      <div className="chapter-divider" />

      {/* Financial Command Checklist */}
      <div className="py-16">
        <h3 className="section-heading text-center mb-4">The ALP Financial Command Checklist</h3>
        <p className="text-center text-lg opacity-70 font-sans mb-16">Seeing the Business Clearly — Weekly Review</p>
        
        <p className="body-text mb-12 italic text-center max-w-2xl mx-auto">
          If you cannot answer these questions clearly, you do not have financial command.
        </p>

        <div className="space-y-12 max-w-3xl">
          <div>
            <h4 className="subsection-heading">Job-Level Visibility</h4>
            <DoctrineList items={[
              "Do I know planned vs current margin on every active job?",
              "Do I know which jobs are drifting — and why?",
              "Do I know what exposure is unrecoverable vs recoverable?"
            ]} />
          </div>

          <div>
            <h4 className="subsection-heading">Time & Schedule</h4>
            <DoctrineList items={[
              "Are schedules current and respected?",
              "Is critical path clearly identified?",
              "Are delays documented and time-stamped?"
            ]} />
          </div>

          <div>
            <h4 className="subsection-heading">General Conditions</h4>
            <DoctrineList items={[
              "Are general conditions fully carried and defended?",
              "Are supervision and management absorbing disruption?",
              "Is time being protected — or leaking quietly?"
            ]} />
          </div>

          <div>
            <h4 className="subsection-heading">Change & Entitlement</h4>
            <DoctrineList items={[
              "Are changes identified immediately?",
              "Are notices issued early and consistently?",
              "Is change order velocity fast or lagging?"
            ]} />
          </div>

          <div>
            <h4 className="subsection-heading">Cash & Billing</h4>
            <DoctrineList items={[
              "Is billing aligned with progress?",
              "Is cash lag increasing?",
              "Are retainage and receivables controlled?"
            ]} />
          </div>

          <div>
            <h4 className="subsection-heading">People & Decisions</h4>
            <DoctrineList items={[
              "Are decisions being delayed due to discomfort?",
              "Is pressure being applied where clarity exists?",
              "Is the business reacting — or commanding?"
            ]} />
          </div>

          <div className="pt-8 border-t border-chapter-divider">
            <h4 className="subsection-heading">Final Question</h4>
            <p className="body-text-emphasis text-xl">
              If nothing changed for 90 days, would the business be stronger — or weaker?
            </p>
            <p className="body-text mt-4">
              If the answer is unclear, clarity is your next priority.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chapter22;
