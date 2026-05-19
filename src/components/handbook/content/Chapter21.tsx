import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';

import IdentityParable from '../IdentityParable';

const Chapter21: React.FC = () => {
  return (
    <div id="chapter-21" className="py-24 border-t border-chapter-divider">
      <ChapterHeader 
        number={21} 
        title="Financial Authority at Scale" 
      />

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most contractors believe they understand their finances.
        </p>
        <p>
          They know revenue.<br />
          They know payroll.<br />
          They know whether the bank balance feels tight or loose.
        </p>
        <p>
          That is not financial command.
        </p>
        <p className="body-text-emphasis">
          That is financial awareness — and awareness is not control.
        </p>
        <p>
          Businesses do not fail because owners don't work hard.<br />
          They fail because owners <strong>cannot see clearly enough to decide early</strong>.
        </p>
        <p className="body-text-emphasis">
          Financial command is the ability to see reality before it becomes pain.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="Revenue Is Not Control">
        <p>
          Revenue is noise.
        </p>
        <p>
          It creates confidence when it rises.<br />
          It creates panic when it falls.
        </p>
        <p>
          But revenue alone tells you nothing about:
        </p>
        <DoctrineList items={[
          "Risk",
          "Margin erosion",
          "Cash exposure",
          "Future instability"
        ]} />
        <p>
          Many contractors go bankrupt on record revenue.
        </p>
        <p>
          Not because they were unlucky —<br />
          but because they were blind.
        </p>
      </Section>

      <Section title="What Financial Command Actually Means">
        <p>
          Financial command is knowing:
        </p>
        <DoctrineList items={[
          "Where money is made",
          "Where money is lost",
          "Where money is at risk",
          "And where money will be in the future"
        ]} />
        <p>
          It is proactive, not reactive.
        </p>
        <p>
          It allows the entrepreneur to:
        </p>
        <DoctrineList items={[
          "Decide early",
          "Correct quickly",
          "Apply pressure intentionally",
          "Avoid emotional decision-making"
        ]} />
        <p>
          Without command, every decision feels urgent.<br />
          With command, urgency disappears.
        </p>
      </Section>

      <Parable id="parable-profitable-company-collapsed" title="The Profitable Company That Collapsed">
        <p>
          A contractor was growing fast.
        </p>
        <p>
          Revenue doubled in three years.<br />
          The backlog looked strong.<br />
          The market respected them.
        </p>
        <p>
          Then one job slipped.<br />
          Then another.<br />
          Then cash tightened.
        </p>
        <p>
          By the time the owner realized there was a problem, the problem was already fatal.
        </p>
        <p>
          The issue wasn't bad jobs.<br />
          It wasn't theft.<br />
          It wasn't fraud.
        </p>
        <p className="body-text-emphasis">
          It was lack of visibility.
        </p>
        <p>
          No one could see margin erosion early.<br />
          No one could see cash lag building.<br />
          No one could see exposure stacking.
        </p>
        <p>
          The company didn't collapse suddenly.
        </p>
        <p>
          It <strong>ran out of time to react</strong>.
        </p>
      </Parable>

      <Section title="Cash Flow Is a Lagging Indicator">
        <p>
          Cash problems feel sudden.
        </p>
        <p>
          They are not.
        </p>
        <p>
          Cash reflects decisions made months earlier:
        </p>
        <DoctrineList items={[
          "Under-carried general conditions",
          "Unpriced disruption",
          "Slow change orders",
          "Poor billing discipline",
          "Loose scheduling"
        ]} />
        <p>
          When cash becomes the problem, it is already late.
        </p>
        <p className="body-text-emphasis">
          Financial command moves the lens upstream —<br />
          to where correction is still possible.
        </p>
      </Section>

      

      <Section title="Job-Level Visibility Is Non-Negotiable">
        <p>
          Financial command does not live in company-wide summaries.
        </p>
        <p>
          It lives at the job level.
        </p>
        <p>
          Every job must answer:
        </p>
        <DoctrineList items={[
          "What was the planned margin?",
          "What is the current margin?",
          "What has changed?",
          "What is at risk?",
          "What is recoverable?"
        ]} />
        <p>
          If you cannot answer these questions in real time,<br />
          you do not control the business.
        </p>
        <p className="body-text-emphasis">
          You are reacting to it.
        </p>
      </Section>

      <Section title="Cost Coding Is Not Accounting — It Is Intelligence">
        <p>
          Cost codes are not bookkeeping.
        </p>
        <p className="body-text-emphasis">
          They are diagnostic tools.
        </p>
        <p>
          They reveal:
        </p>
        <DoctrineList items={[
          "Where inefficiency is occurring",
          "Where labor is drifting",
          "Where supervision is absorbing disruption",
          "Where margin is leaking quietly"
        ]} />
        <p>
          Poor cost coding hides problems.<br />
          Strong cost coding exposes them early.
        </p>
        <p>
          Early exposure creates options.<br />
          Late discovery creates panic.
        </p>
      </Section>

      <Section title="Financial Command Eliminates Emotional Decisions">
        <p>
          When visibility is weak, decisions become emotional:
        </p>
        <DoctrineList items={[
          "Chasing bad work to fill gaps",
          "Cutting pricing to keep crews busy",
          "Accepting risk you don't understand",
          "Avoiding necessary confrontation"
        ]} />
        <p className="body-text-emphasis">
          Clarity removes emotion.
        </p>
        <p>
          When you can see:
        </p>
        <DoctrineList items={[
          "Exposure",
          "Timing",
          "Margin",
          "Leverage"
        ]} />
        <p>
          Decisions become calm and deliberate.
        </p>
        <p className="body-text-emphasis">
          That calm is power.
        </p>
      </Section>

      <Section title="The Owner's Real Financial Role">
        <p>
          The entrepreneur is not the bookkeeper.<br />
          The entrepreneur is not the accountant.
        </p>
        <p className="body-text-emphasis">
          The entrepreneur is the commander.
        </p>
        <p>
          That means:
        </p>
        <DoctrineList items={[
          "Demanding clear reporting",
          "Reviewing it consistently",
          "Asking uncomfortable questions",
          "Acting before problems grow teeth"
        ]} />
        <p>
          Delegation without visibility is abdication.
        </p>
      </Section>

      <Section title="Financial Command and the Scaling Stool">
        <p>
          Financial command stabilizes every leg of the stool.
        </p>
        <p>
          It:
        </p>
        <DoctrineList items={[
          "Informs marketing spend",
          "Sharpens sales discipline",
          "Exposes operational drift",
          "Reveals people inefficiencies",
          "Prevents surprise collapse"
        ]} />
        <p>
          Without financial command, the stool stands — until it doesn't.
        </p>
      </Section>

      <Parable id="parable-calm-operator-21" title="The Calm Operator">
        <p>
          Two owners faced the same problem:<br />
          A major job fell behind schedule.
        </p>
        <p>
          One panicked.<br />
          Cut costs blindly.<br />
          Pressed crews.<br />
          Damaged morale.
        </p>
        <p>
          The other reviewed the numbers.<br />
          Saw where exposure was contained.<br />
          Issued notices.<br />
          Adjusted billing.<br />
          Applied pressure precisely.
        </p>
        <p>
          Same problem.<br />
          Different outcome.
        </p>
        <p>
          The difference wasn't intelligence.
        </p>
        <p className="body-text-emphasis">
          It was clarity.
        </p>
      </Parable>

      <IdentityParable id="identity-parable-21" title="The Owner Who Avoided the Numbers">
        <p>
          He said:<br />
          "I'm not a numbers guy."<br />
          "I trust my accountant."<br />
          "I just build."
        </p>
        <p>
          But the truth was discomfort.
        </p>
        <p>
          Numbers made him feel exposed.<br />
          Numbers forced accountability.<br />
          Numbers removed plausible deniability.
        </p>
        <p className="body-text-emphasis">
          So he stayed busy instead.
        </p>
        <p>
          Revenue rose.<br />
          Stress rose faster.<br />
          Clarity never arrived.
        </p>
        <p className="body-text-emphasis">
          Avoiding numbers is not humility.
        </p>
        <p>
          It is identity avoidance.
        </p>
        <p>
          Those who refuse to look cannot lead.
        </p>
      </IdentityParable>

      <Section title="Final Truth">
        <p>
          You cannot control what you cannot see.
        </p>
        <p className="body-text-emphasis">
          Financial command is not about fear.<br />
          It is about freedom.
        </p>
        <p>
          Freedom to:
        </p>
        <DoctrineList items={[
          "Say no",
          "Wait",
          "Apply pressure",
          "Protect margin",
          "Scale deliberately"
        ]} />
        <p>
          Entrepreneurs who see clearly move early.<br />
          Those who don't spend their careers reacting late.
        </p>
        <p className="body-text-emphasis">
          Financial command is the difference.
        </p>
      </Section>
    </div>
  );
};

export default Chapter21;
