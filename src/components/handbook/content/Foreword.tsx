import React from 'react';
import Section from '../Section';
import Eyebrow from '@/components/editorial/Eyebrow';

const Foreword: React.FC = () => {
  return (
    <div id="foreword" className="py-24 border-t border-chapter-divider">
      <header className="mb-16">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-6">
          <Eyebrow accent bare>Updated for V2</Eyebrow>
          <Eyebrow bare>Foreword</Eyebrow>
        </div>
        <h2 className="chapter-heading">Author's Note</h2>
      </header>




      <div className="body-text space-y-6 max-w-3xl">
        <p>This book is not theory.</p>
        <p>It is not a motivational book.</p>
        <p>It is not a collection of nice ideas about leadership, business, or construction.</p>
        <p className="body-text-emphasis">
          This is a field handbook for contractors who are trying to build the company behind the projects.
        </p>
        <p>
          Most contractors are good builders. That is not the problem. They know how to produce work. They know how to fight through hard jobs. They know how to solve problems in the field. They know how to carry pressure.
        </p>
        <p>But building projects and building a company are not the same thing.</p>
        <p>
          A contractor can be excellent at the work and still have a weak business. A contractor can have revenue, employees, trucks, software, backlog, and reputation and still be completely dependent on the owner to hold the whole thing together.
        </p>
        <p>That is the real problem this book is written to address.</p>
      </div>

      <Section title="Why Companies Fail">
        <p>
          The modern contracting company does not fail because the owner lacks work ethic. It fails because the business has not been turned into a system.
        </p>
        <p>
          Everything flows back to the owner. Decisions flow back to the owner. Problems flow back to the owner. Standards flow back to the owner. Sales pressure, estimating judgment, scheduling conflicts, billing issues, people problems, and jobsite disorder all eventually make their way back to the same place.
        </p>
        <p>At first, that feels like leadership.</p>
        <p className="body-text-emphasis">Eventually, it becomes bondage.</p>
        <p>The purpose of the ALP Handbook is to give contractors a practical doctrine for escaping that trap.</p>
      </Section>

      <Section title="The Frame: Altitude, Logic, Pressure">
        <p>ALP stands for Altitude, Logic, and Pressure.</p>
        <p>
          <strong>Altitude</strong> means you have to get above the chaos long enough to see the actual business problem.
        </p>
        <p>
          <strong>Logic</strong> means you have to make decisions from facts, structure, math, contracts, sequence, accountability, and consequence.
        </p>
        <p>
          <strong>Pressure</strong> means you have to apply force in the right place. Not emotional pressure. Not random urgency. Useful pressure. Commercial pressure. Leadership pressure. Execution pressure.
        </p>
        <p>That is the frame.</p>
        <p>But a frame is not enough.</p>
      </Section>

      <Section title="Why the Operating System">
        <p>A contracting company also needs an operating system.</p>
        <p>
          It needs a formal way to define the mission, assign ownership, measure execution, solve issues, document process, and create weekly accountability. It needs to move from an owner-dependent hierarchy into an accountability model where people own real outcomes and the business can police itself through standards, numbers, priorities, and rhythm.
        </p>
        <p>That is where AOS comes in.</p>
        <p>
          AOS is the ALP Operating System. It is the practical structure for running a contracting company with clarity, accountability, and execution discipline. It is not meant to make the company more corporate. It is meant to make the company more executable.
        </p>
      </Section>

      <Section title="The Lens of This Book">
        <p>The chapters in this handbook are built around that idea.</p>
        <p><strong>Marketing</strong> is not just marketing. It is infrastructure.</p>
        <p><strong>Sales</strong> is not just persuasion. It is pressure, clarity, and qualification.</p>
        <p><strong>Operations</strong> is not just labor. It is logistics, margin protection, and controlled execution.</p>
        <p><strong>Documentation</strong> is not paperwork. It is entitlement and proof.</p>
        <p><strong>Scheduling</strong> is not a calendar. It is time control.</p>
        <p><strong>Financial command</strong> is not bookkeeping. It is the owner's ability to see the truth early enough to act.</p>
        <p><strong>General conditions</strong> are not overhead. They are a recoverable cost structure and, when understood correctly, a profit center.</p>
        <p><strong>Change orders</strong> are not a nuisance. They are the monetization of disruption.</p>
        <p><strong>Leadership</strong> is not personality. It is standards, accountability, repetition, and enforcement.</p>
        <p>That is the lens of this book.</p>
        <p>The goal is not to help you feel better about your business.</p>
        <p className="body-text-emphasis">The goal is to help you see it clearly enough to operate it.</p>
      </Section>

      <Section title="How to Read It">
        <p>
          Read this book as a working reference. Mark it up. Argue with it. Bring it into meetings. Use it when you are pricing work, reviewing a contract, preparing a notice, evaluating a manager, building a scorecard, creating a process, or deciding whether the problem in front of you is really a construction problem or an entrepreneurial one.
        </p>
        <p>Because most of the time, the problem is not the project.</p>
        <p>The project is just where the weakness in the company finally became visible.</p>
        <p>This handbook is about building the company strong enough that the same problems stop repeating.</p>
        <p className="body-text-emphasis">That is the work.</p>
        <p className="pt-8 text-right italic font-serif text-xl">
          — Marshall Wilkinson
        </p>
      </Section>
    </div>
  );
};

export default Foreword;
