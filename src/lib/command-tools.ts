// Canonical registry of all command tools. Single source of truth for the
// Switch Tool dropdown, the dashboard signal tiles, and Today's Move.
//
// `vaultSource` must match the `source` string the tool writes to vault
// packets — that's how the dashboard pairs a tool with its latest finding.

import {
  TrendingUp,
  Activity,
  Calculator,
  FileSignature,
  CalendarClock,
  PiggyBank,
  AlertTriangle,
  ScissorsLineDashed,
  Network,
  ListChecks,
  Gauge,
  UserPlus2,
  Rocket,
  Users,
  CalendarCheck2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type ToolGroup =
  | "Make more money"
  | "Protect margin and cash"
  | "Build the machine"
  | "Deliver better projects";

export type ToolStatus = "live" | "coming-next" | "later";

export type CommandTool = {
  id: string;
  name: string;
  blurb: string;
  group: ToolGroup;
  status: ToolStatus;
  icon: LucideIcon;
  /** Route if live, else null. */
  route?: string;
  /** The exact `source` string written to vault_packets by this tool. */
  vaultSource?: string;
};

export const COMMAND_TOOLS: CommandTool[] = [
  // Make more money
  {
    id: "growth-constraint",
    name: "Growth Constraint Map",
    blurb: "Find what is actually constraining revenue growth.",
    group: "Make more money",
    status: "live",
    icon: TrendingUp,
    route: "/tools/growth-constraint",
    vaultSource: "Growth Constraint Map",
  },
  {
    id: "pipeline-leak",
    name: "Pipeline Leak Finder",
    blurb: "Find where leads die before they become contracts.",
    group: "Make more money",
    status: "coming-next",
    icon: Activity,
  },
  {
    id: "estimate-throughput",
    name: "Estimate Throughput Tracker",
    blurb: "See whether estimates are keeping up with the revenue target.",
    group: "Make more money",
    status: "live",
    icon: Calculator,
    vaultSource: "Estimate Throughput Tracker",
  },
  {
    id: "proposal-scorecard",
    name: "Proposal Scorecard",
    blurb: "Pressure-test whether proposals help close better work.",
    group: "Make more money",
    status: "coming-next",
    icon: FileSignature,
  },

  // Protect margin and cash
  {
    id: "billing-event-planner",
    name: "Billing Event Planner",
    blurb: "Plan and protect the billing events that create cash.",
    group: "Protect margin and cash",
    status: "coming-next",
    icon: CalendarClock,
  },
  {
    id: "cash-control",
    name: "Cash Control Snapshot",
    blurb: "See where cash is leaking before the P&L tells you.",
    group: "Protect margin and cash",
    status: "coming-next",
    icon: PiggyBank,
  },
  {
    id: "change-order",
    name: "Change Order Money Finder",
    blurb: "Find money trapped in undocumented or unbilled changes.",
    group: "Protect margin and cash",
    status: "coming-next",
    icon: AlertTriangle,
  },
  {
    id: "margin-leak",
    name: "Margin Leak Finder",
    blurb: "Find where gross margin disappears between estimate and closeout.",
    group: "Protect margin and cash",
    status: "coming-next",
    icon: ScissorsLineDashed,
  },

  // Build the machine
  {
    id: "owner-dependency",
    name: "Owner Dependency Scorecard",
    blurb: "Find where the business still depends on the owner.",
    group: "Build the machine",
    status: "live",
    icon: Network,
    route: "/tools/owner-dependency",
    vaultSource: "Owner Dependency Scorecard",
  },
  {
    id: "sop-priority",
    name: "SOP Priority Builder",
    blurb: "Find which system to build first.",
    group: "Build the machine",
    status: "coming-next",
    icon: ListChecks,
  },
  {
    id: "scorecard-builder",
    name: "Scorecard Builder",
    blurb: "Choose the weekly numbers that make the business visible.",
    group: "Build the machine",
    status: "coming-next",
    icon: Gauge,
  },
  {
    id: "next-seat",
    name: "Next Seat Finder",
    blurb: "Find the next role that would reduce owner drag.",
    group: "Build the machine",
    status: "coming-next",
    icon: UserPlus2,
  },

  // Deliver better projects
  {
    id: "project-launch",
    name: "Project Launch Readiness",
    blurb: "Stop sold work from becoming production chaos.",
    group: "Deliver better projects",
    status: "coming-next",
    icon: Rocket,
  },
  {
    id: "pm-capacity",
    name: "PM Capacity Planner",
    blurb: "See whether PM and project leadership capacity can carry the work.",
    group: "Deliver better projects",
    status: "coming-next",
    icon: Users,
  },
  {
    id: "client-decision",
    name: "Client Decision Tracker",
    blurb: "Find the owner/client decisions blocking production and billing.",
    group: "Deliver better projects",
    status: "coming-next",
    icon: CalendarCheck2,
  },
  {
    id: "contract-readiness",
    name: "Contract Readiness Scan",
    blurb: "Check whether the contract protects cash, schedule, scope, and margin.",
    group: "Deliver better projects",
    status: "coming-next",
    icon: ShieldCheck,
  },
];

export const TOOL_GROUPS: ToolGroup[] = [
  "Make more money",
  "Protect margin and cash",
  "Build the machine",
  "Deliver better projects",
];

export function toolsByGroup(group: ToolGroup) {
  return COMMAND_TOOLS.filter((t) => t.group === group);
}

export function findToolBySource(source: string | undefined) {
  if (!source) return undefined;
  return COMMAND_TOOLS.find((t) => t.vaultSource === source);
}
