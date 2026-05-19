import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter6: React.FC = () => {
  return (
    <div id="chapter-6" className="chapter-container">
      <ChapterHeader 
        number={6} 
        title="Sales, Pressure, and Clarity" 
      />
      
      <Section>
        <p>Most contractors misunderstand sales.</p>
        <p>They think sales is persuasion.<br />
        Convincing.<br />
        Pitching.<br />
        "Handling objections."</p>
        <p>That misunderstanding is why sales feels uncomfortable, stressful, and personal.</p>
        <p>Sales is not persuasion.</p>
        <p><strong>Sales is clarity under pressure.</strong></p>
      </Section>

      <Section title="Why Sales Feels Hard for Contractors">
        <p>Sales feels hard when the system upstream is weak.</p>
        <p>When marketing is inconsistent.<br />
        When opportunity is scarce.<br />
        When identity is shaky.<br />
        When pressure is avoided.</p>
        <p>In those conditions, every conversation feels loaded.</p>
        <p>You need the job.<br />
        You need the approval.<br />
        You need the deal to work.</p>
        <p><strong>And need destroys clarity.</strong></p>
        <p>Sales does not break down because contractors lack skill.</p>
        <p>It breaks down because pressure is mismanaged.</p>
      </Section>

      <Section title="Sales Is the Moment Pressure Enters the System">
        <p>Marketing creates opportunity.<br />
        Sales is where pressure appears.</p>
        <p>Pressure shows up as:</p>
        <DoctrineList items={[
          "Price conversations",
          "Timeline tension",
          "Scope ambiguity",
          "Decision delays",
          "Risk transfer"
        ]} />
        <p>How you behave under that pressure determines everything downstream.</p>
        <p>Sales is the point where:</p>
        <DoctrineList items={[
          "Standards are either enforced or abandoned",
          "Risk is either defined or absorbed",
          "Clarity is either created or avoided"
        ]} />
        <p>Sales is not a personality test.</p>
        <p><strong>It is a discipline test.</strong></p>
      </Section>

      <Section title="Pressure Is Not Manipulation">
        <p>This is one of the most important distinctions in ALP:</p>
        <p><strong>Pressure is not manipulation.</strong></p>
        <p>Pressure is responsibility.</p>
        <p>Pressure means:</p>
        <DoctrineList items={[
          "Asking for decisions instead of waiting",
          "Clarifying next steps instead of drifting",
          "Defining timelines instead of hoping",
          "Addressing risk instead of ignoring it"
        ]} />
        <p>Avoiding pressure does not create comfort.</p>
        <p><strong>It creates confusion.</strong></p>
        <p>And confusion kills deals more reliably than price ever will.</p>
      </Section>

      <Section title="Avoided Pressure Always Shows Up Later">
        <p>When pressure is avoided in sales, it doesn't disappear.</p>
        <p><strong>It gets transferred downstream.</strong></p>
        <p>It shows up as:</p>
        <DoctrineList items={[
          "Scope creep",
          "Unrealistic expectations",
          "Constant change",
          "Late decisions",
          "Disputes",
          "Margin erosion"
        ]} />
        <p>Pressure avoided in sales becomes chaos in operations.</p>
        <p>This is why strong operators are firm early.</p>
        <p>They are not being aggressive.</p>
        <p><strong>They are being responsible.</strong></p>
      </Section>

      <Section title="Clarity Is the Highest Form of Professionalism">
        <p>Clients don't fear clarity.</p>
        <p><strong>They fear uncertainty.</strong></p>
        <p>Sales clarity looks like:</p>
        <DoctrineList items={[
          "Clear scope",
          "Clear exclusions",
          "Clear responsibilities",
          "Clear timelines",
          "Clear consequences"
        ]} />
        <p>Most contractors think being "easy to work with" means being flexible.</p>
        <p>In reality, it means being clear.</p>
        <p>Clarity reduces anxiety.<br />
        Ambiguity amplifies it.</p>
      </Section>

      <Section title="Sales Is Not About Closing — It's About Qualification">
        <p>Another misconception:</p>
        <p><strong>Sales is not about closing everyone.</strong></p>
        <p>It's about qualifying correctly.</p>
        <p>Strong operators use sales to determine:</p>
        <DoctrineList items={[
          "Is this client decisive or indecisive?",
          "Is this scope realistic or aspirational?",
          "Is this timeline achievable or political?",
          "Is this risk priced or hidden?"
        ]} />
        <p>Selling bad work well is still bad business.</p>
        <p><strong>Sales discipline protects operations before the job ever starts.</strong></p>
      </Section>

      <Parable id="parable-indecisive-buyer" title="The Indecisive Buyer">
        <p>Two contractors met with the same client.</p>
        <p>The client delayed decisions.<br />
        Avoided timelines.<br />
        Asked for "one more revision."</p>
        <p>The first contractor stayed polite.<br />
        Flexible.<br />
        Open-ended.</p>
        <p>The second contractor clarified:<br />
        <em>"This decision needs to be made by Friday or the schedule changes."</em></p>
        <p>One contractor felt uncomfortable.</p>
        <p>The other got the job.</p>
        <p>Not because he pushed.<br />
        <strong>Because he defined reality.</strong></p>
      </Parable>

      <Section title="Sales Conversations Reveal Identity">
        <p>Sales exposes how an operator handles:</p>
        <DoctrineList items={[
          "Discomfort",
          "Silence",
          "Objections",
          "Authority",
          "Self-trust"
        ]} />
        <p>Operators who:</p>
        <DoctrineList items={[
          "Need to be liked",
          "Avoid tension",
          "Over-explain",
          "Over-discount"
        ]} />
        <p>Do not have sales problems.</p>
        <p><strong>They have identity problems.</strong></p>
        <p>Sales does not create those issues.<br />
        It reveals them.</p>
      </Section>

      <Section title="Pricing Is a Sales Outcome, Not a Math Problem">
        <p>Most pricing pressure is not about numbers.</p>
        <p><strong>It's about posture.</strong></p>
        <p>When sales clarity is weak:</p>
        <DoctrineList items={[
          "Discounts feel necessary",
          "Price feels negotiable",
          "Value feels fragile"
        ]} />
        <p>When sales clarity is strong:</p>
        <DoctrineList items={[
          "Price feels anchored",
          "Risk feels understood",
          "Expectations feel stable"
        ]} />
        <p>You don't "defend" price with better math.</p>
        <p><strong>You defend it with clarity and confidence.</strong></p>
      </Section>

      <Section title="Sales Sets the Emotional Tone of the Job">
        <p>Whatever energy exists in the sale carries into the project.</p>
        <p>If the sale was:</p>
        <DoctrineList items={[
          "Rushed → the job feels rushed",
          "Confused → the job feels chaotic",
          "Defensive → the job feels adversarial"
        ]} />
        <p>If the sale was:</p>
        <DoctrineList items={[
          "Clear → the job feels structured",
          "Firm → the job feels stable",
          "Calm → the job feels professional"
        ]} />
        <p>Sales is not separate from operations.</p>
        <p><strong>It programs operations.</strong></p>
      </Section>

      <Section title="Sales Is a Leadership Act">
        <p>Sales is where the operator shows:</p>
        <DoctrineList items={[
          "Standards",
          "Boundaries",
          "Judgment",
          "Courage"
        ]} />
        <p>This is why delegating sales too early breaks businesses.</p>
        <p>You can delegate execution.<br />
        You cannot delegate standards-setting.</p>
        <p><strong>Sales is where leadership first touches the project.</strong></p>
      </Section>

      <Section title="Bringing It Back to ALP">
        <p><strong>Altitude</strong> allows you to detach from emotion.<br />
        <strong>Logic</strong> forces you to define reality.<br />
        <strong>Pressure</strong> requires you to act, not drift.</p>
        <p>Sales collapses when any of these are missing.</p>
        <p>Sales stabilizes when all three are present.</p>
      </Section>

      <Section title="Final Truth">
        <p>Sales is not about convincing people to say yes.</p>
        <p>It is about making the decision environment clear enough that the right people can decide — and the wrong ones self-select out.</p>
        <p>Pressure is not the enemy.<br />
        <strong>Avoided pressure is.</strong></p>
        <p>Clarity is not aggressive.<br />
        <strong>It is professional.</strong></p>
        <p>And contractors who master sales as clarity under pressure<br />
        don't just close better jobs —<br />
        <strong>they build businesses that hold together.</strong></p>
      </Section>
    </div>
  );
};

export default Chapter6;
