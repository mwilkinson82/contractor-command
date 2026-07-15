import { tierAtLeast, type Tier } from "@/hooks/use-tier";

export const START_HERE_MIN_TIER: Tier = "book_buyer";

export type StartHereExperience = "handbook" | "circle";

export function startHereExperience(tier: Tier | null): StartHereExperience {
  return tierAtLeast(tier, "circle") ? "circle" : "handbook";
}
