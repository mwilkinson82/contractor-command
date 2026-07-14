// Canonical registry of all command tools. Single source of truth for the
// Switch Tool dropdown, the dashboard signal tiles, and Today's Move.
//
// Roster is intentionally tight. AOS already covers scorecards and seat
// planning, so those don't appear here. Everything else cut as filler.
// See mem://features/command-tools-roster for rationale.

import {
  TrendingUp,
  Activity,
  Calculator,
  Compass,
  ScissorsLineDashed,
  Network,
  ListChecks,
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
  {
    id: "cos-navigator",
    name: "State of Control",
    blurb: "Assess company, project, and field control, then build the next 90-day roadmap.",
    group: "Build the machine",
    status: "live",
    icon: Compass,
    route: "/tools/cos-navigator",
    vaultSource: "COS Navigator",
  },
  {
    id: "sop-priority",
    name: "SOP Priority Builder",
    blurb: "Rank what to systemize first, or generate a department SOP backlog.",
    group: "Build the machine",
    status: "live",
    icon: ListChecks,
    vaultSource: "SOP Priority Builder",
  },
  {
    id: "contract-readiness",
    name: "Contract Readiness Scan",
    blurb: "Pressure-test a contract for cash, schedule, scope, and margin gaps.",
    group: "Deliver better projects",
    status: "live",
    icon: ShieldCheck,
    vaultSource: "Contract Readiness Scan",
  },
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
    id: "estimate-throughput",
    name: "Estimate Throughput Tracker",
    blurb: "See whether estimates are keeping up with the revenue target.",
    group: "Make more money",
    status: "live",
    icon: Calculator,
    vaultSource: "Estimate Throughput Tracker",
  },
  {
    id: "margin-leak",
    name: "Margin Leak Finder",
    blurb: "Find where gross margin disappears between estimate and closeout.",
    group: "Protect margin and cash",
    status: "live",
    icon: ScissorsLineDashed,
    vaultSource: "Margin Leak Finder",
  },
  {
    id: "pipeline-leak",
    name: "Pipeline Leak Finder",
    blurb: "Find where leads die before they become contracts.",
    group: "Make more money",
    status: "later",
    icon: Activity,
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
