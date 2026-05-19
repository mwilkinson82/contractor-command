import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';

const Chapter30: React.FC = () => {
  return (
    <div id="chapter-30" className="py-24 border-t border-chapter-divider">
      <ChapterHeader number={7} title="Weekly Execution Is Where the Company Is Won" />

      <div className="body-text space-y-6 max-w-3xl">
        <p>Most contractors want the result.</p>
        <p>More profit. Better jobs. Cleaner projects. Stronger cash flow. Less chaos. Better people. Fewer surprises. More owner freedom.</p>
        <p>Everybody wants that.</p>
        <p>The problem is that those results are lagging indicators. By the time you see them clearly, the actions that created them already happened.</p>
        <p>Profit is not created when the P&amp;L comes out. Profit is created when the company qualifies the right work, estimates it correctly, negotiates the contract, plans the job, buys it out, manages labor, processes change orders, bills on time, collects on time, and closes out correctly.</p>
        <p>Cash flow is not fixed when the bank account is low. Cash flow is created by billing discipline, collections discipline, contract terms, job-cost accuracy, change order processing, procurement decisions, and project execution.</p>
        <p>Owner freedom is not created by the owner deciding to take Friday off. Owner freedom is created when other people own real outcomes and the system makes those outcomes visible.</p>
        <p className="body-text-emphasis">This is why weekly execution matters.</p>
      </div>

      <Section title="The Weekly Rhythm">
        <p>The weekly rhythm is where the company turns goals into action.</p>
        <p>Annual goals are too far away. Quarterly Rocks create focus. Weekly scorecards create truth. Weekly meetings create pressure. Weekly to-dos create movement. Weekly issue solving creates progress.</p>
        <p>That is the operating rhythm.</p>
        <p>If you only look at the company monthly, you are late.</p>
        <p>If you only look at the company quarterly, you are guessing.</p>
        <p>If you only look at the company when there is a crisis, you are not leading. You are reacting.</p>
        <p>A contracting company needs a weekly command rhythm. That rhythm should answer five questions:</p>
        <DoctrineList items={[
          "Are our numbers on track?",
          "Are our quarterly priorities on track?",
          "What has changed with customers, employees, and projects?",
          "Did we do what we said we would do?",
          "What issues must be solved now?",
        ]} />
        <p>That is not complicated. But it is powerful. Because the rhythm creates accountability.</p>
        <p>If a Rock is off track, the team sees it. If a number is missed, the team sees it. If a to-do is not completed, the team sees it. If the same issue keeps coming back, the team sees it.</p>
        <p>That visibility changes behavior.</p>
        <p>People start preparing. People start owning their numbers. People start bringing issues earlier. People start making commitments more carefully.</p>
        <p>People start realizing that the company is no longer running on vague effort. It is running on visible execution.</p>
      </Section>

      <Section title="Peer Pressure as a Healthy Force">
        <p>This creates peer pressure. That is a good thing.</p>
        <p>A healthy company should have peer pressure. Not politics. Not blame. Not gossip. Peer pressure around execution.</p>
        <p>If one leader is prepared and another is not, the system exposes it.</p>
        <p>If one seat owns its number and another seat makes excuses, the system exposes it.</p>
        <p>If one department keeps creating problems for another department, the system exposes it.</p>
        <p>That is how a company becomes self-policing.</p>
        <p>The owner no longer has to be the only source of pressure.</p>
        <p>The system creates pressure. The numbers create pressure. The commitments create pressure. The team creates pressure.</p>
        <p className="body-text-emphasis">That is how the company grows up.</p>
      </Section>

      <Section title="Without the Rhythm">
        <p>Without that rhythm, every initiative fades.</p>
        <p>The owner comes back from a conference with new ideas. Everybody gets excited for a week. Then the jobs get busy. The old habits return. The initiative dies. Nothing changes.</p>
        <p>That happens because the company has no execution mechanism. It has ideas, but no cadence. It has goals, but no weekly accountability. It has problems, but no issue-solving discipline. It has people, but no operating rhythm.</p>
        <p>AOS fixes that. It gives the company a weekly place to run the business.</p>
        <p className="body-text-emphasis">Not just talk about the business. Run it.</p>
      </Section>
    </div>
  );
};

export default Chapter30;
