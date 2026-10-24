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
