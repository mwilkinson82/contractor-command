import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';

const Chapter28: React.FC = () => {
  return (
    <div id="chapter-28" className="py-24 border-t border-chapter-divider">
      <ChapterHeader number={5} title="Hierarchy Is Not Accountability" />

      <div className="body-text space-y-6 max-w-3xl">
        <p>Contracting companies need hierarchy.</p>
        <p>That is not the problem.</p>
        <p>
          You cannot run a project, a crew, a field operation, or a company with no chain of command. When it is time to mobilize people, material, equipment, subcontractors, schedules, and inspections, there has to be order. Someone has to be in charge. Someone has to make the call. Someone has to own the mission.
        </p>
        <p>In that sense, contracting is very similar to the military.</p>
        <p>You are mobilizing resources to accomplish a mission at a specific geographic location in the world.</p>
        <p>There is a plan. There are roles. There is a sequence. There are constraints. There are risks. There is a deadline. There is a cost for failure.</p>
        <p>That kind of environment needs command structure.</p>
        <p className="body-text-emphasis">But command structure alone does not create accountability.</p>
      </div>

      <Section title="Where Contractors Get It Wrong">
        <p>
          They build a hierarchy chart and assume they have accountability. They say the PM reports to the operations manager, the superintendent reports to the PM, the estimator reports to the owner, the office manager handles paperwork, the controller handles the money, and therefore the company is organized.
        </p>
        <p>It may be organized on paper.</p>
        <p>That does not mean it is accountable.</p>
        <p>Hierarchy answers one question: Who reports to who?</p>
        <p>Accountability answers a better question: Who owns what result?</p>
        <p>Those are not the same thing.</p>
        <p>A person can report to the right person and still own nothing clearly.</p>
        <p>A person can have a title and still have no measurable output.</p>
        <p>A person can be "in charge" and still send every difficult decision back to the owner.</p>
        <p>A person can sit in a leadership seat and still wait to be told what matters every week.</p>
        <p>That is the failure of the hierarchy model.</p>
        <p>
          The hierarchy model creates vertical dependence. Everything flows upward. Questions flow upward. Problems flow upward. Decisions flow upward. Conflict flows upward. Exceptions flow upward. Eventually, the owner is sitting at the top of a pyramid of unresolved work.
        </p>
        <p>That model makes the owner feel important.</p>
        <p>It also makes the company weak.</p>
      </Section>

      <Section title="The Accountability Model">
        <p>An accountability model is different.</p>
        <p>
          In an accountability model, each seat has a defined mission. Each seat has measurable outputs. Each seat has decision rights. Each seat has recurring responsibilities. Each seat has numbers. Each seat has rocks. Each seat has ownership.
        </p>
        <p>The question becomes: What is this role responsible for producing?</p>
        <p>Not what is this person's title. Not who do they report to. Not how long have they been here. Not are they a good person.</p>
        <p className="body-text-emphasis">What result does this seat exist to create?</p>
        <p>That shift changes the company.</p>
        <p>A PM is not just a person who manages projects. A PM owns project outcomes. Schedule. Cost control. Change order execution. Client communication. Subcontractor coordination. Billing readiness. Closeout. Margin protection.</p>
        <p>A superintendent is not just the person in the field. The superintendent owns field execution. Daily coordination. Jobsite readiness. Production flow. Quality. Safety. Schedule discipline. Field communication.</p>
        <p>An estimator is not just someone who prices work. The estimator owns bid output. Bid volume. Bid quality. Scope clarity. Hand-off readiness. Hit-rate intelligence. Estimate discipline.</p>
        <p>A controller is not just someone who handles the books. The controller owns financial visibility. Billing cadence. Receivables. Payables. Cash awareness. Job-cost reporting. Margin truth.</p>
        <p>The owner should not have to inspect every one of those areas by personal memory.</p>
        <p>The operating system should force those areas into the open every week.</p>
      </Section>

      <Section title="Accountability Needs Numbers">
        <p>Without numbers, accountability becomes personality management.</p>
        <p>The owner starts asking questions like:</p>
        <p>"Did you get that done?"<br />"Where are we on that?"<br />"Why did this happen?"<br />"How did we miss this?"<br />"When were you going to tell me?"</p>
        <p className="body-text-emphasis">That is not leadership. That is chasing.</p>
        <p>
          In a real operating system, each role has numbers that show whether the work is being executed. The point is not to bury people in metrics. The point is to identify the few leading indicators that tell the truth before the damage shows up in the financials.
        </p>
        <p>Lagging indicators tell you what already happened. Leading indicators tell you what is coming.</p>
        <p>If cash is tight, that is a lagging indicator. If billing is not going out on time, that is a leading indicator.</p>
        <p>If profit is down, that is a lagging indicator. If change orders are not being priced, approved, and billed, that is a leading indicator.</p>
        <p>If revenue is down, that is a lagging indicator. If bid volume, proposal follow-up, and sales activity are weak, those are leading indicators.</p>
        <p>If projects are chaotic, that is a lagging indicator. If preconstruction handoff, weekly planning, procurement tracking, and schedule updates are weak, those are leading indicators.</p>
        <p>Most owners live in lagging indicators because that is when the pain is finally impossible to ignore.</p>
        <p>The operating system forces the team to live in leading indicators.</p>
        <p>That is how a company starts catching problems while there is still time to do something about them.</p>
      </Section>

      <Section title="From Personality Pressure to System Pressure">
        <p>This is also how the company becomes self-policing.</p>
        <p>Self-policing does not mean nobody leads.</p>
        <p>It means the system makes the truth visible enough that the team cannot hide from it.</p>
        <p>If the scorecard is reviewed every week, the numbers speak.</p>
        <p>If Rocks are reviewed every week, priority drift gets exposed.</p>
        <p>If issues are captured and solved every week, problems do not live forever in hallway conversations.</p>
        <p>If roles are clear, people cannot keep pushing responsibility sideways.</p>
        <p>If the meeting rhythm is disciplined, the company does not need the owner to reassemble the whole business from scratch every Monday morning.</p>
        <p>That is the move.</p>
        <p className="body-text-emphasis">The company has to move from personality pressure to system pressure.</p>
        <p>Personality pressure is when the owner has to push, remind, correct, chase, repeat, and escalate everything manually.</p>
        <p>System pressure is when the weekly rhythm, scorecard, Rocks, issue list, and accountability chart force the right conversations to happen without the owner dragging them out of people.</p>
        <p>That is not bureaucracy.</p>
        <p>That is how execution becomes normal.</p>
      </Section>
    </div>
  );
};

export default Chapter28;
