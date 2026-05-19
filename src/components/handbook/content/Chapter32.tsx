import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';

const Chapter32: React.FC = () => {
  return (
    <div id="chapter-32" className="py-24 border-t border-chapter-divider">
      <ChapterHeader number={9} title="Why AOS Belongs in an Application" />

      <div className="body-text space-y-6 max-w-3xl">
        <p>An operating system cannot live in scattered places forever.</p>
        <p>
          If the V/TO is in one PDF, the scorecard is in one spreadsheet, Rocks are in someone's notebook, issues are in a meeting agenda, SOPs are in a folder, accountability is in someone's head, and follow-up is buried in email, the company does not really have one operating system.
        </p>
        <p>It has pieces. Pieces are better than nothing. But pieces still create friction.</p>
        <p className="body-text-emphasis">The company needs one place to run the system. That is why AOS belongs in an application.</p>
      </div>

      <Section title="The App Is Not the System">
        <p>The app is not the operating system by itself. This is important.</p>
        <p>Software does not create discipline. Software does not fix weak leadership. Software does not make people accountable if the company refuses to hold them accountable. Software does not replace the hard conversations.</p>
        <p>But the right software gives the operating system a home.</p>
        <p>It centralizes the work. It stores the company memory. It keeps the scorecard visible. It keeps Rocks visible. It keeps issues from disappearing.</p>
        <p>It connects decisions to owners. It connects problems to process gaps. It connects weekly execution to quarterly priorities. It gives the leadership team one place to see what matters.</p>
      </Section>

      <Section title="Why Scattered Systems Die">
        <p>That matters because scattered systems die.</p>
        <p>They die because people cannot find things.</p>
        <p>They die because the owner stops updating them.</p>
        <p>They die because nobody knows which version is current.</p>
        <p>They die because the meeting rhythm is separate from the tools.</p>
        <p>They die because the company has too many places where truth can hide.</p>
        <p>AOS is designed to centralize the operating system so the company can actually use it.</p>
        <p className="body-text-emphasis">The goal is not more software. The goal is less chaos.</p>
        <p>One place for Vision. One place for the Accountability Chart. One place for the Scorecard. One place for Rocks. One place for Issues. One place for Processes. One place for meeting rhythm. One place for follow-through.</p>
        <p>That is what a contracting company needs if it is serious about scaling.</p>
      </Section>

      <Section title="A Real Command Center">
        <p>The owner should be able to look at the system and know:</p>
        <DoctrineList items={[
          "Where are we going?",
          "Who owns what?",
          "What numbers are off?",
          "What priorities are on track or off track?",
          "What issues are unresolved?",
          "What process gaps keep creating pain?",
          "What commitments were made?",
          "What needs to happen next?",
        ]} />
        <p>That is a command center. Not a dashboard full of vanity charts. A real command center. The kind that tells the truth and drives action.</p>
      </Section>

      <Section title="The Natural Evolution">
        <p>This is the natural evolution of the contracting company.</p>
        <p>First, the owner runs everything by force.</p>
        <p>Then the company installs an operating system.</p>
        <p>Then the operating system gets centralized in AOS.</p>
        <p>Then the company starts to build process, accountability, and execution on top of that foundation.</p>
        <p>That is how the company becomes less dependent on the owner.</p>
        <p>That is how the leadership team becomes more accountable.</p>
        <p>That is how the company becomes more measurable.</p>
        <p>That is how issues get solved faster.</p>
        <p>That is how priorities stop changing every week.</p>
        <p>That is how the business starts operating like a real business.</p>
        <p>There is nothing mystical about it.</p>
        <p>It is structure. It is cadence. It is accountability. It is numbers. It is process. It is execution.</p>
        <p className="body-text-emphasis">That is the operating system.</p>
        <p>And if a contractor wants to build a company that can grow beyond the owner's personal capacity, this is not optional. It is the work.</p>
      </Section>
    </div>
  );
};

export default Chapter32;
