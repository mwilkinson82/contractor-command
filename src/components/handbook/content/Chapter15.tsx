import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter15 = () => {
  return (
    <section id="chapter-15" className="chapter-section">
      <ChapterHeader number={15} title="Start–Stop Work and Productivity Loss" />
      
      <p className="body-text">
        Few things destroy profit faster — or more quietly — than start–stop work.
      </p>
      
      <p className="body-text">
        It doesn't show up as a line item.<br />
        It doesn't trigger immediate alarms.<br />
        It doesn't feel catastrophic in the moment.
      </p>
      
      <p className="body-text">
        But it bleeds productivity, morale, schedule, and margin every single time it occurs.
      </p>
      
      <p className="body-text font-semibold">Start–stop work is not a labor problem.</p>
      
      <p className="body-text">It is a leadership and sequencing failure.</p>

      <Section title="What Start–Stop Work Really Is">
        <p className="body-text">Start–stop work happens when crews are forced to:</p>
        
        <DoctrineList items={[
          "Mobilize before prerequisites are ready",
          "Demobilize due to missing information or access",
          "Remobilize later to \"finish up\"",
          "Relearn conditions they already solved once"
        ]} />
        
        <p className="body-text">This creates friction that compounds invisibly.</p>
        
        <p className="body-text">
          The work technically progresses.<br />
          The job technically moves forward.
        </p>
        
        <p className="body-text">But efficiency collapses.</p>
      </Section>

      <Section title="Why Start–Stop Work Is So Dangerous">
        <p className="body-text">Start–stop work attacks productivity from multiple angles at once:</p>
        
        <DoctrineList items={[
          "Loss of momentum",
          "Loss of task familiarity",
          "Loss of crew rhythm",
          "Increased errors and rework",
          "Expanded supervision needs",
          "Increased General Conditions",
          "Morale erosion"
        ]} />
        
        <p className="body-text">None of this shows up immediately.</p>
        
        <p className="body-text font-semibold">It shows up in the final margin.</p>
      </Section>

      <Section title="Productivity Is Fragile">
        <p className="body-text">Productivity is not linear.</p>
        
        <p className="body-text">
          Crews don't perform at the same efficiency every time they touch an activity.
        </p>
        
        <p className="body-text">Productivity improves when:</p>
        
        <DoctrineList items={[
          "Scope is continuous",
          "Access is uninterrupted",
          "Decisions are final",
          "Crews stay mentally and physically engaged"
        ]} />
        
        <p className="body-text">Start–stop work resets that curve.</p>
        
        <p className="body-text font-semibold">Every restart is a step backward.</p>
      </Section>

      <Section title="The Myth of 'We'll Just Come Back'">
        <p className="body-text">This phrase has destroyed more profit than bad estimating.</p>
        
        <p className="body-text font-semibold">"We'll just come back and finish it."</p>
        
        <p className="body-text">Coming back is never neutral.</p>
        
        <p className="body-text">Coming back means:</p>
        
        <DoctrineList items={[
          "New setup",
          "New orientation",
          "New coordination",
          "New risk",
          "New supervision"
        ]} />
        
        <p className="body-text">The job pays for that friction — whether it's priced or not.</p>
      </Section>

      <Parable id="parable-interrupted-trade" title="The Interrupted Trade">
        <p className="body-text">A trade was started before preceding work was complete.</p>
        
        <p className="body-text">
          They worked around obstacles.<br />
          Installed partial scope.<br />
          Left.
        </p>
        
        <p className="body-text">Weeks later, they returned.</p>
        
        <p className="body-text">
          Different crew.<br />
          Different site conditions.<br />
          Different constraints.
        </p>
        
        <p className="body-text">
          Productivity was half.<br />
          Errors increased.<br />
          Supervision doubled.
        </p>
        
        <p className="body-text">The estimate was fine.</p>
        
        <p className="body-text font-semibold">The execution was broken by interruption.</p>
      </Parable>

      <Section title="Start–Stop Work Is a Scheduling Failure">
        <p className="body-text">Start–stop work does not happen randomly.</p>
        
        <p className="body-text">It happens when:</p>
        
        <DoctrineList items={[
          "Sequence is ignored",
          "Prerequisites are not enforced",
          "Access is granted prematurely",
          "Decisions lag",
          "The schedule is treated as flexible"
        ]} />
        
        <p className="body-text">This is not bad luck.</p>
        
        <p className="body-text font-semibold">It is weak time control.</p>
      </Section>

      <Section title="Why Contractors Tolerate It">
        <p className="body-text">Contractors tolerate start–stop work because it feels cooperative.</p>
        
        <p className="body-text">They want to:</p>
        
        <DoctrineList items={[
          "Be flexible",
          "Keep trades \"busy\"",
          "Avoid confrontation",
          "Keep owners happy",
          "Maintain momentum"
        ]} />
        
        <p className="body-text font-semibold">But busyness is not progress.</p>
        
        <p className="body-text">And flexibility without control is chaos.</p>
      </Section>

      <Section title="Start–Stop Work Expands General Conditions Automatically">
        <p className="body-text">Every interruption extends:</p>
        
        <DoctrineList items={[
          "Supervision",
          "Management involvement",
          "Site presence",
          "Temporary facilities",
          "Administrative overhead"
        ]} />
        
        <p className="body-text">
          No argument.<br />
          No negotiation.
        </p>
        
        <p className="body-text">Time expands — and GC's expand with it.</p>
        
        <p className="body-text">
          This is why start–stop work is a financial event, not just an operational one.
        </p>
      </Section>

      <Section title="Why Productivity Loss Is Rarely Recovered">
        <p className="body-text">Most contractors fail to recover productivity loss because:</p>
        
        <DoctrineList items={[
          "They don't document interruptions clearly",
          "They don't tie disruption to measurable impact",
          "They don't update schedules to reflect resequencing",
          "They don't issue notice early",
          "They normalize inefficiency instead of flagging it"
        ]} />
        
        <p className="body-text">Owners don't pay for "harder work."</p>
        
        <p className="body-text font-semibold">They pay for demonstrated disruption.</p>
      </Section>

      <Section title="Documentation Is the Only Defense">
        <p className="body-text">Every start–stop event should trigger immediate action:</p>
        
        <DoctrineList items={[
          "Field documentation",
          "Schedule analysis",
          "Notice consideration",
          "Cost impact tracking"
        ]} />
        
        <p className="body-text">If interruption is not recorded, it is assumed to be normal.</p>
        
        <p className="body-text font-semibold">And normal inefficiency is never compensated.</p>
      </Section>

      <Section title="Start–Stop Work Is a Leadership Choice">
        <p className="body-text">This is the uncomfortable truth:</p>
        
        <p className="body-text font-semibold">
          Start–stop work persists because leadership allows it.
        </p>
        
        <p className="body-text">Strong operators:</p>
        
        <DoctrineList items={[
          "Enforce prerequisites",
          "Protect sequence",
          "Delay starts until work can flow",
          "Accept short-term discomfort to protect long-term margin"
        ]} />
        
        <p className="body-text">Weak operators trade control for peace.</p>
        
        <p className="body-text">The bill comes later.</p>
      </Section>

      <Section title="The Operator's Responsibility">
        <p className="body-text">The operator must decide:</p>
        
        <p className="body-text">
          Do we start work to appear cooperative —<br />
          or do we start work when it can be done productively?
        </p>
        
        <p className="body-text">Those are not the same thing.</p>
        
        <p className="body-text">Every premature start is a hidden concession.</p>
        
        <p className="body-text font-semibold">And concessions compound.</p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p className="body-text">
          <strong>Altitude</strong> allows you to see interruption as systemic damage, not inconvenience.<br />
          <strong>Logic</strong> connects start–stop work to productivity loss and GC expansion.<br />
          <strong>Pressure</strong> requires you to say "not yet" — even when others push.
        </p>
        
        <p className="body-text">Remove any one — and inefficiency becomes normal.</p>
      </Section>

      <Section title="Final Truth">
        <p className="body-text font-semibold">
          Most contractors don't lose money because crews worked slowly.
        </p>
        
        <p className="body-text">
          They lose money because crews were forced to restart work that should have flowed.
        </p>
        
        <p className="body-text">Start–stop work is not a cost of doing business.</p>
        
        <p className="body-text font-semibold">It is a failure of sequencing, enforcement, and leadership.</p>
        
        <p className="body-text">
          Protect flow.<br />
          Protect productivity.<br />
          Protect time.
        </p>
        
        <p className="body-text font-semibold">Or watch margin die quietly — one restart at a time.</p>
      </Section>
    </section>
  );
};

export default Chapter15;
