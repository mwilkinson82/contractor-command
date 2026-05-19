import React from 'react';
import Section from '../Section';
import Eyebrow from '@/components/editorial/Eyebrow';

const HowToUse: React.FC = () => {
  return (
    <div id="how-to-use" className="py-24 border-t border-chapter-divider">
      <header className="mb-16">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-6">
          <Eyebrow accent bare>Updated for V2</Eyebrow>
          <Eyebrow bare>Front Matter</Eyebrow>
        </div>
        <h2 className="chapter-heading">How to Use This Handbook</h2>
      </header>


      <div className="body-text space-y-6 max-w-3xl">
        <p>Do not read this handbook like a normal business book.</p>
        <p>Use it like a field reference.</p>
        <p>
          The point is not to finish it, agree with it, and put it on a shelf. The point is to use it when pressure shows up in the business.
        </p>
        <p>Use it when a project is slipping.</p>
        <p>Use it when cash is tight.</p>
        <p>Use it when change orders are stacking up.</p>
        <p>Use it when the team is waiting on the owner.</p>
        <p>Use it when a client is creating disruption.</p>
        <p>Use it when the company is busy but not making money.</p>
        <p>Use it when people are active but not accountable.</p>
        <p>Use it when you are growing and starting to lose control.</p>
      </div>

      <Section title="How the Handbook Is Organized">
        <p>This handbook is organized to move from doctrine to execution.</p>
        <p>
          <strong>Part I</strong> gives you the frame: how to think about contracting problems, entrepreneurial responsibility, and the ALP doctrine of Altitude, Logic, and Pressure.
        </p>
        <p>
          <strong>Part II</strong> gives you the operating system: how the company moves from owner dependency into accountability, scorecards, roles, priorities, issue solving, process, and weekly execution.
        </p>
        <p>
          The business-system sections show how that operating system applies to marketing, sales, estimating, operations, documentation, scheduling, finance, general conditions, notices, change orders, leadership, and scale.
        </p>
        <p>Do not treat each chapter as a separate idea.</p>
        <p>The chapters connect.</p>
        <p>The operating system is the foundation.</p>
        <p>The business systems sit on top of it.</p>
        <p>The financial and legal chapters protect the money.</p>
        <p>The leadership chapters protect the standards.</p>
        <p>
          The real-time application chapters are there to help you use the handbook inside the actual pressure of running the company.
        </p>
      </Section>

      <Section title="The Three Questions">
        <p>When you read a chapter, ask three questions:</p>
        <ol className="list-decimal pl-6 space-y-2">
          <li>Where is this problem showing up in my company right now?</li>
          <li>Who owns this result?</li>
          <li>What system, number, process, or standard needs to be installed so this stops depending on me?</li>
        </ol>
        <p>Those three questions matter more than highlighting every page.</p>
      </Section>

      <Section title="Turn It Into Execution">
        <p>If a chapter exposes a weakness, do not turn it into a giant initiative.</p>
        <p>Turn it into a decision.</p>
        <p>Turn it into a scorecard number.</p>
        <p>Turn it into a Rock.</p>
        <p>Turn it into an issue.</p>
        <p>Turn it into a process.</p>
        <p>Turn it into a standard.</p>
        <p>Turn it into something the company can execute this week.</p>
        <p>That is how the handbook should be used.</p>
        <p>Not as inspiration.</p>
        <p className="body-text-emphasis">As a tool.</p>
        <p>The contractor who wins is not the one with the most ideas.</p>
        <p className="body-text-emphasis">
          The contractor who wins is the one who can turn the right ideas into repeatable execution.
        </p>
      </Section>
    </div>
  );
};

export default HowToUse;
