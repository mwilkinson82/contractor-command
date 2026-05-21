// Single source of truth for what gets sold to whom on /upgrade and in the
// sidebar. Tier rank determines which cards appear, plus a "primary" flag
// elevates the recommended next step for each viewer.
//
// Pricing for the newer SKUs (Power Hour, S&M School, Hardcore, call packs)
// is intentionally TBD — cards use an interest-capture CTA until Stripe
// price IDs land. See createCallPackCheckout / etc. when wiring real checkout.

import { Sparkles, Users, Zap, GraduationCap, Flame, Phone, BookOpen, type LucideIcon } from "lucide-react";
import type { Tier } from "@/hooks/use-tier";

export type UpsellSku =
  | "book_buyer"
  | "circle"
  | "power_hour"
  | "sm_school"
  | "hardcore"
  | "call_1"
  | "call_3"
  | "call_6";

export type UpsellCard = {
  sku: UpsellSku;
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  price: string;
  priceNote: string;
  pitch: string;
  bullets: string[];
  // 'live' = Stripe checkout wired. 'interest' = capture interest only.
  checkout: "live" | "interest";
  // Which existing route or in-app action handles it (if live).
  liveAction?: "circle" | "intensive_legacy";
};

export const UPSELL_CATALOG: Record<UpsellSku, UpsellCard> = {
  book_buyer: {
    sku: "book_buyer",
    eyebrow: "The Handbook",
    icon: BookOpen,
    title: "ALP Contractor Handbook",
    price: "$497",
    priceNote: "One-time",
    pitch: "The full operating system in book form. Read it, run it.",
    bullets: [
      "32-chapter Handbook with audio narration",
      "AOS workspace (1 workspace, 2 seats)",
      "Foundation for everything above",
    ],
    checkout: "interest",
  },
  circle: {
    sku: "circle",
    eyebrow: "Contractor Circle",
    icon: Users,
    title: "The room. Calls, Vault, Marshall.",
    price: "Membership",
    priceNote: "Monthly",
    pitch: "Bi-weekly working sessions, full Vault, Ask Marshall, and the community of operators running AOS.",
    bullets: [
      "Bi-weekly group calls with Marshall",
      "Full Vault of templates, replays, frameworks",
      "Ask Marshall — direct line, any topic",
      "Unlimited AOS workspaces and seats",
    ],
    checkout: "live",
    liveAction: "circle",
  },
  power_hour: {
    sku: "power_hour",
    eyebrow: "Power Hour",
    icon: Zap,
    title: "Daily 8AM PT working room.",
    price: "Pricing TBD",
    priceNote: "Monthly",
    pitch: "Start every weekday in the room. One hour, every day, with operators moving on the same things you are.",
    bullets: [
      "Daily Power Hour, Mon–Fri 8AM PT",
      "Full Power Hour replay archive",
      "Add-on for Circle members",
    ],
    checkout: "interest",
  },
  sm_school: {
    sku: "sm_school",
    eyebrow: "Sales & Marketing School",
    icon: GraduationCap,
    title: "Weekly S&M class with Marshall.",
    price: "Pricing TBD",
    priceNote: "Monthly",
    pitch: "Wednesdays. Build the sales and marketing engine. Live teaching plus the full class replay archive.",
    bullets: [
      "Weekly S&M School class, Wednesdays 7PM PT",
      "Full S&M School replay archive",
      "Add-on for Circle members",
    ],
    checkout: "interest",
  },
  hardcore: {
    sku: "hardcore",
    eyebrow: "ALP Hardcore",
    icon: Flame,
    title: "The full daily room.",
    price: "Pricing TBD",
    priceNote: "Monthly",
    pitch: "Everything. Power Hour, S&M School, and Contractor School — the inner-circle calendar plus every replay.",
    bullets: [
      "Daily Power Hour + Tuesday Contractor School + Wednesday S&M School",
      "Hardcore-only replay shelf (Contractor School)",
      "Daily room calendar with all recordings",
    ],
    checkout: "interest",
  },
  call_1: {
    sku: "call_1",
    eyebrow: "Single Call",
    icon: Phone,
    title: "One hour with Marshall.",
    price: "Pricing TBD",
    priceNote: "One-time",
    pitch: "One private session. Bring a decision you can't unblock alone.",
    bullets: ["1 × 60-minute private session", "Direct pressure-test of one decision"],
    checkout: "interest",
  },
  call_3: {
    sku: "call_3",
    eyebrow: "Three Call Pack",
    icon: Sparkles,
    title: "Three sessions over six weeks.",
    price: "Pricing TBD",
    priceNote: "One-time",
    pitch: "Enough cadence to install structure on a single inflection point.",
    bullets: ["3 × 60-minute private sessions", "Direct chat between calls", "Outputs you carry into AOS"],
    checkout: "interest",
  },
  call_6: {
    sku: "call_6",
    eyebrow: "Six Call Pack",
    icon: Sparkles,
    title: "Six sessions. The full installation.",
    price: "Pricing TBD",
    priceNote: "One-time",
    pitch: "What the Six-Week Intensive was — same six private sessions, paid as a pack.",
    bullets: [
      "6 × 60-minute private sessions",
      "Marshall in your business for six weeks",
      "Priorities and structure installed end-to-end",
    ],
    checkout: "interest",
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
      return ["circle", "sm_school", "call_3", "call_1"];
    case "sm_school":
      return ["circle", "power_hour", "call_3", "call_1"];
    case "intensive":
      return ["circle", "call_3", "call_1"];
    case "circle":
      return ["power_hour", "sm_school", "hardcore", "call_3"];
    case "hardcore":
      return ["call_6", "call_3", "call_1"];
    default:
      return ["circle", "call_3", "call_1"];
  }
}
