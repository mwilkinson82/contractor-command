import type { CardSection } from "../cards/model";
import type { Bounds } from "./geometry";
import type { SheetInspection } from "./pdf";

type CitedLine = { line_no: number; sheet?: string | null; detail?: string | null };
export type DrawingReference = {
  title: string;
  bounds: Bounds;
  line_numbers: number[];
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const sheetKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Captions are evidence of references to review, never proof that the depicted work is included or measured. */
export function drawingReferences(
  inspection: Pick<SheetInspection, "objects" | "truncated">,
  sheet: string,
  lines: CitedLine[],
) {
  const references: DrawingReference[] = [];
  const seen = new Set<string>();
  for (const object of inspection.objects) {
    if (object.kind !== "text") continue;
    const title = (object.text ?? "").replace(/\s+/g, " ").trim();
    // Read labels from the drawing itself, across trades. Body notes and 'see detail' leaders
    // are not inventories. No list of expected project items or benchmark quantities is used.
    if (
      title.length > 120 ||
      !/\b(?:plan|detail|schedule|section)(?:\s+[a-z0-9.-]+)?$/i.test(title)
    )
      continue;
    if (/^(?:see|refer|ref|per|for|note|notes)\b/i.test(title)) continue;
    const key = normalize(title);
    if (!key || /^(?:plan|detail|schedule|section)(?:\s+[a-z0-9.-]+)?$/.test(key) || seen.has(key))
      continue;
    const b = object.bounds;
    if (
      ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
      b.x < 0 ||
      b.y < 0 ||
      b.width <= 0 ||
      b.height <= 0 ||
      b.x + b.width > 1.001 ||
      b.y + b.height > 1.001
    )
      continue;
    seen.add(key);
    const lineNumbers = lines
      .filter((line) => {
        if (sheetKey(line.sheet ?? "") !== sheetKey(sheet)) return false;
        const citation = normalize(line.detail ?? "");
        // A line must actually cite the caption. An item mentioning 'pier' alone is
        // not proof that both Pier A and Pier B, or all of their work, were taken off.
        return citation !== "" && ` ${citation} `.includes(` ${key} `);
      })
      .map((line) => line.line_no);
    references.push({
      title,
      bounds: { ...b },
      line_numbers: [...new Set(lineNumbers)].sort((a, b) => a - b),
    });
  }
  references.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  return {
    sheet,
    references: references.slice(0, 40),
    omitted_references: Math.max(0, references.length - 40),
    inspection_truncated: inspection.truncated,
    coverage_complete: false as const,
  };
}

export function drawingReferenceSection(review: ReturnType<typeof drawingReferences>): CardSection {
  return {
    heading: `Drawing references to reconcile · ${review.sheet}`,
    kind: "list",
    rows: [
      {
        cells: [
          "Captions extracted from this sheet. Check them against the agreed scope and takeoff. Quantities and complete scope coverage remain unverified.",
        ],
        tone: "unknown",
      },
      ...review.references.map((reference) => ({
        cells: [
          reference.title,
          reference.line_numbers.length
            ? `Cited by ${reference.line_numbers.map((n) => `L${n}`).join(", ")}. Confirm that the required quantities are measured.`
            : "No saved line cites this drawing reference. Confirm included, excluded or covered elsewhere.",
        ],
        tone: "unknown" as const,
      })),
      ...(!review.references.length
        ? [
            {
              cells: [
                "No labelled references were extracted. Review the sheet visually; text extraction does not establish completeness.",
              ],
              tone: "unknown" as const,
            },
          ]
        : []),
      ...(review.inspection_truncated || review.omitted_references
        ? [
            {
              cells: [
                "This reference list is partial. Review the remaining drawing content before settling scope.",
              ],
              tone: "unknown" as const,
            },
          ]
        : []),
    ],
  };
}
