import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';
import IdentityParable from '../IdentityParable';

const Chapter19: React.FC = () => {
  return (
    <div id="chapter-19" className="py-24 border-t border-chapter-divider">
      <ChapterHeader 
        number={19} 
        title="Change Order Velocity and Monetizing Disruption" 
      />

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most contractors experience change.
        </p>
        <p className="body-text-emphasis">
          Few contractors monetize it well.
        </p>
        <p>
          That difference is not intelligence.<br />
          It is not aggression.<br />
          It is not luck.
        </p>
        <p className="body-text-emphasis">
          It is velocity.
        </p>
        <p>
          Change orders are not lost because disruption didn't occur.<br />
          They are lost because the contractor moved too slowly — or not at all.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="Disruption Is Not the Problem">
        <p>
          Disruption is inevitable.
        </p>
        <p>
          Every project experiences:
        </p>
        <DoctrineList items={[
          "Design changes",
          "Scope clarifications",
          "Resequencing",
          "Delays",
          "Interference",
          "Access issues"
        ]} />
        <p>
          These are not exceptions.
        </p>
        <p>
          They are normal conditions of construction.
        </p>
        <p>
          The mistake contractors make is treating disruption as something to "push through" instead of something to <strong>capture and convert</strong>.
        </p>
      </Section>

      <Section title="What Change Order Velocity Really Means">
        <p>
          Change order velocity is the speed at which disruption is:
        </p>
        <DoctrineList items={[
          "Identified",
          "Documented",
          "Priced",
          "Submitted",
          "Resolved"
        ]} />
        <p>
          The faster this cycle moves, the more leverage the contractor retains.
        </p>
        <p>
          The slower it moves, the more leverage shifts to the owner.
        </p>
        <p>
          Delay does not create goodwill.<br />
          Delay creates dispute.
        </p>
      </Section>

      <Section title="Why Contractors Lose Change Orders">
        <p>
          Contractors lose change orders for predictable reasons:
        </p>
        <DoctrineList items={[
          "They wait too long to document",
          "They continue working without direction",
          'They absorb disruption "to keep things moving"',
          "They lack schedule proof",
          "They rely on memory instead of records"
        ]} />
        <p>
          By the time the change is submitted, the job has moved on — and so has the owner's willingness to pay.
        </p>
      </Section>

      <Section title="Work First, Argue Later Is a Losing Strategy">
        <p>
          Many contractors operate under an unspoken rule:<br />
          "Just do the work and we'll figure it out later."
        </p>
        <p>
          This feels cooperative.<br />
          It feels professional.<br />
          It feels necessary in the moment.
        </p>
        <p className="body-text-emphasis">
          It is also how entitlement disappears.
        </p>
        <p>
          Once work is performed:
        </p>
        <DoctrineList items={[
          "Urgency drops",
          "Leverage fades",
          "Disruption becomes invisible",
          "Memory replaces proof"
        ]} />
        <p>
          Owners pay for <strong>impact</strong>, not effort.
        </p>
        <p>
          If the impact is not captured in real time, it becomes negotiable — or deniable.
        </p>
      </Section>

      <Section title="Documentation Is the Engine of Velocity">
        <p>
          Change order velocity is impossible without documentation.
        </p>
        <p>
          At minimum, this includes:
        </p>
        <DoctrineList items={[
          "Daily reports",
          "Schedule updates",
          "Photos",
          "Logs",
          "Correspondence"
        ]} />
        <p>
          Documentation is not bureaucracy.
        </p>
        <p className="body-text-emphasis">
          It is how disruption is transformed into entitlement.
        </p>
        <p>
          Without it, every change becomes an argument.<br />
          With it, changes become transactions.
        </p>
      </Section>

      <Section title="The Role of the Schedule in Change Orders">
        <p>
          Schedules give context to disruption.
        </p>
        <p>
          They show:
        </p>
        <DoctrineList items={[
          "What was planned",
          "What changed",
          "Where the critical path was impacted",
          "How time was extended"
        ]} />
        <p>
          Without schedule impact, change orders are reduced to opinions about inconvenience.
        </p>
        <p className="body-text-emphasis">
          With schedule impact, they become claims of time and cost.
        </p>
        <p>
          Time is where money lives.
        </p>
      </Section>

      <Section title="Velocity Protects Relationships">
        <p>
          Slow change order processes create tension.
        </p>
        <p>
          Owners feel blindsided.<br />
          Contractors feel exploited.<br />
          Trust erodes.
        </p>
        <p>
          Fast, clean change management:
        </p>
        <DoctrineList items={[
          "Reduces emotion",
          "Creates clarity",
          "Preserves professionalism",
          "Maintains momentum"
        ]} />
        <p>
          Velocity is not aggressive.
        </p>
        <p className="body-text-emphasis">
          It is respectful.
        </p>
      </Section>

      <Section title="Change Orders as a System, Not an Event">
        <p>
          Top-tier contractors do not treat change orders as isolated incidents.
        </p>
        <p>
          They treat them as a <strong>system</strong>.
        </p>
        <p>
          That system answers:
        </p>
        <DoctrineList items={[
          "Who identifies change?",
          "Who documents it?",
          "Who prices it?",
          "Who submits it?",
          "Who tracks resolution?"
        ]} />
        <p>
          When this system is unclear, velocity collapses.
        </p>
        <p>
          When it is clear, disruption becomes manageable — and profitable.
        </p>
      </Section>

      <Section title="Why Owners Respect Fast Contractors">
        <p>
          Owners do not like surprises.<br />
          They also do not like ambiguity.
        </p>
        <p>
          Contractors who surface change early:
        </p>
        <DoctrineList items={[
          "Appear organized",
          "Appear controlled",
          "Appear trustworthy"
        ]} />
        <p>
          Contractors who wait:
        </p>
        <DoctrineList items={[
          "Appear disorganized",
          "Appear reactive",
          "Appear desperate"
        ]} />
        <p className="body-text-emphasis">
          Velocity signals competence.
        </p>
      </Section>

      <Section title="Bringing It Back to the Stool">
        <p>
          Change order velocity sits at the intersection of:
        </p>
        <DoctrineList items={[
          "Operations",
          "Scheduling",
          "General conditions",
          "Financial command",
          "Sales discipline"
        ]} />
        <p>
          Weak velocity destabilizes the stool.
        </p>
        <p className="body-text-emphasis">
          Strong velocity reinforces control across the business.
        </p>
      </Section>

      <Section title="The Operator's Responsibility">
        <p>
          The entrepreneur must design the change system.
        </p>
        <p>
          Not personally chase every change —<br />
          but ensure the system exists and is enforced.
        </p>
        <p>
          That means:
        </p>
        <DoctrineList items={[
          "Clear triggers",
          "Clear documentation standards",
          "Clear timelines",
          "Clear authority"
        ]} />
        <p>
          If disruption is unmanaged, margin will absorb it.
        </p>
      </Section>

      <Parable id="parable-change-order-died" title="The Change Order That Died Quietly">
        <p>
          A design conflict stopped work for half a day.
        </p>
        <p>
          The superintendent adjusted.<br />
          Crews shifted tasks.<br />
          Everyone stayed "productive."
        </p>
        <p>
          No notice was issued.<br />
          No documentation captured impact.<br />
          The schedule wasn't updated.
        </p>
        <p>
          Weeks later, the contractor submitted a change order.
        </p>
        <p>
          The owner responded calmly:<br />
          "You worked through it."
        </p>
        <p>
          And that was the end of it.
        </p>
        <p>
          The disruption was real.<br />
          The cost was real.<br />
          But the moment had passed.
        </p>
        <p className="body-text-emphasis">
          Velocity was lost.
        </p>
        <p>
          Change orders don't die in rejection.<br />
          They die in <strong>delay</strong>.
        </p>
        <p>
          By the time many contractors speak up, the project has already moved on — and so has entitlement.
        </p>
      </Parable>

      <IdentityParable id="identity-parable-19" title="The Nice Contractor">
        <p>
          Everyone liked him.
        </p>
        <p>
          He was agreeable.<br />
          Flexible.<br />
          Understanding.
        </p>
        <p>
          He didn't issue notices.<br />
          Didn't push change orders.<br />
          Didn't want to "rock the boat."
        </p>
        <p>
          He believed being liked would protect him.
        </p>
        <p className="body-text-emphasis">
          It didn't.
        </p>
        <p>
          Costs piled up.<br />
          Scope blurred.<br />
          Disruption went unpaid.
        </p>
        <p>
          By the end of the job, the relationship he tried to protect no longer mattered.
        </p>
        <p className="body-text-emphasis">
          Niceness without boundaries is not professionalism.
        </p>
        <p>
          It is fear of disapproval.
        </p>
        <p>
          Velocity requires identity strong enough to tolerate tension.
        </p>
      </IdentityParable>

      <Section title="Final Truth">
        <p>
          Disruption is not optional in construction.
        </p>
        <p className="body-text-emphasis">
          Profit from disruption is.
        </p>
        <p>
          Those who move slowly subsidize the project.
        </p>
        <p>
          Those who move with velocity get paid for reality.
        </p>
        <p>
          Change does not kill margin.
        </p>
        <p className="body-text-emphasis">
          Delay does.
        </p>
      </Section>
    </div>
  );
};

export default Chapter19;
