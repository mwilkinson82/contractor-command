import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter16 = () => {
  return (
    <section id="chapter-16" className="chapter-section">
      <ChapterHeader number={16} title="Financial Command: Seeing the Business Clearly" />
      
      <p className="body-text">Most contractors don't lack profit.</p>
      
      <p className="body-text">They lack visibility.</p>
      
      <p className="body-text">
        They work hard.<br />
        They stay busy.<br />
        They close jobs.
      </p>
      
      <p className="body-text">And still feel uncertain.</p>
      
      <p className="body-text">
        Not because the business is broken —<br />
        but because they don't actually see it.
      </p>
      
      <p className="body-text font-semibold">Financial command is not accounting.</p>
      
      <p className="body-text">It is clarity.</p>

      <Section title="Why Money Feels Confusing in Construction">
        <p className="body-text">Construction hides financial truth.</p>
        
        <p className="body-text">
          Costs are delayed.<br />
          Revenue is uneven.<br />
          Problems surface late.<br />
          Margins erode quietly.
        </p>
        
        <p className="body-text">You can be:</p>
        
        <DoctrineList items={[
          "Busy and losing money",
          "Profitable on paper and broke in cash",
          "Ahead in production and behind financially"
        ]} />
        
        <p className="body-text">
          This is why operators often feel uneasy even when work is strong.
        </p>
        
        <p className="body-text font-semibold">The numbers lag reality.</p>
      </Section>

      <Section title="Financial Command Is Not About Reports">
        <p className="body-text">Most contractors equate financial awareness with reports.</p>
        
        <p className="body-text">
          Monthly P&Ls.<br />
          Job cost summaries.<br />
          Accounting software dashboards.
        </p>
        
        <p className="body-text">Those are necessary — but insufficient.</p>
        
        <p className="body-text">Reports describe what already happened.</p>
        
        <p className="body-text font-semibold">
          Financial command is about understanding what is happening right now — 
          and what is about to happen next.
        </p>
      </Section>

      <Section title="The Core Failure: Blended Thinking">
        <p className="body-text">Here's the fundamental mistake:</p>
        
        <p className="body-text font-semibold">
          Most contractors blend job performance with business performance.
        </p>
        
        <p className="body-text">They don't separate:</p>
        
        <DoctrineList items={[
          "Cash vs. profit",
          "Revenue vs. margin",
          "Progress vs. entitlement",
          "Activity vs. productivity"
        ]} />
        
        <p className="body-text">So everything feels vague.</p>
        
        <p className="body-text">
          Vagueness creates anxiety.<br />
          Anxiety creates bad decisions.
        </p>
      </Section>

      <Section title="Profit Is Not a Feeling">
        <p className="body-text">Operators often say:</p>
        
        <p className="body-text">"This job feels good."</p>
        
        <p className="body-text">Or:</p>
        
        <p className="body-text">"That one never felt right."</p>
        
        <p className="body-text">Feelings are signals — not proof.</p>
        
        <p className="body-text">Profit must be:</p>
        
        <DoctrineList items={[
          "Measured",
          "Protected",
          "Verified"
        ]} />
        
        <p className="body-text">
          If you can't explain why a job is profitable or unprofitable, you're guessing.
        </p>
        
        <p className="body-text font-semibold">Guessing is not command.</p>
      </Section>

      <Section title="Cash Flow Is Not Profit">
        <p className="body-text">This confusion ruins more contractors than bad estimating.</p>
        
        <p className="body-text">Cash flow answers:</p>
        
        <p className="body-text">"Can I pay my bills right now?"</p>
        
        <p className="body-text">Profit answers:</p>
        
        <p className="body-text">"Is this job actually working?"</p>
        
        <p className="body-text">
          You can have cash and be losing money.<br />
          You can be profitable and starved for cash.
        </p>
        
        <p className="body-text">
          Operators who don't separate the two eventually collapse — usually when growth accelerates.
        </p>
      </Section>

      <Section title="Margin Dies Before You Feel It">
        <p className="body-text">Margin does not disappear suddenly.</p>
        
        <p className="body-text">It erodes through:</p>
        
        <DoctrineList items={[
          "Time drift",
          "Start–stop work",
          "Productivity loss",
          "Unrecovered GC's",
          "Silent concessions"
        ]} />
        
        <p className="body-text">By the time the P&L confirms it, the damage is done.</p>
        
        <p className="body-text font-semibold">
          Financial command requires early indicators, not autopsies.
        </p>
      </Section>

      <Section title="The Job Is the Unit of Truth">
        <p className="body-text">The business is an aggregation of jobs.</p>
        
        <p className="body-text">If you don't understand:</p>
        
        <DoctrineList items={[
          "Which jobs are carrying the business",
          "Which jobs are bleeding",
          "Which jobs are masking problems elsewhere"
        ]} />
        
        <p className="body-text">You don't understand the business.</p>
        
        <p className="body-text font-semibold">Everything starts at the job level.</p>
        
        <p className="body-text">Always.</p>
      </Section>

      <Parable id="parable-profitable-company-wasnt" title="The Profitable Company That Wasn't">
        <p className="body-text">A contractor looked successful.</p>
        
        <p className="body-text">
          Strong revenue.<br />
          Busy crews.<br />
          Growing backlog.
        </p>
        
        <p className="body-text">But three jobs were quietly underwater.</p>
        
        <p className="body-text">They consumed:</p>
        
        <DoctrineList items={[
          "Management attention",
          "Cash",
          "Schedule flexibility"
        ]} />
        
        <p className="body-text">
          New jobs paid the bills.<br />
          Old jobs drained margin.
        </p>
        
        <p className="body-text">The company wasn't profitable.</p>
        
        <p className="body-text font-semibold">It was floating on activity.</p>
        
        <p className="body-text">When the backlog slowed, reality arrived.</p>
      </Parable>

      <Section title="Financial Command Requires Separation">
        <p className="body-text">Strong operators separate relentlessly:</p>
        
        <DoctrineList items={[
          "Estimated margin vs. earned margin",
          "Approved changes vs. pending exposure",
          "Contract value vs. collectible value",
          "Progress billed vs. progress earned",
          "Cash received vs. cash owed"
        ]} />
        
        <p className="body-text">This separation creates clarity.</p>
        
        <p className="body-text font-semibold">Clarity enables decisions.</p>
      </Section>

      <Section title="Why Contractors Avoid Financial Precision">
        <p className="body-text">Precision removes excuses.</p>
        
        <p className="body-text">It forces acknowledgment of:</p>
        
        <DoctrineList items={[
          "Bad jobs",
          "Weak controls",
          "Avoided conversations",
          "Deferred decisions"
        ]} />
        
        <p className="body-text">Ambiguity feels safer.</p>
        
        <p className="body-text">Until it isn't.</p>
      </Section>

      <Section title="Financial Command Drives Behavior">
        <p className="body-text">When financial clarity exists:</p>
        
        <DoctrineList items={[
          "Schedules tighten",
          "Documentation improves",
          "Decisions accelerate",
          "Tolerance for chaos drops"
        ]} />
        
        <p className="body-text">Why?</p>
        
        <p className="body-text">Because consequences become visible.</p>
        
        <p className="body-text font-semibold">Nothing sharpens leadership like clear numbers.</p>
      </Section>

      <Section title="The Operator's Role in Financial Command">
        <p className="body-text">You can delegate bookkeeping.</p>
        
        <p className="body-text font-semibold">You cannot delegate financial understanding.</p>
        
        <p className="body-text">The operator must:</p>
        
        <DoctrineList items={[
          "Read job performance in real time",
          "Ask uncomfortable questions",
          "Tie operations to financial impact",
          "Act early when numbers drift"
        ]} />
        
        <p className="body-text font-semibold">Leadership that avoids numbers forfeits control.</p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p className="body-text">
          <strong>Altitude</strong> allows you to see the business, not just the work.<br />
          <strong>Logic</strong> connects operations, time, and money.<br />
          <strong>Pressure</strong> forces decisions when numbers signal danger — not months later.
        </p>
        
        <p className="body-text">Remove any one — and finances become reactive.</p>
      </Section>

      <Section title="Final Truth">
        <p className="body-text font-semibold">
          Most contractors don't fail because they lack work.
        </p>
        
        <p className="body-text">
          They fail because they didn't see the truth early enough to act.
        </p>
        
        <p className="body-text">Financial command is not about sophistication.</p>
        
        <p className="body-text font-semibold">It is about visibility, separation, and discipline.</p>
        
        <p className="body-text">
          See clearly.<br />
          Decide early.<br />
          Act decisively.
        </p>
        
        <p className="body-text">
          That is how control is maintained —<br />
          and how businesses scale without breaking.
        </p>
      </Section>
    </section>
  );
};

export default Chapter16;
