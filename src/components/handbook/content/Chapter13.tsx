import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter13 = () => {
  return (
    <section id="chapter-13" className="chapter-section">
      <ChapterHeader number={13} title="Notices & Playing Offense" />
      
      <p className="body-text">Most contractors treat notices as paperwork.</p>
      
      <p className="body-text">
        Something defensive.<br />
        Something adversarial.<br />
        Something you send when things are already bad.
      </p>
      
      <p className="body-text">That misunderstanding costs them leverage, entitlement, and control.</p>
      
      <p className="body-text font-semibold">Notices are not paperwork.</p>
      
      <p className="body-text">They are offensive tools.</p>

      <Section title="Why Notices Exist">
        <p className="body-text">Notices exist for one reason:</p>
        
        <p className="body-text font-semibold">To preserve rights in real time.</p>
        
        <p className="body-text">
          Not to argue later.<br />
          Not to threaten.<br />
          Not to posture.
        </p>
        
        <p className="body-text">
          Notices exist so that when disruption occurs, responsibility is documented before memory, 
          emotion, and narrative take over.
        </p>
        
        <p className="body-text">Construction does not reward hindsight.</p>
        
        <p className="body-text">It rewards contemporaneous record.</p>
      </Section>

      <Section title="Defense vs. Offense">
        <p className="body-text">Most contractors play defense.</p>
        
        <p className="body-text">
          They wait.<br />
          They hope.<br />
          They accommodate.<br />
          They "work it out."<br />
          They send a notice only when payment is threatened.
        </p>
        
        <p className="body-text">By then, it's too late.</p>
        
        <p className="body-text">Offensive contractors issue notices:</p>
        
        <DoctrineList items={[
          "Early",
          "Calmly",
          "Factually",
          "Consistently"
        ]} />
        
        <p className="body-text">
          Not because they are aggressive —<br />
          but because they are disciplined.
        </p>
      </Section>

      <Section title="What 'Playing Offense' Actually Means">
        <p className="body-text">Playing offense does not mean being combative.</p>
        
        <p className="body-text">It means setting the narrative early.</p>
        
        <p className="body-text">When disruption occurs, one of two things will happen:</p>
        
        <p className="body-text">Either:</p>
        <p className="body-text ml-4">You define the event, its cause, and its impact</p>
        
        <p className="body-text">Or:</p>
        <p className="body-text ml-4">Someone else will</p>
        
        <p className="body-text">Silence is not neutral.</p>
        
        <p className="body-text font-semibold">Silence concedes narrative control.</p>
      </Section>

      <Section title="Notices Are About Time, Not Blame">
        <p className="body-text">Here's where most contractors get it wrong:</p>
        
        <p className="body-text">They think notices are about fault.</p>
        
        <p className="body-text">They're not.</p>
        
        <p className="body-text font-semibold">They're about time and impact.</p>
        
        <p className="body-text">A proper notice answers four questions:</p>
        
        <DoctrineList items={[
          "What happened?",
          "When did it happen?",
          "What is the impact on time and/or cost?",
          "What rights are being reserved?"
        ]} />
        
        <p className="body-text">
          No emotion.<br />
          No accusation.<br />
          No argument.
        </p>
        
        <p className="body-text">Just record.</p>
      </Section>

      <Section title="Why Contractors Delay Notices">
        <p className="body-text">Contractors delay notices because they:</p>
        
        <DoctrineList items={[
          "Don't want to upset the owner",
          "Want to be \"easy to work with\"",
          "Think the issue might resolve itself",
          "Fear conflict",
          "Don't fully understand entitlement"
        ]} />
        
        <p className="body-text">This feels reasonable.</p>
        
        <p className="body-text">It is also how leverage evaporates.</p>
        
        <p className="body-text">
          By the time the issue "doesn't resolve,"<br />
          the notice window has closed.
        </p>
      </Section>

      <Parable id="parable-polite-contractor" title="The Polite Contractor">
        <p className="body-text">A contractor accommodated repeated owner delays.</p>
        
        <p className="body-text">
          No notice.<br />
          No documentation.<br />
          Just cooperation.
        </p>
        
        <p className="body-text">Months later, the schedule was blown and costs mounted.</p>
        
        <p className="body-text">When the contractor finally raised the issue, the response was simple:</p>
        
        <p className="body-text font-semibold">"You never said anything."</p>
        
        <p className="body-text">Politeness did not preserve entitlement.</p>
        
        <p className="body-text">Documentation would have.</p>
      </Parable>

      <Section title="Notices Protect Relationships — They Don't Damage Them">
        <p className="body-text">This is counterintuitive, but true:</p>
        
        <p className="body-text font-semibold">Clear notices often reduce conflict.</p>
        
        <p className="body-text">Why?<br />Because:</p>
        
        <DoctrineList items={[
          "Expectations are set early",
          "Surprises are minimized",
          "Memory doesn't get rewritten",
          "Responsibility stays clear"
        ]} />
        
        <p className="body-text">Conflict escalates when issues surface late.</p>
        
        <p className="body-text">Notices surface them early.</p>
      </Section>

      <Section title="Notice Is a System, Not an Event">
        <p className="body-text">Strong operators do not "remember" to issue notices.</p>
        
        <p className="body-text">They systematize them.</p>
        
        <p className="body-text">That means:</p>
        
        <DoctrineList items={[
          "Defined triggers",
          "Standard language",
          "Consistent timing",
          "Centralized tracking"
        ]} />
        
        <p className="body-text">
          If notices rely on memory, emotion, or judgment calls under pressure, they will fail.
        </p>
        
        <p className="body-text">Every time.</p>
      </Section>

      <Section title="What Triggers a Notice">
        <p className="body-text">At minimum, notices should be triggered by:</p>
        
        <DoctrineList items={[
          "Owner-caused delay",
          "Design ambiguity",
          "Late approvals",
          "Resequencing",
          "Start–stop work",
          "Trade stacking",
          "Scope growth",
          "Access restrictions"
        ]} />
        
        <p className="body-text">
          If something impacts time, cost, or sequence —<br />
          it deserves a notice.
        </p>
      </Section>

      <Section title="Notice Does Not Equal Escalation">
        <p className="body-text">Issuing notice does not mean you stop working.</p>
        
        <p className="body-text">It means you keep working with protection.</p>
        
        <p className="body-text">This is the difference between:</p>
        
        <DoctrineList items={[
          "Cooperation",
          "Capitulation"
        ]} />
        
        <p className="body-text">Offensive operators cooperate without surrendering rights.</p>
      </Section>

      <Section title="The Cost of 'We'll Deal With It Later'">
        <p className="body-text">Later never comes.</p>
        
        <p className="body-text">What comes instead:</p>
        
        <DoctrineList items={[
          "Denied change orders",
          "Unpaid GC's",
          "Rejected claims",
          "Strained relationships",
          "Emotional arguments"
        ]} />
        
        <p className="body-text">All because the record was never built.</p>
        
        <p className="body-text">
          Notices are how you build that record — calmly, methodically, and without drama.
        </p>
      </Section>

      <Section title="Notices as a Leadership Act">
        <p className="body-text">Issuing notice is a leadership decision.</p>
        
        <p className="body-text">It signals:</p>
        
        <DoctrineList items={[
          "Professionalism",
          "Discipline",
          "Clarity",
          "Command"
        ]} />
        
        <p className="body-text">Teams follow leaders who protect the business.</p>
        
        <p className="body-text">Silence teaches people that protection is optional.</p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p className="body-text">
          <strong>Altitude</strong> lets you recognize disruption early.<br />
          <strong>Logic</strong> tells you when entitlement is at risk.<br />
          <strong>Pressure</strong> forces you to act before windows close.
        </p>
        
        <p className="body-text">Remove any one — and notices fail.</p>
      </Section>

      <Section title="Final Truth">
        <p className="body-text font-semibold">Most contractors don't lose claims because they were wrong.</p>
        
        <p className="body-text">They lose them because they were quiet.</p>
        
        <p className="body-text">Notices are not aggression.</p>
        
        <p className="body-text">They are responsibility in written form.</p>
        
        <p className="body-text">
          If you don't play offense in real time,<br />
          you will always be defending yourself later.
        </p>
        
        <p className="body-text font-semibold">And later is where leverage goes to die.</p>
      </Section>
    </section>
  );
};

export default Chapter13;
