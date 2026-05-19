import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';

import IdentityParable from '../IdentityParable';

const Chapter17: React.FC = () => {
  return (
    <div id="chapter-17" className="pt-4 pb-12">
      <h3 className="section-heading mt-4 mb-8">General Conditions as a Profit Center</h3>


      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most contractors misunderstand general conditions.
        </p>
        <p>
          They treat them as overhead.<br />
          They minimize them to win work.<br />
          They under-carry them to stay competitive.
        </p>
        <p>
          And then they wonder why profitable jobs quietly fail.
        </p>
        <p>
          General conditions are not a burden on the job.
        </p>
        <p className="body-text-emphasis">
          They are the control system of the job.
        </p>
        <p>
          When general conditions are weak, profit erodes invisibly — regardless of how good the estimate looks on paper.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="What General Conditions Actually Are">
        <p>
          General conditions are the resources required to <strong>control time, coordination, and execution</strong>.
        </p>
        <p>
          They include:
        </p>
        <DoctrineList items={[
          "Supervision",
          "Project management",
          "Scheduling",
          "Site logistics",
          "Safety",
          "Temporary facilities",
          "Testing and inspections",
          "Professional fees",
          "Documentation",
          "Communication infrastructure"
        ]} />
        <p>
          These are not extras.
        </p>
        <p className="body-text-emphasis">
          They are the systems that prevent chaos.
        </p>
      </Section>

      <Section title="Why Contractors Underestimate General Conditions">
        <p>
          Contractors under-carry general conditions for three reasons:
        </p>
        <DoctrineList items={[
          "Fear of being uncompetitive",
          "Pressure to hit a number",
          "Misunderstanding where profit is actually lost"
        ]} />
        <p>
          General conditions are the first thing cut during estimating — and the first thing desperately needed during execution.
        </p>
        <p className="body-text-emphasis">
          That contradiction alone should tell you something.
        </p>
      </Section>

      <Section title="Time Is the Real Currency of the Job">
        <p>
          Labor, materials, and equipment are easy to see.
        </p>
        <p>
          Time is not.
        </p>
        <p className="body-text-emphasis">
          General conditions exist to protect time.
        </p>
        <p>
          Every day a job drags:
        </p>
        <DoctrineList items={[
          "Supervision costs increase",
          "Management hours stack",
          "Temporary facilities remain",
          "Cash flow stretches",
          "Morale degrades"
        ]} />
        <p>
          Time overruns do not announce themselves loudly.
        </p>
        <p>
          They accumulate quietly — until margin disappears.
        </p>
      </Section>

      

      <Section title="Separation of Men and the Cost of Disorder">
        <p>
          One of the clearest indicators of weak general conditions is poor separation of men.
        </p>
        <p>
          When crews:
        </p>
        <DoctrineList items={[
          "Interfere with one another",
          "Compete for space",
          "Wait for access",
          "Rework completed areas"
        ]} />
        <p>
          You are paying twice for the same work.
        </p>
        <p>
          Strong general conditions enforce separation:
        </p>
        <DoctrineList items={[
          "Clear work zones",
          "Defined sequencing",
          "Controlled access",
          "Coordinated trades"
        ]} />
        <p>
          Order is not aesthetic.
        </p>
        <p className="body-text-emphasis">
          Order is financial discipline.
        </p>
      </Section>

      <Section title="Start–Stop Work Is a General Conditions Failure">
        <p>
          Start–stop work is rarely a labor issue.
        </p>
        <p>
          It is almost always a general conditions failure.
        </p>
        <p>
          When materials are late, drawings unclear, or sequencing loose, crews stop — and momentum dies.
        </p>
        <p>
          Every stop:
        </p>
        <DoctrineList items={[
          "Breaks rhythm",
          "Lowers morale",
          "Reduces output",
          "Increases supervision time"
        ]} />
        <p>
          You cannot "push" productivity back into a broken system.
        </p>
        <p className="body-text-emphasis">
          You must remove the friction.
        </p>
      </Section>

      <Section title="Why GC Costs Create Profit">
        <p>
          Here is the truth most contractors never internalize:
        </p>
        <p className="body-text-emphasis">
          Strong general conditions make money.
        </p>
        <p>
          They do this by:
        </p>
        <DoctrineList items={[
          "Preventing inefficiency",
          "Maintaining flow",
          "Preserving schedule",
          "Supporting change order entitlement",
          "Protecting cash flow"
        ]} />
        <p>
          Weak general conditions save money only on bid day.
        </p>
        <p>
          They lose it every day afterward.
        </p>
      </Section>

      <Section title="General Conditions and Change Orders">
        <p>
          General conditions are a prerequisite for change order velocity.
        </p>
        <p>
          If you lack:
        </p>
        <DoctrineList items={[
          "Documentation",
          "Schedules",
          "Logs",
          "Communication structure"
        ]} />
        <p>
          You cannot prove impact.
        </p>
        <p>
          And if you cannot prove impact, you cannot monetize change.
        </p>
        <p>
          Change orders are not created in the field.
        </p>
        <p className="body-text-emphasis">
          They are created in the systems that capture disruption.
        </p>
      </Section>

      <Section title='The Illusion of "Good Jobs"'>
        <p>
          Many contractors say:<br />
          "The job went well, but we didn't make what we thought."
        </p>
        <p>
          That usually means:
        </p>
        <DoctrineList items={[
          "General conditions were underfunded",
          "Time stretched",
          "Supervision absorbed disruption",
          "Margin paid the price"
        ]} />
        <p>
          The job didn't fail.
        </p>
        <p className="body-text-emphasis">
          The control system did.
        </p>
      </Section>

      <Section title="The Operator's Responsibility">
        <p>
          The entrepreneur must protect general conditions.
        </p>
        <p>
          Not emotionally.<br />
          Not defensively.<br />
          Strategically.
        </p>
        <p>
          That means:
        </p>
        <DoctrineList items={[
          "Carrying them properly",
          "Defending them during negotiation",
          "Monitoring them during execution",
          "Adjusting when scope or schedule changes"
        ]} />
        <p className="body-text-emphasis">
          If you do not fight for control, you will pay for chaos.
        </p>
      </Section>

      <Section title="Bringing It Back to the Stool">
        <p>
          General conditions sit at the intersection of:
        </p>
        <DoctrineList items={[
          "Operations",
          "Financial Command",
          "Sales discipline"
        ]} />
        <p>
          Weak general conditions destabilize the stool.
        </p>
        <p className="body-text-emphasis">
          Strong general conditions reinforce every leg.
        </p>
      </Section>

      <Parable id="parable-job-looked-profitable" title="The Job That Looked Profitable">
        <p>
          Two contractors bid the same project.
        </p>
        <p>
          Both won work.<br />
          Both had similar labor rates.<br />
          Both had similar material pricing.<br />
          Both were competent builders.
        </p>
        <p>
          Six months in, one was profitable.<br />
          The other was exhausted and angry.
        </p>
        <p>
          The difference wasn't effort.<br />
          It wasn't intelligence.<br />
          It wasn't luck.
        </p>
        <p className="body-text-emphasis">
          It was general conditions.
        </p>
        <p>
          The losing contractor cut supervision to win the job.<br />
          Reduced project management.<br />
          Assumed they could "stay on top of it."
        </p>
        <p>
          They were always on site.<br />
          Always fixing issues.<br />
          Always answering questions.<br />
          Always absorbing disruption.
        </p>
        <p>
          The job looked fine in the estimate.<br />
          It died slowly in execution.
        </p>
        <p>
          The winning contractor carried full general conditions.<br />
          Clear supervision.<br />
          Clear scheduling.<br />
          Clear control.
        </p>
        <p>
          They didn't work harder.<br />
          They worked calmer.
        </p>
        <p>
          Profit didn't come from pushing labor.<br />
          It came from <strong>preventing chaos</strong>.
        </p>
        <p>
          General conditions didn't cost them money.<br />
          They <strong>made them money</strong>.
        </p>
      </Parable>

      <IdentityParable id="identity-parable-17" title="The Owner Who Had to Be Needed">
        <p>
          A contractor insisted on being everywhere.
        </p>
        <p>
          He answered every call.<br />
          Solved every problem.<br />
          Made every decision.
        </p>
        <p>
          He told himself this was leadership.
        </p>
        <p className="body-text-emphasis">
          In reality, it was identity.
        </p>
        <p>
          He needed to be needed.<br />
          He needed to feel indispensable.<br />
          He needed validation through exhaustion.
        </p>
        <p>
          General conditions were underfunded.<br />
          Supervision was thin.<br />
          Systems never matured.
        </p>
        <p>
          The business did not fail because of construction.<br />
          It stalled because the owner's identity required chaos.
        </p>
        <p className="body-text-emphasis">
          When identity is tied to heroics, control is impossible.
        </p>
        <p>
          True leadership is not being needed.
        </p>
        <p className="body-text-emphasis">
          It is being replaceable without losing authority.
        </p>
      </IdentityParable>

      <Section title="Final Truth">
        <p>
          Profit is not made by pushing harder.
        </p>
        <p className="body-text-emphasis">
          It is made by controlling time, flow, and order.
        </p>
        <p>
          General conditions are not overhead.
        </p>
        <p>
          They are the profit center that separates professional operators from exhausted ones.
        </p>
        <p>
          Those who understand this stop leaking margin.
        </p>
        <p>
          Those who don't keep wondering where it went.
        </p>
      </Section>
    </div>
  );
};

export default Chapter17;
