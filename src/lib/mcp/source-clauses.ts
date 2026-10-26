import { createServerOnlyFn } from "@tanstack/react-start";
import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";
import type { Job } from "./jobs";
import type { ReadableSource } from "./document-readable";
import { materializeClauses, indexLiteralClauses, type LiteralClause } from "./literal-clauses";
export async function loadJobSourceClauses(
  sb: Sb,
  job: Pick<Job, "job_id" | "company_id">,
  requestedCompany?: string,
) {
  const read = createServerOnlyFn(async () => {
    if (
      requestedCompany &&
      requestedCompany.trim().toLowerCase() !== job.company_id.toLowerCase()
    ) {
      const { memberCompanies } = await import("./jobs");
      const wanted = requestedCompany.trim().toLowerCase();
      const named = (await memberCompanies(sb)).filter(
        (c) => c.id.toLowerCase() === wanted || c.name.trim().toLowerCase() === wanted,
      );
      if (named.length !== 1 || named[0].id !== job.company_id)
        throw new ToolError("That job is not in the company you named. Nothing changed.");
    }
    const { loadReadable } = await import("./document-readable");
    const { loadClauseIndex } = await import("./document-clause-index");
    const clauses: LiteralClause[] = [],
      problems: string[] = [];
    let sources = 0;
    const source_extractions: {
      source_id: string;
      file_sha256: string | null;
      state: string;
      covered_pdf_pages: number;
      index_version: string;
      clauses: number;
    }[] = [];
    for (const table of ["mcp_contract_documents", "mcp_spec_documents"] as const) {
      const { data, error } = await sb
        .from(table)
        .select(
          "id,name,company_id,job_id,upload_id,storage_bucket,storage_path,file_sha256,size_bytes,mime_type",
        )
        .eq("job_id", job.job_id)
        .eq("company_id", job.company_id);
      if (error)
        throw new ToolError("Saved source clauses could not be read; no absence was inferred.");
      for (const source of (data ?? []) as unknown as (ReadableSource & {
        name: string;
        mime_type: string;
      })[]) {
        sources++;
        if (source.mime_type !== "application/pdf" || !source.storage_path) {
          problems.push(
            `${source.name}: physical-page extraction is unavailable; use the saved source reader.`,
          );
          continue;
        }
        let readable: Awaited<ReturnType<typeof loadReadable>>;
        try {
          readable = await loadReadable(sb, source);
        } catch {
          problems.push(
            `${source.name}: complete saved page text is unavailable through this source reference; its original and existing records are unchanged.`,
          );
          continue;
        }
        if (!readable) {
          problems.push(`${source.name}: readable extraction is not yet prepared.`);
          continue;
        }
        if (!readable.pages.some((p) => p.text.trim())) {
          problems.push(
            `${source.name}: no machine-readable text was extracted; blank/image-only pages do not imply no contract requirements.`,
          );
          continue;
        }
        let index: Awaited<ReturnType<typeof loadClauseIndex>> = null;
        try {
          index = await loadClauseIndex(sb, source, readable);
        } catch {
          problems.push(
            `${source.name}: the clause index is unavailable; verified saved page text is used directly.`,
          );
        }
        source_extractions.push({
          source_id: source.id,
          file_sha256: source.file_sha256,
          state: index ? "stored_literal_index" : "saved_text",
          covered_pdf_pages: readable.covered_pdf_pages,
          index_version: index?.index_version ?? "literal-sections-v2",
          clauses: index?.entries.length ?? indexLiteralClauses(readable.pages).length,
        });
        clauses.push(
          ...materializeClauses(index?.entries ?? indexLiteralClauses(readable.pages), readable, {
            id: source.id,
            name: source.name,
            file_sha256: source.file_sha256!,
          }),
        );
      }
    }
    return { clauses, problems, sources, source_extractions };
  });
  return read();
}
