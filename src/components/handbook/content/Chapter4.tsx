import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter4: React.FC = () => {
  return (
    <div id="chapter-4" className="chapter-container">
      <ChapterHeader 
        number={4} 
        title="Marketing as Infrastructure" 
      />
      
      <Section>
        <p>Most contractors misunderstand marketing.</p>
        <p>They treat it as promotion.<br />
        As content.<br />
        As something cosmetic.</p>
        <p>Something you do when things are slow.<br />
        Something you stop when things get busy.</p>
        <p>That misunderstanding costs them stability, leverage, and ultimately control.</p>
        <p>Marketing is not a growth activity.</p>
        <p><strong>Marketing is infrastructure.</strong></p>
      </Section>

      <Section title="Why Marketing Exists">
        <p>Marketing exists for one reason:</p>
        <p className="italic"><strong>To ensure that opportunity flows toward the business consistently, instead of sporadically.</strong></p>
        <p>That's it.</p>
        <p>Not to look good.<br />
        Not to be clever.<br />
        Not to entertain the internet.</p>
        <p>Marketing exists so that when you need work, work is already moving toward you.</p>
        <p>When marketing is weak:</p>
        <DoctrineList items={[
          "Sales feels desperate",
          "Pricing erodes",
          "Decisions become emotional",
          "You start taking work you shouldn't",
          "You tolerate behavior you shouldn't"
        ]} />
        <p>When marketing is strong:</p>
        <DoctrineList items={[
          "Sales feels calm",
          "You choose projects instead of chasing them",
          "You hold pricing",
          "You enforce standards",
          "You operate from position, not need"
        ]} />
        <p><strong>Marketing is upstream leverage.</strong></p>
      </Section>

      <Section title="Marketing Is a Stability System, Not a Growth Lever">
        <p>Most people think marketing creates growth.</p>
        <p>That's partially true — but it's not the main function.</p>
        <p><strong>Marketing creates stability.</strong></p>
        <p>It stabilizes:</p>
        <DoctrineList items={[
          "Cash flow",
          "Decision-making",
          "Sales behavior",
          "Emotional posture"
        ]} />
        <p>When marketing is inconsistent, the entire business becomes reactive.</p>
        <p>You don't sell well when you're afraid.<br />
        You don't negotiate well when you're behind.<br />
        You don't enforce standards when you "need the job."</p>
        <p><strong>Marketing removes desperation from the system.</strong></p>
        <p>That's infrastructure.</p>
      </Section>

      <Section title="Inconsistent Marketing Creates Inconsistent Identity">
        <p>Here's a hard truth most contractors don't want to hear:</p>
        <p><strong>When your marketing is inconsistent, your identity becomes inconsistent.</strong></p>
        <p>You feel confident one month.<br />
        Invisible the next.<br />
        Urgent the next.<br />
        Burned out the next.</p>
        <p>That emotional volatility leaks into:</p>
        <DoctrineList items={[
          "Sales calls",
          "Pricing decisions",
          "Client interactions",
          "Team leadership"
        ]} />
        <p>This is why operators with inconsistent marketing feel like they're always "on edge."</p>
        <p>The business doesn't feel grounded — because it isn't.</p>
      </Section>

      <Section title="Consistency Beats Brilliance">
        <p>The market does not reward cleverness.</p>
        <p><strong>It rewards reliability.</strong></p>
        <p>Marketing only works while it is being done.</p>
        <p>If you market hard for two weeks and disappear for six, your results will look exactly like that pattern.</p>
        <p>Cool videos.<br />
        Nice edits.<br />
        Short bursts of attention.<br />
        No compounding effect.</p>
        <p>Consistency compounds.<br />
        Inconsistency resets momentum.</p>
      </Section>

      <Section title="Water Beats the Rock">
        <p>Marketing follows the same law as erosion.</p>
        <p>Water does not beat the rock by force.<br />
        It does not beat it by creativity.<br />
        It does not beat it by showing up once.</p>
        <p><strong>It beats the rock by showing up every day.</strong></p>
        <p>That's how markets work.</p>
        <p>You don't win by being louder.<br />
        You win by being present longer.</p>
      </Section>

      <Section title="Complexity Is the Enemy of Consistency">
        <p>The more complex your marketing system is:</p>
        <DoctrineList items={[
          "The harder it is to maintain",
          "The faster it breaks under pressure",
          "The more likely it gets abandoned when work increases"
        ]} />
        <p>If your marketing requires:</p>
        <DoctrineList items={[
          "Perfect lighting",
          "Heavy editing",
          "Creative inspiration",
          "Long setup time"
        ]} />
        <p>You will not sustain it.</p>
        <p>And anything you cannot sustain is not infrastructure.</p>
        <p><strong>Simple systems survive reality.<br />
        Complex systems degrade.</strong></p>
      </Section>

      <Section title="Marketing Must Match the Operator">
        <p>This is one of the most important ideas in this handbook:</p>
        <p><strong>Marketing must match who you are as an operator.</strong></p>
        <p>Not who you want to be.<br />
        Not who someone else is.<br />
        Not what looks impressive online.</p>
        <p>The real question is:</p>
        <p className="italic">What kind of marketing can I execute consistently, even when the business is busy, stressful, and imperfect?</p>
        <p>That depends on:</p>
        <DoctrineList items={[
          "Your personality",
          "Your schedule",
          "Your tolerance for friction",
          "Your communication style"
        ]} />
        <p>The best marketing system is not the best one on paper.</p>
        <p><strong>It is the one you won't quit.</strong></p>
      </Section>

      <Parable id="parable-silent-expert" title="The Silent Expert">
        <p>An operator was technically superior to everyone in his market.</p>
        <p>Better estimating.<br />
        Better execution.<br />
        Better outcomes.</p>
        <p>But invisible.</p>
        <p>Another operator was average — but visible every week.</p>
        <p>Posting.<br />
        Sharing.<br />
        Teaching.<br />
        Showing up.</p>
        <p>The second operator got the calls.<br />
        The first got excuses.</p>
        <p><strong>Markets don't reward hidden excellence.<br />
        They reward visible consistency.</strong></p>
      </Parable>

      <Section title="Marketing Feeds the Entire Stool">
        <p>Marketing feeds sales.<br />
        Sales feeds operations.<br />
        Operations feed cash flow.<br />
        Cash flow feeds stability.</p>
        <p>When marketing weakens, everything downstream starts to starve.</p>
        <p>Sales becomes aggressive.<br />
        Operations become reactive.<br />
        Financial decisions become emotional.</p>
        <p>This is why marketing is a daily discipline, not a campaign.</p>
        <p>Not because something happens every day —<br />
        but because something eventually will.</p>
      </Section>

      <Section title="Marketing as an Entrepreneurial Responsibility">
        <p>Marketing is not something you outsource and forget.</p>
        <p>You can delegate execution.<br />
        You cannot delegate responsibility.</p>
        <p>If marketing stops, it is not the agency's fault.<br />
        It is not the algorithm's fault.<br />
        It is not the market's fault.</p>
        <p><strong>It is a leadership failure.</strong></p>
        <p>Entrepreneurs who understand this stop treating marketing as optional.</p>
        <p>They treat it like electricity.</p>
        <p>Invisible when it's working.<br />
        Catastrophic when it's not.</p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p><strong>Altitude</strong> lets you see marketing as infrastructure, not ego.<br />
        <strong>Logic</strong> forces you to build systems that actually survive reality.<br />
        <strong>Pressure</strong> requires you to show up even when you don't feel like it.</p>
        <p>Remove any one of those — and marketing collapses.</p>
      </Section>

      <Section title="Final Truth">
        <p>Most contractors don't fail because their marketing is bad.</p>
        <p><strong>They fail because their marketing is inconsistent.</strong></p>
        <p>Consistency beats cleverness.<br />
        Water beats the rock.<br />
        Infrastructure beats inspiration.</p>
        <p>Marketing is not about growth.</p>
        <p><strong>It is about stability, leverage, and control.</strong></p>
        <p>And without it, nothing else holds.</p>
      </Section>
    </div>
  );
};

export default Chapter4;
