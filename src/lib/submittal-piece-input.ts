import { z } from "zod";
import { PACKAGE_KINDS } from "./mcp/submittals";

export const newSubmittalPiece = z
  .object({
    kind: z.enum(PACKAGE_KINDS),
    source_party: z.string().trim().min(1).max(120),
    required: z.boolean().default(true),
  })
  .strict();

export function submittalPieceMime(name: string): string | null {
  if (!name.trim() || name.length > 120 || /[\\/]|\p{Cc}/u.test(name)) return null;
  const types: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
  };
  return types[name.split(".").at(-1)?.toLowerCase() ?? ""] ?? null;
}

/** Filename collisions are visible facts, not proof that two documents have identical contents. */
export function duplicatePieceWarnings(items: { file_ref?: string | null }[]) {
  const names = new Map<string, { filename: string; pieces: string[] }>();
  items.forEach((item, index) => {
    const filename = item.file_ref?.split("/").at(-1);
    if (!filename) return;
    const key = filename.normalize("NFKC").toLowerCase();
    const entry = names.get(key) ?? { filename, pieces: [] };
    entry.pieces.push(`P${index + 1}`);
    names.set(key, entry);
  });
  return [...names.values()]
    .filter((entry) => entry.pieces.length > 1)
    .map((entry) => ({
      code: "DUPLICATE_FILENAME" as const,
      ...entry,
      message: `Duplicate filename: ${entry.filename} appears on ${entry.pieces.join(", ")}. Both copies are kept; check which belong in the package. Matching names do not confirm matching contents.`,
    }));
}
