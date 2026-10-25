/** Official is the only copy that can post. A draft is a separate copy and never becomes official here. */
export const DRAFT_NOT_OFFICIAL = "Draft, not official";
export type RecordStanding = "official" | "draft";

export function recordStanding(value: unknown): RecordStanding {
  return value === "draft" ? "draft" : "official";
}

/** Null on the official copy. The same words on every draft surface. */
export function draftLabel(standing: RecordStanding): string | null {
  return standing === "draft" ? DRAFT_NOT_OFFICIAL : null;
}

/** Stored fact module for one record. Official stays the bare name; the draft is a sibling module. */
export function storedModule(record: string, standing: RecordStanding): string {
  return standing === "draft" ? `${record}_draft` : record;
}
