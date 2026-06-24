import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Compass,
  Loader2,
  MessageCircle,
  PlayCircle,
  Route as RouteIcon,
  Target,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { createThread } from "@/lib/ask.functions";

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
    imageClassName: "object-[50%_58%]",
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
      module: "AOS Installation",
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
      module: "AOS Installation",
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
      module: "Economics Engine Workshop",
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
      module: "IOR Implementation Sprint",
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
      module: "IOR Risk Review",
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
      module: "Weekly Rhythm Installation",
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
      module: "Delivery Systems Sprint",
      worksheet: "Change Order Velocity Tracker / EOT Checklist / Burn Rate Worksheet",
    },
    tool: "Contract Readiness Scan",
    workbenchToolId: "contract-readiness",
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

const orientationCards = [
  {
    icon: <Compass className="h-4 w-4" />,
    title: "Understand the system",
    copy: "See how owner dependence, AOS, economics, IOR, risk, rhythm, and delivery fit together.",
  },
  {
    icon: <Target className="h-4 w-4" />,
    title: "Find the constraint",
    copy: "Use the Navigator to identify what is actually limiting the company right now.",
  },
  {
    icon: <RouteIcon className="h-4 w-4" />,
    title: "Install the next move",
    copy: "Leave with the chapter, worksheet, module, and tool that belong in the next 30 days.",
  },
];

const toolLaunchpad = [
  {
    id: "cos-navigator",
    title: "COS Navigator",
    copy: "Diagnose the company, rank the constraint, and generate the operating roadmap.",
  },
  {
    id: "sop-priority",
    title: "SOP Priority Builder",
    copy: "Decide which operating process should get documented first.",
  },
  {
    id: "contract-readiness",
    title: "Contract Readiness Scan",
    copy: "Spot contract risk before it becomes project margin exposure.",
  },
  {
    id: "owner-dependency",
    title: "Owner Dependency Scorecard",
    copy: "Find where decisions, memory, and escalation still route back through the owner.",
  },
  {
    id: "growth-constraint",
    title: "Growth Constraint Map",
    copy: "Identify what limits the next stage of revenue, throughput, and capacity.",
  },
  {
    id: "estimate-throughput",
    title: "Estimate Throughput Tracker",
    copy: "See whether estimating flow can support the growth target.",
  },
  {
    id: "margin-leak",
    title: "Margin Leak Finder",
    copy: "Trace where project profit is escaping before accounting proves it.",
  },
];

const clientRolloutSteps = [
  {
    label: "01",
    title: "See the operating map",
    copy: "Do not start with every chapter. First see how owner dependence, AOS, economics, IOR, risk, cadence, and delivery connect.",
    action: "Open map",
    kind: "map",
  },
  {
    label: "02",
    title: "Run the COS Navigator",
    copy: "Answer the assessment and capacity questions so the system can rank the active constraint instead of giving generic advice.",
    action: "Run Navigator",
    to: "/tools",
    search: { t: "cos-navigator" },
  },
  {
    label: "03",
    title: "Save the diagnosis",
    copy: "Save the Navigator output to the Vault. That packet becomes operating context for Ask Marshall and future review.",
    action: "Open Vault",
    to: "/vault",
  },
  {
    label: "04",
    title: "Ask Marshall for the next move",
    copy: "Ask from the saved diagnosis: what should we do first this week, and what should we bring to the next call?",
    action: "Ask Marshall",
    to: "/ask",
  },
  {
    label: "05",
    title: "Bring one issue to the room",
    copy: "Use the diagnosis to bring one real bottleneck to the next Contractor Circle call, not a vague update.",
    action: "Submit topic",
    to: "/calls",
    hash: "submit-topic",
  },
] as const;

type PlaybookSectionData = (typeof playbookSections)[number];

function OperatingPlaybookPage() {
  const [ready, setReady] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(playbookSections[0].id);
  const activeSection =
    playbookSections.find((section) => section.id === activeSectionId) ?? playbookSections[0];
  usePlaybookRevealFallback(ready);

  useEffect(() => {
    const timeout = window.setTimeout(() => setReady(true), 520);
    return () => window.clearTimeout(timeout);
  }, []);

  function scrollToSection(id: string) {
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function selectSection(id: string) {
    setActiveSectionId(id);
    scrollToSection("chapter-reader");
  }

  if (!ready) return <ExperienceLoader />;

  return (
    <div data-cos-playbook className="min-h-screen bg-background text-foreground">
      <Hero onStart={() => scrollToSection("client-rollout")} />

      <main className="mx-auto w-full max-w-[1520px] space-y-10 px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <ClientRolloutPath onStartMap={() => scrollToSection("system-map")} />
        <MemberOrientation />
        <OperatingMap />
        <ConstraintEngine />
        <SequenceBand activeId={activeSection.id} onSelect={selectSection} />
        <GuidedChapterReader
          activeSection={activeSection}
          activeId={activeSection.id}
          onSelect={selectSection}
        />
        <DoctrineBank />
        <ToolLaunchpad />
        <InstallationPlan />
      </main>
    </div>
  );
}

function usePlaybookRevealFallback(ready: boolean) {
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;

    let raf = 0;
    const timers = new Set<number>();

    const revealVisible = () => {
      const root = document.querySelector<HTMLElement>("[data-cos-playbook]");
      if (!root) return;

      root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-visible)").forEach((el) => {
        const rect = el.getBoundingClientRect();
        const nearViewport = rect.top < window.innerHeight * 1.15 && rect.bottom > -120;
        if (nearViewport) el.classList.add("is-visible");
      });
    };

    const scheduleReveal = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        revealVisible();
      });
    };

    scheduleReveal();
    [220, 700, 1400].forEach((delay) => {
      const timer = window.setTimeout(revealVisible, delay);
      timers.add(timer);
    });

    window.addEventListener("scroll", scheduleReveal, { passive: true });
    window.addEventListener("resize", scheduleReveal);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("scroll", scheduleReveal);
      window.removeEventListener("resize", scheduleReveal);
    };
  }, [ready]);
}

function ExperienceLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background">
            <span className="absolute h-8 w-8 animate-ping rounded-full border border-signal/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-signal" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
              Building the path
            </p>
            <p className="mt-1 font-display text-3xl leading-none">Map. Manual. Advisor.</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2">
          {["Doctrine", "Behavior", "Visibility"].map((item, index) => (
            <div key={item} className="rounded-md border border-border bg-background p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                0{index + 1}
              </p>
              <p className="mt-2 text-[12px] text-foreground/78">{item}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section data-reveal className="border-b border-border bg-[var(--paper-deep)]/45">
      <div className="mx-auto grid w-full max-w-[1520px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_430px] lg:px-8 lg:py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-signal">
            Contractor Circle Member Playbook
          </p>
          <h1 className="mt-4 max-w-4xl font-display text-[clamp(2.8rem,6vw,6.2rem)] leading-[0.94] text-foreground">
            Contractor Operating System
          </h1>
          <p className="mt-5 max-w-3xl text-[18px] leading-[1.65] text-foreground/76">
            This is the guided field manual for learning how AOS and IOR work together, finding the
            constraint, and choosing the next operating move inside Contractor Circle.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:opacity-90"
            >
              Start Guided Path
              <PlayCircle className="h-4 w-4" />
            </button>
            <Link
              to="/tools"
              search={{ t: "cos-navigator" } as never}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground/80 hover:bg-muted"
            >
              Run COS Navigator
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            What this page does
          </p>
          <div className="mt-4 space-y-3">
            {orientationCards.map((card, index) => (
              <div
                key={card.title}
                data-reveal
                data-reveal-delay={String(index + 1)}
                className="rounded-md border border-border bg-background p-3"
              >
                <div className="flex items-center gap-2 text-signal">
                  {card.icon}
                  <h2 className="font-mono text-[10px] uppercase tracking-[0.18em]">
                    {card.title}
                  </h2>
                </div>
                <p className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">{card.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ClientRolloutPath({ onStartMap }: { onStartMap: () => void }) {
  return (
    <section
      id="client-rollout"
      data-reveal
      className="scroll-mt-24 overflow-hidden rounded-lg border border-ink bg-ink text-cream shadow-soft"
    >
      <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cream/15 bg-cream/5 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-signal animate-signal-pulse" />
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/70">
              Member path live
            </p>
          </div>
          <h2 className="mt-4 max-w-3xl font-display text-[clamp(2.3rem,4.5vw,4.8rem)] leading-[0.96]">
            Install the first operating route this week.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-[1.75] text-cream/72">
            This is the first Contractor OS path inside Contractor Circle. Members should not try
            to learn every idea at once. The job is to run the Navigator, save the diagnosis, ask
            Marshall from that context, and bring one constraint to the next call.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/tools"
              search={{ t: "cos-navigator" } as never}
              className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink hover:bg-signal/90"
            >
              Run COS Navigator
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              to="/ask"
              className="inline-flex items-center gap-2 rounded-md border border-cream/18 bg-cream/5 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:bg-cream/10"
            >
              Ask from diagnosis
              <MessageCircle className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {clientRolloutSteps.map((step, index) => {
            const card = (
              <div
                data-reveal
                data-reveal-delay={String(index + 1)}
                className="group h-full rounded-lg border border-cream/12 bg-cream/[0.045] p-4 transition hover:border-signal/55 hover:bg-cream/[0.07]"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
                    {step.label}
                  </p>
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/40 group-hover:text-signal">
                    {step.action}
                  </span>
                </div>
                <h3 className="mt-3 font-display text-3xl leading-none text-cream">
                  {step.title}
                </h3>
                <p className="mt-3 text-[13px] leading-[1.6] text-cream/68">{step.copy}</p>
              </div>
            );

            if ("kind" in step && step.kind === "map") {
              return (
                <button
                  key={step.label}
                  type="button"
                  onClick={onStartMap}
                  className="block h-full w-full text-left"
                >
                  {card}
                </button>
              );
            }

            return (
              <Link
                key={step.label}
                to={("to" in step ? step.to : "/") as "/"}
                search={("search" in step ? step.search : undefined) as never}
                hash={"hash" in step ? step.hash : undefined}
                className="text-left"
              >
                {card}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="border-t border-cream/10 bg-cream/[0.035] px-5 py-4 sm:px-6">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["Member outcome", "They know the biggest constraint and the next operating move."],
            ["Vault context", "Saved Navigator packets become context for Ask Marshall."],
            ["Call prep", "They bring one diagnosed issue instead of a broad status update."],
          ].map(([label, copy]) => (
            <div key={label} className="rounded-md border border-cream/10 bg-ink/30 p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">
                {label}
              </p>
              <p className="mt-2 text-[12.5px] leading-[1.55] text-cream/68">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MemberOrientation() {
  return (
    <section data-reveal className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            Start here
          </p>
          <h2 className="mt-2 max-w-2xl font-display text-[clamp(2.25rem,4vw,4.25rem)] leading-none">
            You are here to get one answer.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-[1.75] text-foreground/72">
            Which part of the company operating system should you install next, and what tool,
            worksheet, or Contractor Circle module should you use first?
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
          {[
            ["First", "See the whole operating system map so the parts are not floating ideas."],
            ["Second", "Understand that the Navigator turns the map into a decision and a route."],
            ["Third", "Work the field manual chapter that matches the next operating constraint."],
          ].map(([label, copy], index) => (
            <div
              key={label}
              data-reveal
              data-reveal-delay={String(index + 1)}
              className="rounded-lg border border-border bg-background p-4"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                {label}
              </p>
              <p className="mt-2 text-[14px] leading-[1.55] text-foreground/78">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SequenceBand({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      id="guided-sequence"
      data-reveal
      className="scroll-mt-24 rounded-lg border border-border bg-card p-5 shadow-soft sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            Chapter sequence
          </p>
          <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.65rem)] leading-none">
            Now work the system one chapter at a time.
          </h2>
          <p className="mt-3 max-w-2xl text-[14px] leading-[1.7] text-muted-foreground">
            After the map and decision bridge, this is the path into the field manual. Choose the
            chapter that matches the constraint, or start with owner bottleneck and continue.
          </p>
        </div>
        <Link
          to="/tools"
          search={{ t: "cos-navigator" } as never}
          className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:bg-signal/90"
        >
          Run Navigator
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-7">
        {playbookSections.map((section, index) => {
          const active = section.id === activeId;
          const [number, label] = section.eyebrow.split(" / ");
          return (
            <button
              key={section.id}
              type="button"
              data-reveal
              data-reveal-delay={String(Math.min(index + 1, 6))}
              onClick={() => onSelect(section.id)}
              className={`hover-lift min-h-[124px] rounded-lg border p-3 text-left transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground/78 hover:border-foreground/35"
              }`}
            >
              <span
                className={`font-mono text-[9px] uppercase tracking-[0.18em] ${
                  active ? "text-background/65" : "text-signal"
                }`}
              >
                {number}
              </span>
              <span
                className={`mt-2 block font-mono text-[10px] uppercase tracking-[0.18em] ${
                  active ? "text-background/65" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
              <span className="mt-3 block text-[14px] font-medium leading-tight">
                {section.title}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function OperatingMap() {
  return (
    <section
      id="system-map"
      data-reveal
      className="scroll-mt-24 grid gap-5 rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            System map
          </p>
          <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.5rem)] leading-none">
            See the whole machine once.
          </h2>
        </div>
        <p className="max-w-md text-[14px] leading-[1.7] text-muted-foreground">
          This map is orientation, not homework. The guided chapters below break it into one
          decision at a time.
        </p>
      </div>
      <VisualImage src={cosMap} alt="Contractor Operating System map" />
    </section>
  );
}

function ConstraintEngine() {
  return (
    <section
      id="decision-bridge"
      data-reveal
      className="scroll-mt-24 grid gap-5 rounded-lg border border-border bg-ink p-5 text-cream sm:p-6"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            Navigator bridge
          </p>
          <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.8rem)] leading-none">
            The assessment ends with a decision.
          </h2>
          <p className="mt-4 max-w-3xl text-[14px] leading-[1.7] text-cream/70">
            The manual teaches the doctrine. The COS Navigator turns it into constraint ranking,
            impact weighting, a 90-day sequence, and the first 30-day route.
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

function GuidedChapterReader({
  activeSection,
  activeId,
  onSelect,
}: {
  activeSection: PlaybookSectionData;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const activeIndex = playbookSections.findIndex((section) => section.id === activeId);
  const nextSection = playbookSections[(activeIndex + 1) % playbookSections.length];

  return (
    <section
      id="chapter-reader"
      data-reveal
      className="scroll-mt-24 rounded-lg border border-border bg-[var(--paper-deep)]/45 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            Field manual
          </p>
          <h2 className="mt-2 font-display text-[clamp(2.2rem,4vw,4.25rem)] leading-none">
            Install the selected chapter.
          </h2>
        </div>
        <p className="max-w-md text-[14px] leading-[1.7] text-muted-foreground">
          You chose {activeSection.title}. Use this as the operating page for doctrine, next move,
          proof, worksheet, tool, and source trail.
        </p>
      </div>

      <div className="mt-6">
        <article className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.72fr)]">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
                {activeSection.eyebrow}
              </p>
              <h3 className="mt-2 font-display text-[clamp(2.4rem,4.5vw,4.6rem)] leading-[0.96]">
                {activeSection.title}
              </h3>
              <p className="mt-5 border-l-2 border-signal pl-4 font-display text-[1.8rem] leading-[1.12] text-foreground">
                {activeSection.doctrine}
              </p>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <InfoBlock
                  title="Why this matters"
                  copy={activeSection.problem}
                  icon={<Target className="h-4 w-4" />}
                />
                <InfoBlock
                  title="Do this next"
                  copy={activeSection.move}
                  icon={<ClipboardList className="h-4 w-4" />}
                />
              </div>
            </div>

            <div className="space-y-3">
              <VisualImage src={activeSection.image} alt={`${activeSection.title} visual`} />
              <div className="rounded-lg border border-border bg-background p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                  Tool path
                </p>
                <p className="mt-2 font-display text-3xl leading-none">{activeSection.tool}</p>
                <p className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">
                  {activeSection.chapter.module}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                Proof it is working
              </p>
              <ul className="mt-3 space-y-3 text-[14px] leading-[1.6] text-muted-foreground">
                {activeSection.chapter.proof.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                Worksheet
              </p>
              <p className="mt-2 text-[14px] leading-[1.55] text-foreground/80">
                {activeSection.chapter.worksheet}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <DestinationLink
                  section={activeSection}
                  className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-cream hover:opacity-90"
                >
                  Open tool
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </DestinationLink>
                <AskMarshallChapterButton section={activeSection} />
              </div>
            </div>
          </div>

          <section className="mt-5 rounded-lg border border-border bg-background p-4">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
              <BookOpen className="h-4 w-4" />
              Deeper chapter notes
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <ChapterList title="What this teaches" items={activeSection.chapter.teaches} />
              <ChapterList title="Install this now" items={activeSection.chapter.install} />
              <div className="rounded-md border border-border bg-card p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                  Source trail
                </p>
                <p className="mt-3 text-[13px] leading-[1.55] text-muted-foreground">
                  {activeSection.chapter.sourceTrail}
                </p>
                <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                  Deeper dive
                </p>
                <ul className="mt-3 space-y-3 text-[13px] leading-[1.55] text-muted-foreground">
                  {activeSection.deepDive.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-[var(--paper-deep)]/45 p-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                Next chapter
              </p>
              <p className="mt-1 text-[14px] text-foreground/80">{nextSection.title}</p>
            </div>
            <button
              type="button"
              onClick={() => onSelect(nextSection.id)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground/78 hover:bg-muted"
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

function DoctrineBank() {
  return (
    <section
      data-reveal
      className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:p-6"
      id="doctrine"
    >
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
          Doctrine bank
        </p>
        <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.5rem)] leading-none">
          The four ideas you must remember.
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {doctrineCards.map((card, index) => (
          <article
            key={card.title}
            data-reveal
            data-reveal-delay={String(index + 1)}
            className="hover-lift flex h-full flex-col rounded-lg border border-border bg-background p-4"
          >
            <div className="min-h-[136px]">
              <h3 className="font-display text-[1.85rem] leading-none">{card.title}</h3>
              <p className="mt-3 text-[13px] leading-[1.65] text-muted-foreground">
                {card.copy}
              </p>
            </div>
            <div className="mt-4">
              <VisualImage
                src={card.image}
                alt={card.title}
                compact
                imageClassName={card.imageClassName}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ToolLaunchpad() {
  return (
    <section
      id="tools"
      data-reveal
      className="scroll-mt-24 rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            Operator's Workbench
          </p>
          <h2 className="mt-2 font-display text-[clamp(2.2rem,4vw,4rem)] leading-none">
            Use the tool that matches the constraint.
          </h2>
        </div>
        <Link
          to="/tools"
          search={{ t: "cos-navigator" } as never}
          className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-cream hover:opacity-90"
        >
          Open Workbench
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {toolLaunchpad.map((tool, index) => (
          <Link
            key={tool.id}
            to="/tools"
            search={{ t: tool.id } as never}
            data-reveal
            data-reveal-delay={String(Math.min(index + 1, 6))}
            className={`hover-lift group rounded-lg border p-4 transition hover:border-foreground/30 ${
              index === 0
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p
                className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
                  index === 0 ? "text-background/65" : "text-signal"
                }`}
              >
                {String(index + 1).padStart(2, "0")}
              </p>
              <ArrowUpRight
                className={`h-4 w-4 shrink-0 transition ${
                  index === 0
                    ? "text-background/65"
                    : "text-foreground/35 group-hover:text-signal"
                }`}
              />
            </div>
            <h3 className="mt-3 font-display text-3xl leading-none">{tool.title}</h3>
            <p
              className={`mt-3 text-[13px] leading-[1.6] ${
                index === 0 ? "text-background/72" : "text-muted-foreground"
              }`}
            >
              {tool.copy}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function InstallationPlan() {
  return (
    <section
      id="installation"
      data-reveal
      className="scroll-mt-24 rounded-lg border border-border bg-card p-5 sm:p-6"
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
        {installPlan.map((phase, index) => (
          <article
            key={phase.week}
            data-reveal
            data-reveal-delay={String(index + 1)}
            className="hover-lift rounded-lg border border-border bg-background p-4"
          >
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

function DestinationLink({
  section,
  className,
  children,
}: {
  section: PlaybookSectionData;
  className: string;
  children: ReactNode;
}) {
  if ("workbenchToolId" in section && section.workbenchToolId) {
    return (
      <Link to="/tools" search={{ t: section.workbenchToolId } as never} className={className}>
        {children}
      </Link>
    );
  }
  if ("route" in section && section.route) {
    return (
      <Link to={section.route as "/aos"} className={className}>
        {children}
      </Link>
    );
  }
  if ("external" in section && section.external) {
    return (
      <a href={section.external} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return null;
}

function AskMarshallChapterButton({ section }: { section: PlaybookSectionData }) {
  const navigate = useNavigate();
  const createThreadFn = useServerFn(createThread);
  const [busy, setBusy] = useState(false);

  async function askMarshall() {
    if (busy) return;
    setBusy(true);
    try {
      const { id } = await createThreadFn({
        data: { title: section.title, source: "operating_playbook" },
      });
      const firstMessage = `I'm working through the Contractor Operating System field manual chapter "${section.title}". The doctrine is: "${section.doctrine}". Help me apply this to my company. Start by asking me for the few facts you need, then give me the read and the next move.`;
      window.history.replaceState({ ...(window.history.state ?? {}), firstMessage }, "");
      navigate({ to: "/ask/$threadId", params: { threadId: id } });
    } catch (error) {
      console.error(error);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={askMarshall}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/78 hover:bg-muted disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
      Ask Marshall
    </button>
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

function InfoBlock({ title, copy, icon }: { title: string; copy: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2 text-signal">
        {icon}
        <h4 className="font-mono text-[10px] uppercase tracking-[0.2em]">{title}</h4>
      </div>
      <p className="mt-3 text-[14px] leading-[1.65] text-muted-foreground">{copy}</p>
    </div>
  );
}

function VisualImage({
  src,
  alt,
  compact = false,
  dark = false,
  imageClassName = "",
}: {
  src: string;
  alt: string;
  compact?: boolean;
  dark?: boolean;
  imageClassName?: string;
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
          loading={compact ? "lazy" : "eager"}
          className={`w-full object-cover transition duration-300 group-hover:scale-[1.015] ${
            compact ? "aspect-[16/9]" : "aspect-[16/9]"
          } ${imageClassName}`}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[min(1200px,94vw)] max-w-none overflow-auto p-3">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">
            Enlarged operating system visual. Close the dialog to return to the page.
          </DialogDescription>
          <div className="sticky top-0 z-10 flex justify-end bg-background/90 pb-2 backdrop-blur">
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-md border border-border bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/75 hover:bg-muted"
              >
                Close visual
              </button>
            </DialogClose>
          </div>
          <img src={src} alt={alt} className="h-auto w-full rounded-md" />
        </DialogContent>
      </Dialog>
    </>
  );
}
