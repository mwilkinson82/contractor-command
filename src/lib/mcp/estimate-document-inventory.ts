import { ToolError } from "@lovable.dev/mcp-js";
import { drawingRecords, type DrawingRecord } from "./drawing-set";
import type { Doc, Setup } from "./estimating";
import type { Sb } from "./guard";
import type { Job } from "./jobs";

/** Storage records, document declarations and extracted text are separate facts.
 * A saved clause or spec review is never described as an uploaded complete file. */
export function documentInventory(
  setup: Setup,
  sources: DrawingRecord[],
  clauses: { section: string; source?: string | null }[],
) {
  return {
    drawings: sources.map((s) => ({
      source_id: s.id,
      name: s.filename,
      revision: s.version,
      sheets: s.sheets,
      storage: "stored original",
    })),
    specifications: setup.documents.filter((d) => d.kind === "spec"),
    reviewed_spec_sections:
      setup.doc_review?.specs.map((s) => ({ section: s.section, title: s.title })) ?? [],
    contracts: setup.documents.filter((d) => d.kind === "contract"),
    contract_clauses: clauses.map((c) => ({ section: c.section, source: c.source ?? null })),
    documents: setup.documents,
    scale_next_step:
      "Lock the scale for each plan/detail before measuring lengths, areas or volumes. Counts need a confirmed region.",
  };
}

export async function loadDocumentInventory(sb: Sb, job: Job, setup: Setup) {
  const sources = await drawingRecords(sb, job);
  const result = await sb
    .from("mcp_contract_clauses")
    .select("section, source")
    .eq("job_id", job.job_id);
  if (result.error)
    throw new ToolError(
      "The saved contract inventory could not be read. It is not confirmed missing.",
    );
  return documentInventory(setup, sources, result.data ?? []);
}

export function inventoryDocuments(
  setup: Setup,
  inventory: ReturnType<typeof documentInventory>,
): Doc[] {
  const documents = [...setup.documents];
  for (const s of inventory.drawings)
    if (!documents.some((d) => d.name === s.name && d.revision === String(s.revision)))
      documents.push({
        name: s.name,
        kind: "sheet",
        revision: String(s.revision),
        sheets: s.sheets,
      });
  return documents;
}

export function inventoryText(inventory: ReturnType<typeof documentInventory>): string {
  return [
    "Stored project inventory",
    ...inventory.drawings.map(
      (d) =>
        `- Drawing: ${d.name} · revision ${d.revision} · ${d.sheets.join(", ") || "sheet index needed"} · source ${d.source_id}`,
    ),
    ...inventory.specifications.map(
      (d) =>
        `- Specification document: ${d.name}${d.path ? " · stored file" : " · listed; file storage not confirmed"}`,
    ),
    ...inventory.reviewed_spec_sections.map(
      (s) => `- Saved specification review: ${s.section} · ${s.title}`,
    ),
    ...inventory.contracts.map(
      (d) =>
        `- Contract document: ${d.name}${d.path ? " · stored file" : " · listed; file storage not confirmed"}`,
    ),
    ...inventory.contract_clauses.map(
      (c) => `- Saved contract text: §${c.section}${c.source ? ` · ${c.source}` : ""}`,
    ),
    ...(!inventory.specifications.length && !inventory.reviewed_spec_sections.length
      ? ["- No specification document or section review is on file."]
      : []),
    ...(!inventory.contract_clauses.length && !inventory.contracts.length
      ? [
          "- No saved contract clause text was found; this does not establish whether a contract file exists elsewhere.",
        ]
      : []),
    inventory.scale_next_step,
  ].join("\n");
}
