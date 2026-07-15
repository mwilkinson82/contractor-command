import { tierAtLeast, type Tier } from "@/hooks/use-tier";

export type CircleFeature = "contractor-os" | "calls" | "community" | "templates" | "replays";

export type CircleFeatureMeta = {
  eyebrow: string;
  title: string;
  description: string;
  benefits: readonly string[];
};

export const CIRCLE_FEATURES: Record<CircleFeature, CircleFeatureMeta> = {
  "contractor-os": {
    eyebrow: "Contractor OS",
    title: "The implementation playbook",
    description:
      "The connected operating path for ownership, economics, IOR, field control, delivery, and execution.",
    benefits: [
      "The complete professional contractor operating sequence",
      "Implementation moves tied to the active constraint",
      "Direct routing into AOS, OverWatch, tools, and working files",
    ],
  },
  calls: {
    eyebrow: "Live room",
    title: "Calls and bootcamps",
    description:
      "Bring the real company or project issue into the room and pressure-test the next move with Marshall.",
    benefits: [
      "Bi-weekly working sessions with Marshall",
      "Monthly implementation bootcamps",
      "Topic submission and live issue pressure",
    ],
  },
  community: {
    eyebrow: "Between the calls",
    title: "The Contractor Circle community",
    description:
      "Stay connected to the operators, conversations, and daily guidance that keep implementation moving.",
    benefits: [
      "Private Contractor Circle Discord",
      "Daily questions, wins, and operator conversations",
      "A direct line into what the room is working on now",
    ],
  },
  templates: {
    eyebrow: "Implementation assets",
    title: "Templates and working files",
    description:
      "Use the field-tested worksheets, checklists, and operating files that turn the teaching into company practice.",
    benefits: [
      "The complete Contractor Circle template Vault",
      "AOS, IOR, project, field, and leadership working files",
      "Updated assets that follow the current teaching",
    ],
  },
  replays: {
    eyebrow: "Teaching library",
    title: "The complete replay archive",
    description:
      "Catch up on the working sessions and return to the exact teaching when the company needs it.",
    benefits: [
      "Every Contractor Circle call replay",
      "Implementation teaching organized for reuse",
      "The context behind the tools and templates",
    ],
  },
};

export function hasContractorCircleAccess(tier: Tier | null): boolean {
  return tierAtLeast(tier, "circle");
}

export function hasCircleFeature(tier: Tier | null, _feature: CircleFeature): boolean {
  return hasContractorCircleAccess(tier);
}
