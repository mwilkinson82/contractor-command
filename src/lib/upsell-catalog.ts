// Single source of truth for what gets sold to whom on /upgrade and in the
// sidebar. Tier rank determines which cards appear; first card in the list
// is rendered as "Recommended."
//
// Each card has one or two plans (e.g. monthly + quarterly). The /upgrade
// view shows a toggle when plans.length > 1.

import { Sparkles, Users, Zap, GraduationCap, Flame, Phone, BookOpen, Wrench, type LucideIcon } from "lucide-react";
import type { Tier } from "@/hooks/use-tier";

export type UpsellSku =
  | "book_buyer"
  | "circle"
  | "power_hour"
  | "sm_school"
  | "contractor_school"
  | "hardcore"
  | "call_1"
  | "call_3"
  | "call_6";

// Server-known plan identifiers — must match the `plan` enum in
// createSkuCheckout (billing.functions.ts).
export type PlanId =
  | "power_hour_month"
  | "power_hour_quarter"
  | "sm_school_month"
  | "sm_school_quarter"
  | "contractor_school_month"
  | "contractor_school_quarter"
  | "call_1"
  | "call_3"
  | "call_6"
  | "circle";

export type PlanOption = {
  id: PlanId;
  label: string;          // "Monthly" | "Quarterly" | "One-time"
  price: string;          // "$997"
  cadence: string;        // "per month" | "per quarter" | "one-time"
  badge?: string;         // "Best value", etc.
};

export type UpsellCard = {
  sku: UpsellSku;
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  pitch: string;
  bullets: string[];
  // 'live' = wired to Stripe checkout. 'interest' = capture interest only.
  checkout: "live" | "interest";
  plans: PlanOption[];     // 1 or 2; UI shows toggle when length > 1
};

export const UPSELL_CATALOG: Record<UpsellSku, UpsellCard> = {
  book_buyer: {
    sku: "book_buyer",
    eyebrow: "The Handbook",
    icon: BookOpen,
    title: "ALP Contractor Handbook",
    pitch: "The full operating system in book form. Read it, run it.",
    bullets: [
      "32-chapter Handbook with audio narration",
      "AOS workspace (1 workspace, 2 seats)",
      "Foundation for everything above",
    ],
    checkout: "interest",
    plans: [{ id: "circle" /* unused */, label: "One-time", price: "$47", cadence: "one-time" }],
  },
  circle: {
    sku: "circle",
    eyebrow: "Contractor Circle",
    icon: Users,
    title: "The room. Calls, Vault, Marshall.",
    pitch: "Bi-weekly working sessions, full Vault, Ask Marshall, and the community of operators running AOS.",
    bullets: [
      "Bi-weekly group calls with Marshall",
      "Full Vault of templates, replays, frameworks",
      "Ask Marshall — direct line, any topic",
      "Unlimited AOS workspaces and seats",
    ],
    checkout: "live",
    plans: [{ id: "circle", label: "Monthly", price: "Membership", cadence: "monthly" }],
  },
  power_hour: {
    sku: "power_hour",
    eyebrow: "Power Hour",
    icon: Zap,
    title: "Daily 8AM PT working room.",
    pitch: "Start every weekday in the room. One hour, every day, with operators moving on the same things you are.",
    bullets: [
      "Daily Power Hour, Mon–Fri 8AM PT",
      "Full Power Hour replay archive",
      "Add-on for Circle members",
    ],
    checkout: "live",
    plans: [
      { id: "power_hour_month", label: "Monthly", price: "$997", cadence: "per month" },
      { id: "power_hour_quarter", label: "Quarterly", price: "$2,997", cadence: "per quarter", badge: "Lock in 90 days" },
    ],
  },
  sm_school: {
    sku: "sm_school",
    eyebrow: "Sales & Marketing School",
    icon: GraduationCap,
    title: "Weekly S&M class with Marshall.",
    pitch: "Wednesdays. Build the sales and marketing engine. Live teaching plus the full class replay archive.",
    bullets: [
      "Weekly S&M School class",
      "Full S&M School replay archive",
      "Add-on for Circle members",
    ],
    checkout: "live",
    plans: [
      { id: "sm_school_month", label: "Monthly", price: "$497", cadence: "per month" },
      { id: "sm_school_quarter", label: "Quarterly", price: "$1,497", cadence: "per quarter", badge: "Lock in 90 days" },
    ],
  },
  contractor_school: {
    sku: "contractor_school",
    eyebrow: "Contractor School",
    icon: Wrench,
    title: "In the weeds — PM, estimating, ops.",
    pitch: "Tactical class on project management, estimating, and the execution side of the business.",
    bullets: [
      "Weekly Contractor School class",
      "Full Contractor School replay archive",
      "Project management, estimating, ops playbooks",
    ],
    checkout: "live",
    plans: [
      { id: "contractor_school_month", label: "Monthly", price: "$497", cadence: "per month" },
      { id: "contractor_school_quarter", label: "Quarterly", price: "$1,497", cadence: "per quarter", badge: "Lock in 90 days" },
    ],
  },
  hardcore: {
    sku: "hardcore",
    eyebrow: "ALP Hardcore",
    icon: Flame,
    title: "The full daily room.",
    pitch: "Everything. Power Hour, S&M School, and Contractor School — the inner-circle calendar plus every replay.",
    bullets: [
      "Daily Power Hour + S&M School + Contractor School",
      "Hardcore-only replay shelves",
      "Daily room calendar with all recordings",
    ],
    checkout: "interest",
    plans: [{ id: "circle" /* unused */, label: "Monthly", price: "Pricing TBD", cadence: "monthly" }],
  },
  call_1: {
    sku: "call_1",
    eyebrow: "Single Call",
    icon: Phone,
    title: "One hour with Marshall.",
    pitch: "One private session. Bring a decision you can't unblock alone.",
    bullets: ["1 × 60-minute private session", "Direct pressure-test of one decision"],
    checkout: "live",
    plans: [{ id: "call_1", label: "One-time", price: "$1,500", cadence: "one-time" }],
  },
  call_3: {
    sku: "call_3",
    eyebrow: "Three Call Pack",
    icon: Sparkles,
    title: "Three sessions over six weeks.",
    pitch: "Enough cadence to install structure on a single inflection point.",
    bullets: ["3 × 60-minute private sessions", "Direct chat between calls", "Outputs you carry into AOS"],
    checkout: "live",
    plans: [{ id: "call_3", label: "One-time", price: "$3,000", cadence: "one-time" }],
  },
  call_6: {
    sku: "call_6",
    eyebrow: "Six Call Pack",
    icon: Sparkles,
    title: "Six sessions. The full installation.",
    pitch: "What the Six-Week Intensive was — same six private sessions, paid as a pack.",
    bullets: [
      "6 × 60-minute private sessions",
      "Marshall in your business for six weeks",
      "Priorities and structure installed end-to-end",
    ],
    checkout: "live",
    plans: [{ id: "call_6", label: "One-time", price: "$5,000", cadence: "one-time", badge: "Best value" }],
  },
};

// What appears on /upgrade per viewer tier. Order matters — first card is
// the visual "primary".
export function upsellsForTier(tier: Tier | null): UpsellSku[] {
  switch (tier) {
    case "aos_only":
      return ["book_buyer", "circle", "call_3", "call_1"];
    case "book_buyer":
      return ["circle", "power_hour", "sm_school", "call_3"];
    case "power_hour":
      return ["circle", "sm_school", "contractor_school", "call_3"];
    case "sm_school":
      return ["circle", "power_hour", "contractor_school", "call_3"];
    case "contractor_school":
      return ["circle", "power_hour", "sm_school", "call_3"];
    case "intensive":
      return ["circle", "call_3", "call_1"];
    case "circle":
      return ["power_hour", "sm_school", "contractor_school", "call_3"];
    case "hardcore":
      return ["call_6", "call_3", "call_1"];
    default:
      return ["circle", "call_3", "call_1"];
  }
}
