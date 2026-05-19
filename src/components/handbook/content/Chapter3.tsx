import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';
import Parable from '../Parable';
import ExpandableImage from '../ExpandableImage';
import alpScalingStool from '@/assets/alp-scaling-stool.png';

const Chapter3: React.FC = () => {
  return (
    <div id="chapter-3" className="py-24 border-t border-chapter-divider">
      <ChapterHeader 
        number={3} 
        title="The ALP Scaling Stool" 
      />

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          Most contracting businesses do not fail dramatically.
        </p>
        <p>
          They wobble.
        </p>
        <p>
          They feel unstable.<br />
          They feel reactive.<br />
          They feel unpredictable.
        </p>
        <p>
          Owners describe it as:
        </p>
        <DoctrineList items={[
          '"We\'re busy but stressed"',
          '"Cash feels tight even though revenue is up"',
          '"Everything depends on me"',
          '"One problem turns into ten"'
        ]} />
        <p>
          That instability is not random.
        </p>
        <p className="body-text-emphasis">
          It is structural.
        </p>
      </div>

      <div className="chapter-divider" />

      <Section title="Why the Ladder Model Fails">
        <p>
          Most people believe business growth works like a ladder.
        </p>
        <p>
          You climb rung by rung:<br />
          More jobs → more people → more revenue → more success.
        </p>
        <p>
          That mental model is wrong.
        </p>
        <p>
          Ladders assume balance automatically.<br />
          Businesses do not work that way.
        </p>
        <p>
          In contracting, adding weight without support doesn't lift you.<br />
          It <strong>breaks you</strong>.
        </p>
      </Section>

      <Section title="The Stool Is the Correct Model">
        <p>
          A contracting business behaves like a stool.
        </p>
        <p>
          It stands on multiple legs <strong>at the same time</strong>.
        </p>
        <p>
          If one leg weakens, the stool wobbles.<br />
          If two weaken, it becomes unstable.<br />
          If three weaken, it collapses — regardless of how strong the remaining leg is.
        </p>
        <p>
          The stool does not reward strength in one area.<br />
          It requires <strong>balance across all areas</strong>.
        </p>
        <p>
          This is why many contractors feel fine at one level of scale and overwhelmed at the next.
        </p>
        <p className="body-text-emphasis">
          Growth exposed imbalance that already existed.
        </p>
      </Section>

      <figure className="my-16">
        <ExpandableImage 
          src={alpScalingStool} 
          alt="The ALP Scaling Stool - A Contracting Company Does Not Grow by Climbing, It Grows by Balancing. Shows a five-legged stool with Marketing, Sales, Operations, People, and Financial Command as the legs supporting The Business." 
          className="w-full max-w-4xl mx-auto rounded-lg shadow-lg"
        />
      </figure>

      <Section title="The Five Legs of the ALP Scaling Stool">
        <p>
          The ALP Scaling Stool consists of five legs:
        </p>
        <DoctrineList items={[
          "Marketing",
          "Sales",
          "Operations",
          "People",
          "Financial Command"
        ]} />
        <p>
          These legs are not departments.<br />
          They are <strong>functions</strong>.
        </p>
        <p>
          Every contracting business has all five — whether intentionally built or not.
        </p>
        <p>
          The question is not whether they exist.
        </p>
        <p className="body-text-emphasis">
          The question is whether they are strong enough to carry the current load.
        </p>
      </Section>

      <Section title="The Seat of the Stool">
        <p>
          At the top of the stool sits the business itself:
        </p>
        <DoctrineList items={[
          "Contracts",
          "Cash flow",
          "Delivery",
          "Reputation",
          "Longevity"
        ]} />
        <p>
          The business is not a leg.
        </p>
        <p>
          It is <strong>supported</strong> by the legs.
        </p>
        <p>
          This distinction matters, because most entrepreneurs try to fix the seat while ignoring the structure underneath it.
        </p>
      </Section>

      <Section title="Marketing — The Visibility Leg">
        <p>
          Marketing ensures the business is known.
        </p>
        <p>
          Its job is not creativity.<br />
          Its job is <strong>consistency</strong>.
        </p>
        <p>
          Marketing feeds attention into the business.<br />
          Without it, sales starves.<br />
          When sales starves, panic sets in.
        </p>
        <p className="body-text-emphasis">
          Inconsistent marketing produces inconsistent opportunity.
        </p>
        <p className="italic font-serif text-xl">
          Water beats the rock not by force, but by repetition.
        </p>
      </Section>

      <Section title="Sales — The Commitment Leg">
        <p>
          Sales converts attention into contracts.
        </p>
        <p>
          Sales is not persuasion.<br />
          It is clarity.
        </p>
        <p>
          A contract is signed when a client believes:
        </p>
        <DoctrineList items={[
          "Risk is understood",
          "Risk is priced",
          "Risk is managed"
        ]} />
        <p>
          Without sales, marketing is wasted motion.
        </p>
        <p className="body-text-emphasis">
          Sales is oxygen.<br />
          Everything else depends on it.
        </p>
      </Section>

      <Section title="Operations — The Delivery Leg">
        <p>
          Operations is where most contractors believe their business lives.
        </p>
        <p>
          That belief is incomplete.
        </p>
        <p>
          Operations is not labor.<br />
          It is <strong>logistics</strong>.
        </p>
        <p>
          It is the coordination of:
        </p>
        <DoctrineList items={[
          "People",
          "Time",
          "Materials",
          "Information",
          "Sequencing"
        ]} />
        <p>
          Poor operations quietly erode profit, even on good jobs.
        </p>
        <p className="body-text-emphasis">
          Strong operations turn complexity into predictability.
        </p>
      </Section>

      <Section title="People — The Capacity Leg">
        <p>
          People determine whether the business can grow beyond the owner.
        </p>
        <p>
          If everything routes through one person, scale is impossible.
        </p>
        <p>
          People systems include:
        </p>
        <DoctrineList items={[
          "Recruiting",
          "Accountability",
          "Role clarity",
          "Culture",
          "Standards"
        ]} />
        <p>
          A business without people systems does not scale.<br />
          It multiplies stress.
        </p>
      </Section>

      <Section title="Financial Command — The Control Leg">
        <p>
          Revenue is not control.
        </p>
        <p className="body-text-emphasis">
          Visibility is control.
        </p>
        <p>
          Financial command means:
        </p>
        <DoctrineList items={[
          "Knowing where money is made",
          "Knowing where it is lost",
          "Knowing where risk is accumulating",
          "Knowing cash position in real time"
        ]} />
        <p>
          Businesses do not fail from lack of revenue.<br />
          They fail from lack of financial command.
        </p>
      </Section>

      <div className="chapter-divider" />

      <Section title="Why Marketing and Sales Are Oxygen Legs">
        <p>
          All five legs matter.
        </p>
        <p>
          But two legs feed the rest:
        </p>
        <DoctrineList items={[
          "Marketing",
          "Sales"
        ]} />
        <p>
          Without them:
        </p>
        <DoctrineList items={[
          "Operations panics",
          "People become unstable",
          "Financial pressure increases",
          "Decision-making degrades"
        ]} />
        <p>
          This is why ALP addresses these legs early.
        </p>
        <p className="body-text-emphasis">
          Without oxygen, nothing else survives long enough to improve.
        </p>
      </Section>

      <Section title="Balance Over Strength">
        <p>
          The goal is not to perfect each leg.
        </p>
        <p>
          The goal is to keep every leg <strong>functional and improving together</strong>.
        </p>
        <p>
          An exceptional operations leg does not save weak sales.<br />
          Strong sales does not save financial blindness.<br />
          Great people do not fix poor delivery.
        </p>
        <p className="body-text-emphasis">
          The stool requires balance, not heroics.
        </p>
      </Section>

      <Section title="Diagnosing Instability">
        <p>
          When the business feels "off," the question is never:<br />
          "What tactic do I need?"
        </p>
        <p>
          The question is:
        </p>
        <p className="blockquote-doctrine">
          Which leg is failing right now?
        </p>
        <p>
          This diagnostic lens eliminates guesswork.
        </p>
        <p className="body-text-emphasis">
          Instability always points to imbalance.
        </p>
      </Section>

      <Parable id="parable-uneven-table" title="The Uneven Table">
        <p>
          A table with one short leg rocks constantly.
        </p>
        <p>
          Adding weight doesn't fix it.<br />
          Decorating it doesn't fix it.
        </p>
        <p className="body-text-emphasis">
          Only balance does.
        </p>
      </Parable>

      <Section title="The Entrepreneur's Role">
        <p>
          The entrepreneur is responsible for the stool.
        </p>
        <p>
          Not by doing everything —<br />
          but by <strong>seeing everything clearly</strong>.
        </p>
        <p>
          This requires:
        </p>
        <DoctrineList items={[
          "Altitude to zoom out",
          "Logic to diagnose accurately",
          "Pressure to act decisively"
        ]} />
        <p className="body-text-emphasis">
          That is ALP in practice.
        </p>
      </Section>

      <Section title="Final Truth">
        <p>
          Growth does not fix weak legs.
        </p>
        <p className="body-text-emphasis">
          Growth exposes them.
        </p>
        <p>
          The scaling stool is not theory.<br />
          It is reality, whether acknowledged or not.
        </p>
        <p>
          Those who understand it early build businesses that last.
        </p>
        <p>
          Those who ignore it relearn the lesson under pressure.
        </p>
      </Section>
    </div>
  );
};

export default Chapter3;
