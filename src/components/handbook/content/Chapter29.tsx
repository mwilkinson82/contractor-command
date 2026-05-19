import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';

const Chapter29: React.FC = () => {
  return (
    <div id="chapter-29" className="py-24 border-t border-chapter-divider">
      <ChapterHeader number={6} title="The Six Components of a Contracting Operating System" />

      <div className="body-text space-y-6 max-w-3xl">
        <p>AOS is built around six core components.</p>
        <p>These components are not a menu.</p>
        <p>You do not pick the ones you like and ignore the rest.</p>
        <p>They work together. If one is missing, the system gets weak.</p>
        <p>If Vision is missing, the company has no direction.</p>
        <p>If People is missing, the company has no structure.</p>
        <p>If Data is missing, the company has no truth.</p>
        <p>If Issues is missing, the company has no problem-solving discipline.</p>
        <p>If Process is missing, the company has no repeatability.</p>
        <p>If Traction is missing, the company has no execution rhythm.</p>
        <p className="body-text-emphasis">Together, they create an operating system.</p>
      </div>

      <Section title="1. Vision">
        <p>Vision answers the first question: Where are we going?</p>
        <p>Most contractors think they have a vision because the owner knows what they want.</p>
        <p>That is not enough.</p>
        <p>If the vision only exists in the owner's head, the company does not have a vision. The owner has a private opinion.</p>
        <p>
          A real vision has to be written down. It has to be simple enough that the leadership team can repeat it. It has to clarify who the company is, what it does, what kind of work it wants, what kind of clients it serves, what makes it different, what it is trying to become, and what has to happen this year.
        </p>
        <p>The V/TO, or Vision/Traction Organizer, forces that clarity. It answers the core questions:</p>
        <DoctrineList items={[
          "What are our core values?",
          "What is our core focus?",
          "What is our long-term target?",
          "Who is our target market?",
          "What makes us different?",
          "What does the company need to look like in three years?",
          "What must happen this year?",
          "What are the issues standing in the way?",
        ]} />
        <p>This matters because people cannot execute a mission they cannot see.</p>
        <p>If the estimator is chasing work that does not fit the company, Vision is weak.</p>
        <p>If operations is building projects the company should never have won, Vision is weak.</p>
        <p>If the owner keeps changing priorities every month, Vision is weak.</p>
        <p>If employees cannot explain what the company is trying to become, Vision is weak.</p>
        <p>Vision is not decorative.</p>
        <p className="body-text-emphasis">Vision is command intent. It tells the company what hill it is taking.</p>
      </Section>

      <Section title="2. People">
        <p>People answers the next question: Who owns what?</p>
        <p>This is where the company moves from names and titles to seats and accountability.</p>
        <p>Most contractors organize around people they already have. They ask, "Where does this person fit?"</p>
        <p>That is backwards.</p>
        <p>The better question is: What seats does the company need in order to execute the mission? Then: Who is the right person for each seat?</p>
        <p>
          The Accountability Chart is not just an org chart. An org chart shows reporting lines. An Accountability Chart shows ownership.
        </p>
        <p>Each seat needs a clear purpose. Each seat needs five to seven major accountabilities. Each seat needs to be held by a person who gets it, wants it, and has the capacity to do it.</p>
        <p>This matters because vague roles create owner dependency.</p>
        <p>When nobody knows who owns billing, the owner chases billing.</p>
        <p>When nobody knows who owns schedule recovery, the owner chases schedule recovery.</p>
        <p>When nobody knows who owns change order execution, the owner chases change orders.</p>
        <p>When nobody knows who owns closeout, the owner chases closeout.</p>
        <p>The owner should not be the backup accountability system for every unclear seat in the company.</p>
        <p className="body-text-emphasis">Define the seats. Define the outputs. Put the right people in the right seats. Then hold the seats accountable.</p>
      </Section>

      <Section title="3. Data">
        <p>Data answers the question: Are we running on facts or feelings?</p>
        <p>Contractors love gut feel.</p>
        <p>Gut feel has value. Experienced judgment matters. But gut feel without numbers eventually turns into guessing.</p>
        <p>The Weekly Scorecard is where the company tells itself the truth. Not once a year. Not once a quarter. Every week.</p>
        <p>The scorecard should track a small set of numbers that show whether the business is on track. These numbers should be simple, visible, and owned by specific people.</p>
        <p>Good scorecard numbers are not just financial statements after the damage is done. They are leading indicators. Examples:</p>
        <DoctrineList items={[
          "Bids due this week",
          "Proposals sent",
          "Follow-ups completed",
          "New qualified opportunities",
          "Backlog value",
          "Projects on schedule",
          "Change orders pending approval",
          "Unbilled work",
          "Pay applications submitted",
          "AR over 30 days",
          "Labor productivity variance",
          "Safety incidents",
          "Open RFIs",
          "Closeout items aging",
        ]} />
        <p>The point is not to track everything. The point is to track what tells the truth.</p>
        <p>If a number is off, it creates a conversation. If the conversation reveals a real obstacle, it becomes an issue. If the issue matters, it gets solved.</p>
        <p>That is how Data connects to Issues.</p>
        <p>Without a scorecard, the company waits until problems are big enough to hurt.</p>
        <p>With a scorecard, the company sees pressure building before it becomes a fire.</p>
      </Section>

      <Section title="4. Issues">
        <p>Issues answers the question: Are we solving problems permanently or just talking about them?</p>
        <p>Every contracting company has issues.</p>
        <p>The difference between a weak company and a strong company is not whether problems exist. The difference is whether problems get named, prioritized, solved, and prevented from repeating.</p>
        <p>Most companies do not have an issue-solving system. They have complaint loops.</p>
        <p>They talk about the same problems in the truck, in the office, in the hallway, over lunch, after the meeting, and again next week.</p>
        <p>Nothing gets solved because the problem never gets processed.</p>
        <p>The issue list is where problems go so they stop floating around the company. The IDS process is how they get solved:</p>
        <DoctrineList items={[
          "Identify the real issue.",
          "Discuss it honestly.",
          "Solve it with a clear decision or action.",
        ]} />
        <p>The first step is the most important. Most people discuss symptoms. The operating system forces the team to identify the root issue.</p>
        <p>"The PM is overwhelmed" may not be the issue. The real issue might be no standard project handoff.</p>
        <p>"Cash is tight" may not be the issue. The real issue might be billing is late, change orders are not processed, or the company is taking jobs with bad terms.</p>
        <p>"The field is chaotic" may not be the issue. The real issue might be weak preconstruction, no procurement planning, no weekly production rhythm, or unclear superintendent accountability.</p>
        <p className="body-text-emphasis">Strong companies solve root issues. Weak companies keep reacting to symptoms.</p>
        <p>AOS gives the team a place to capture issues, prioritize them, assign ownership, and follow through. That is how problems stop living in the owner's head.</p>
      </Section>

      <Section title="5. Process">
        <p>Process answers the question: How do we do things here?</p>
        <p>This is where entrepreneurs start to get uncomfortable. They hear "process" and think corporate paperwork.</p>
        <p>That is the wrong way to look at it. Process is not paperwork. Process is repeatability.</p>
        <p>If the company cannot repeat a result without the owner explaining it, the process is not built.</p>
        <p>Every contracting company needs core processes:</p>
        <DoctrineList items={[
          "How we estimate",
          "How we qualify work",
          "How we price change orders",
          "How we hand off from estimating to operations",
          "How we buy out a project",
          "How we onboard a client",
          "How we bill",
          "How we collect",
          "How we schedule",
          "How we manage RFIs",
          "How we document field changes",
          "How we close out a job",
          "How we hire",
          "How we train",
          "How we market",
          "How we sell",
        ]} />
        <p>These do not need to become 200-page manuals. That is where people get stuck.</p>
        <p>Start by thin-slicing the work. Write down the major steps. Name the owner. Define the standard. Identify the forms, templates, tools, and checkpoints. Then improve it as the company uses it.</p>
        <p>The point is not perfection. The point is that the company stops depending on tribal knowledge.</p>
        <p>Tribal knowledge is expensive. It lives in people's heads. It disappears when they leave. It changes from person to person. It creates inconsistency. It makes training harder. It forces the owner to stay involved.</p>
        <p className="body-text-emphasis">Process turns tribal knowledge into company property.</p>
      </Section>

      <Section title="6. Traction">
        <p>Traction answers the final question: Are we executing?</p>
        <p>This is where the system either works or becomes another binder on the shelf.</p>
        <p>Traction is the execution rhythm of the company. It includes quarterly Rocks, weekly meetings, to-dos, scorecard review, issue solving, and follow-through.</p>
        <p>Rocks are the few mission-critical priorities that must be completed in the next 90 days.</p>
        <p>Not 40 priorities. Not every good idea. Not everything the owner is frustrated about.</p>
        <p>Three to seven priorities. Owned by specific people. Reviewed every week. Completed in the quarter.</p>
        <p>This is how the company stops trying to fix everything at once.</p>
        <p>The weekly meeting rhythm keeps the company honest. Every week, the leadership team reviews the scorecard, checks Rocks, reviews customer and employee headlines, reviews to-dos, solves issues, and ends with clarity.</p>
        <p>That rhythm matters because execution is not an event. Execution is a cadence.</p>
        <p>The company does not become disciplined because the owner gave a passionate speech.</p>
        <p>The company becomes disciplined because the system keeps pulling the team back to the mission, the numbers, the priorities, and the unresolved issues every single week.</p>
        <p className="body-text-emphasis">That is Traction. And without Traction, Vision is just talk.</p>
      </Section>
    </div>
  );
};

export default Chapter29;
