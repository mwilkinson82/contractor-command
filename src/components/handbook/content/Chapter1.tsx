import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';

const Chapter1: React.FC = () => {
  return (
    <div id="chapter-1" className="py-24 border-t border-chapter-divider">
      <ChapterHeader 
        number={1} 
        title="The ALP Doctrine — Altitude, Logic, Pressure" 
      />

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Every successful operator eventually develops a way of seeing the world.
        </p>
        <p>
          Not tactics.<br />
          Not tricks.<br />
          A lens.
        </p>
        <p className="body-text-emphasis">
          ALP is that lens.
        </p>
        <p>
          Altitude.<br />
          Logic.<br />
          Pressure.
        </p>
        <p>
          These are not personality traits.<br />
          They are not motivational concepts.
        </p>
        <p className="body-text-emphasis">
          They are operating states.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="Altitude: Seeing the System">
        <p>
          Altitude is the ability to rise above emotion, noise, and immediacy.
        </p>
        <p>
          It is perspective.
        </p>
        <p>
          From altitude, you can see:
        </p>
        <DoctrineList items={[
          "Patterns instead of incidents",
          "Systems instead of people",
          "Causes instead of symptoms"
        ]} />
        <p>
          Low altitude feels urgent.<br />
          High altitude feels calm.
        </p>
        <p className="body-text-emphasis">
          Most bad decisions are made at low altitude.
        </p>
      </Section>

      <Section title="Logic: Defining the Problem">
        <p>
          Logic is discipline.
        </p>
        <p>
          It asks:
        </p>
        <DoctrineList items={[
          "What is actually happening?",
          "Where are the constraints?",
          "What variables matter?",
          "What does not matter?"
        ]} />
        <p>
          Logic removes drama.
        </p>
        <p>
          It forces precision.
        </p>
        <p>
          Without logic, altitude becomes detachment.<br />
          With logic, altitude becomes power.
        </p>
      </Section>

      <Section title="Pressure: Enforcing Reality">
        <p>
          Pressure is responsibility in action.
        </p>
        <p>
          It is the willingness to:
        </p>
        <DoctrineList items={[
          "Decide",
          "Enforce",
          "Hold the line",
          "Move forward despite discomfort"
        ]} />
        <p>
          Pressure is not aggression.<br />
          It is not domination.
        </p>
        <p className="body-text-emphasis">
          It is commitment to action.
        </p>
        <p>
          Most entrepreneurs fail here — not because they don't know what to do, but because they hesitate to apply pressure when it counts.
        </p>
      </Section>

      <Section title="ALP Is a Sequence">
        <p>
          ALP must be used in order.
        </p>
        <p>
          Altitude first.<br />
          Logic second.<br />
          Pressure last.
        </p>
        <p>
          Pressure without altitude is reaction.<br />
          Pressure without logic is chaos.
        </p>
        <p className="body-text-emphasis">
          But pressure applied after altitude and logic?
        </p>
        <p className="body-text-emphasis">
          That is command.
        </p>
      </Section>

      <Parable id="parable-calm-operator" title="The Calm Operator">
        <p>
          Two owners face the same problem: a delayed project and an angry client.
        </p>
        <p>
          One reacts.<br />
          Explains.<br />
          Apologizes.<br />
          Overpromises.
        </p>
        <p>
          The other pauses.<br />
          Steps back.<br />
          Maps the facts.<br />
          Issues notice.<br />
          Holds position.
        </p>
        <p>
          Same situation.<br />
          Different altitude.
        </p>
        <p className="body-text-emphasis">
          One loses control.<br />
          The other preserves it.
        </p>
      </Parable>

      <Section title="ALP as a Habit">
        <p>
          ALP is not something you "do" once.
        </p>
        <p>
          It is how you:
        </p>
        <DoctrineList items={[
          "Start your day",
          "Diagnose problems",
          "Lead meetings",
          "Handle conflict",
          "Make decisions"
        ]} />
        <p>
          Eventually, it becomes instinct.
        </p>
        <p className="body-text-emphasis">
          That is when outcomes change.
        </p>
      </Section>
    </div>
  );
};

export default Chapter1;
