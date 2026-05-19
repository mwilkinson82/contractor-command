import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter14 = () => {
  return (
    <section id="chapter-14" className="chapter-section">
      <ChapterHeader number={14} title="Scheduling as Time Control" />
      
      <p className="body-text">Most contractors treat the schedule as a requirement.</p>
      
      <p className="body-text">
        Something to submit.<br />
        Something to update occasionally.<br />
        Something that lives in software.
      </p>
      
      <p className="body-text">That misunderstanding turns time into an enemy.</p>
      
      <p className="body-text font-semibold">Scheduling is not administration.</p>
      
      <p className="body-text">
        Scheduling is time control — and time is the currency everything else trades on.
      </p>

      <Section title="Why Time Is the Real Battlefield">
        <p className="body-text">Money does not disappear randomly in construction.</p>
        
        <p className="body-text">It disappears through time.</p>
        
        <p className="body-text">Every problem eventually becomes:</p>
        
        <DoctrineList items={[
          "A delay",
          "A resequence",
          "A compression",
          "A start–stop event"
        ]} />
        
        <p className="body-text">And every one of those events has a cost.</p>
        
        <p className="body-text">If you don't control time, you don't control:</p>
        
        <DoctrineList items={[
          "General Conditions",
          "Productivity",
          "Cash flow",
          "Entitlement",
          "Margin"
        ]} />
        
        <p className="body-text">The schedule is where all of that is decided.</p>
      </Section>

      <Section title="The Schedule Is Not a Forecast">
        <p className="body-text">Most contractors treat the schedule like a prediction.</p>
        
        <p className="body-text">"This is how long we think it will take."</p>
        
        <p className="body-text">That's wrong.</p>
        
        <p className="body-text font-semibold">A schedule is not a forecast.</p>
        
        <p className="body-text">It is a control document.</p>
        
        <p className="body-text">It defines:</p>
        
        <DoctrineList items={[
          "Sequence",
          "Access",
          "Responsibility",
          "Dependency",
          "Entitlement"
        ]} />
        
        <p className="body-text">If the schedule is weak, every downstream argument is weak.</p>
      </Section>

      <Section title="What the Schedule Actually Does">
        <p className="body-text">A real schedule answers five questions:</p>
        
        <DoctrineList items={[
          "What happens first?",
          "What must finish before something else can start?",
          "Who controls each activity?",
          "Where is float — and who owns it?",
          "What happens when something slips?"
        ]} />
        
        <p className="body-text">If your schedule doesn't answer those questions clearly, it is decorative.</p>
      </Section>

      <Section title="Why Contractors Avoid Schedule Discipline">
        <p className="body-text">Schedule discipline forces uncomfortable conversations.</p>
        
        <p className="body-text">It exposes:</p>
        
        <DoctrineList items={[
          "Unrealistic timelines",
          "Owner indecision",
          "Design incompleteness",
          "Trade stacking",
          "Resource constraints"
        ]} />
        
        <p className="body-text">It also forces decisions.</p>
        
        <p className="body-text">Many contractors avoid schedules because:</p>
        
        <DoctrineList items={[
          "They don't want conflict",
          "They don't want to appear rigid",
          "They hope things \"work themselves out\""
        ]} />
        
        <p className="body-text">They won't.</p>
      </Section>

      <Parable id="parable-flexible-timeline" title="The Flexible Timeline">
        <p className="body-text">An owner wanted flexibility.</p>
        
        <p className="body-text">The contractor agreed.</p>
        
        <p className="body-text">
          No firm milestones.<br />
          No enforced sequence.<br />
          No consequences.
        </p>
        
        <p className="body-text">
          Trades overlapped.<br />
          Decisions lagged.<br />
          Work restarted repeatedly.
        </p>
        
        <p className="body-text">The job stayed "busy."</p>
        
        <p className="body-text">But productivity collapsed.</p>
        
        <p className="body-text">Flexibility felt cooperative.</p>
        
        <p className="body-text font-semibold">It was just uncontrolled time.</p>
      </Parable>

      <Section title="Float Is Not Free Time">
        <p className="body-text">This is one of the most misunderstood concepts in construction.</p>
        
        <p className="body-text font-semibold">Float is not "extra time."</p>
        
        <p className="body-text">Float is risk capacity.</p>
        
        <p className="body-text">And whoever controls float controls leverage.</p>
        
        <p className="body-text">If float is not clearly defined:</p>
        
        <DoctrineList items={[
          "It gets consumed silently",
          "It gets reassigned emotionally",
          "It gets blamed on the contractor"
        ]} />
        
        <p className="body-text">Strong operators protect float explicitly.</p>
        
        <p className="body-text">They don't give it away casually.</p>
      </Section>

      <Section title="Scheduling Is the Backbone of Entitlement">
        <p className="body-text">Every successful claim traces back to one thing:</p>
        
        <p className="body-text font-semibold">A schedule that proves cause and effect.</p>
        
        <p className="body-text">Without a schedule:</p>
        
        <DoctrineList items={[
          "Delays are opinions",
          "Disruption is subjective",
          "Impact is arguable"
        ]} />
        
        <p className="body-text">With a schedule:</p>
        
        <DoctrineList items={[
          "Cause is visible",
          "Effect is traceable",
          "Responsibility is clear"
        ]} />
        
        <p className="body-text">This is why owners fight schedule updates.</p>
        
        <p className="body-text">They know what it represents.</p>
      </Section>

      <Section title="Start–Stop Work Is a Scheduling Failure">
        <p className="body-text">When work starts, stops, and restarts, productivity dies.</p>
        
        <p className="body-text">This is not a labor problem.</p>
        
        <p className="body-text">It is a sequencing problem.</p>
        
        <p className="body-text">Start–stop work:</p>
        
        <DoctrineList items={[
          "Destroys momentum",
          "Increases error rates",
          "Expands General Conditions",
          "Burns morale"
        ]} />
        
        <p className="body-text">Every start–stop event should trigger:</p>
        
        <DoctrineList items={[
          "Documentation",
          "Schedule review",
          "Notice consideration"
        ]} />
        
        <p className="body-text">If it doesn't, profit leaks quietly.</p>
      </Section>

      <Section title="Updating the Schedule Is an Offensive Move">
        <p className="body-text">Most contractors update schedules defensively.</p>
        
        <p className="body-text">
          To respond.<br />
          To explain.<br />
          To justify.
        </p>
        
        <p className="body-text">Strong operators update schedules offensively.</p>
        
        <p className="body-text">To:</p>
        
        <DoctrineList items={[
          "Capture impact",
          "Preserve entitlement",
          "Force decisions",
          "Control narrative"
        ]} />
        
        <p className="body-text">A stale schedule is a liability.</p>
        
        <p className="body-text font-semibold">An updated schedule is leverage.</p>
      </Section>

      <Section title="The Schedule as a Leadership Tool">
        <p className="body-text">Teams behave differently when the schedule is enforced.</p>
        
        <p className="body-text">
          Clarity increases.<br />
          Excuses decrease.<br />
          Decisions accelerate.
        </p>
        
        <p className="body-text">Why?</p>
        
        <p className="body-text">Because ambiguity disappears.</p>
        
        <p className="body-text">
          A leader who controls time controls behavior — without raising their voice.
        </p>
      </Section>

      <Section title="Scheduling Is Not Delegation-Proof">
        <p className="body-text">You can delegate schedule maintenance.</p>
        
        <p className="body-text font-semibold">You cannot delegate schedule ownership.</p>
        
        <p className="body-text">The operator must:</p>
        
        <DoctrineList items={[
          "Understand the logic",
          "Respect the dependencies",
          "Enforce the sequence",
          "Use the schedule as a decision tool"
        ]} />
        
        <p className="body-text">
          If leadership treats the schedule as paperwork, everyone else will too.
        </p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p className="body-text">
          <strong>Altitude</strong> allows you to see time as exposure, not inconvenience.<br />
          <strong>Logic</strong> forces sequence, dependency, and cause-and-effect.<br />
          <strong>Pressure</strong> requires you to enforce the schedule when it's uncomfortable.
        </p>
        
        <p className="body-text">Remove any one — and time drifts.</p>
      </Section>

      <Section title="Final Truth">
        <p className="body-text font-semibold">Most contractors don't lose money because work was hard.</p>
        
        <p className="body-text">They lose it because time was allowed to float without control.</p>
        
        <p className="body-text">The schedule is not a formality.</p>
        
        <p className="body-text font-semibold">It is a weapon.</p>
        
        <p className="body-text">
          Those who control time control margin.<br />
          Those who fail to control time spend their careers reacting to it.
        </p>
        
        <p className="body-text">In construction, time always wins.</p>
        
        <p className="body-text font-semibold">Unless you command it.</p>
      </Section>
    </section>
  );
};

export default Chapter14;
