import { z } from "zod";
import { ToolError } from "@lovable.dev/mcp-js";
import type { DrawingUpload } from "./drawing-set";

// ChatGPT recognizes file inputs only when a top-level field is declared in
// openai/fileParams. Keep the legacy drawing.file input for other callers.
export const drawingFile = z
  .object({
    download_url: z.string(),
    file_id: z.string(),
    mime_type: z.string().optional(),
    file_name: z.string().optional(),
  })
  .optional();

const FILE_TOOLS = new Set(["drawing_set_import", "estimate_intake", "estimate_takeoff_save"]);
export function drawingFileMeta(name: string): Record<string, unknown> {
  return FILE_TOOLS.has(name) ? { "openai/fileParams": ["file"] } : {};
}

export function drawingWithFile(
  drawing: DrawingUpload | undefined,
  file: z.infer<typeof drawingFile>,
  sheets?: string[],
): DrawingUpload | undefined {
  if (!file) return drawing;
  if (drawing?.file || drawing?.source_url || drawing?.content_base64)
    throw new ToolError(
      "Provide one drawing source: the attached file, PDF bytes, or a source link. Nothing was stored.",
    );
  return { ...drawing, file, sheets: drawing?.sheets ?? sheets };
}
