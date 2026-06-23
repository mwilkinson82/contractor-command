import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, Printer, RotateCcw, Save } from "lucide-react";
import { vault } from "@/lib/vault";
import { PacketCard } from "@/components/portal/packet-card";

export const Route = createFileRoute("/tools/cos-navigator")({
  head: () => ({
    meta: [{ title: "COS Navigator - ALP Contractor Circle" }],
  }),
  component: () => <CosNavigatorTool />,
});

type CategoryId = "aos" | "economics" | "ior" | "delivery" | "execution";
type Scores = Record<CategoryId, number[]>;
type CapacityLabel =
  | "Cash capacity"
  | "PM capacity"
  | "Admin billing capacity"
  | "Bonding capacity";

type Category = {
  id: CategoryId;
  title: string;
  narrative: string;
  doctrine: string;
  playbookSection: string;
  worksheet: string;
  module: string;
  application: string;
  why: string;
  questions: string[];
};

type CapacityInputs = {
  revenueGoal: number;
  pmCount: number;
  projectsPerPm: number;
  avgMonthlyBilling: number;
  downtime: number;
  adminCap: number;
  bondingCap: number;
  cashCap: number;
};

type ResolutionPlan = {
  title: string;
  symptoms: string[];
  financialImpact: string;
  actions: string[];
  worksheet: string;
  module: string;
  application: string;
  playbookSection: string;
  key: string;
};

type CategoryRow = {
  category: Category;
  score: number;
  impact: string;
  priority: number;
};

type CosModel = {
  snapshot: ReturnType<typeof capacitySnapshot>;
  categoryRows: CategoryRow[];
  ranked: CategoryRow[];
  total: number;
  maturity: (typeof maturityLevels)[number];
  primary: CategoryRow;
  resolution: ResolutionPlan;
};

const categories: Category[] = [
  {
    id: "aos",
    title: "AOS",
    narrative: "Start by making ownership visible.",
    doctrine: "The Project Is Not The Business",
    playbookSection: "Owner Bottleneck + AOS",
    worksheet: "Owner Bottleneck Worksheet",
    module: "AOS Installation",
    application: "AOS Dashboard",
    why: "The company cannot scale cleanly while ownership still lives in memory, proximity, or personality.",
    questions: [
      "The company has a written vision that the team actually uses.",
      "Major company functions have clear owners.",
      "The accountability chart shows ownership, not just hierarchy.",
      "The team has a weekly scorecard with owners and goals.",
      "The company runs a weekly meeting rhythm that solves issues.",
    ],
  },
  {
    id: "economics",
    title: "Economics",
    narrative: "Find the constraint limiting capacity and cash conversion.",
    doctrine: "The Gap Is Capacity",
    playbookSection: "Economics Engine",
    worksheet: "Economics Snapshot + Capacity Constraint Worksheet",
    module: "Economics Engine Workshop",
    application: "Economics Calculator Suite",
    why: "Revenue growth without capacity growth does not fix the company. It amplifies the constraint already inside the operating model.",
    questions: [
      "The company knows its annual billing capacity.",
      "The company tracks active and target concurrent billing events.",
      "The company knows how long work takes to become collected cash.",
      "The company tracks AR, unapproved change orders, and cash constraints weekly.",
      "The company can identify its current primary capacity constraint.",
    ],
  },
  {
    id: "ior",
    title: "IOR",
    narrative: "Install project financial truth on one active job.",
    doctrine: "The Budget Is Not Truth",
    playbookSection: "IOR",
    worksheet: "IOR Snapshot + Top-Five Risk Register",
    module: "IOR Implementation Sprint",
    application: "IOR Application",
    why: "Projects do not lose money all at once. They leak margin through risks that were visible before they were financial facts.",
    questions: [
      "Active projects have forecasted final contract and forecasted final cost.",
      "Known project risks are converted into E-holds.",
      "General project uncertainty is converted into C-holds.",
      "Project managers can explain indicated gross profit weekly.",
      "Leadership can see company-wide project risk exposure.",
    ],
  },
  {
    id: "delivery",
    title: "Delivery",
    narrative: "Standardize the workflows that protect margin.",
    doctrine: "Risk Is The Job",
    playbookSection: "Delivery Systems",
    worksheet: "Change Order Velocity Tracker + EOT Checklist",
    module: "Delivery Systems Sprint",
    application: "Delivery Applications",
    why: "If change orders, selections, delays, and acceleration are unmanaged, margin protection remains theoretical.",
    questions: [
      "Selections are centralized, visual, dated, approved, and field-accessible.",
      "Change order velocity is tracked from issue to collection.",
      "Delay notices and extension-of-time claims follow a documented process.",
      "Acceleration is priced as a service, not given away as a favor.",
      "Burn rate, overhead, and cash carry are tied to project delays.",
    ],
  },
  {
    id: "execution",
    title: "Execution",
    narrative: "Turn red numbers into owned action.",
    doctrine: "Red Numbers Become Owned Action",
    playbookSection: "Weekly Rhythm",
    worksheet: "PM Risk Review + L10 Integration",
    module: "Weekly Rhythm Installation",
    application: "AOS Meeting + PM Review Views",
    why: "The operating rhythm has to turn reality into issues, issues into decisions, and decisions into completed to-dos.",
    questions: [
      "PM meetings focus on risk, money, ownership, and action.",
      "Red scorecard items become issues, not excuses.",
      "Issues become owned, time-bound to-dos.",
      "Recurring project failures become process improvements.",
      "The team reviews whether risks are growing, shrinking, or resolved.",
    ],
  },
];

const defaultScores: Scores = categories.reduce((acc, category) => {
  acc[category.id] = Array(category.questions.length).fill(0);
  return acc;
}, {} as Scores);

const defaultCapacity: CapacityInputs = {
  revenueGoal: 20_000_000,
  pmCount: 3,
  projectsPerPm: 3,
  avgMonthlyBilling: 125_000,
  downtime: 8,
  adminCap: 12_000_000,
  bondingCap: 15_000_000,
  cashCap: 8_700_000,
};

const maturityLevels = [
  { max: 25, title: "Owner-Dependent", copy: "The company still runs through the owner." },
  { max: 50, title: "Reactive Operator", copy: "Pieces exist, but the system is inconsistent." },
  { max: 75, title: "Managed Company", copy: "Real operating structure is forming." },
  {
    max: 90,
    title: "Scalable Company",
    copy: "The company is becoming repeatable and less owner-dependent.",
  },
  {
    max: 100,
    title: "Category-Grade Operator",
    copy: "Accountability, economics, project truth, and delivery are visible.",
  },
];

const baseResolution: Record<CategoryId, Omit<ResolutionPlan, "key">> = {
  aos: {
    title: "Owner Bottleneck Constraint",
    symptoms: [
      "Decisions wait for the owner.",
      "Accountability is implied instead of visible.",
      "Meetings discuss work but do not create owned action.",
    ],
    financialImpact:
      "Growth depends on owner bandwidth, so the company cannot add complexity without adding drag.",
    actions: [
      "Complete the Owner Bottleneck Worksheet.",
      "Draft the current accountability chart.",
      "Choose the first five weekly scorecard numbers.",
      "Run one L10 with a real issue board.",
    ],
    worksheet: "Owner Bottleneck Worksheet",
    module: "AOS Installation",
    application: "AOS Dashboard",
    playbookSection: "Owner Bottleneck + AOS",
  },
  economics: {
    title: "Economics Constraint",
    symptoms: [
      "Revenue goals are set without proving capacity.",
      "Cash, PM bandwidth, bonding, and admin capacity are discussed separately.",
      "The company does not know which ceiling is limiting growth.",
    ],
    financialImpact:
      "Growth pressure can exceed the company's ability to carry, bill, finance, or administer the work.",
    actions: [
      "Complete the Economics Snapshot.",
      "Calculate Annual Billing Capacity.",
      "Identify the primary capacity constraint.",
      "Add one capacity metric to the weekly scorecard.",
    ],
    worksheet: "Economics Snapshot + Capacity Constraint Worksheet",
    module: "Economics Engine Workshop",
    application: "Economics Calculator Suite",
    playbookSection: "Economics Engine",
  },
  ior: {
    title: "Project Financial Truth Constraint",
    symptoms: [
      "Project profit is confirmed after the damage has already happened.",
      "Known risks are discussed but not held financially.",
      "PMs cannot clearly explain indicated gross profit each week.",
    ],
    financialImpact:
      "Margin exposure stays hidden until accounting catches up, which makes recovery slower and less likely.",
    actions: [
      "Build an IOR for one live project.",
      "Separate known exposure from general uncertainty.",
      "Name the top five risks by probability and impact.",
      "Review indicated gross profit weekly with the PM.",
    ],
    worksheet: "IOR Snapshot + Top-Five Risk Register",
    module: "IOR Implementation Sprint",
    application: "IOR Application",
    playbookSection: "IOR",
  },
  delivery: {
    title: "Delivery Systems Constraint",
    symptoms: [
      "Selections, change orders, delays, and acceleration are handled differently by project.",
      "The team knows work changed before money is approved.",
      "Burn rate and cash carry are not visible during delays.",
    ],
    financialImpact:
      "Margin leaks through unmanaged workflows even when the original estimate looked profitable.",
    actions: [
      "Pick one delivery system to install first.",
      "Track change order velocity from issue to collection.",
      "Add delay and EOT notice discipline to the weekly review.",
      "Convert recurring delivery failures into process improvements.",
    ],
    worksheet: "Change Order Velocity Tracker + EOT Checklist",
    module: "Delivery Systems Sprint",
    application: "Delivery Applications",
    playbookSection: "Delivery Systems",
  },
  execution: {
    title: "Execution Rhythm Constraint",
    symptoms: [
      "Red numbers are observed but not converted into decisions.",
      "Issues repeat because no one owns the next move.",
      "The weekly rhythm does not connect company scorecards to project risk.",
    ],
    financialImpact: "The company loses time, margin, and trust through repeated issue recurrence.",
    actions: [
      "Run PM meetings around the top-five risk questions.",
      "Move red scorecard items to the issue board.",
      "Assign one owner and due date to each issue.",
      "Review to-dos until behavior changes.",
    ],
    worksheet: "PM Risk Review + L10 Integration",
    module: "Weekly Rhythm Installation",
    application: "AOS Meeting + PM Review Views",
    playbookSection: "Weekly Rhythm",
  },
};

const economicsSubconstraints: Record<CapacityLabel, Omit<ResolutionPlan, "key">> = {
  "Cash capacity": {
    title: "Cash Capacity Constraint",
    symptoms: [
      "AR aging is stretching beyond operating comfort.",
      "Change orders carry cost before cash returns.",
      "The company can sell more work than it can safely finance.",
    ],
    financialImpact:
      "The company is limited by how much work it can carry before billing and collections return cash.",
    actions: [
      "Complete the Cash Conversion Snapshot.",
      "Reduce AR over 60 before adding backlog.",
      "Accelerate change-order approval and billing velocity.",
      "Add cash conversion days to the weekly scorecard.",
    ],
    worksheet: "Cash Conversion Snapshot + Capacity Constraint Worksheet",
    module: "Economics Engine Workshop",
    application: "Economics Calculator Suite",
    playbookSection: "Economics Engine: Cash Capacity",
  },
  "PM capacity": {
    title: "PM Capacity Constraint",
    symptoms: [
      "PMs are carrying too many concurrent billing events.",
      "Risk review quality drops as volume increases.",
      "The owner becomes the backup PM.",
    ],
    financialImpact:
      "Revenue is limited by how much active work PMs can control without margin, schedule, or client-service decay.",
    actions: [
      "Map active projects per PM.",
      "Reduce concurrent project load before adding backlog.",
      "Define PM capacity by billing volume, not headcount.",
      "Add PM capacity utilization to the weekly scorecard.",
    ],
    worksheet: "PM Capacity Map",
    module: "Economics Engine Workshop",
    application: "Economics Calculator Suite",
    playbookSection: "Economics Engine: PM Capacity",
  },
  "Admin billing capacity": {
    title: "Admin Billing Capacity Constraint",
    symptoms: [
      "Work is performed faster than it can be documented and billed.",
      "Billing depends on too few people or too many manual steps.",
      "Payment applications, lien waivers, approvals, and documentation create delay.",
    ],
    financialImpact:
      "The company may have field capacity but still fail to convert completed work into invoices and cash.",
    actions: [
      "Map the billing workflow from work performed to invoice submitted.",
      "Remove documentation bottlenecks before increasing volume.",
      "Set a billing-cycle standard by project type.",
      "Add billing velocity to the weekly scorecard.",
    ],
    worksheet: "Billing Velocity Worksheet",
    module: "Economics Engine Workshop",
    application: "Economics Calculator Suite",
    playbookSection: "Economics Engine: Admin Billing Capacity",
  },
  "Bonding capacity": {
    title: "Bonding Capacity Constraint",
    symptoms: [
      "Revenue goals depend on work the company may not be able to bond.",
      "Backlog targets ignore bonding ceiling and surety requirements.",
      "Capital, reporting, or balance sheet constraints limit project selection.",
    ],
    financialImpact:
      "The company may have demand but cannot safely commit to the target volume without resolving bonding capacity.",
    actions: [
      "Confirm bonding capacity against the revenue target.",
      "Identify which project types consume bonding capacity fastest.",
      "Align backlog targets with bonding and cash ceilings.",
      "Add bonding utilization to the executive scorecard.",
    ],
    worksheet: "Bonding Capacity Snapshot",
    module: "Economics Engine Workshop",
    application: "Economics Calculator Suite",
    playbookSection: "Economics Engine: Bonding Capacity",
  },
};

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

function categoryScore(scores: Scores, id: CategoryId) {
  return scores[id].reduce((sum, value) => sum + value, 0);
}

function capacitySnapshot(inputs: CapacityInputs) {
  const pmCapacity =
    inputs.pmCount *
    inputs.projectsPerPm *
    inputs.avgMonthlyBilling *
    12 *
    (1 - inputs.downtime / 100);
  const stack: Array<{ label: CapacityLabel; value: number }> = [
    { label: "PM capacity", value: pmCapacity },
    { label: "Admin billing capacity", value: inputs.adminCap },
    { label: "Bonding capacity", value: inputs.bondingCap },
    { label: "Cash capacity", value: inputs.cashCap },
  ].sort((left, right) => left.value - right.value);
  const limiting = stack[0];
  const gap = inputs.revenueGoal - limiting.value;
  return {
    revenueGoal: inputs.revenueGoal,
    pmCapacity,
    stack,
    limiting,
    gap,
    gapToShow: Math.max(gap, 0),
  };
}

function getImpact(
  category: Category,
  score: number,
  snapshot: ReturnType<typeof capacitySnapshot>,
) {
  const scoreGap = 20 - score;
  if (category.id === "economics") {
    return snapshot.gap > 0
      ? `${fmtMoney(snapshot.gap)} annual capacity gap. Constraint: ${snapshot.limiting.label}.`
      : "No current capacity gap. Validate margin and cash conversion under the projected load.";
  }
  if (category.id === "ior") {
    return `${scoreGap}/20 visibility gap. Project margin exposure may not be visible soon enough.`;
  }
  if (category.id === "delivery") {
    return `${scoreGap}/20 control gap. Delivery leakage can show up in change orders, delays, and burn rate.`;
  }
  if (category.id === "execution") {
    return `${scoreGap}/20 cadence gap. Recurring issues may not be converting into owned action.`;
  }
  return `${scoreGap}/20 ownership gap. Decisions and accountability may still flow back to the owner.`;
}

function priorityWeight(
  category: Category,
  score: number,
  snapshot: ReturnType<typeof capacitySnapshot>,
) {
  const scoreGap = 20 - score;
  let weight = scoreGap * 5;
  if (category.id === "economics" && snapshot.gapToShow > 0) {
    const gapRatio = snapshot.gapToShow / Math.max(1, snapshot.revenueGoal);
    weight += Math.min(80, Math.round(gapRatio * 100));
  }
  return weight;
}

function getResolution(
  categoryId: CategoryId,
  snapshot: ReturnType<typeof capacitySnapshot>,
): ResolutionPlan {
  if (categoryId === "economics") {
    const sub = economicsSubconstraints[snapshot.limiting.label];
    return {
      ...sub,
      key: `economics-${snapshot.limiting.label.toLowerCase().replaceAll(" ", "-")}`,
    };
  }
  return { ...baseResolution[categoryId], key: categoryId };
}

export function CosNavigatorTool({ embedded = false }: { embedded?: boolean } = {}) {
  const [scores, setScores] = useState<Scores>(defaultScores);
  const [capacity, setCapacity] = useState<CapacityInputs>(defaultCapacity);
  const [savedId, setSavedId] = useState<string | null>(null);

  const model = useMemo(() => {
    const snapshot = capacitySnapshot(capacity);
    const categoryRows = categories.map((category) => {
      const score = categoryScore(scores, category.id);
      return {
        category,
        score,
        impact: getImpact(category, score, snapshot),
        priority: priorityWeight(category, score, snapshot),
      };
    });
    const ranked = [...categoryRows].sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      if (left.score !== right.score) return left.score - right.score;
      return (
        categories.findIndex((c) => c.id === left.category.id) -
        categories.findIndex((c) => c.id === right.category.id)
      );
    });
    const total = categoryRows.reduce((sum, row) => sum + row.score, 0);
    const maturity =
      maturityLevels.find((level) => total <= level.max) ??
      maturityLevels[maturityLevels.length - 1];
    const primary = ranked[0];
    const resolution = getResolution(primary.category.id, snapshot);
    return { snapshot, categoryRows, ranked, total, maturity, primary, resolution };
  }, [scores, capacity]);

  function updateScore(categoryId: CategoryId, index: number, value: number) {
    setScores((prev) => ({
      ...prev,
      [categoryId]: prev[categoryId].map((score, i) => (i === index ? value : score)),
    }));
    setSavedId(null);
  }

  function updateCapacity<K extends keyof CapacityInputs>(key: K, raw: string) {
    const value = Number(raw.replace(/[,$]/g, ""));
    setCapacity((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
    setSavedId(null);
  }

  function reset() {
    setScores(defaultScores);
    setCapacity(defaultCapacity);
    setSavedId(null);
  }

  function savePacket() {
    const p = vault.save({
      kind: "command",
      source: "COS Navigator",
      title: `${model.primary.category.title}: ${model.resolution.title}`,
      primaryFinding: `${model.total}/100 COS score. Primary constraint: ${model.primary.category.title}. ${model.primary.impact}`,
      primaryConstraint: model.resolution.title,
      financialConsequence:
        model.primary.category.id === "economics"
          ? `${fmtMoney(model.snapshot.gapToShow)} capacity gap. Limiting constraint: ${model.snapshot.limiting.label}.`
          : model.resolution.financialImpact,
      missingSystem: model.resolution.playbookSection,
      recommendedAction: model.resolution.actions[0],
      bringOneIssuePrompt: `What would have to change in the next 30 days to remove the ${model.resolution.title}?`,
      intensiveRecommended: model.total < 60 || model.snapshot.gapToShow > 2_000_000,
      inputs: {
        totalScore: model.total,
        revenueGoal: capacity.revenueGoal,
        capacityGap: model.snapshot.gapToShow,
        ...Object.fromEntries(
          model.categoryRows.map((row) => [`${row.category.id}Score`, row.score]),
        ),
      },
    });
    setSavedId(p.id);
  }

  return (
    <div
      className={
        embedded
          ? "mx-auto w-full max-w-[1440px] px-6 py-8"
          : "mx-auto w-full max-w-[1440px] px-6 py-8 sm:py-10"
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-5">
        <div>
          {!embedded && (
            <Link
              to="/tools"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-foreground/70 hover:bg-muted"
            >
              <ArrowLeft className="h-3 w-3" /> All tools
            </Link>
          )}
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Contractor Operating System
          </p>
          <h1 className="mt-2 font-display text-4xl leading-none sm:text-5xl">COS Navigator</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Diagnose the operating constraint, weigh the business impact, and route the member to
            the right doctrine, worksheet, module, and application.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] hover:bg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] hover:bg-muted"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          <button
            type="button"
            onClick={savePacket}
            disabled={!!savedId}
            className="inline-flex items-center gap-1.5 rounded-md bg-signal px-4 py-2 text-[12.5px] font-semibold text-ink hover:opacity-90 disabled:opacity-70"
          >
            {savedId ? (
              <>
                <Check className="h-3.5 w-3.5" /> Saved
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" /> Save to vault
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="space-y-6">
          <ScoreSummary model={model} />
          <Assessment scores={scores} onChange={updateScore} />
          <CapacityCalculator
            capacity={capacity}
            snapshot={model.snapshot}
            onChange={updateCapacity}
          />
        </div>

        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Roadmap model={model} />
          <ResolutionCard resolution={model.resolution} />
          <NextActions actions={model.resolution.actions} />
          {savedId ? <PacketCard packet={vault.get(savedId)!} /> : null}
        </aside>
      </div>
    </div>
  );
}

function ScoreSummary({ model }: { model: CosModel }) {
  return (
    <section className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <article className="rounded-2xl border border-border bg-card p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          COS score
        </p>
        <div className="mt-4 flex items-end gap-2">
          <span className="font-display text-6xl leading-none">{model.total}</span>
          <span className="pb-2 font-mono text-xs text-muted-foreground">/100</span>
        </div>
        <h2 className="mt-3 font-display text-2xl">{model.maturity.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{model.maturity.copy}</p>
      </article>

      <article className="rounded-2xl border border-border bg-card p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Financial signal
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Capacity gap" value={fmtMoney(model.snapshot.gapToShow)} highlight />
          <Metric label="Annual capacity" value={fmtMoney(model.snapshot.limiting.value)} />
          <Metric label="Economic constraint" value={model.snapshot.limiting.label} />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {model.snapshot.gap > 0
            ? `The revenue goal exceeds current annual billing capacity by ${fmtMoney(model.snapshot.gap)}.`
            : `The current model supports the stated revenue goal by ${fmtMoney(Math.abs(model.snapshot.gap))}.`}
        </p>
      </article>
    </section>
  );
}

function Assessment({
  scores,
  onChange,
}: {
  scores: Scores;
  onChange: (categoryId: CategoryId, index: number, value: number) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Assessment
          </p>
          <h2 className="mt-1 font-display text-3xl">Score the operating system.</h2>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          0 = not in place. 4 = measured, owned, and reviewed on rhythm.
        </p>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {categories.map((category) => (
          <article
            key={category.id}
            className="overflow-hidden rounded-xl border border-border bg-background"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-card/70 px-4 py-3">
              <h3 className="font-display text-xl">{category.title}</h3>
              <span className="font-mono text-sm text-signal">
                {categoryScore(scores, category.id)} / 20
              </span>
            </div>
            <div className="divide-y divide-border">
              {category.questions.map((question, index) => (
                <div
                  key={question}
                  className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <p className="text-[13px] leading-snug text-foreground/85">{question}</p>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => onChange(category.id, index, value)}
                        className={`h-7 w-7 rounded-md text-xs tabular-nums ${
                          scores[category.id][index] === value
                            ? "bg-ink text-cream"
                            : "border border-border bg-card text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CapacityCalculator({
  capacity,
  snapshot,
  onChange,
}: {
  capacity: CapacityInputs;
  snapshot: ReturnType<typeof capacitySnapshot>;
  onChange: <K extends keyof CapacityInputs>(key: K, raw: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Economics Engine
          </p>
          <h2 className="mt-1 font-display text-3xl">Find the capacity gap.</h2>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
          The gap is capacity
        </p>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Revenue goal"
            value={capacity.revenueGoal}
            onChange={(v) => onChange("revenueGoal", v)}
            money
          />
          <NumberField
            label="Project managers"
            value={capacity.pmCount}
            onChange={(v) => onChange("pmCount", v)}
          />
          <NumberField
            label="Active projects per PM"
            value={capacity.projectsPerPm}
            onChange={(v) => onChange("projectsPerPm", v)}
          />
          <NumberField
            label="Average monthly billing per project"
            value={capacity.avgMonthlyBilling}
            onChange={(v) => onChange("avgMonthlyBilling", v)}
            money
          />
          <NumberField
            label="Downtime / seasonality %"
            value={capacity.downtime}
            onChange={(v) => onChange("downtime", v)}
          />
          <NumberField
            label="Admin billing capacity"
            value={capacity.adminCap}
            onChange={(v) => onChange("adminCap", v)}
            money
          />
          <NumberField
            label="Bonding capacity"
            value={capacity.bondingCap}
            onChange={(v) => onChange("bondingCap", v)}
            money
          />
          <NumberField
            label="Cash capacity"
            value={capacity.cashCap}
            onChange={(v) => onChange("cashCap", v)}
            money
          />
        </div>
        <div className="rounded-xl bg-ink p-5 text-cream">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
            Capacity stack
          </p>
          <div className="mt-4 space-y-3">
            {snapshot.stack.map((item, index) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-3 border-b border-cream/10 pb-3 last:border-b-0 last:pb-0"
              >
                <div>
                  <p className="text-sm text-cream">{item.label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/45">
                    {index === 0 ? "Primary constraint" : index === 1 ? "Secondary" : "Monitor"}
                  </p>
                </div>
                <strong className={index === 0 ? "text-signal" : "text-cream/80"}>
                  {fmtMoney(item.value)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Roadmap({ model }: { model: CosModel }) {
  const months = ["Month 1", "Month 2", "Month 3"];
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Operating roadmap
      </p>
      <h2 className="mt-2 font-display text-3xl">{model.primary.category.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{model.primary.category.narrative}</p>
      <div className="mt-5 grid gap-3">
        {model.ranked.slice(0, 3).map((item, index) => {
          const resolution = getResolution(item.category.id, model.snapshot);
          return (
            <article
              key={item.category.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    {months[index]}
                  </p>
                  <h3 className="mt-1 font-display text-xl">{item.category.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{item.impact}</p>
                </div>
                <span className="font-mono text-xs text-signal">{item.priority}</span>
              </div>
              <p className="mt-3 text-[12px] text-foreground/80">
                {resolution.playbookSection} {"->"} {resolution.worksheet}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ResolutionCard({ resolution }: { resolution: ResolutionPlan }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Constraint resolution plan
      </p>
      <h2 className="mt-2 font-display text-3xl">{resolution.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{resolution.financialImpact}</p>
      <div className="mt-5 grid gap-3">
        <InfoBlock title="Symptoms" items={resolution.symptoms} />
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Routing
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <RouteRow label="Playbook" value={resolution.playbookSection} />
            <RouteRow label="Worksheet" value={resolution.worksheet} />
            <RouteRow label="Module" value={resolution.module} />
            <RouteRow label="Application" value={resolution.application} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function NextActions({ actions }: { actions: string[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Next 30 days
      </p>
      <ol className="mt-4 space-y-3">
        {actions.map((action, index) => (
          <li key={action} className="flex gap-3 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-signal/10 font-mono text-[10px] text-signal">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{action}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-lg font-semibold ${highlight ? "text-signal" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  money = false,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
  money?: boolean;
}) {
  return (
    <label className="block rounded-xl border border-border bg-background p-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full bg-transparent text-sm outline-none focus:text-signal"
      />
      {money ? (
        <span className="mt-1 block text-[11px] text-muted-foreground">{fmtMoney(value)}</span>
      ) : null}
    </label>
  );
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {title}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-foreground/85">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-signal" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RouteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
