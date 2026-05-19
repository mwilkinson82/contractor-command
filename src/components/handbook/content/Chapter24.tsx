import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter24: React.FC = () => {
  return (
    <div id="chapter-24" className="chapter-container">
      <ChapterHeader 
        number={24} 
        title="Using the ALP Handbook in Real Time" 
      />
      
      <Section>
        <p>This handbook is not meant to be read once.</p>
        <p>It is meant to be <strong>used under pressure</strong>.</p>
        <p>When things are calm, most operators feel competent.<br />
        When things become chaotic, clarity disappears.</p>
        <p>This chapter exists for those moments.</p>
      </Section>

      <Section title="The Purpose of the Handbook">
        <p>The ALP Handbook is not motivational.<br />
        It is not inspirational.<br />
        It is not theoretical.</p>
        <p>It is a <strong>diagnostic and decision tool</strong>.</p>
        <p>Its job is to:</p>
        <DoctrineList items={[
          "Remove emotional noise",
          "Identify root causes",
          "Restore order",
          "Drive correct action"
        ]} />
        <p>If you only read this handbook when things are going well, you are missing its purpose.</p>
      </Section>

      <Section title="Step One: Stop Treating Symptoms">
        <p>When something goes wrong, the instinct is to react to the loudest problem.</p>
        <p>Cash feels tight.<br />
        A job feels out of control.<br />
        People are frustrated.<br />
        Clients are difficult.</p>
        <p>These are symptoms, not causes.</p>
        <p>The first rule of ALP is this:</p>
        <p className="italic"><strong>Never solve at the level of pain.<br />
        Always solve at the level of structure.</strong></p>
      </Section>

      <Section title="Step Two: Use the Stool to Diagnose">
        <p>When pressure appears, return to the ALP Scaling Stool.</p>
        <p>Ask one question:</p>
        <p className="italic"><strong>Which leg is weak right now?</strong></p>
        <DoctrineList items={[
          "Marketing → leads dry up, desperation increases",
          "Sales → bad deals, poor terms, misaligned clients",
          "Operations → chaos, inefficiency, rework",
          "People → morale issues, turnover, inconsistency",
          "Financial Command → surprises, confusion, anxiety"
        ]} />
        <p>Do not guess.<br />
        Do not rationalize.<br />
        Identify the weakest leg.</p>
        <p>That leg is where attention belongs.</p>
      </Section>

      <Parable id="parable-owner-fixed-wrong" title="The Owner Who Fixed the Wrong Thing">
        <p>An owner thought his problem was operations.</p>
        <p>Jobs felt heavy.<br />
        Stress was high.<br />
        Margins were thin.</p>
        <p>He focused on field efficiency.<br />
        New tools.<br />
        New supervisors.</p>
        <p>Nothing changed.</p>
        <p>The real issue was sales.<br />
        Bad contracts.<br />
        Weak terms.<br />
        Unclear scope.</p>
        <p>Once sales discipline was restored, operations stabilized naturally.</p>
        <p>He didn't have an operations problem.</p>
        <p><strong>He had a diagnosis problem.</strong></p>
      </Parable>

      <Section title="Step Three: Move From Chaos to Control">
        <p>Once the weak leg is identified, apply the From Chaos to Control flow:</p>
        <div className="space-y-4 mt-6">
          <div>
            <p className="font-semibold">1. See Clearly</p>
            <p className="opacity-80">Gather facts. Numbers. Schedules. Reality.<br />
            No stories. No emotion.</p>
          </div>
          <div>
            <p className="font-semibold">2. Decide Correctly</p>
            <p className="opacity-80">Use the Decision Matrix.<br />
            Altitude → Logic → Pressure.</p>
          </div>
          <div>
            <p className="font-semibold">3. Apply Pressure</p>
            <p className="opacity-80">Execute the decision decisively.<br />
            Delay is a decision — and usually the wrong one.</p>
          </div>
          <div>
            <p className="font-semibold">4. Protect Margin</p>
            <p className="opacity-80">Confirm the action stabilizes time, money, and exposure.</p>
          </div>
        </div>
        <p className="mt-6">This flow should be automatic.</p>
      </Section>

      <Section title="Step Four: Use the Decision Matrix Under Stress">
        <p>The Decision Matrix exists because stress distorts thinking.</p>
        <p>When pressure rises:</p>
        <DoctrineList items={[
          "Altitude collapses",
          "Logic gets emotional",
          "Pressure gets avoided or misapplied"
        ]} />
        <p>The matrix forces order:</p>
        <div className="space-y-4 mt-6">
          <p><strong>Altitude:</strong> Zoom out. What actually matters?</p>
          <p><strong>Logic:</strong> What are the facts? Constraints? Options?</p>
          <p><strong>Pressure:</strong> What must be done now — cleanly and responsibly?</p>
        </div>
        <p className="mt-6">If a decision feels heavy, it usually means one step was skipped.</p>
      </Section>

      <Parable id="parable-clean-decision" title="The Clean Decision">
        <p>An operator delayed terminating a bad subcontractor.</p>
        <p>He gathered more data.<br />
        Asked more opinions.<br />
        Waited.</p>
        <p>Costs mounted.</p>
        <p>When he finally used the matrix, the answer was obvious.</p>
        <p>The delay wasn't strategic.<br />
        It was emotional.</p>
        <p>Once the decision was made, the job stabilized within weeks.</p>
        <p><strong>Clarity feels harsh — until you experience the cost of avoidance.</strong></p>
      </Parable>

      <Section title="Step Five: Return to Identity">
        <p>If you find yourself resisting a decision, ask this question:</p>
        <p className="italic"><strong>What am I afraid this decision says about me?</strong></p>
        <p>Most hesitation is not operational.<br />
        It is personal.</p>
        <DoctrineList items={[
          "Fear of being disliked.",
          "Fear of being wrong.",
          "Fear of confrontation.",
          "Fear of responsibility."
        ]} />
        <p>ALP requires confronting identity first — then acting anyway.</p>
      </Section>

      <Section title="How to Use This Handbook Weekly">
        <p>High-performing operators do not wait for chaos.</p>
        <p>They review this handbook:</p>
        <DoctrineList items={[
          "Weekly",
          "Monthly",
          "Before major decisions",
          "After major disruptions"
        ]} />
        <p>They ask:</p>
        <DoctrineList items={[
          "Where am I drifting?",
          "Which leg needs reinforcement?",
          "Where is pressure building?",
          "What decision am I avoiding?"
        ]} />
        <p>This is how stability compounds.</p>
      </Section>

      <Section title="Using the Handbook With Teams">
        <p>This handbook is not private.</p>
        <p>It is a <strong>leadership alignment tool</strong>.</p>
        <p>Use it to:</p>
        <DoctrineList items={[
          "Train supervisors",
          "Frame meetings",
          "Diagnose problems",
          "Remove emotion from discussion",
          "Create a shared language"
        ]} />
        <p>When everyone understands the framework, accountability becomes clean.</p>
      </Section>

      <Section title="Final Truth">
        <p>Most businesses do not fail from lack of effort.</p>
        <p>They fail from:</p>
        <DoctrineList items={[
          "Poor diagnosis",
          "Emotional decisions",
          "Avoidance under pressure"
        ]} />
        <p>The ALP Handbook exists to prevent that.</p>
        <p>Use it when things feel unclear.<br />
        Use it when pressure rises.<br />
        Use it when decisions matter most.</p>
        <p><strong>Clarity is not accidental.</strong></p>
        <p>It is built — deliberately — by those willing to operate at a higher level.</p>
      </Section>

      {/* ALP Field Checklist */}
      <div className="mt-24 pt-16 border-t border-chapter-divider">
        <h3 className="text-2xl md:text-3xl font-semibold font-serif mb-4">The ALP Field Checklist</h3>
        <p className="text-lg opacity-70 mb-8 italic">(Jobs • Leadership • Decisions • Pressure)</p>
        
        <p className="body-text mb-8"><strong>Purpose:</strong><br />
        To restore clarity, control, and correct action under real-world pressure.</p>
        <p className="body-text mb-12">Use this checklist whenever something feels off.</p>

        <div className="space-y-12">
          <div className="checklist-section">
            <h4 className="subsection-heading">STEP 1 — STOP THE NOISE</h4>
            <p className="text-sm opacity-60 mb-4">(Do not act emotionally)</p>
            <div className="space-y-2 body-text">
              <p>☐ Pause reactive decisions</p>
              <p>☐ Lower urgency before increasing effort</p>
              <p>☐ Separate facts from feelings</p>
              <p>☐ Refuse to solve at the level of stress</p>
            </div>
            <p className="mt-4 text-sm opacity-70 italic">Rule: If it feels urgent, slow down. Urgency without clarity creates damage.</p>
          </div>

          <div className="checklist-section">
            <h4 className="subsection-heading">STEP 2 — DIAGNOSE USING THE STOOL</h4>
            <p className="text-sm opacity-60 mb-4">(Find the weak leg)</p>
            <p className="body-text mb-4">Ask: Which leg is failing right now?</p>
            <div className="space-y-2 body-text">
              <p>☐ Marketing — leads drying up, desperation rising</p>
              <p>☐ Sales — bad deals, poor terms, misalignment</p>
              <p>☐ Operations — chaos, inefficiency, rework</p>
              <p>☐ People — morale issues, turnover, inconsistency</p>
              <p>☐ Financial Command — surprises, confusion, anxiety</p>
            </div>
            <p className="mt-4 text-sm opacity-70 italic">Rule: Symptoms appear everywhere. Causes live in one place.</p>
          </div>

          <div className="checklist-section">
            <h4 className="subsection-heading">STEP 3 — SEE CLEARLY (FINANCIAL COMMAND)</h4>
            <div className="space-y-2 body-text">
              <p>☐ Do I know the real numbers?</p>
              <p>☐ Do I know where margin is leaking?</p>
              <p>☐ Do I know what this issue is costing per week?</p>
              <p>☐ Am I guessing — or measuring?</p>
            </div>
            <p className="mt-4 text-sm opacity-70 italic">Rule: If you cannot see clearly, you cannot decide correctly.</p>
          </div>

          <div className="checklist-section">
            <h4 className="subsection-heading">STEP 4 — DECIDE USING THE ALP DECISION MATRIX</h4>
            <div className="space-y-6 body-text mt-4">
              <div>
                <p className="font-semibold">ALTITUDE</p>
                <p>☐ Am I zoomed out enough to see reality?</p>
                <p>☐ What actually matters long-term?</p>
                <p>☐ What is noise vs signal?</p>
              </div>
              <div>
                <p className="font-semibold">LOGIC</p>
                <p>☐ What are the facts?</p>
                <p>☐ What are the constraints?</p>
                <p>☐ What options actually exist?</p>
              </div>
              <div>
                <p className="font-semibold">PRESSURE</p>
                <p>☐ What decision must be made now?</p>
                <p>☐ What am I avoiding?</p>
                <p>☐ What action restores control?</p>
              </div>
            </div>
            <p className="mt-4 text-sm opacity-70 italic">Rule: Delay is a decision — and usually the wrong one.</p>
          </div>

          <div className="checklist-section">
            <h4 className="subsection-heading">STEP 5 — APPLY PRESSURE CLEANLY</h4>
            <p className="text-sm opacity-60 mb-4">(Execution)</p>
            <div className="space-y-2 body-text">
              <p>☐ Clear direction given</p>
              <p>☐ Accountability assigned</p>
              <p>☐ Timeline established</p>
              <p>☐ Standards enforced</p>
              <p>☐ No re-negotiation midstream</p>
            </div>
            <p className="mt-4 text-sm opacity-70 italic">Rule: Pressure applied correctly stabilizes systems. Pressure avoided multiplies problems.</p>
          </div>

          <div className="checklist-section">
            <h4 className="subsection-heading">STEP 6 — CHECK IDENTITY</h4>
            <p className="text-sm opacity-60 mb-4">(The hidden failure point)</p>
            <p className="body-text mb-4">Ask yourself honestly:</p>
            <div className="space-y-2 body-text">
              <p>☐ Am I avoiding this because I want to be liked?</p>
              <p>☐ Am I hesitating because I fear being wrong?</p>
              <p>☐ Am I over-explaining to seek validation?</p>
              <p>☐ Am I protecting comfort instead of standards?</p>
            </div>
            <p className="mt-4 text-sm opacity-70 italic">Rule: If identity is weak, execution will fail.</p>
          </div>

          <div className="checklist-section">
            <h4 className="subsection-heading">STEP 7 — DOCUMENT & PROTECT</h4>
            <p className="text-sm opacity-60 mb-4">(Lock in control)</p>
            <div className="space-y-2 body-text">
              <p>☐ Is this documented?</p>
              <p>☐ Was notice issued if required?</p>
              <p>☐ Is schedule impact recorded?</p>
              <p>☐ Is cost exposure captured?</p>
            </div>
            <p className="mt-4 text-sm opacity-70 italic">Rule: What is not documented does not exist.</p>
          </div>

          <div className="checklist-section">
            <h4 className="subsection-heading">STEP 8 — RETURN TO ORDER</h4>
            <p className="text-sm opacity-60 mb-4">(Stabilization)</p>
            <div className="space-y-2 body-text">
              <p>☐ Has chaos reduced?</p>
              <p>☐ Has clarity increased?</p>
              <p>☐ Has margin been protected?</p>
              <p>☐ Has pressure normalized?</p>
            </div>
            <p className="mt-4 text-sm opacity-70 italic">If no — repeat the checklist.</p>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-chapter-divider">
          <h4 className="subsection-heading mb-4">FINAL TRUTH</h4>
          <p className="body-text">You do not need more effort.<br />
          You need more clarity under pressure.</p>
          <p className="body-text mt-4">This checklist is not optional.<br />
          It is how professionals operate when things matter.</p>
          <p className="body-text mt-4 font-semibold">Altitude. Logic. Pressure.<br />
          Applied daily — not occasionally.</p>
        </div>
      </div>
    </div>
  );
};

export default Chapter24;
