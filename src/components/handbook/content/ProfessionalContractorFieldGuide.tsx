import DoctrineList from "../DoctrineList";
import ExpandableImage from "../ExpandableImage";
import Section from "../Section";
import Eyebrow from "@/components/editorial/Eyebrow";
import controlLoop from "@/assets/professional-contractor-control-loop.png";

const CONTROL_LEVELS = [
  {
    level: "01 / Company",
    title: "AOS",
    control: "Company control",
    question: "Where are we going, who owns the result, and what must move now?",
    rhythm: "Weekly leadership execution and quarterly direction.",
  },
  {
    level: "02 / Project",
    title: "OverWatch / IOR",
    control: "Project control",
    question: "Where is the project indicating it will finish after risk is priced?",
    rhythm: "Daily risk movement and a defensible weekly forecast.",
  },
  {
    level: "03 / Field",
    title: "Daily Logs + Daily Project WIP",
    control: "Production control",
    question: "What did we install, earn, and spend today?",
    rhythm: "Same-day field truth tied to the schedule of values.",
  },
] as const;

const CONTROL_RHYTHM = [
  {
    cadence: "Daily",
    action: "Log and price production.",
    output: "Installed quantity, earned value, actual cost, variance, and new exposure.",
  },
  {
    cadence: "Weekly",
    action: "Forecast and act.",
    output: "Updated IOR, top risks, schedule position, billing position, owners, and decisions.",
  },
  {
    cadence: "Monthly",
    action: "Confirm and bill.",
    output: "A pay application and accounting WIP that confirm the trend already being managed.",
  },
  {
    cadence: "Quarterly",
    action: "Reset priorities.",
    output: "AOS Rocks, scorecard priorities, capacity decisions, and process improvements.",
  },
] as const;

const SYSTEM_LINKS = [
  {
    title: "Start Here",
    description: "Watch the orientation and see the full professional contractor system.",
    href: "https://app.alpcontractorcircle.com/start-here",
  },
  {
    title: "State of Control",
    description: "Assess the operating system and generate a prioritized 90-day route.",
    href: "https://app.alpcontractorcircle.com/tools?t=cos-navigator",
  },
  {
    title: "AOS",
    description: "Run vision, accountability, scorecards, priorities, issues, and execution.",
    href: "https://app.alpcontractorcircle.com/aos",
  },
  {
    title: "OverWatch",
    description: "Run IOR, project forecasting, risk, Daily Logs, and Daily Project WIP.",
    href: "https://app.alpcontractorcircle.com/overwatch",
  },
] as const;

export function ProfessionalContractorFieldGuide() {
  return (
    <div id="professional-contractor-field-guide" className="py-24 border-t border-chapter-divider">
      <header className="mb-16 pt-8">
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Eyebrow accent bare>
            New Field Guide
          </Eyebrow>
          <Eyebrow bare>Professional Contractor Control</Eyebrow>
        </div>
        <h2 className="chapter-heading">The Professional Contractor Control Loop</h2>
        <p className="body-text-emphasis mt-8 max-w-3xl">
          Control the work while the outcome can still change.
        </p>
      </header>

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          A professional contracting company does not run the company, the projects, and the field
          as separate worlds. It runs one control system. The field produces facts. The project team
          converts those facts into forecast and risk movement. Leadership turns project truth into
          company action. Direction then travels back down through the same system.
        </p>
        <p>
          The hierarchy is simple:{" "}
          <strong>
            AOS runs the company. IOR controls the projects inside OverWatch. Daily Logs and Daily
            Project WIP establish the field truth inside OverWatch.
          </strong>
        </p>
        <p>
          This is the foundation of profitable contracting that can scale. Without it, the owner is
          forced to manage through instinct, meetings, accounting history, and emergency response.
          With it, the company can see drift early enough to act.
        </p>
      </div>

      <figure className="my-20">
        <ExpandableImage
          src={controlLoop}
          alt="The Professional Contractor Control Loop: AOS at the company level, OverWatch and IOR at the project level, and Daily Logs plus Daily Project WIP at the field level."
          className="w-full h-auto rounded-sm shadow-2xl"
        />
        <figcaption className="mt-4 text-center font-sans text-xs uppercase tracking-[0.16em] opacity-55">
          Field truth moves up. Direction moves down. Run it as one loop.
        </figcaption>
      </figure>

      <Section title="One System. Three Levels of Control.">
        <div className="grid gap-5 md:grid-cols-3">
          {CONTROL_LEVELS.map((level) => (
            <article key={level.level} className="border-t border-chapter-divider pt-5">
              <p className="font-sans text-xs uppercase tracking-[0.18em] opacity-55">
                {level.level}
              </p>
              <h3 className="subsection-heading mt-3">{level.title}</h3>
              <p className="font-sans text-sm font-semibold uppercase tracking-[0.08em] opacity-65">
                {level.control}
              </p>
              <p className="mt-5">{level.question}</p>
              <p className="mt-4 opacity-75">{level.rhythm}</p>
            </article>
          ))}
        </div>
        <p className="body-text-emphasis mt-10">
          If one level is missing, the levels above it are forced to operate from assumption.
        </p>
      </Section>

      <Section title="Level One: AOS Runs the Company">
        <p>
          AOS is the company operating system. It gives leadership a shared place to establish
          direction, ownership, numbers, priorities, issues, process, and execution rhythm. Its
          purpose is not to make the company more corporate. Its purpose is to make the company
          executable without routing every decision through the owner.
        </p>
        <p>AOS answers the company-level questions:</p>
        <DoctrineList
          items={[
            "Where are we going?",
            "Who owns each major result?",
            "What numbers tell us whether the company is on track?",
            "What issues are limiting execution?",
            "What priorities must be completed this quarter?",
            "What processes must become repeatable?",
            "What must happen this week?",
          ]}
        />
        <p>
          The weekly scorecard and meeting rhythm must receive real signals from the projects. When
          project risk, billing velocity, production, schedule reliability, or cash conversion turns
          red, AOS gives the company a place to assign ownership and solve the constraint.
        </p>
      </Section>

      <Section title="Level Two: IOR Controls the Project in OverWatch">
        <p>
          In this handbook, <strong>IOR means Indicated Outcome Report.</strong> It does not mean
          Inspector of Record. IOR is the forward-looking project control lens that asks what the
          project is currently expected to earn at completion after known risks, recoveries,
          offsets, remaining uncertainty, and realized cost are priced.
        </p>
        <p>
          IOR is the management method.{" "}
          <strong>OverWatch is the application that gives that method a home.</strong> OverWatch
          organizes the forecast, risk exposure, action paths, billing, schedule, Daily Logs, and
          Daily Project WIP so the team can manage the outcome instead of describing activity.
        </p>
        <p className="body-text-emphasis">
          The budget is the original plan. IOR is the best current reading of where the project is
          actually going.
        </p>

        <div className="my-10 border-y border-chapter-divider py-8">
          <p className="font-sans text-xs uppercase tracking-[0.18em] opacity-55">
            The operating equation
          </p>
          <p className="subsection-heading mt-3">Current Expected Profit</p>
          <p className="mt-4">
            Planned gross profit + approved improvement + confirmed recovery and offsets - open risk
            exposure - realized unrecovered cost.
          </p>
        </div>

        <p>OverWatch operationalizes that logic through:</p>
        <DoctrineList
          items={[
            "Forecasted final contract and forecasted final cost.",
            "Exposure holds for known, specific project risks.",
            "Contingency holds for general uncertainty that is not ready to be released.",
            "Indicated gross profit - the best current answer for where the project will land.",
            "Owners, next actions, due dates, and evidence for recovery.",
          ]}
        />
        <p>
          Every material risk must choose a path:{" "}
          <strong>eliminate it, recover it, offset it, or consciously accept it.</strong> A risk
          without a dollar value, owner, response, and next review date is not being managed. It is
          only being discussed.
        </p>
      </Section>

      <Section title="Level Three: Daily Logs and Daily Project WIP Establish Field Truth">
        <p>
          Traditional accounting WIP tells the company whether it is over-billed or under-billed
          during a billing cycle. That report matters, but it arrives too late to manage the work
          that created the result.
        </p>
        <p>
          <strong>
            Daily Project WIP means Work in Place or Work in Progress reconciled on the day the work
            occurs.
          </strong>{" "}
          It starts with the physical quantity installed, ties that quantity to the correct
          schedule-of-values activity or work item, calculates the value earned, and compares that
          value with the actual cost required to produce it.
        </p>
        <p>The same-day record should answer:</p>
        <DoctrineList
          items={[
            "What work was put in place?",
            "What quantity was installed and against which SOV activity?",
            "What value did that installed work earn?",
            "What labor, material, equipment, and subcontractor cost did it require?",
            "What did the production variance reveal?",
            "What changed in the schedule, billing position, or risk forecast?",
          ]}
        />
        <p>
          For a self-performing contractor, this reveals actual production rates, cost per unit,
          crew performance, and the conditions that improve or damage output. For a general
          contractor, it reveals subcontractor production units, scope performance, billing
          position, schedule reliability, and whether the original buyout was sharp enough.
        </p>
        <p>
          It also compares physical progress with company billing and subcontractor billing. That
          makes front-loading, lagging pay applications, schedule drift, and cash pressure visible
          before the end of the month.
        </p>
        <p className="body-text-emphasis">
          Month-end should confirm the trend. It should not reveal it.
        </p>
      </Section>

      <Section title="How Truth Moves Through the Loop">
        <p>
          The control loop is not a reporting chain. It is a decision chain. Each level has to
          change the level above it, and each decision has to travel back down to the work.
        </p>
        <div className="mt-10 space-y-6">
          {CONTROL_RHYTHM.map((item) => (
            <article
              key={item.cadence}
              className="grid gap-3 border-t border-chapter-divider pt-5 md:grid-cols-[8rem_1fr]"
            >
              <p className="font-sans text-xs font-semibold uppercase tracking-[0.18em] opacity-60">
                {item.cadence}
              </p>
              <div>
                <p className="subsection-heading">{item.action}</p>
                <p className="mt-2">{item.output}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-10">
          The loop closes when field facts change the project forecast, project truth changes
          company action, and the company decision changes tomorrow's field execution.
        </p>
      </Section>

      <Section title="The Daily and Weekly Questions">
        <p>
          Every active project should be able to answer these questions without waiting for
          accounting:
        </p>
        <DoctrineList
          items={[
            "Where is the money exposed?",
            "What risk is growing?",
            "What risk is shrinking?",
            "What can be eliminated, recovered, or offset?",
            "What needs to be escalated before it becomes expensive?",
            "What is the current indicated gross profit?",
            "Who owns the next action, and when will the exposure move?",
          ]}
        />
        <p>
          The PM meeting is not complete when the team has explained what happened. It is complete
          when the financial movement, decision, owner, and next action are clear.
        </p>
      </Section>

      <Section title="Install the System Through One Pilot Project">
        <p>
          Do not attempt a company-wide rollout on day one. Choose one active project with enough
          work remaining to change the outcome and enough leadership attention to enforce the
          standard.
        </p>
        <DoctrineList
          items={[
            "Select the SOV activities that deserve daily production measurement.",
            "Require same-day Daily Logs with installed quantity and cost inputs.",
            "Build the first IOR from current contract, forecasted final cost, and known exposure.",
            "Assign every risk a dollar value, response path, owner, action, and review date.",
            "Run a weekly project control review and move company-level issues into AOS.",
            "Use the first 30 days to prove the rhythm before adding the next project.",
          ]}
        />
        <p>
          The goal is not perfect data. The goal is useful truth early enough to change manpower,
          sequencing, procurement, subcontractor pressure, billing, recovery strategy, or company
          priorities.
        </p>
      </Section>

      <Section title="Use the State of Control to Choose the First Constraint">
        <p>
          A contractor does not need to install every system at once. The State of Control
          assessment measures company, economic, project, field, delivery, and execution control,
          then identifies the active constraint and builds the next 90-day implementation route.
        </p>
        <p>
          That roadmap is the bridge between understanding the doctrine and changing the company. It
          tells you which system to install first, what output proves it is moving, and where AOS or
          OverWatch supports the work.
        </p>
        <p className="body-text-emphasis">
          Diagnose. Prioritize. Install. Prove. Then move to the next constraint.
        </p>
      </Section>

      <Section title="Open the Working System">
        <p>
          The Handbook teaches the doctrine. The applications make the doctrine executable. Your
          access level determines which coaching and community resources are included, but the
          operating sequence remains the same.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {SYSTEM_LINKS.map((link) => (
            <a
              key={link.title}
              href={link.href}
              className="group border border-chapter-divider p-6 transition-colors hover:bg-foreground/[0.03]"
            >
              <p className="subsection-heading group-hover:underline">{link.title}</p>
              <p className="mt-3">{link.description}</p>
              <p className="mt-5 font-sans text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent">
                Open in the Contractor Circle Hub →
              </p>
            </a>
          ))}
        </div>
      </Section>

      <div className="mt-24 border-y border-chapter-divider py-16 text-center">
        <p className="font-sans text-xs uppercase tracking-[0.2em] opacity-55">
          The professional contractor standard
        </p>
        <p className="body-text-emphasis mx-auto mt-6 max-w-3xl">
          Know what was built today. Know what it cost. Know what it earned. Know where the project
          is going. Know what the company must do next.
        </p>
      </div>
    </div>
  );
}

export default ProfessionalContractorFieldGuide;
