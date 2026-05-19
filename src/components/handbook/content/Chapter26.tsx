import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter26: React.FC = () => {
  return (
    <div id="chapter-26" className="chapter-container">
      <ChapterHeader 
        number={23} 
        title="Leadership, Standards, and Cultural Enforcement" 
      />
      
      <Section>
        <p>Culture does not drift upward.</p>
        <p>It always drifts <strong>downward</strong>.</p>
        <p>If it is not actively enforced, it degrades.<br />
        If standards are not protected, they erode.<br />
        If leadership hesitates, disorder fills the gap.</p>
        <p>This chapter exists to clarify one truth:</p>
        <p className="italic"><strong>Culture is not what you say.<br />
        It is what you tolerate.</strong></p>
      </Section>

      <Section title="Leadership Is Not Personality">
        <p>Many contractors confuse leadership with personality.</p>
        <p>They believe leadership means:</p>
        <DoctrineList items={[
          "Being liked",
          "Being charismatic",
          "Being inspiring",
          "Being agreeable"
        ]} />
        <p>Those traits may help — but they are not leadership.</p>
        <p><strong>Leadership is standards under pressure.</strong></p>
        <p>When things are easy, anyone can lead.<br />
        When pressure rises, real leadership is revealed.</p>
      </Section>

      <Section title="Standards Are the Real Culture">
        <p>Culture is not values on a wall.<br />
        It is not slogans.<br />
        It is not meetings.</p>
        <p><strong>Culture is the sum of enforced standards.</strong></p>
        <p>What gets corrected becomes culture.<br />
        What gets ignored becomes culture.<br />
        What gets excused becomes culture.</p>
        <p>There is no neutral ground.</p>
      </Section>

      <Section title="Why Standards Slip">
        <p>Standards erode for predictable reasons:</p>
        <DoctrineList items={[
          "Leaders avoid conflict",
          "Leaders seek approval",
          "Leaders fear turnover",
          "Leaders rationalize exceptions",
          "Leaders delay hard conversations"
        ]} />
        <p>None of these are operational failures.</p>
        <p>They are <strong>identity failures</strong>.</p>
        <p>And once standards slip, recovery becomes expensive.</p>
      </Section>

      <Parable id="parable-first-exception" title="The First Exception">
        <p>A supervisor violated a clear standard.</p>
        <p>The owner noticed.<br />
        He hesitated.<br />
        He let it slide — just once.</p>
        <p>That exception became precedent.<br />
        Precedent became permission.<br />
        Permission became culture.</p>
        <p>Six months later, the owner blamed "the team."</p>
        <p><strong>The team was only following what was tolerated.</strong></p>
      </Parable>

      <Section title="Leadership Is Willingness to Enforce">
        <p>Leadership does not require volume.<br />
        It requires resolve.</p>
        <p>Enforcement means:</p>
        <DoctrineList items={[
          "Addressing issues early",
          "Having uncomfortable conversations",
          "Correcting behavior immediately",
          "Holding lines consistently",
          "Removing people who refuse standards"
        ]} />
        <p>This is not cruelty.</p>
        <p><strong>It is clarity.</strong></p>
      </Section>

      <Section title="Standards Protect Good People">
        <p>Many leaders avoid enforcement because they believe it is harsh.</p>
        <p>In reality, weak enforcement punishes high performers.</p>
        <p>When standards are not enforced:</p>
        <DoctrineList items={[
          "Strong people carry weak ones",
          "Accountability feels unfair",
          "Morale erodes",
          "Resentment grows"
        ]} />
        <p><strong>Clear standards protect the right people.</strong></p>
      </Section>

      <Section title="Culture Is Enforced Daily — Not Announced">
        <p>Culture is built through:</p>
        <DoctrineList items={[
          "What leaders correct",
          "What leaders praise",
          "What leaders ignore",
          "What leaders allow to repeat"
        ]} />
        <p>Daily behavior matters more than quarterly meetings.</p>
        <p>ALP leaders understand this and act accordingly.</p>
      </Section>

      <Section title="Leadership at Scale Requires Consistency">
        <p>As the business grows, leadership becomes less visible.</p>
        <p>This makes standards more important — not less.</p>
        <p>At scale:</p>
        <DoctrineList items={[
          "Tone travels slower",
          "Intent gets diluted",
          "Exceptions multiply faster"
        ]} />
        <p>This is why systems, documentation, and enforcement must replace intuition.</p>
        <p><strong>Consistency is the only scalable form of leadership.</strong></p>
      </Section>

      <Section title="The Cost of Weak Leadership">
        <p>Weak leadership does not feel dangerous at first.</p>
        <p>It feels:</p>
        <DoctrineList items={[
          "Polite",
          "Flexible",
          "Understanding"
        ]} />
        <p>Then it becomes:</p>
        <DoctrineList items={[
          "Confusing",
          "Inconsistent",
          "Frustrating"
        ]} />
        <p>Eventually, it becomes expensive.</p>
        <p><strong>Chaos is not random.<br />
        It is tolerated.</strong></p>
      </Section>

      <Section title="The Entrepreneur's Responsibility">
        <p>The entrepreneur sets the ceiling.</p>
        <p>If the entrepreneur:</p>
        <DoctrineList items={[
          "Avoids conflict",
          "Compromises standards",
          "Explains instead of enforces",
          "Seeks consensus instead of clarity"
        ]} />
        <p>The culture will reflect it.</p>
        <p><strong>Leadership is not delegated.<br />
        It is modeled.</strong></p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p><strong>Altitude</strong> clarifies what standards matter.<br />
        <strong>Logic</strong> defines them clearly.<br />
        <strong>Pressure</strong> enforces them consistently.</p>
        <p>Remove any one — culture degrades.</p>
        <p>ALP leaders do not negotiate standards.<br />
        They defend them.</p>
      </Section>

      <Section title="Final Truth">
        <p>Culture is not fragile.</p>
        <p><strong>It is honest.</strong></p>
        <p>It tells the truth about leadership every day.</p>
        <p>If you want a stronger culture:</p>
        <DoctrineList items={[
          "Raise standards",
          "Enforce them early",
          "Accept discomfort",
          "Protect the mission"
        ]} />
        <p>Leadership is not about being followed.</p>
        <p><strong>It is about being respected under pressure.</strong></p>
      </Section>
    </div>
  );
};

export default Chapter26;
