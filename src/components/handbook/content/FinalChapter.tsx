import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import DoctrineList from '../DoctrineList';

const FinalChapter: React.FC = () => {
  return (
    <div id="final-chapter" className="chapter-container">
      <ChapterHeader 
        number={26}
        title="The ALP Way — Doctrine & Commitment" 
        subtitle="Final Chapter"
      />
      
      <Section>
        <p>ALP is not a tactic.</p>
        <p>It is not a framework you use when convenient.<br />
        It is not a set of ideas you agree with intellectually.</p>
        <p><strong>ALP is an operating doctrine.</strong></p>
        <p>It is how you see.<br />
        How you decide.<br />
        How you act.<br />
        How you carry pressure.<br />
        How you lead when things are unclear.</p>
        <p>This chapter is not instruction.</p>
        <p><strong>It is a line in the sand.</strong></p>
      </Section>

      <Section title="Why ALP Exists">
        <p>Most entrepreneurs are not lacking effort.<br />
        They are not lazy.<br />
        They are not unintelligent.</p>
        <p>They are <strong>undisciplined under pressure</strong>.</p>
        <p>ALP exists to solve that.</p>
        <p>Not by removing pressure —<br />
        but by creating people capable of carrying it.</p>
      </Section>

      <Section title="The World Does Not Reward Intent">
        <p>The market does not care how hard you try.<br />
        Clients do not care what you meant.<br />
        Employees do not care what you hoped would happen.</p>
        <p>They respond to:</p>
        <DoctrineList items={[
          "Clarity",
          "Consistency",
          "Standards",
          "Execution"
        ]} />
        <p>ALP aligns intention with outcome.</p>
      </Section>

      <Section title="Altitude Is the Refusal to Panic">
        <p><strong>Altitude</strong> is the ability to rise above emotion.</p>
        <p>It is the refusal to:</p>
        <DoctrineList items={[
          "React impulsively",
          "Solve the wrong problem",
          "Fight at the wrong level",
          "Confuse urgency with importance"
        ]} />
        <p>Altitude creates space.<br />
        Space creates clarity.<br />
        Clarity creates power.</p>
        <p>Without altitude, everything feels personal.<br />
        With altitude, everything becomes manageable.</p>
      </Section>

      <Section title="Logic Is Respect for Reality">
        <p><strong>Logic</strong> is not cold.<br />
        It is honest.</p>
        <p>Logic refuses:</p>
        <DoctrineList items={[
          "Excuses",
          "Stories",
          "Rationalization",
          "Self-deception"
        ]} />
        <p>Logic asks:</p>
        <DoctrineList items={[
          "What is true?",
          "What is constrained?",
          "What actually works?",
          "What does not?"
        ]} />
        <p>Logic is how professionals honor reality —<br />
        even when it is uncomfortable.</p>
      </Section>

      <Section title="Pressure Is Responsibility in Action">
        <p><strong>Pressure</strong> is not aggression.<br />
        It is not force.<br />
        It is not domination.</p>
        <p>Pressure is <strong>responsibility applied without delay</strong>.</p>
        <p>Pressure:</p>
        <DoctrineList items={[
          "Makes decisions real",
          "Turns clarity into action",
          "Enforces standards",
          "Prevents drift"
        ]} />
        <p>Avoided pressure multiplies problems.<br />
        Applied pressure stabilizes systems.</p>
      </Section>

      <Section title="ALP Is a Way of Being">
        <p>ALP is not something you turn on and off.</p>
        <p>It shows up in:</p>
        <DoctrineList items={[
          "How you price",
          "How you say no",
          "How you enforce standards",
          "How you handle criticism",
          "How you decide when no one agrees with you"
        ]} />
        <p><strong>ALP is identity expressed through action.</strong></p>
      </Section>

      <Section title="The Cost of Half-Commitment">
        <p>Partial adoption of ALP creates frustration.</p>
        <p>If you use:</p>
        <DoctrineList items={[
          "Altitude without Pressure → you drift",
          "Logic without Pressure → you delay",
          "Pressure without Logic → you damage trust"
        ]} />
        <p>ALP works only when all three are present.</p>
        <p>This is why most people fail with it.</p>
        <p>They want the clarity —<br />
        without the responsibility.</p>
      </Section>

      <Section title="The Commitment">
        <p>If you choose the ALP Way, you are committing to:</p>
        <DoctrineList items={[
          "Seeing reality clearly",
          "Deciding without avoidance",
          "Enforcing standards consistently",
          "Carrying pressure without resentment",
          "Taking responsibility without blame",
          "Leading without needing approval"
        ]} />
        <p>This is not easy.</p>
        <p><strong>It is clean.</strong></p>
      </Section>

      <Section title="Who ALP Is Not For">
        <p>ALP is not for:</p>
        <DoctrineList items={[
          "Those who need validation",
          "Those who avoid conflict",
          "Those who blame circumstances",
          "Those who want shortcuts",
          "Those who want comfort"
        ]} />
        <p>There are easier paths.</p>
        <p>ALP is not one of them.</p>
      </Section>

      <Section title="Who ALP Is For">
        <p>ALP is for:</p>
        <DoctrineList items={[
          "Entrepreneurs who want control",
          "Leaders who accept responsibility",
          "Operators who value clarity over comfort",
          "Professionals who want to scale without losing themselves"
        ]} />
        <p>ALP is for those willing to become more than they are today.</p>
      </Section>

      <Section title="Final Doctrine">
        <p>You will be misunderstood.<br />
        You will be criticized.<br />
        You will be tested.<br />
        You will be pressured.</p>
        <p><strong>That is the point.</strong></p>
        <p>Pressure reveals identity.<br />
        Identity determines outcome.</p>
        <p>Those who live the ALP Way do not hope things work out.</p>
        <p><strong>They make them work.</strong></p>
      </Section>

      <div className="mt-24 pt-16 border-t border-chapter-divider text-center">
        <h3 className="text-2xl md:text-3xl font-semibold font-serif mb-8">Final Commitment</h3>
        <p className="body-text max-w-2xl mx-auto">If you adopt ALP, do it fully.</p>
        <p className="body-text max-w-2xl mx-auto mt-4">Not when it is convenient.<br />
        Not when things are calm.<br />
        But when it is hardest.</p>
        <p className="body-text max-w-2xl mx-auto mt-4"><strong>Because that is when it matters.</strong></p>
        
        <div className="mt-16 py-12">
          <p className="text-2xl md:text-3xl font-serif font-semibold tracking-wide">
            Altitude.<br />
            Logic.<br />
            Pressure.
          </p>
          <p className="text-xl md:text-2xl font-serif mt-8 opacity-80">
            This is the ALP Way.
          </p>
        </div>
      </div>
    </div>
  );
};

export default FinalChapter;
