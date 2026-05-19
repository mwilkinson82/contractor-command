import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter7: React.FC = () => {
  return (
    <div id="chapter-7" className="chapter-container">
      <ChapterHeader 
        number={7} 
        title="Operations as Margin Protection" 
      />
      
      <Section>
        <p>Most contractors think profit is made in estimating.</p>
        <p>They believe if the numbers are right, the job will be profitable.</p>
        <p>That belief is comforting — and wrong.</p>
        <p>Profit is not made in estimating.</p>
        <p><strong>Profit is protected in operations.</strong></p>
      </Section>

      <Section title="Operations Is Where Margin Lives or Dies">
        <p>Operations is where plans meet reality.</p>
        <p>Labor shows up.<br />
        Materials arrive.<br />
        Space tightens.<br />
        Decisions collide.<br />
        Pressure increases.</p>
        <p>This is where margin is either:</p>
        <DoctrineList items={[
          "Preserved through structure, or",
          "Bled out quietly through disorder"
        ]} />
        <p>Most jobs don't fail dramatically.</p>
        <p><strong>They fail incrementally.</strong></p>
        <p>A little inefficiency.<br />
        A little rework.<br />
        A few delays.<br />
        A few bad days.</p>
        <p>Margin doesn't disappear all at once.</p>
        <p><strong>It leaks.</strong></p>
      </Section>

      <Section title="Selling Construction Is Selling Logistics">
        <p>Clients don't hire contractors to build things.</p>
        <p><strong>They hire them to coordinate complexity.</strong></p>
        <p>Construction is not a craft problem.<br />
        It is a logistics problem.</p>
        <p>Operations manages:</p>
        <DoctrineList items={[
          "Sequence",
          "Access",
          "Space",
          "Time",
          "People",
          "Risk"
        ]} />
        <p>If you execute well, the craft looks easy.<br />
        If you execute poorly, even great craftsmen fail.</p>
        <p><strong>Operations is the execution of the promise made in sales.</strong></p>
      </Section>

      <Section title="Where Margin Actually Dies">
        <p>Margin is rarely lost to labor rates alone.</p>
        <p>It erodes through:</p>
        <DoctrineList items={[
          "Poor sequencing",
          "Trade stacking",
          "Start–stop work",
          "Rework",
          "Decision delays",
          "Lack of access",
          "Uncontrolled changes"
        ]} />
        <p>These are not field problems.</p>
        <p><strong>They are operational leadership failures.</strong></p>
        <p>Crews don't cause chaos.<br />
        They operate inside it.</p>
      </Section>

      <Section title="Start–Stop Work Is Silent Theft">
        <p>Start–stop work is one of the most expensive forces in construction.</p>
        <p>Every stop:</p>
        <DoctrineList items={[
          "Breaks rhythm",
          "Destroys momentum",
          "Increases supervision",
          "Increases frustration",
          "Increases error"
        ]} />
        <p>Crews don't get paid less when they stop.<br />
        Supervision doesn't disappear.<br />
        Time doesn't pause.</p>
        <p>Start–stop work doesn't look dramatic.</p>
        <p><strong>It looks normal.</strong></p>
        <p>And that's why it's deadly.</p>
      </Section>

      <Parable id="parable-crowded-site" title="The Crowded Site">
        <p>A project had plenty of labor.<br />
        Plenty of materials.<br />
        Plenty of effort.</p>
        <p>But no sequence.</p>
        <p>Trades stacked on top of each other.<br />
        Constant interruptions.<br />
        No clear access.</p>
        <p>Everyone worked hard.<br />
        Nothing moved forward.</p>
        <p>By the time leadership noticed the problem, margin was already gone.</p>
        <p>The issue was not effort.</p>
        <p><strong>It was disorder.</strong></p>
      </Parable>

      <Section title="Operations Is Designed — Not Improvised">
        <p>Good operations do not rely on heroics.</p>
        <p>They rely on:</p>
        <DoctrineList items={[
          "Clear sequencing",
          "Defined handoffs",
          "Controlled access",
          "Realistic pacing",
          "Enforced standards"
        ]} />
        <p>When operations rely on people "figuring it out," chaos fills the gap.</p>
        <p><strong>Structure prevents firefighting.<br />
        Firefighting consumes margin.</strong></p>
      </Section>

      <Section title="Field Leadership Is an Extension of the Operator">
        <p>Operations fail when the field and leadership are disconnected.</p>
        <p>If field leaders:</p>
        <DoctrineList items={[
          "Don't understand the plan",
          "Aren't empowered to enforce sequence",
          "Don't have authority to stop disorder"
        ]} />
        <p>Then operations will drift.</p>
        <p>A schedule in the office does not protect margin.</p>
        <p><strong>Execution in the field does.</strong></p>
      </Section>

      <Section title="Small Decisions Compound Faster Than Big Ones">
        <p>Most operators focus on big mistakes.</p>
        <p>But margin is lost through small, repeated decisions:</p>
        <DoctrineList items={[
          "Letting one trade jump ahead",
          "Allowing one incomplete handoff",
          "Ignoring one delay",
          "Accepting one unclear directive"
        ]} />
        <p>Each one seems harmless.</p>
        <p>Together, they collapse profitability.</p>
        <p><strong>Operations discipline is about stopping small leaks before they become floods.</strong></p>
      </Section>

      <Section title="Operations Is Emotional Regulation at Scale">
        <p>Operations is not just physical coordination.</p>
        <p><strong>It is emotional management.</strong></p>
        <p>Disorder creates:</p>
        <DoctrineList items={[
          "Frustration",
          "Blame",
          "Impatience",
          "Shortcuts",
          "Conflict"
        ]} />
        <p>Order creates:</p>
        <DoctrineList items={[
          "Calm",
          "Predictability",
          "Accountability",
          "Focus"
        ]} />
        <p>When the job is calm, people perform better.<br />
        When it's chaotic, even great people fail.</p>
      </Section>

      <Section title="Why Operators Lose Control of Operations">
        <p>Operators lose control when they:</p>
        <DoctrineList items={[
          "Stay too far from execution",
          "Delegate without standards",
          "Avoid conflict in the field",
          'Tolerate disorder to "keep peace"'
        ]} />
        <p>Peace without structure is expensive.</p>
        <p><strong>Operations requires enforced clarity, not popularity.</strong></p>
      </Section>

      <Section title="Operations and Time Are Inseparable">
        <p>Time is the most expensive input on a job.</p>
        <p>Operations that lose time:</p>
        <DoctrineList items={[
          "Increase general conditions",
          "Increase supervision",
          "Increase overhead",
          "Increase financial pressure"
        ]} />
        <p>You don't recover lost time with harder work.</p>
        <p><strong>You recover it with better sequencing and decisions.</strong></p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p><strong>Altitude</strong> lets you see the whole operation, not just today's fire.<br />
        <strong>Logic</strong> forces you to design sequence instead of reacting.<br />
        <strong>Pressure</strong> requires you to enforce standards even when it's uncomfortable.</p>
        <p>Operations collapse when any of these are missing.</p>
      </Section>

      <Section title="Final Truth">
        <p>Most contractors don't lose margin because they estimate poorly.</p>
        <p><strong>They lose it because they allow disorder to compound.</strong></p>
        <p>Operations is not a support function.<br />
        It is margin defense.</p>
        <p>And contractors who treat operations casually<br />
        spend their careers working hard<br />
        <strong>to protect profits that never arrive.</strong></p>
      </Section>
    </div>
  );
};

export default Chapter7;
