export const CAPTURE_SEGMENTS = [
  "field_notes",
  "circle",
  "handbook",
  "intensive",
  "clinic",
] as const;

export type CaptureSegment = (typeof CAPTURE_SEGMENTS)[number];

/** Locked Pike/Resend segment IDs. Do not invent replacements. */
export const RESEND_SEGMENT_IDS: Record<CaptureSegment, string> = {
  field_notes: "a043da96-fa9f-40e1-8593-25b1186834b6",
  circle: "39e48e7b-1978-4422-8542-8e11f64c5312",
  handbook: "38aa13bc-a2cc-44b2-8a06-383488f8f5ad",
  intensive: "b2067818-20f8-4399-a304-da4babbcb2fa",
  clinic: "9214eaa2-369d-4125-ba6f-238502d6db9c",
};

export const DEFAULT_CAPTURE_SEGMENT: CaptureSegment = "field_notes";

export function isCaptureSegment(value: unknown): value is CaptureSegment {
  return typeof value === "string" && (CAPTURE_SEGMENTS as readonly string[]).includes(value);
}
