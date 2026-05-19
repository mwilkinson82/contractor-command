import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';

const Chapter31: React.FC = () => {
  return (
    <div id="chapter-31" className="py-24 border-t border-chapter-divider">
      <ChapterHeader number={8} title="Systems Are How You Take the Personality Out of the Business" />

      <div className="body-text space-y-6 max-w-3xl">
        <p>Entrepreneurs usually build companies through force of personality.</p>
        <p>That is not an insult. It is usually the truth.</p>
        <p>The owner sells the work. The owner sets the standard. The owner makes the hard calls. The owner pushes the team. The owner solves the problems. The owner knows what good looks like. The owner sees the risk before everyone else sees it.</p>
        <p>That personality is often why the company exists in the first place.</p>
        <p>But the same thing that creates the company can eventually trap the company.</p>
        <p className="body-text-emphasis">If the company depends on the owner's personality to function, the company cannot scale beyond the owner's reach.</p>
      </div>

      <Section title="Translating the Owner Into the Company">
        <p>This is why the work of building systems matters. Systems take the personality out of the business.</p>
        <p>That does not mean the company loses its culture. It means the company stops depending on one person's constant presence to maintain that culture.</p>
        <p>The owner's standards have to become company standards.</p>
        <p>The owner's judgment has to become decision rules.</p>
        <p>The owner's preferences have to become documented processes.</p>
        <p>The owner's reminders have to become recurring rhythms.</p>
        <p>The owner's pressure has to become accountability.</p>
        <p>The owner's mental checklist has to become a company checklist.</p>
        <p>The owner's way of doing things has to become a process that other people can learn, repeat, improve, and own.</p>
        <p>That is what allows duplication. Duplication is the foundation of scale.</p>
        <p>If only one person can do something correctly, the company is constrained.</p>
        <p>If one trained person can teach another trained person to do it correctly, the company can grow.</p>
        <p className="body-text-emphasis">That is the difference between a job and a system.</p>
      </Section>

      <Section title="Where Systems Are Needed">
        <p>A contracting company needs systems in every major area:</p>
        <DoctrineList items={[
          "Business development",
          "Sales",
          "Estimating",
          "Preconstruction",
          "Contract review",
          "Project startup",
          "Scheduling",
          "Procurement",
          "Field execution",
          "Change orders",
          "Billing",
          "Collections",
          "Job-cost review",
          "Closeout",
          "Hiring",
          "Training",
          "Safety",
          "Leadership",
        ]} />
        <p>But those systems need a foundation. That foundation is the operating system.</p>
      </Section>

      <Section title="Why the Operating System Comes First">
        <p>Do not start with a giant SOP project. That is where contractors get buried.</p>
        <p>They try to document everything before the company has a rhythm for using anything.</p>
        <p>The operating system comes first.</p>
        <p>Why? Because the operating system tells you which systems matter most right now.</p>
        <p>If the scorecard shows AR is aging, the billing and collections process matters now.</p>
        <p>If the issue list keeps showing bad handoffs, the estimating-to-operations handoff process matters now.</p>
        <p>If Rocks are stuck because nobody owns decisions, the Accountability Chart matters now.</p>
        <p>If projects are bleeding margin, the project controls process matters now.</p>
        <p>If sales are inconsistent, the business development and follow-up process matters now.</p>
        <p>The operating system creates the signal. Then the company builds the process around the signal.</p>
        <p>That is how systems get built in the right order. Not because they sound good. Because the company needs them to execute.</p>
      </Section>

      <Section title="Useful, Not Decorative">
        <p>This is also how systems become useful instead of decorative.</p>
        <p>Many companies have SOPs nobody uses. That happens because the SOPs were built outside the rhythm of the company. They were written as documents, not installed as behavior.</p>
        <p>AOS should prevent that. The system should connect the issue, the owner, the process gap, the Rock, the to-do, and the follow-up.</p>
        <p>That is how process becomes part of execution. Not a file folder. Not a binder. Not a nice idea. Execution.</p>
        <p>The point is not to make the company complicated. The point is to make the company repeatable.</p>
        <p>Repeatable companies are easier to train. Easier to manage. Easier to measure. Easier to improve. Easier to scale.</p>
        <p className="body-text-emphasis">That is the entire game.</p>
      </Section>
    </div>
  );
};

export default Chapter31;
