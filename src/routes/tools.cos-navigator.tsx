import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Download,
  Loader2,
  Mail,
  MessageCircle,
  Printer,
  RotateCcw,
  Save,
} from "lucide-react";
import { vault } from "@/lib/vault";
import { PacketCard } from "@/components/portal/packet-card";
import {
  StateOfControlPrintReport,
  type StateOfControlReportData,
} from "@/components/portal/state-of-control-report";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendTransactionalEmail } from "@/lib/email/send";
import { supabase } from "@/integrations/supabase/client";
import { createControlPlan } from "@/lib/control-plan";
import { markControlProgress } from "@/lib/control-progress";

export const Route = createFileRoute("/tools/cos-navigator")({
  head: () => ({
    meta: [{ title: "State of Control - ALP Contractor Circle" }],
  }),
  component: () => <CosNavigatorTool />,
});

type CategoryId = "aos" | "economics" | "ior" | "field" | "delivery" | "execution";
type Scores = Record<CategoryId, number[]>;
type CapacityLabel =
  "Cash capacity" | "PM capacity" | "Admin billing capacity" | "Bonding capacity";

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
    id: "field",
    title: "Field Control",
    narrative: "Install daily production and cost truth where the work happens.",
    doctrine: "Field Truth Starts Daily",
    playbookSection: "Daily Logs + Daily Project WIP",
    worksheet: "Daily Project WIP Implementation",
    module: "Field Control Installation",
    application: "OverWatch Daily Logs + Daily Project WIP",
    why: "The monthly WIP report is too late to change the work. Daily installed quantities, earned value, and actual cost reveal the trend while the team can still act.",
    questions: [
      "Daily logs are completed accurately on the same day the work occurs.",
      "Installed quantities are tied to the correct SOV activity or work item.",
      "Daily labor, material, equipment, and subcontractor costs are captured against that work.",
      "The team can compare daily earned value against daily actual cost and explain the variance.",
      "Field production trends update project schedule, billing, and IOR decisions before month-end.",
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
    copy: "Accountability, economics, project truth, field production, and delivery are visible.",
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
  field: {
    title: "Daily Field Truth Constraint",
    symptoms: [
      "Daily logs describe activity but do not quantify installed work.",
      "Production quantities, earned value, and actual cost are reconciled after the fact.",
      "Schedule, billing, and IOR forecasts move without a daily field signal.",
    ],
    financialImpact:
      "The company discovers production loss, billing drift, and subcontractor underperformance after the opportunity for low-cost correction has passed.",
    actions: [
      "Choose one active project and define the SOV activities that require daily production tracking.",
      "Require same-day logs with installed quantities and actual labor, material, equipment, and subcontractor cost.",
      "Compare daily earned value against actual cost and name the variance before the next shift.",
      "Roll the trend into the weekly IOR, schedule, billing, and subcontractor review.",
    ],
    worksheet: "Daily Project WIP Implementation",
    module: "Field Control Installation",
    application: "OverWatch Daily Logs + Daily Project WIP",
    playbookSection: "Daily Logs + Daily Project WIP",
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
  const stack: Array<{ label: CapacityLabel; value: number }> = (
    [
      { label: "PM capacity", value: pmCapacity },
      { label: "Admin billing capacity", value: inputs.adminCap },
      { label: "Bonding capacity", value: inputs.bondingCap },
      { label: "Cash capacity", value: inputs.cashCap },
    ] satisfies Array<{ label: CapacityLabel; value: number }>
  ).sort((left, right) => left.value - right.value);
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
  if (category.id === "field") {
    return `${scoreGap}/20 daily-control gap. Production, cost, billing, and schedule drift may be reaching management too late.`;
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

function buildReportData(model: CosModel, capacity: CapacityInputs): StateOfControlReportData {
  return {
    generatedAt: new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date()),
    total: model.total,
    maturityTitle: model.maturity.title,
    maturityCopy: model.maturity.copy,
    primaryCategory: model.primary.category.title,
    primaryConstraint: model.resolution.title,
    primaryImpact: model.primary.impact,
    capacityGap: fmtMoney(model.snapshot.gapToShow),
    annualCapacity: fmtMoney(model.snapshot.limiting.value),
    revenueGoal: fmtMoney(capacity.revenueGoal),
    limitingCapacity: model.snapshot.limiting.label,
    categories: model.categoryRows.map((row) => ({
      title: row.category.title,
      score: row.score,
      impact: row.impact,
    })),
    roadmap: model.ranked.slice(0, 3).map((row, index) => {
      const resolution = getResolution(row.category.id, model.snapshot);
      return {
        period: `Month ${index + 1}`,
        title: row.category.title,
        impact: row.impact,
        playbook: resolution.playbookSection,
        worksheet: resolution.worksheet,
      };
    }),
    symptoms: model.resolution.symptoms,
    financialImpact: model.resolution.financialImpact,
    actions: model.resolution.actions,
    routing: [
      { label: "Playbook", value: model.resolution.playbookSection },
      { label: "Worksheet", value: model.resolution.worksheet },
      { label: "Module", value: model.resolution.module },
      { label: "Application", value: model.resolution.application },
    ],
  };
}

export function CosNavigatorTool({ embedded = false }: { embedded?: boolean } = {}) {
  const [scores, setScores] = useState<Scores>(defaultScores);
  const [capacity, setCapacity] = useState<CapacityInputs>(defaultCapacity);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const markedAssessmentStart = useRef(false);

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
    const rawTotal = categoryRows.reduce((sum, row) => sum + row.score, 0);
    const total = Math.round((rawTotal / (categories.length * 20)) * 100);
    const maturity =
      maturityLevels.find((level) => total <= level.max) ??
      maturityLevels[maturityLevels.length - 1];
    const primary = ranked[0];
    const resolution = getResolution(primary.category.id, snapshot);
    return { snapshot, categoryRows, ranked, total, maturity, primary, resolution };
  }, [scores, capacity]);

  const reportData = useMemo(() => buildReportData(model, capacity), [model, capacity]);

  function updateScore(categoryId: CategoryId, index: number, value: number) {
    markAssessmentStarted();
    setScores((prev) => ({
      ...prev,
      [categoryId]: prev[categoryId].map((score, i) => (i === index ? value : score)),
    }));
    setSavedId(null);
    setSaveError(null);
  }

  function updateCapacity<K extends keyof CapacityInputs>(key: K, raw: string) {
    markAssessmentStarted();
    const value = Number(raw.replace(/[,$]/g, ""));
    setCapacity((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
    setSavedId(null);
    setSaveError(null);
  }

  function reset() {
    setScores(defaultScores);
    setCapacity(defaultCapacity);
    setSavedId(null);
    setSaveError(null);
  }

  function markAssessmentStarted() {
    if (markedAssessmentStart.current) return;
    markedAssessmentStart.current = true;
    void markControlProgress({ assessment_started_at: new Date().toISOString() });
  }

  async function savePacket() {
    if (saving || savedId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const controlPlan = createControlPlan(
        model.ranked.slice(0, 3).map((row, index) => {
          const resolution = getResolution(row.category.id, model.snapshot);
          return {
            period: `Month ${index + 1}`,
            title: row.category.title,
            impact: row.impact,
            playbook: resolution.playbookSection,
            worksheet: resolution.worksheet,
            actions: resolution.actions,
          };
        }),
      );
      const p = await vault.saveAndPersist({
        kind: "command",
        source: "COS Navigator",
        title: `State of Control: ${model.resolution.title}`,
        primaryFinding: `${model.total}/100 State of Control score. Primary constraint: ${model.primary.category.title}. ${model.primary.impact}`,
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
          maturity: model.maturity.title,
          primaryCategory: model.primary.category.title,
          primaryConstraint: model.resolution.title,
          revenueGoal: capacity.revenueGoal,
          capacityGap: model.snapshot.gapToShow,
          pmCount: capacity.pmCount,
          projectsPerPm: capacity.projectsPerPm,
          avgMonthlyBilling: capacity.avgMonthlyBilling,
          downtime: capacity.downtime,
          adminCap: capacity.adminCap,
          bondingCap: capacity.bondingCap,
          cashCap: capacity.cashCap,
          limitingCapacity: model.snapshot.limiting.label,
          ...Object.fromEntries(
            model.categoryRows.map((row) => [`${row.category.id}Score`, row.score]),
          ),
        },
        controlPlan,
      });
      if (!p) {
        setSaveError(
          "Could not save this Navigator result to Vault. Make sure you are signed in and try again.",
        );
        return;
      }
      setSavedId(p.id);
      const savedAt = new Date().toISOString();
      void markControlProgress({
        baseline_saved_at: savedAt,
        latest_baseline_id: p.id,
        latest_score: model.total,
        primary_category: model.primary.category.title,
        primary_constraint: model.resolution.title,
      });
    } catch (error) {
      console.error(error);
      setSaveError(
        "Could not save this Navigator result to Vault. Make sure you are signed in and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className={
          embedded
            ? "soc-screen mx-auto w-full max-w-[1440px] px-6 py-8"
            : "soc-screen mx-auto w-full max-w-[1440px] px-6 py-8 sm:py-10"
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
              Professional Contractor Control
            </p>
            <h1 className="mt-2 font-display text-4xl leading-none sm:text-5xl">
              State of Control
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-[1.6] text-muted-foreground">
              Establish the current operating baseline, expose the active constraint, and turn the
              result into a 90-day route across AOS and OverWatch.
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
              <Download className="h-3.5 w-3.5" /> Save PDF
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] hover:bg-muted"
            >
              <Mail className="h-3.5 w-3.5" /> Email report
            </button>
            <button
              type="button"
              onClick={savePacket}
              disabled={saving || !!savedId}
              className="inline-flex items-center gap-1.5 rounded-md bg-signal px-4 py-2 text-[12.5px] font-semibold text-ink hover:opacity-90 disabled:opacity-70"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
                </>
              ) : savedId ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Saved
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" /> Save baseline
                </>
              )}
            </button>
          </div>
        </div>

        <ExperienceSteps />

        {saveError ? (
          <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
            {saveError}
          </p>
        ) : null}
        {savedId ? <NavigatorSavedPanel packetId={savedId} /> : null}

        <div className="mt-8 space-y-8">
          <ScoreSummary model={model} />
          <Assessment model={model} scores={scores} onChange={updateScore} />
          <CapacityCalculator
            capacity={capacity}
            snapshot={model.snapshot}
            onChange={updateCapacity}
          />
          <Interpretation model={model} />
          <Roadmap model={model} />
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <ResolutionCard resolution={model.resolution} />
            <NextActions actions={model.resolution.actions} />
          </div>
          <ActionCenter
            model={model}
            saving={saving}
            saved={!!savedId}
            onSave={savePacket}
            onPrint={() => window.print()}
            onEmail={() => setShareOpen(true)}
          />
          {savedId ? <PacketCard packet={vault.get(savedId)!} /> : null}
        </div>
      </div>

      <StateOfControlPrintReport data={reportData} />
      <StateOfControlShareDialog open={shareOpen} onOpenChange={setShareOpen} report={reportData} />
    </>
  );
}

function NavigatorSavedPanel({ packetId }: { packetId: string }) {
  return (
    <section className="mt-4 rounded-2xl border border-signal/35 bg-signal/10 p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            Saved to Vault
          </p>
          <h2 className="mt-2 font-display text-3xl leading-none">
            Ask Marshall can now use this diagnosis.
          </h2>
          <p className="mt-2 text-[13px] leading-[1.6] text-foreground/72">
            This State of Control result is now an operating packet in the Vault. When the member
            asks from this diagnosis, the saved constraint, financial signal, and recommended action
            start the conversation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/control-plan/$packetId"
            params={{ packetId }}
            className="inline-flex items-center gap-1.5 rounded-md bg-signal px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink hover:opacity-90"
          >
            Start 90-day plan
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/vault"
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-cream hover:opacity-90"
          >
            Open Vault
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/ask"
            search={{ diagnosis: packetId } as never}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground/78 hover:bg-muted"
          >
            Ask from diagnosis
            <MessageCircle className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function ExperienceSteps() {
  const steps = [
    ["01", "Assess", "Score six control domains"],
    ["02", "Understand", "Identify the active constraint"],
    ["03", "Act", "Build the next 90 days"],
    ["04", "Share", "Save, print, and align the team"],
  ];
  return (
    <nav
      aria-label="State of Control workflow"
      className="mt-5 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4"
    >
      {steps.map(([number, title, copy]) => (
        <div key={number} className="bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] text-signal">{number}</span>
            <strong className="text-[12px] uppercase tracking-[0.08em]">{title}</strong>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{copy}</p>
        </div>
      ))}
    </nav>
  );
}

function ScoreSummary({ model }: { model: CosModel }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)_minmax(280px,0.8fr)]">
        <article className="bg-ink p-6 text-cream">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Control score
          </p>
          <div className="mt-4 flex items-end gap-2">
            <span className="font-display text-6xl leading-none">{model.total}</span>
            <span className="pb-2 font-mono text-xs text-cream/45">/100</span>
          </div>
          <h2 className="mt-3 font-display text-2xl">{model.maturity.title}</h2>
          <p className="mt-2 text-sm text-cream/60">{model.maturity.copy}</p>
        </article>

        <article className="border-t border-border p-6 lg:border-l lg:border-t-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Active constraint
          </p>
          <h2 className="mt-3 font-display text-3xl leading-tight">{model.resolution.title}</h2>
          <p className="mt-3 text-sm leading-[1.6] text-muted-foreground">
            {model.resolution.financialImpact}
          </p>
          <p className="mt-4 border-l-2 border-signal pl-3 text-[12px] font-medium text-foreground/75">
            Start here: {model.resolution.actions[0]}
          </p>
        </article>

        <article className="border-t border-border p-6 lg:border-l lg:border-t-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Financial signal
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <Metric
              label="Capacity gap"
              value={fmtMoney(model.snapshot.gapToShow)}
              highlight
              compact
            />
            <Metric
              label="Annual capacity"
              value={fmtMoney(model.snapshot.limiting.value)}
              compact
            />
            <Metric label="Limiting capacity" value={model.snapshot.limiting.label} compact />
          </div>
        </article>
      </div>
      <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {model.categoryRows.map((row) => (
          <div key={row.category.id} className="bg-background px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium">{row.category.title}</span>
              <span className="font-mono text-[10px] text-signal">{row.score}/20</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-ink" style={{ width: `${row.score * 5}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Assessment({
  model,
  scores,
  onChange,
}: {
  model: CosModel;
  scores: Scores;
  onChange: (categoryId: CategoryId, index: number, value: number) => void;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Assessment
          </p>
          <h2 className="mt-1 font-display text-4xl">Score the operating system.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-[1.6] text-muted-foreground">
            Each domain is a separate layer of control. Score what is true today—not what is
            intended or being discussed.
          </p>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          0 = not in place. 4 = measured, owned, and reviewed on rhythm.
        </p>
      </div>
      <div className="mt-6 space-y-4">
        {model.categoryRows.map((row, categoryIndex) => {
          const category = row.category;
          return (
            <article
              key={category.id}
              className="overflow-hidden rounded-2xl border border-border bg-card"
            >
              <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
                <div className="border-b border-border bg-background p-5 lg:border-b-0 lg:border-r lg:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] text-signal">
                      {String(categoryIndex + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-sm text-signal">{row.score} / 20</span>
                  </div>
                  <h3 className="mt-5 font-display text-3xl">{category.title}</h3>
                  <p className="mt-2 text-[13px] font-medium text-foreground/75">
                    {category.doctrine}
                  </p>
                  <p className="mt-4 text-[12px] leading-[1.6] text-muted-foreground">
                    {category.why}
                  </p>
                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-signal"
                      style={{ width: `${row.score * 5}%` }}
                    />
                  </div>
                  <p className="mt-3 text-[11px] leading-[1.5] text-muted-foreground">
                    {row.impact}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {category.questions.map((question, index) => (
                    <div
                      key={question}
                      className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <p className="text-[13px] leading-[1.45] text-foreground/85">{question}</p>
                      <div className="flex gap-1">
                        {[0, 1, 2, 3, 4].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => onChange(category.id, index, value)}
                            aria-label={`${category.title}: ${question} - score ${value}`}
                            aria-pressed={scores[category.id][index] === value}
                            className={`h-8 w-8 rounded-md text-xs tabular-nums transition-colors ${
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
              </div>
            </article>
          );
        })}
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

function Interpretation({ model }: { model: CosModel }) {
  const uses = [
    {
      number: "01",
      title: "Create an operating baseline",
      copy: "Agree on what is actually installed today so leadership is solving the same problem from the same facts.",
    },
    {
      number: "02",
      title: "Expose the active constraint",
      copy: `Focus first on ${model.resolution.title} instead of spreading effort across every weakness at once.`,
    },
    {
      number: "03",
      title: "Route the work",
      copy: `Move the diagnosis into ${model.resolution.application} using ${model.resolution.worksheet}.`,
    },
    {
      number: "04",
      title: "Manage the change",
      copy: "Assign ownership, review the signal weekly, and remeasure in 90 days to confirm the system is improving.",
    },
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-ink text-cream">
      <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
        <div className="p-6 sm:p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            Interpretation
          </p>
          <h2 className="mt-3 font-display text-4xl leading-[1.05]">
            What this data allows you to do.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-[1.7] text-cream/60">
            The assessment is useful only when it changes management behavior. Use the result to
            establish truth, concentrate effort, and create a repeatable review rhythm.
          </p>
        </div>
        <div className="grid border-t border-cream/10 sm:grid-cols-2 lg:border-l lg:border-t-0">
          {uses.map((item) => (
            <article
              key={item.number}
              className="border-b border-cream/10 p-5 last:border-b-0 sm:border-r sm:odd:border-r sm:even:border-r-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
            >
              <span className="font-mono text-[9px] text-signal">{item.number}</span>
              <h3 className="mt-3 font-display text-xl">{item.title}</h3>
              <p className="mt-2 text-[12px] leading-[1.6] text-cream/55">{item.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Roadmap({ model }: { model: CosModel }) {
  const months = ["Month 1", "Month 2", "Month 3"];
  return (
    <section>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Implementation route
      </p>
      <h2 className="mt-2 font-display text-4xl">Your 90-Day Roadmap</h2>
      <p className="mt-2 max-w-2xl text-sm leading-[1.6] text-muted-foreground">
        <span className="font-medium text-foreground/80">
          Primary constraint: {model.primary.category.title}.
        </span>{" "}
        {model.primary.category.narrative}
      </p>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {model.ranked.slice(0, 3).map((item, index) => {
          const resolution = getResolution(item.category.id, model.snapshot);
          return (
            <article
              key={item.category.id}
              className={`overflow-hidden rounded-2xl border border-border ${index === 0 ? "bg-ink text-cream" : "bg-card"}`}
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p
                      className={`font-mono text-[10px] uppercase tracking-[0.22em] ${index === 0 ? "text-signal" : "text-muted-foreground"}`}
                    >
                      {months[index]}
                    </p>
                    <h3 className="mt-3 font-display text-3xl">{item.category.title}</h3>
                  </div>
                  <span
                    className={`font-display text-4xl leading-none ${index === 0 ? "text-cream/20" : "text-foreground/10"}`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <p
                  className={`mt-4 min-h-12 text-[12px] leading-[1.55] ${index === 0 ? "text-cream/60" : "text-muted-foreground"}`}
                >
                  {item.impact}
                </p>
              </div>
              <div
                className={`border-t px-5 py-4 ${index === 0 ? "border-cream/10 bg-cream/[0.04]" : "border-border bg-background"}`}
              >
                <p
                  className={`font-mono text-[8px] uppercase tracking-[0.18em] ${index === 0 ? "text-cream/40" : "text-muted-foreground"}`}
                >
                  Route
                </p>
                <p
                  className={`mt-2 text-[11px] leading-[1.5] ${index === 0 ? "text-cream/75" : "text-foreground/75"}`}
                >
                  {resolution.playbookSection} {"->"} {resolution.worksheet}
                </p>
              </div>
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
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Next 30 days
      </p>
      <h2 className="mt-2 font-display text-3xl">Make the first move visible.</h2>
      <p className="mt-2 text-[12px] leading-[1.6] text-muted-foreground">
        Assign one owner and one due date to every action. Review these weekly until the constraint
        changes.
      </p>
      <ol className="mt-5 space-y-4">
        {actions.map((action, index) => (
          <li
            key={action}
            className="flex gap-3 border-t border-border pt-4 text-sm first:border-t-0 first:pt-0"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-signal/10 font-mono text-[10px] text-signal">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{action}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ActionCenter({
  model,
  saving,
  saved,
  onSave,
  onPrint,
  onEmail,
}: {
  model: CosModel;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onPrint: () => void;
  onEmail: () => void;
}) {
  return (
    <section className="rounded-2xl border border-signal/35 bg-signal/10 p-6 sm:p-8">
      <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            Put the report to work
          </p>
          <h2 className="mt-2 font-display text-4xl leading-[1.05]">
            Align the team around the same truth.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-[1.65] text-foreground/65">
            Preserve the {model.total}/100 baseline in the Vault, share the management report with
            the people responsible for the work, and return in 90 days to measure whether the
            constraint moved.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:max-w-[360px] lg:justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || saved}
            className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[12px] font-semibold text-cream disabled:opacity-60"
          >
            {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? "Baseline saved" : saving ? "Saving…" : "Save baseline"}
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-[12px] font-semibold hover:bg-muted"
          >
            <Printer className="h-4 w-4" /> Print / save PDF
          </button>
          <button
            type="button"
            onClick={onEmail}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-[12px] font-semibold hover:bg-muted"
          >
            <Mail className="h-4 w-4" /> Email report
          </button>
        </div>
      </div>
    </section>
  );
}

function StateOfControlShareDialog({
  open,
  onOpenChange,
  report,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: StateOfControlReportData;
}) {
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendReport() {
    const to = recipient.trim();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setError("Enter a valid email address.");
      return;
    }
    setSending(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: profile } = user
        ? await supabase.from("profiles").select("full_name,email").eq("id", user.id).maybeSingle()
        : { data: null as { full_name: string | null; email: string } | null };

      await sendTransactionalEmail({
        templateName: "state-of-control-report",
        recipientEmail: to,
        idempotencyKey: `state-of-control-${user?.id ?? "member"}-${Date.now()}`,
        templateData: {
          senderName: profile?.full_name ?? undefined,
          senderEmail: profile?.email ?? user?.email ?? undefined,
          note: note.trim() || undefined,
          ...report,
          roadmap: report.roadmap.map((item) => ({
            period: item.period,
            title: item.title,
            impact: item.impact,
            route: `${item.playbook} -> ${item.worksheet}`,
          })),
        },
      });
      setSent(true);
      setTimeout(() => {
        onOpenChange(false);
        setSent(false);
        setRecipient("");
        setNote("");
      }, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the report.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Email the State of Control report</DialogTitle>
          <DialogDescription>
            Sends a branded management report with the score, constraint, domain results, 90-day
            roadmap, and next actions.
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="flex items-center gap-2 py-8 text-sm">
            <Check className="h-4 w-4 text-signal" /> Report sent.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                Report summary
              </p>
              <div className="mt-2 flex items-end justify-between gap-4">
                <div>
                  <strong className="font-display text-2xl">{report.total}/100</strong>
                  <p className="mt-1 text-xs text-muted-foreground">{report.maturityTitle}</p>
                </div>
                <p className="max-w-[230px] text-right text-xs text-foreground/70">
                  {report.primaryConstraint}
                </p>
              </div>
            </div>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Recipient email
              </span>
              <input
                type="email"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="you@company.com"
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-ink"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Note <span className="opacity-60">· optional</span>
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Why you are sharing this report…"
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-ink"
              />
            </label>
            {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
          </div>
        )}
        {!sent ? (
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border bg-background px-3 py-2 text-[12px] hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={sendReport}
              disabled={sending || !recipient.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-[12px] font-semibold text-cream disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
              {sending ? "Sending…" : "Send report"}
            </button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  label,
  value,
  highlight = false,
  compact = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-border bg-background ${compact ? "p-3" : "p-4"}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`${compact ? "mt-1 text-sm" : "mt-2 text-lg"} font-semibold ${highlight ? "text-signal" : "text-foreground"}`}
      >
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
