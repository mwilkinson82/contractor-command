import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';

const Chapter8: React.FC = () => {
  return (
    <div id="chapter-8" className="py-24 border-t border-chapter-divider">
      <ChapterHeader 
        number={8} 
        title="General Conditions & Invisible Costs" 
      />

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most contractors treat General Conditions as overhead.
        </p>
        <p>
          Something to minimize.<br />
          Something to "absorb."<br />
          Something that doesn't feel like real construction.
        </p>
        <p>
          That misunderstanding destroys more profit than bad labor, bad subs, or bad estimating ever will.
        </p>
        <p className="body-text-emphasis">
          General Conditions are not overhead.
        </p>
        <p>
          They are time-based costs, and time is the most dangerous variable in construction.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="Why General Conditions Are Invisible Until They Aren't">
        <p>
          General Conditions don't arrive all at once.
        </p>
        <p>
          They leak.
        </p>
        <p>
          Quietly.<br />
          Daily.<br />
          Predictably.
        </p>
        <p>
          Supervision stays a little longer.<br />
          Trailers remain on site a little longer.<br />
          Temporary power keeps running.<br />
          Management keeps checking in.<br />
          Schedules keep slipping.
        </p>
        <p>
          Nothing explodes.
        </p>
        <p className="body-text-emphasis">
          Margin just disappears.
        </p>
        <p>
          This is why General Conditions are so dangerous — they don't feel expensive in isolation, but they compound relentlessly.
        </p>
      </Section>

      <Section title="The Core Misunderstanding">
        <p>
          Most contractors think:
        </p>
        <p className="blockquote-doctrine">
          "If the job is moving, we're fine."
        </p>
        <p>
          That's false.
        </p>
        <p>
          General Conditions are not tied to production.
        </p>
        <p>
          They are tied to <strong>time</strong>.
        </p>
        <p>
          A job can look active and still be bleeding.
        </p>
        <p className="body-text-emphasis">
          If the duration extends, General Conditions expand — regardless of how hard people are working.
        </p>
      </Section>

      <Section title="What General Conditions Really Are">
        <p>
          General Conditions include, but are not limited to:
        </p>
        <DoctrineList items={[
          "Project supervision",
          "Site management",
          "Scheduling and coordination",
          "Temporary facilities and utilities",
          "Safety compliance",
          "QA/QC processes",
          "Professional services",
          "Administrative oversight",
          "Logistics and access control"
        ]} />
        <p>
          None of these pour concrete.<br />
          None of these install material.
        </p>
        <p>
          But all of them exist for as long as the job exists.
        </p>
        <p className="body-text-emphasis">
          That's the key.
        </p>
      </Section>

      <Section title="Time Is the Multiplier">
        <p>
          Labor is a variable cost.<br />
          Materials are a variable cost.
        </p>
        <p className="body-text-emphasis">
          General Conditions are a duration cost.
        </p>
        <p>
          Every additional day multiplies:
        </p>
        <DoctrineList items={[
          "Supervision cost",
          "Overhead allocation",
          "Administrative load",
          "Opportunity cost",
          "Emotional strain on leadership"
        ]} />
        <p>
          This is why schedule control is financial control.
        </p>
        <p className="body-text-emphasis">
          Lose time — and General Conditions expand automatically.
        </p>
      </Section>

      <Section title="The Lie Contractors Tell Themselves">
        <p>
          Here's the lie:
        </p>
        <p className="blockquote-doctrine">
          "It's only a small delay."
        </p>
        <p>
          There is no such thing.
        </p>
        <p>
          Small delays stack.<br />
          Small delays compound.<br />
          Small delays metastasize.
        </p>
        <p className="body-text-emphasis">
          And General Conditions are always there to collect the bill.
        </p>
      </Section>

      <Parable id="parable-one-week-extension" title="The One-Week Extension">
        <p>
          A project slipped one week.
        </p>
        <p>
          No formal change.<br />
          No notice.<br />
          No documentation.
        </p>
        <p>
          Superintendent stayed.<br />
          Trailer stayed.<br />
          Temporary utilities stayed.<br />
          PM stayed involved.
        </p>
        <p>
          No one felt alarmed.
        </p>
        <p>
          By the time the job closed, the margin was gone.
        </p>
        <p>
          Not because of a mistake.
        </p>
        <p className="body-text-emphasis">
          Because time was allowed to drift — and General Conditions followed it faithfully.
        </p>
      </Parable>

      <Section title="Why General Conditions Are Rarely Recovered">
        <p>
          Most contractors fail to recover GC's because:
        </p>
        <DoctrineList items={[
          "They don't tie them to time explicitly",
          "They don't document disruption early",
          "They don't issue notice",
          "They don't update schedules",
          "They don't quantify duration impact"
        ]} />
        <p>
          Owners don't pay for effort.<br />
          They pay for demonstrated time impact.
        </p>
        <p className="body-text-emphasis">
          If you can't show how time extended, GC's become "your problem."
        </p>
      </Section>

      <Section title="GC's Connect the Entire Stool">
        <p>
          General Conditions sit at the intersection of:
        </p>
        <DoctrineList items={[
          "Operations",
          "Scheduling",
          "Documentation",
          "Notices",
          "Financial command"
        ]} />
        <p>
          Weakness in any one of those legs shows up here first.
        </p>
        <p className="body-text-emphasis">
          This is why GC's are diagnostic.
        </p>
        <p>
          If your General Conditions are always "tight," something upstream is broken.
        </p>
      </Section>

      <Section title="Why Operators Emotionally Avoid GC's">
        <p>
          General Conditions feel abstract.
        </p>
        <p>
          They don't feel like:
        </p>
        <DoctrineList items={[
          "Concrete",
          "Steel",
          "Labor hours"
        ]} />
        <p>
          They feel like "soft costs."
        </p>
        <p>
          But soft does not mean optional.
        </p>
        <p className="body-text-emphasis">
          It means unprotected.
        </p>
        <p>
          Contractors who avoid GC's emotionally tend to:
        </p>
        <DoctrineList items={[
          "Accept delays casually",
          "Over-accommodate clients",
          "Avoid conflict",
          "Delay notices",
          "Rationalize lost time"
        ]} />
        <p>
          Those behaviors don't feel dangerous.
        </p>
        <p className="body-text-emphasis">
          Until the job ends.
        </p>
      </Section>

      <Section title="General Conditions Are Not a Back-End Problem">
        <p>
          Most contractors try to deal with GC's at the end of the job.
        </p>
        <p className="body-text-emphasis">
          That's too late.
        </p>
        <p>
          General Conditions must be managed daily, not reconciled later.
        </p>
        <p>
          You protect GC's by:
        </p>
        <DoctrineList items={[
          "Enforcing sequence",
          "Preventing start–stop work",
          "Controlling access",
          "Driving decisions",
          "Documenting disruption",
          "Updating schedules",
          "Issuing timely notice"
        ]} />
        <p className="body-text-emphasis">
          GC's are not recovered retroactively.
        </p>
        <p>
          They are preserved proactively.
        </p>
      </Section>

      <Section title="The Operator's Responsibility">
        <p>
          The entrepreneur must understand this clearly:
        </p>
        <p className="blockquote-doctrine">
          If time slips and General Conditions are not protected,<br />
          profit is being given away silently.
        </p>
        <p>
          Not stolen.<br />
          Not disputed.
        </p>
        <p className="body-text-emphasis">
          Given away.
        </p>
        <p>
          Strong operators don't argue about GC's emotionally.
        </p>
        <p>
          They structure the job so GC's are either:
        </p>
        <DoctrineList items={[
          "Protected, or",
          "Entitled, or",
          "Eliminated through time control"
        ]} />
        <p className="body-text-emphasis">
          Anything else is hope.
        </p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p>
          <strong>Altitude</strong> lets you see General Conditions as time exposure, not overhead.<br />
          <strong>Logic</strong> forces you to connect duration to cost explicitly.<br />
          <strong>Pressure</strong> requires you to enforce schedules, notices, and decisions early.
        </p>
        <p className="body-text-emphasis">
          Remove any one of these — and GC's will bleed unnoticed.
        </p>
      </Section>

      <Section title="Final Truth">
        <p>
          Most contractors don't lose money on labor.
        </p>
        <p className="body-text-emphasis">
          They lose it on time they failed to control.
        </p>
        <p>
          General Conditions are not invisible.
        </p>
        <p>
          They are ignored.
        </p>
        <p>
          And whatever is ignored in this business eventually gets paid for —<br />
          just not by the person who caused it.
        </p>
        <p className="body-text-emphasis">
          Control time.<br />
          Protect General Conditions.<br />
          Or watch profit disappear quietly.
        </p>
      </Section>
    </div>
  );
};

export default Chapter8;
