import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter25: React.FC = () => {
  return (
    <div id="chapter-25" className="chapter-container">
      <ChapterHeader 
        number={24} 
        title="Scaling Without Losing Control" 
      />
      
      <Section>
        <p>Most contractors do not fail early.</p>
        <p>They fail <strong>after growth begins</strong>.</p>
        <p>Revenue increases.<br />
        Backlog grows.<br />
        Headcount expands.<br />
        Work accelerates.</p>
        <p>And control quietly erodes.</p>
        <p>This chapter exists to explain why that happens — and how ALP prevents it.</p>
      </Section>

      <Section title="Growth Is Not Scale">
        <p><strong>Growth</strong> is volume.</p>
        <p><strong>Scale</strong> is control at volume.</p>
        <p>Many businesses grow.<br />
        Very few scale.</p>
        <p>Growth without control:</p>
        <DoctrineList items={[
          "Increases stress",
          "Magnifies mistakes",
          "Exposes weak systems",
          "Accelerates burnout"
        ]} />
        <p>Scale absorbs volume without losing clarity.</p>
        <p>ALP is a scaling doctrine, not a growth hack.</p>
      </Section>

      <Section title="Why Businesses Break During Growth">
        <p>Growth introduces three forces simultaneously:</p>
        <DoctrineList items={[
          "Speed — decisions must be made faster",
          "Distance — the operator is further from the work",
          "Complexity — more people, jobs, variables"
        ]} />
        <p>If control systems are not already in place, growth overwhelms the operator.</p>
        <p>The business does not collapse because it is too big.</p>
        <p><strong>It collapses because command did not scale with size.</strong></p>
      </Section>

      <Section title="The Myth of 'We'll Fix It Later'">
        <p>Many operators postpone discipline until after growth stabilizes.</p>
        <p>This is backwards.</p>
        <p>You cannot retrofit control easily.<br />
        You must install it early.</p>
        <p>Deferred discipline compounds:</p>
        <DoctrineList items={[
          "Weak sales terms become systemic losses",
          "Poor scheduling multiplies disruption",
          "Inconsistent documentation kills entitlement",
          "Financial blindness grows with revenue"
        ]} />
        <p>Later never comes.<br />
        Pressure always does.</p>
      </Section>

      <Section title="Scaling the Operator First">
        <p>The constraint in scaling is not the business.</p>
        <p><strong>It is the operator.</strong></p>
        <p>If the entrepreneur:</p>
        <DoctrineList items={[
          "Avoids decisions",
          "Seeks approval",
          "Hesitates under pressure",
          "Relies on instinct",
          "Resists structure"
        ]} />
        <p>The business cannot scale beyond them.</p>
        <p>ALP requires the operator to grow <em>ahead</em> of the business, not behind it.</p>
      </Section>

      <Section title="Control Must Precede Delegation">
        <p>Delegation without control creates chaos.</p>
        <p>Before handing work off, the operator must ensure:</p>
        <DoctrineList items={[
          "Standards are defined",
          "Systems are documented",
          "Authority is clear",
          "Accountability is enforced",
          "Financial visibility exists"
        ]} />
        <p>You cannot delegate responsibility without first establishing command structure.</p>
        <p>Otherwise, you are not scaling.<br />
        You are dispersing risk.</p>
      </Section>

      <Parable id="parable-expanding-circle" title="The Expanding Circle">
        <p>An owner grew from two jobs to twelve.</p>
        <p>Revenue tripled.<br />
        So did problems.</p>
        <p>He hired more people.<br />
        Added more meetings.<br />
        Installed new software.</p>
        <p>Nothing improved.</p>
        <p>The issue was not capacity.<br />
        It was clarity.</p>
        <p>Once decision authority, scheduling discipline, and financial reporting were standardized, the business stabilized — without reducing volume.</p>
        <p>The circle didn't need to shrink.<br />
        <strong>It needed structure.</strong></p>
      </Parable>

      <Section title="Scaling Each Leg of the Stool">
        <p>Scale must be balanced.</p>
        <p>If one leg grows faster than the others, instability follows.</p>
        <DoctrineList items={[
          "Marketing without sales discipline creates bad backlog",
          "Sales without operations creates chaos",
          "Operations without people creates burnout",
          "People without financial command creates drift"
        ]} />
        <p>The stool must be reinforced evenly as volume increases.</p>
        <p>This is non-negotiable.</p>
      </Section>

      <Section title="Financial Command Becomes Mandatory at Scale">
        <p>At low volume, intuition masks weakness.</p>
        <p>At scale, intuition fails.</p>
        <p>Scaling requires:</p>
        <DoctrineList items={[
          "Cost-coded jobs",
          "Real-time WIP tracking",
          "Cash flow forecasting",
          "Margin visibility by project",
          "Clear exposure awareness"
        ]} />
        <p>If you cannot see the business clearly, you cannot scale it safely.</p>
        <p>Growth hides problems.<br />
        Scale exposes them.</p>
      </Section>

      <Section title="Pressure Increases — Identity Is Tested">
        <p>As the business scales:</p>
        <DoctrineList items={[
          "Decisions affect more people",
          "Mistakes cost more money",
          "Conflict becomes unavoidable",
          "Visibility increases"
        ]} />
        <p>This is where identity collapses or solidifies.</p>
        <p>Operators who need approval shrink.<br />
        Operators who trust themselves stabilize the business.</p>
        <p><strong>Scale does not forgive insecurity.</strong></p>
      </Section>

      <Section title="Systems Reduce Emotional Load">
        <p>ALP systems exist to remove emotion from execution.</p>
        <p>Clear systems:</p>
        <DoctrineList items={[
          "Reduce decision fatigue",
          "Prevent overreaction",
          "Eliminate firefighting",
          "Protect the operator's energy"
        ]} />
        <p>Energy is finite.<br />
        Systems preserve it.</p>
      </Section>

      <Section title="Scaling Is a Discipline, Not a Goal">
        <p>Scale is not a finish line.</p>
        <p>It is a continuous discipline.</p>
        <p>Every new level of volume requires:</p>
        <DoctrineList items={[
          "Re-evaluating weak legs",
          "Tightening standards",
          "Reinforcing documentation",
          "Sharpening decision-making"
        ]} />
        <p>Operators who stop reinforcing control fall behind their own growth.</p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p><strong>Altitude</strong> allows you to see scale clearly.<br />
        <strong>Logic</strong> ensures systems make sense.<br />
        <strong>Pressure</strong> ensures standards are enforced.</p>
        <p>Remove any one — scale collapses.</p>
        <p>ALP is not optional at higher levels.<br />
        It is required infrastructure.</p>
      </Section>

      <Section title="Final Truth">
        <p>Most businesses fail not because they grow too slowly —<br />
        but because they grow faster than they can control.</p>
        <p><strong>Scale rewards discipline.<br />
        It punishes hope.</strong></p>
        <p>Those who scale with ALP do not fear growth.</p>
        <p>They command it.</p>
      </Section>
    </div>
  );
};

export default Chapter25;
