/** Official is the copy that posts. A draft never replaces it. */
export const DRAFT_NOT_OFFICIAL = "Draft, not official";
export type RecordStanding = "official" | "draft";

export function recordStanding(value: unknown): RecordStanding {
  return value === "draft" ? "draft" : "official";
}
