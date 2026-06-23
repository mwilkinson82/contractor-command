import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, ClipboardList, Target } from "lucide-react";

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
    tool: "Owner Dependency Scorecard",
    route: "/tools/owner-dependency",
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
    tool: "COS Navigator",
    route: "/tools/cos-navigator",
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
    tool: "Margin Leak Finder",
    route: "/tools",
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
    tool: "Contract Readiness Scan",
    route: "/tools",
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
              to="/tools/cos-navigator"
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
          <div className="mt-6 flex flex-wrap gap-3">
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
          to="/tools/cos-navigator"
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
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className={`block overflow-hidden rounded-md border ${
        dark ? "border-cream/15 bg-cream/5" : "border-border bg-background"
      }`}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={`w-full object-cover ${compact ? "aspect-[16/9]" : "aspect-[16/9]"}`}
      />
    </a>
  );
}
