import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "../guard";
import type { Job } from "../jobs";
import { FILE_BUCKET, FILE_MAX_BYTES, safeFilename, sha256Hex, storagePath } from "../file-share";
import { engineRpc, type StoredPage } from "./service";
import type { EngineSnapshot } from "./state";
import { measuredPdf, pageGeometry } from "./render";
export async function exportMeasuredSheet(
  sb: Sb,
  job: Job,
  page: StoredPage,
  state: EngineSnapshot,
) {
  const dated = new Date().toISOString(),
    pdf = await measuredPdf(page, state, dated);
  if (pdf.length > FILE_MAX_BYTES)
    throw new ToolError(
      "The derived PDF exceeds the private markup file limit. The original and measured geometry are preserved.",
    );
  const name = safeFilename(`${page.sheet}-measured-${dated.replace(/[:.]/g, "-")}.pdf`).name;
  const path = storagePath(
      job.company_id,
      job.job_id,
      `drawing-markup-takeoff-${crypto.randomUUID()}`,
      name,
    ),
    bucket = sb.storage.from(FILE_BUCKET);
  const { renderPdfiumPage } = await import("../pdf-renderer");
  const png = await renderPdfiumPage(pdf, 0);
  if (!png || png.length > FILE_MAX_BYTES)
    throw new ToolError("The measured sheet preview could not be prepared. Nothing was stored.");
  const pngPath = path.replace(/\.pdf$/i, ".png");
  const result = await bucket.upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false,
    cacheControl: "no-store",
  });
  if (result.error)
    throw new ToolError("The dated markup was not stored. The original is unchanged.");
  const image = await bucket.upload(pngPath, png, {
    contentType: "image/png",
    upsert: false,
    cacheControl: "no-store",
  });
  if (image.error)
    throw new ToolError(
      "The derived sheet PNG was not stored. The original and geometry are unchanged; no export was confirmed.",
    );
  const revisions = pageGeometry(state, page).map((g) => g.id);
  // Never remove an original or an immutable committed record on a later error.
  const record = await engineRpc<{ id: string; created_at: string }>(
    sb,
    "mcp_takeoff_markup_save",
    {
      _job: job.job_id,
      _record: {
        kind: "export",
        source_id: page.source.id,
        page: page.page,
        rendered_pdf: path,
        rendered_png: pngPath,
        content_hash: await sha256Hex(pdf),
        geometry_revs: revisions,
        pass_summary: {
          takeoff_version: state.takeoff_version,
          source_hash: page.source.content_hash,
          dated,
        },
      },
    },
  );
  const signed = await bucket.createSignedUrl(path, 900);
  const pngSigned = await bucket.createSignedUrl(pngPath, 900);
  return {
    path,
    png_url: pngSigned.data?.signedUrl ?? null,
    id: record.id,
    created_at: record.created_at,
    filename: name,
    geometry_revs: revisions,
    url: signed.data?.signedUrl ?? null,
    original_unchanged: true,
  };
}

export type ExportRecord = {
  id: string;
  source_id: string;
  page: number;
  rendered_pdf: string;
  content_hash: string;
  created_at: string;
  geometry_revs: string[];
  source_filename: string;
  sheet: string;
};
export async function downloadMeasuredExport(sb: Sb, job: Job, state: EngineSnapshot, id: string) {
  const records = await engineRpc<ExportRecord[]>(sb, "mcp_takeoff_exports", {
      _job: job.job_id,
      _id: id,
      _source: null,
      _page: null,
    }),
    record = records[0];
  if (
    !record ||
    !record.rendered_pdf.startsWith(`${job.company_id}/${job.job_id}/drawing-markup-`) ||
    !record.rendered_pdf.endsWith(".pdf") ||
    record.rendered_pdf.includes("..") ||
    record.rendered_pdf.includes("\\")
  )
    throw new ToolError("That dated measurement PDF is not available on this job.");
  const bucket = sb.storage.from(FILE_BUCKET),
    stored = await bucket.download(record.rendered_pdf);
  if (
    stored.error ||
    !stored.data ||
    (await sha256Hex(new Uint8Array(await stored.data.arrayBuffer()))) !== record.content_hash
  )
    throw new ToolError(
      "The dated markup could not be verified against its saved fingerprint. No different file was substituted.",
    );
  const signed = await bucket.createSignedUrl(record.rendered_pdf, 900);
  if (signed.error || !signed.data?.signedUrl)
    throw new ToolError(
      "The private PDF link could not be refreshed. The saved version is preserved.",
    );
  const current = pageGeometry(state, {
    source: { id: record.source_id } as StoredPage["source"],
    page: record.page,
  })
    .map((g) => g.id)
    .sort();
  return {
    id: record.id,
    created_at: record.created_at,
    filename: record.rendered_pdf.split("/").at(-1)!,
    url: signed.data.signedUrl,
    geometry_revs: record.geometry_revs,
    original_unchanged: true,
    historical: true,
    stale:
      state.sources?.some((s) => s.id === record.source_id && s.stale) === true ||
      JSON.stringify(current) !== JSON.stringify([...record.geometry_revs].sort()),
  };
}
