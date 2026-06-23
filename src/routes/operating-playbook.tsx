import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUpRight, CheckCircle2, ClipboardList, Target } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import capacityStack from "@/assets/cos-playbook/capacity-constraint-stack.jpg";
import constraintResolutionPlan from "@/assets/cos-playbook/constraint-resolution-plan.jpg";
import cosMap from "@/assets/cos-playbook/cos-map.jpg";
import doctrineBudget from "@/assets/cos-playbook/doctrine-budget-not-truth.jpg";
import doctrineCapacity from "@/assets/cos-playbook/doctrine-gap-capacity.jpg";
import doctrineProject from "@/assets/cos-playbook/doctrine-project-not-business.jpg";
import doctrineRisk from "@/assets/cos-playbook/doctrine-risk-is-job.jpg";
import economicsEngine from "@/assets/cos-playbook/economics-engine.jpg";
import iorFormula from "@/assets/cos-playbook/ior-formula.jpg";
import ownerBottleneck from "@/assets/cos-playbook/owner-bottleneck.jpg";
import riskActionFunnel from "@/assets/cos-playbook/risk-action-funnel.jpg";
import teachingLayers from "@/assets/cos-playbook/three-teaching-layers.jpg";
import weeklyRhythm from "@/assets/cos-playbook/weekly-rhythm.jpg";

export const Route = createFileRoute("/operating-playbook")({
  component: OperatingPlaybookPage,
  head: () => ({
    meta: [
      { title: "Contractor Operating System Playbook - Contractor Circle" },
      {
        name: "description",
        content:
          "The member operating playbook for AOS, Economics, IOR, risk, delivery systems, and the weekly rhythm.",
      },
    ],
  }),
});

const doctrineCards = [
  {
    title: "The project is not the business.",
    copy: "The company is the machine that repeatedly finds, sells, staffs, finances, controls, and completes projects.",
    image: doctrineProject,
  },
  {
    title: "The gap is capacity.",
    copy: "Revenue goals do not create throughput. Capacity, cash conversion, billing velocity, and PM bandwidth do.",
    image: doctrineCapacity,
  },
  {
    title: "The budget is not truth.",
    copy: "The budget is the original plan. IOR is the current financial truth of where the project is indicating it will land.",
    image: doctrineBudget,
  },
  {
    title: "Risk is the job.",
    copy: "The work is not only to identify risk. It is to eliminate, recover, offset, or consciously accept it.",
    image: doctrineRisk,
  },
];

const playbookSections = [
  {
    id: "owner-bottleneck",
    eyebrow: "01 / Diagnose",
    title: "Remove The Owner Bottleneck",
    image: ownerBottleneck,
    doctrine: "If everything flows back to the owner, the owner is still the operating system.",
    problem:
      "The company depends on the owner for decisions, client context, risk interpretation, financial judgment, process memory, and problem solving.",
    move: "Run the Owner Bottleneck Audit. Identify the top five places where ownership still lives in the owner's head, then assign the seat, visible number, and meeting rhythm that should carry each one.",
    deepDive: [
      "Invisible ownership is the real constraint: decisions, client context, risk interpretation, financial judgment, and process memory stay trapped in the owner.",
      "The fix is not delegation by hope. The fix is visible ownership: seat, number, decision right, and meeting rhythm.",
      "The first audit should expose where the company still waits for the owner to see, interpret, escalate, or solve.",
    ],
    chapter: {
      sourceTrail: "Playbook v0.3, Owner Bottleneck Audit, Contractor Circle AOS teaching",
      standard:
        "A company is not owner-independent until decisions, numbers, escalation paths, and process memory live in seats instead of the owner's head.",
      teaches: [
        "Owner dependence usually hides inside capability. The owner can see more, remember more, and solve faster, so the company keeps routing reality back through the owner.",
        "The bottleneck is not only workload. It is invisible ownership: who knows the standard, who owns the decision, and who can act without asking for permission.",
        "The first management act is to separate what only the owner can do from what the company must learn to do without the owner.",
      ],
      install: [
        "List the top five recurring decisions or escalations that still come back to the owner.",
        "Assign each one to a seat, a visible number, a decision right, and a weekly review rhythm.",
        "Move one owner-held decision into AOS this week so the team can practice visible ownership immediately.",
      ],
      proof: [
        "Fewer decisions wait on the owner.",
        "The scorecard shows the problem before the owner has to say it.",
        "The same issue does not return without an owner, a due date, and a system change.",
      ],
      worksheet: "Owner Bottleneck Audit Worksheet",
    },
    tool: "Owner Dependency Scorecard",
    workbenchToolId: "owner-dependency",
  },
  {
    id: "aos",
    eyebrow: "02 / Structure",
    title: "Build The Company Machine",
    image: teachingLayers,
    doctrine: "AOS installs accountability so the company can stop operating from memory.",
    problem:
      "Most contractors have people, habits, spreadsheets, meetings, and instincts. That is not a company machine until ownership, numbers, issues, process, and cadence are visible.",
    move: "Draft the VITO, accountability chart, people analyzer, scorecard, issue board, quarterly rocks, and L10 rhythm. This creates the company operating baseline.",
    deepDive: [
      "AOS answers six operating questions: where are we going, who owns what, what numbers tell the truth, what issues must be solved, what processes must be followed, and what rhythm keeps execution moving.",
      "The accountability chart moves work out of the owner's memory and into seats with roles, responsibilities, accountabilities, numbers, and decision rights.",
      "The L10 is the company execution meeting. It turns scorecard signals and recurring issues into owned decisions.",
    ],
    chapter: {
      sourceTrail: "Playbook v0.3, Apr 26 bootcamp, AOS/L10 teaching archive",
      standard:
        "AOS is installed when vision, seats, numbers, issues, process, and weekly traction are visible enough for the team to run the company without guessing.",
      teaches: [
        "The VITO moves company direction out of private owner instinct and into shared operating clarity.",
        "The accountability chart is not a hierarchy document. It is an ownership document with seats, roles, numbers, and decision rights.",
        "The L10 is where the company machine is inspected. Red numbers become issues, issues become decisions, and decisions become owned to-dos.",
      ],
      install: [
        "Draft the VITO, even if it is imperfect, so the team can see the current target.",
        "Build the accountability chart around functions and seats, not people, titles, or personalities.",
        "Run the first L10 fast. Clumsy rhythm is better than invisible execution.",
      ],
      proof: [
        "Every scorecard number has an owner and a goal.",
        "The issue list contains root problems, not vague complaints.",
        "The weekly meeting produces decisions, to-dos, owners, and deadlines.",
      ],
      worksheet: "AOS Baseline Worksheet",
    },
    tool: "AOS",
    route: "/aos",
  },
  {
    id: "economics",
    eyebrow: "03 / Capacity",
    title: "Install The Economics Engine",
    image: economicsEngine,
    doctrine: "Revenue is not the same as capacity. Profit is not the same as cash.",
    problem:
      "A contractor can want a larger company while the current operating capacity, billing velocity, cash conversion, bonding, or PM bandwidth cannot carry the target.",
    move: "Build the one-page economics snapshot. Compare revenue goal against current capacity, then identify whether cash, PM bandwidth, admin billing, or bonding is the primary constraint.",
    deepDive: [
      "Annual Billing Capacity is not the owner's ambition. It is what the current people, capital, bonding, billing system, and project-management bandwidth can actually carry.",
      "Concurrent billing events matter because revenue only becomes useful when earned work turns into approved invoices and collected cash.",
      "The Navigator should prioritize the constraint by business impact, not just by low score. A large capacity gap can outrank a weaker but lower-dollar issue.",
    ],
    chapter: {
      sourceTrail: "Playbook v0.3, Economics Engine brief, COS Navigator prototype",
      standard: "The company must know what it can carry before it decides what it wants to sell.",
      teaches: [
        "Revenue is not capacity. A larger target does not create PM bandwidth, bonding capacity, cash capacity, admin billing capacity, or clean throughput.",
        "Profit is not cash. A project can be profitable on paper while change orders, pay apps, retention, and AR make the company finance the job.",
        "The capacity gap is the executive bridge between AOS and IOR: AOS creates capacity, IOR protects capacity, and economics tells you where the constraint lives.",
      ],
      install: [
        "Calculate annual revenue goal against current annual billing capacity.",
        "Rank cash, PM bandwidth, admin billing capacity, and bonding capacity as constraints.",
        "Add the active constraint to the weekly scorecard until the company can prove it is moving.",
      ],
      proof: [
        "Leadership can name the primary capacity constraint.",
        "The revenue goal is compared against current capacity, not hope.",
        "Cash conversion, AR, and change-order velocity are discussed as operating constraints.",
      ],
      worksheet: "Economics Snapshot + Capacity Constraint Worksheet",
    },
    tool: "COS Navigator",
    workbenchToolId: "cos-navigator",
  },
  {
    id: "ior",
    eyebrow: "04 / Truth",
    title: "Install Project Financial Truth",
    image: iorFormula,
    doctrine: "The budget is the original plan. IOR is where the project is actually going.",
    problem:
      "Projects lose money slowly before accounting confirms the loss. If risk is not converted into dollars early, the team is only managing noise.",
    move: "Choose one active project and build the first IOR: forecasted final contract, forecasted final cost, exposure holds, contingency holds, and indicated gross profit.",
    deepDive: [
      "The budget is the original plan. IOR is the best current forecast of where the project is indicating it will land.",
      "Exposure Holds protect against known risks: late owner decisions, unpriced change work, manpower failure, schedule compression, or drawing conflicts.",
      "Contingency Holds protect against general uncertainty until the project is mature enough to release the remaining profit as earned.",
    ],
    chapter: {
      sourceTrail: "Jun 2 Contractor School, Jun 21 Contractor Circle IOR application teaching",
      standard:
        "A project is not financially understood until the team can explain forecasted final contract, forecasted final cost, E-holds, C-holds, and indicated gross profit.",
      teaches: [
        "The budget is the plan before the project starts fighting back. IOR is the financial reading after reality enters the job.",
        "Known risk gets an exposure hold. General uncertainty gets a contingency hold. Profit is not treated as real until the risk is resolved or released.",
        "The PM is not done reporting when they describe the problem. They must convert the problem into financial exposure and a management decision.",
      ],
      install: [
        "Pick one active project and build the first IOR from current contract, current cost forecast, and known risks.",
        "Create E-holds for specific risks and C-holds for general uncertainty that should not be released yet.",
        "Review indicated gross profit weekly until the PM can explain what changed and what decision is needed.",
      ],
      proof: [
        "Leadership sees margin movement before accounting confirms it.",
        "Known risks carry dollar values and owners.",
        "The PM can explain how the project gets from current exposure to recovered margin.",
      ],
      worksheet: "IOR Snapshot Worksheet",
    },
    tool: "IOR Application",
    external: "https://overwatch.alpcontractorcircle.com",
  },
  {
    id: "risk",
    eyebrow: "05 / Action",
    title: "Make Risk Visible And Owned",
    image: riskActionFunnel,
    doctrine: "Probability x Impact creates a useful enough risk value to change behavior.",
    problem:
      "Most PM meetings report activity instead of surfacing financial exposure, recovery paths, escalation needs, and risk actions.",
    move: "Build the top-five risk register for the pilot project. Assign probability, impact, net risk, owner, action, review date, and effect on indicated gross profit.",
    deepDive: [
      "Risk value does not need to be perfect. It needs to be useful early enough to change behavior.",
      "Every meaningful risk gets one of four actions: eliminate it, recover it, offset it, or consciously accept it.",
      "The top-five risk register becomes the bridge between project reality, IOR holds, PM meetings, scorecard signals, and L10 issues.",
    ],
    chapter: {
      sourceTrail: "Jun 9 Contractor School, IOR risk register teaching, Risk Action Funnel",
      standard:
        "Risk is owned when it has a dollar value, an action path, an owner, a review date, and a decision about eliminate, recover, offset, or accept.",
      teaches: [
        "Risk management starts by asking where the money is exposed, what risk is growing, and what risk is shrinking.",
        "Growing risk belongs in leadership rhythm before it becomes expensive. Shrinking risk can release holds and move dollars back toward profit.",
        "The risk register is not a paperwork exercise. It is the bridge between PM awareness, IOR holds, scorecard signals, and L10 issues.",
      ],
      install: [
        "Build a top-five risk register for the pilot project.",
        "Assign probability, impact, risk value, owner, action, and review date.",
        "Move any recurring or leadership-level risk into the AOS issue board.",
      ],
      proof: [
        "PM meetings discuss risk movement, not only activity.",
        "At least one risk is eliminated, recovered, offset, or consciously accepted each week.",
        "Holds are updated because risk changed, not because someone feels better.",
      ],
      worksheet: "Top-Five Risk Register",
    },
    tool: "Margin Leak Finder",
    workbenchToolId: "margin-leak",
  },
  {
    id: "weekly-rhythm",
    eyebrow: "06 / Cadence",
    title: "Run The Weekly Rhythm",
    image: weeklyRhythm,
    doctrine: "Information only creates control when it enters a rhythm.",
    problem:
      "A company can have the right facts and still fail to act because risk never reaches the L10, the scorecard, the issue board, or owned to-dos.",
    move: "Run the Monday PM risk review, update the scorecard before the L10, move recurring project risk into company issues, and review owned to-dos the following week.",
    deepDive: [
      "The Monday PM risk review starts with project financial truth: what billed, what gross profit is indicated, and which risks are growing or shrinking.",
      "IOR metrics should feed the company scorecard: exposure holds, contingency holds, change-order velocity, unapproved change value, schedule exposure, and open risk actions.",
      "Project risk becomes a company issue when it repeats across jobs, requires leadership, exposes a process failure, or threatens company margin.",
    ],
    chapter: {
      sourceTrail: "Apr 26 bootcamp L10, Jun 2 IOR/AOS integration, Jun 9 PM risk review",
      standard:
        "The week is working when project truth reaches the scorecard, scorecard exceptions become issues, and issues become owned to-dos.",
      teaches: [
        "AOS and IOR marry inside the weekly rhythm. IOR shows project truth; AOS forces the company to own and solve what the truth reveals.",
        "PM meetings should surface exposure, escalation needs, and recovery paths before the L10.",
        "The L10 is where recurring project risk becomes company improvement instead of another week of storytelling.",
      ],
      install: [
        "Run a Monday PM risk review before the company L10.",
        "Update scorecard items tied to IOR: exposure holds, C-holds, change-order velocity, AR, schedule exposure, and open risk actions.",
        "Move the right project issues into IDS with owners and due dates.",
      ],
      proof: [
        "The L10 contains fewer vague updates and more decision-grade issues.",
        "Every red metric either has context, an issue, or a to-do.",
        "The following week starts by checking whether owned actions happened.",
      ],
      worksheet: "Weekly PM Risk Review + L10 Integration Worksheet",
    },
    tool: "AOS Scorecard + L10",
    route: "/aos",
  },
  {
    id: "delivery",
    eyebrow: "07 / Systems",
    title: "Standardize Delivery Systems",
    image: capacityStack,
    doctrine: "Project profit is protected by small delivery systems that repeat across jobs.",
    problem:
      "Selections, change orders, EOT, acceleration, and burn rate create margin exposure when they depend on personality instead of process.",
    move: "Pick one delivery system to install first. The recommended order is change order velocity, extension of time, selections, burn rate, then acceleration pricing.",
    deepDive: [
      "Change Order Velocity is cash-flow protection: issue identified, priced, submitted, approved, formalized, billed, and collected.",
      "Extension of Time establishes responsibility for owner-caused delay before the company prices general conditions or acceleration.",
      "Burn rate turns time into money so PMs understand the daily cost of delay, supervision, equipment, overhead, and lost opportunity.",
    ],
    chapter: {
      sourceTrail: "Worksheet bank, IOR delivery-system teaching, risk/action implementation notes",
      standard:
        "Delivery systems are installed when common margin threats follow a repeatable workflow instead of depending on the personality of the PM.",
      teaches: [
        "Selections, change orders, delay notices, acceleration, and burn rate are not admin details. They are margin-protection systems.",
        "A delivery system should show status, owner, deadline, financial exposure, and next action.",
        "The first delivery system to install is the one most directly connected to the active constraint or largest margin leak.",
      ],
      install: [
        "Choose one delivery system to install first: change-order velocity, EOT, selections, burn rate, or acceleration pricing.",
        "Define the workflow from event to approval, billing, or recovery.",
        "Add the system's lead indicator to the scorecard until it becomes habit.",
      ],
      proof: [
        "Change orders move faster from issue to approval to billing.",
        "Schedule exposure gets notices, fragments, or escalation before it becomes unrecoverable.",
        "Time-related exposure is translated into dollars through burn rate.",
      ],
      worksheet: "Change Order Velocity Tracker / EOT Checklist / Burn Rate Worksheet",
    },
    tool: "Contract Readiness Scan",
    workbenchToolId: "contract-readiness",
  },
];

const fieldManualChapters = playbookSections.map((section) => ({
  id: section.id,
  eyebrow: section.eyebrow,
  title: section.title,
  doctrine: section.doctrine,
  tool: section.tool,
  worksheet: section.chapter.worksheet,
  sourceTrail: section.chapter.sourceTrail,
}));

const manualLayers = [
  {
    title: "Operating map",
    copy: "This is the current member-facing map: the doctrine, visuals, sequence, and implementation moves that explain how AOS and IOR fit together.",
  },
  {
    title: "Field manual",
    copy: "The deeper chapter layer turns the Contractor Circle teaching, Zoom transcripts, worksheets, and examples into standards, moves, and proof.",
  },
  {
    title: "Operating advisor",
    copy: "The Navigator turns the manual into a decision path: constraint, financial signal, 30-day route, 90-day sequence, worksheet, module, and tool.",
  },
];

const installPlan = [
  {
    week: "Week 1",
    title: "Diagnose",
    items: [
      "Run the Owner Bottleneck Audit.",
      "Choose the pilot project.",
      "Draft the economics snapshot.",
      "Pull the contract, budget, cost, and change-order data.",
    ],
  },
  {
    week: "Week 2",
    title: "Build",
    items: [
      "Clean up accountability seats.",
      "Build the first scorecard.",
      "Identify the current capacity constraint.",
      "Build the first project IOR and top-five risks.",
    ],
  },
  {
    week: "Week 3",
    title: "Run",
    items: [
      "Run the first Monday PM risk review.",
      "Run the L10 with scorecard and issue board.",
      "Move project risk into company issues.",
      "Assign owners and to-dos.",
    ],
  },
  {
    week: "Week 4",
    title: "Standardize",
    items: [
      "Review what broke in the first three weeks.",
      "Pick one delivery system to document.",
      "Update the scorecard and IOR.",
      "Decide the next project to add.",
    ],
  },
];

function OperatingPlaybookPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Hero />

      <main className="mx-auto grid w-full max-w-[1480px] gap-8 px-4 pb-24 pt-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8">
        <aside className="hidden lg:block">
          <nav className="sticky top-20 rounded-lg border border-border bg-card/70 p-3">
            <p className="px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Playbook
            </p>
            {playbookSections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="block rounded-md px-2 py-2 text-[12px] leading-tight text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-signal">
                  {section.eyebrow.split(" / ")[0]}
                </span>
                <span className="mt-0.5 block">{section.title}</span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="space-y-10">
          <OperatingMap />
          <ManualLayer />
          <FieldManualIndex />
          <DoctrineBank />
          <ConstraintEngine />
          {playbookSections.map((section) => (
            <PlaybookSection key={section.id} section={section} />
          ))}
          <InstallationPlan />
        </div>
      </main>
    </div>
  );
}

function Hero() {
  return (
    <section className="border-b border-border bg-[var(--paper-deep)]/45">
      <div className="mx-auto grid w-full max-w-[1480px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_420px] lg:px-8 lg:py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-signal">
            Contractor Circle Member Playbook
          </p>
          <h1 className="mt-4 max-w-4xl font-display text-[clamp(2.8rem,6vw,6.2rem)] leading-[0.94] text-foreground">
            Contractor Operating System
          </h1>
          <p className="mt-5 max-w-3xl text-[17px] leading-[1.7] text-foreground/72">
            The field manual for removing the owner bottleneck, installing company accountability,
            understanding capacity, and managing project financial truth before accounting confirms
            what already happened.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/tools"
              search={{ t: "cos-navigator" } as never}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:opacity-90"
            >
              Run COS Navigator
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <a
              href="#installation"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground/80 hover:bg-muted"
            >
              See 30-Day Install
            </a>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            The operating sequence
          </p>
          <div className="mt-4 grid gap-2">
            {["Diagnose", "Structure", "Capacity", "Truth", "Risk", "Cadence", "Systems"].map(
              (label, index) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-md border border-border/80 bg-background px-3 py-2"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[13px] text-foreground/78">{label}</span>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function OperatingMap() {
  return (
    <section className="grid gap-5 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            System map
          </p>
          <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.5rem)] leading-none">
            Build the company behind the projects.
          </h2>
        </div>
        <p className="max-w-md text-[13px] leading-[1.6] text-muted-foreground">
          This is the opening map. Everything else in the playbook explains one part of this
          operating system and turns it into a member action.
        </p>
      </div>
      <VisualImage src={cosMap} alt="Contractor Operating System map" />
    </section>
  );
}

function ManualLayer() {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            Current build
          </p>
          <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.5rem)] leading-none">
            Map. Manual. Advisor.
          </h2>
        </div>
        <p className="max-w-md text-[13px] leading-[1.6] text-muted-foreground">
          The page you are in now has the operating map, the first field-manual chapter layer, and
          the advisor path into the Workbench.
        </p>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {manualLayers.map((layer, idx) => (
          <article key={layer.title} className="rounded-lg border border-border bg-background p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
              {String(idx + 1).padStart(2, "0")}
            </p>
            <h3 className="mt-2 font-display text-3xl leading-none">{layer.title}</h3>
            <p className="mt-3 text-[13px] leading-[1.65] text-muted-foreground">{layer.copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FieldManualIndex() {
  return (
    <section className="rounded-lg border border-border bg-[var(--paper-deep)]/45 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            Field manual
          </p>
          <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.5rem)] leading-none">
            The chapter path members should work through.
          </h2>
        </div>
        <p className="max-w-md text-[13px] leading-[1.6] text-muted-foreground">
          Each chapter now carries the doctrine, operating standard, installation moves, proof of
          progress, worksheet, tool path, and source trail from the teaching archive.
        </p>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {fieldManualChapters.map((chapter) => (
          <a
            key={chapter.id}
            href={`#${chapter.id}`}
            className="group rounded-lg border border-border bg-card p-4 transition hover:border-foreground/30 hover:bg-background"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
                  {chapter.eyebrow}
                </p>
                <h3 className="mt-2 font-display text-3xl leading-none">{chapter.title}</h3>
              </div>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-foreground/40 transition group-hover:text-signal" />
            </div>
            <p className="mt-3 border-l-2 border-signal/70 pl-3 text-[13px] leading-[1.55] text-foreground/78">
              {chapter.doctrine}
            </p>
            <div className="mt-4 grid gap-2 text-[12px] leading-[1.45] text-muted-foreground sm:grid-cols-3">
              <div className="rounded-md border border-border bg-background p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">
                  Tool path
                </p>
                <p className="mt-1">{chapter.tool}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">
                  Worksheet
                </p>
                <p className="mt-1">{chapter.worksheet}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">
                  Source trail
                </p>
                <p className="mt-1">{chapter.sourceTrail}</p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function DoctrineBank() {
  return (
    <section className="grid gap-4" id="doctrine">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
          Doctrine bank
        </p>
        <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.5rem)] leading-none">
          Four statements that carry the methodology.
        </h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {doctrineCards.map((card) => (
          <article key={card.title} className="rounded-lg border border-border bg-card p-3">
            <VisualImage src={card.image} alt={card.title} compact />
            <div className="px-1 pb-1 pt-4">
              <h3 className="font-display text-3xl leading-none">{card.title}</h3>
              <p className="mt-3 text-[13px] leading-[1.65] text-muted-foreground">{card.copy}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConstraintEngine() {
  return (
    <section className="grid gap-5 rounded-lg border border-border bg-ink p-4 text-cream sm:p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            Navigator bridge
          </p>
          <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.8rem)] leading-none">
            The assessment ends with a decision.
          </h2>
          <p className="mt-4 max-w-3xl text-[14px] leading-[1.7] text-cream/70">
            The playbook teaches the operating doctrine. The COS Navigator turns that doctrine into
            constraint ranking, impact weighting, a 90-day sequence, and the first 30-day route.
          </p>
        </div>
        <div className="rounded-lg border border-cream/15 bg-cream/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
            Operating advisor answers
          </p>
          <ul className="mt-4 space-y-2 text-[13px] text-cream/78">
            {[
              "What is the biggest constraint?",
              "What is it costing?",
              "What should happen in 30 days?",
              "What should happen in 90 days?",
              "Which module, worksheet, and app should be used?",
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <VisualImage
        src={constraintResolutionPlan}
        alt="Constraint Resolution Plan decision engine"
        dark
      />
    </section>
  );
}

type PlaybookSectionData = (typeof playbookSections)[number];

function PlaybookSection({ section }: { section: PlaybookSectionData }) {
  return (
    <section
      id={section.id}
      className="scroll-mt-24 rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            {section.eyebrow}
          </p>
          <h2 className="mt-2 font-display text-[clamp(2.2rem,4vw,4.6rem)] leading-[0.98]">
            {section.title}
          </h2>
          <p className="mt-5 border-l-2 border-signal pl-4 font-display text-[1.6rem] leading-[1.1] text-foreground">
            {section.doctrine}
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <InfoBlock
              title="The problem"
              copy={section.problem}
              icon={<Target className="h-4 w-4" />}
            />
            <InfoBlock
              title="Implementation move"
              copy={section.move}
              icon={<ClipboardList className="h-4 w-4" />}
            />
          </div>
          <div className="mt-6 rounded-lg border border-border bg-background p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
              Deeper dive
            </p>
            <ul className="mt-3 space-y-3 text-[13px] leading-[1.6] text-muted-foreground">
              {section.deepDive.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <ManualChapter chapter={section.chapter} />
          <div className="mt-6 flex flex-wrap gap-3">
            {"workbenchToolId" in section && section.workbenchToolId ? (
              <Link
                to="/tools"
                search={{ t: section.workbenchToolId } as never}
                className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:opacity-90"
              >
                Open {section.tool}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            ) : null}
            {"route" in section && section.route ? (
              <Link
                to={section.route as "/tools"}
                className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:opacity-90"
              >
                Open {section.tool}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            ) : null}
            {"external" in section && section.external ? (
              <a
                href={section.external}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:opacity-90"
              >
                Open {section.tool}
                <ArrowUpRight className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        </div>
        <VisualImage src={section.image} alt={`${section.title} visual`} />
      </div>
    </section>
  );
}

function ManualChapter({ chapter }: { chapter: PlaybookSectionData["chapter"] }) {
  return (
    <div className="mt-6 rounded-lg border border-border bg-[var(--paper-deep)]/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            Field manual chapter
          </p>
          <p className="mt-2 max-w-3xl font-display text-[1.8rem] leading-[1.05]">
            {chapter.standard}
          </p>
        </div>
        <div className="rounded-md border border-border bg-card p-3 text-[12px] leading-[1.45] text-muted-foreground">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">
            Source trail
          </p>
          <p className="mt-1 max-w-[260px]">{chapter.sourceTrail}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <ChapterList title="What this teaches" items={chapter.teaches} />
        <ChapterList title="Install this now" items={chapter.install} />
        <ChapterList title="Proof it is working" items={chapter.proof} />
      </div>
      <div className="mt-4 rounded-md border border-border bg-card p-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">
          Worksheet to complete
        </p>
        <p className="mt-1 text-[13px] leading-[1.5] text-foreground/78">{chapter.worksheet}</p>
      </div>
    </div>
  );
}

function ChapterList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">{title}</p>
      <ul className="mt-3 space-y-3 text-[13px] leading-[1.55] text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoBlock({ title, copy, icon }: { title: string; copy: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2 text-signal">
        {icon}
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em]">{title}</h3>
      </div>
      <p className="mt-3 text-[13px] leading-[1.65] text-muted-foreground">{copy}</p>
    </div>
  );
}

function InstallationPlan() {
  return (
    <section
      id="installation"
      className="scroll-mt-24 rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            30-day installation
          </p>
          <h2 className="mt-2 font-display text-[clamp(2.2rem,4vw,4rem)] leading-none">
            Start with one company and one pilot project.
          </h2>
        </div>
        <Link
          to="/tools"
          search={{ t: "cos-navigator" } as never}
          className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:opacity-90"
        >
          Build the roadmap
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        {installPlan.map((phase) => (
          <article key={phase.week} className="rounded-lg border border-border bg-background p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
              {phase.week}
            </p>
            <h3 className="mt-2 font-display text-3xl leading-none">{phase.title}</h3>
            <ul className="mt-4 space-y-3 text-[13px] leading-[1.5] text-muted-foreground">
              {phase.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function VisualImage({
  src,
  alt,
  compact = false,
  dark = false,
}: {
  src: string;
  alt: string;
  compact?: boolean;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group block w-full overflow-hidden rounded-md border text-left ${
          dark ? "border-cream/15 bg-cream/5" : "border-border bg-background"
        }`}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={`w-full object-cover transition duration-300 group-hover:scale-[1.015] ${
            compact ? "aspect-[16/9]" : "aspect-[16/9]"
          }`}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[min(1200px,94vw)] max-w-none overflow-auto p-3">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">
            Enlarged operating system visual. Close the dialog to return to the page.
          </DialogDescription>
          <img src={src} alt={alt} className="h-auto w-full rounded-md" />
        </DialogContent>
      </Dialog>
    </>
  );
}
