import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";
import type { Job } from "./jobs";
import type { BidBreakdown } from "./estimating-bid";
import { canonicalBidExport } from "./estimating-bid-files";
import { prepareHandoffDraft } from "./estimating-handoff-draft";

export const LOCAL_EXPORT_LIMIT = 10 * 1024 * 1024;
export const LOCAL_EXPORT_MIME = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
type Source = Parameters<typeof prepareHandoffDraft>[0]["snapshot"];
type Calculation = { snapshot: Source; view: { ready: boolean; breakdown: BidBreakdown | null } };
type Request = { format: "pdf" | "xlsx"; expectedVersion?: number; expectedSource?: string };
const held = () => new ToolError("The estimate changed or access is unavailable. Refresh the bid before exporting.");

/** The caller supplies the authenticated, plan-checked job and the existing saved-bid calculator.
 * Reads the guarded current snapshot twice; no save, audit, storage, or customer writes. */
export async function prepareLocalBidDownload(
  sb: Sb,
  job: Job,
  request: Request,
  calculate: (raw: unknown) => Calculation,
) {
  if (job.scope !== "full" && job.scope !== "contract") throw held();
  const read = async () => {
    const { data, error } = await sb.rpc("mcp_estimate_coverage_snapshot", { _job: job.job_id });
    if (error || !data) throw held();
    const result = calculate(data);
    const bid = result.snapshot.bid as { company_id?: unknown } | null;
    if (bid?.company_id !== job.company_id || !result.view.ready || !result.view.breakdown) throw held();
    const receipt = await prepareHandoffDraft({
      companyId: job.company_id, jobId: job.job_id, snapshot: result.snapshot,
      ready: result.view.ready, breakdown: result.view.breakdown,
    });
    return { ...result, receipt };
  };
  const source = await read();
  if ((request.expectedVersion !== undefined && request.expectedVersion !== source.snapshot.version) ||
      (request.expectedSource !== undefined && request.expectedSource !== source.receipt.sha256)) throw held();
  const breakdown = source.view.breakdown;
  if (!breakdown) throw held();
  const bid = source.snapshot.bid as { pricing?: { quotes?: Array<{ sub: string; description: string }> } };
  const selectedQuotes = breakdown.direct.filter((row) => row.basis === "quote").map((row) => {
    const quote = row.quoteId === null ? undefined : bid.pricing?.quotes?.[Number(row.quoteId)];
    if (!quote || row.quoteId === null) throw held();
    return { quoteId: row.quoteId, ref: row.ref, sub: quote.sub, description: quote.description };
  });
  const generated = canonicalBidExport({
    job: `${job.job_number}${job.name ? ` – ${job.name}` : ""}`,
    version: source.snapshot.version, ready: true, breakdown,
    provenance: { companyId: job.company_id, jobId: job.job_id, sourceSha256: source.receipt.sha256, selectedQuotes },
  }, request.format);
  if (!generated) throw new ToolError("The report text or amounts cannot be exported in this format. Try XLSX for Unicode labels.");
  if (!generated.bytes.length || generated.bytes.length > LOCAL_EXPORT_LIMIT)
    throw new ToolError("The export exceeds the 10 MiB limit. No download was prepared.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(generated.bytes)));
  const current = await read();
  if (current.snapshot.version !== source.snapshot.version || current.receipt.sha256 !== source.receipt.sha256) throw held();
  let encoded = "";
  for (let i = 0; i < generated.bytes.length; i += 8192)
    encoded += String.fromCharCode(...generated.bytes.subarray(i, i + 8192));
  return {
    delivery: "local" as const,
    filename: `Bid-summary-v${source.snapshot.version}.${request.format}`,
    mime_type: LOCAL_EXPORT_MIME[request.format], size: generated.bytes.length,
    content_base64: btoa(encoded),
    sha256: Array.from(digest, (n) => n.toString(16).padStart(2, "0")).join(""),
    snapshot_version: source.snapshot.version, source_sha256: source.receipt.sha256,
    company_id: job.company_id, job_id: job.job_id,
  };
}