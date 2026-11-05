// The job's contract and spec files that come inside an import export. Review
// lists them on the card and stores nothing; save stores each one on the job the
// import created or targeted, the same way file_upload stores an attached file.
// A document that fails never undoes or fails the import itself.
import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";
import { resolveJob } from "./jobs";
import { sha256Hex } from "./file-share";
import type { CardSection } from "./cards/model";
import type { ImportDocument, ImportDocumentKind, ReadFile } from "../job-import/files";
import { storeJobDocument } from "./tools/file-upload-tool";

export type DocumentLine = { name: string; kind: ImportDocumentKind };
export type DocumentsOutcome = {
  stored: DocumentLine[];
  skipped: (DocumentLine & { reason: string })[];
  failed: (DocumentLine & { reason: string })[];
  /** Member-facing: why nothing was stored, when nothing was tried. */
  note: string | null;
  /** For the member's AI: how to attach them later. */
  retry?: string;
};
type OnJob = { name: string; file_sha256: string | null; kind: ImportDocumentKind };

const fileName = (path: string) => path.split("/").pop() || path;
const kindWord = (kind: ImportDocumentKind) => (kind === "contract" ? "Contract" : "Spec");
const names = (list: string[], max = 5) =>
  `${list.slice(0, max).map(fileName).join(", ")}${list.length > max ? ` and ${list.length - max} more` : ""}`;
const files = (n: number) => (n === 1 ? "1 file" : `${n} files`);

export const RETRY_DOCUMENTS =
  "Call job_import step save again with the same batch_id, import_key and documents_key, and the same export as file.";

/** Binds the documents shown on one review card to that review. */
export async function documentsKey(batchId: string, docs: ImportDocument[]): Promise<string> {
  const rows: string[][] = [];
  for (const d of docs) rows.push([d.kind, d.name, await sha256Hex(d.bytes)]);
  return sha256Hex(new TextEncoder().encode(JSON.stringify([batchId, rows])));
}

/** The contract and spec documents already on a job, by kind. */
export async function jobDocuments(sb: Sb, jobId: string, companyId: string): Promise<OnJob[]> {
  const out: OnJob[] = [];
  for (const [table, kind] of [
    ["mcp_contract_documents", "contract"],
    ["mcp_spec_documents", "spec"],
  ] as const) {
    const { data, error } = await sb
      .from(table)
      .select("name,file_sha256")
      .eq("job_id", jobId)
      .eq("company_id", companyId)
      .limit(1000);
    if (error) throw new Error("documents unavailable");
    for (const row of (data ?? []) as { name: string; file_sha256: string | null }[])
      out.push({ name: row.name, file_sha256: row.file_sha256, kind });
  }
  return out;
}

/**
 * The review card's one section for the files in the export: what will be stored
 * as the contract and as specs, what is for the drawing import, and what is only
 * listed. saving is false when this review has no save step to store them with.
 */
export async function documentsSection(
  read: Pick<ReadFile, "documents" | "drawings" | "other">,
  saving: boolean,
  onJob: OnJob[] = [],
): Promise<CardSection | null> {
  const rows: CardSection["rows"] = [];
  const have = new Set(onJob.map((d) => d.file_sha256).filter(Boolean));
  const jobContract = onJob.find((d) => d.kind === "contract");
  const contract: string[] = [];
  const specs: string[] = [];
  const already: string[] = [];
  const keptContract: string[] = [];
  for (const d of read.documents) {
    if (have.has(await sha256Hex(d.bytes))) already.push(d.name);
    else if (d.kind === "contract" && jobContract) keptContract.push(d.name);
    else (d.kind === "contract" ? contract : specs).push(d.name);
  }
  if (saving) {
    if (contract.length)
      rows.push({ cells: [`Saved as the job's contract: ${names(contract)}`], tone: "known" });
    if (specs.length)
      rows.push({
        cells: [`Saved as specs (${specs.length}): ${names(specs, 10)}`],
        tone: "known",
      });
  } else if (contract.length || specs.length) {
    rows.push({
      cells: [
        `Not saved by this review: ${names([...contract, ...specs])}. Attach each one on its own and ask Athena to save it to the job's contract or specs.`,
      ],
      tone: "action",
    });
  }
  if (already.length)
    rows.push({ cells: [`Already on the job, not saved again: ${names(already)}`], tone: "known" });
  if (keptContract.length)
    rows.push({
      cells: [
        `The job already has a contract (${jobContract!.name}); Athena keeps it, so ${names(keptContract)} isn't saved`,
      ],
      tone: "known",
    });
  if (read.drawings.length)
    rows.push({
      cells: [
        `Drawings (${files(read.drawings.length)}) come in separately: attach the drawing PDF here and ask Athena to import the drawings.`,
      ],
      tone: "action",
    });
  const noted = read.other.filter((o) => o.note);
  for (const o of noted.slice(0, 5))
    rows.push({ cells: [`Listed only, ${fileName(o.name)}: ${o.note}`], tone: "unknown" });
  if (noted.length > 5)
    rows.push({ cells: [`Listed only: ${noted.length - 5} more over the limit`], tone: "unknown" });
  const plain = read.other.filter((o) => !o.note);
  if (plain.length)
    rows.push({
      cells: [
        `Listed only, not saved (${files(plain.length)}): ${names(plain.map((o) => o.name))}`,
      ],
      tone: "unknown",
    });
  return rows.length ? { heading: "Files in the export", kind: "list", rows } : null;
}

/**
 * After the import is saved: store the export's contract and spec files on the
 * job it saved to. Skips a file whose sha256 is already on the job, and never
 * replaces a contract the job already has. Never throws.
 */
export async function storeImportDocuments(
  sb: Sb,
  input: {
    documents: ImportDocument[];
    documentsKey: string | undefined;
    batchId: string;
    result: Record<string, unknown>;
    jobNumber: string;
  },
): Promise<DocumentsOutcome> {
  const out: DocumentsOutcome = { stored: [], skipped: [], failed: [], note: null };
  const { documents } = input;
  if (!documents.length) {
    if (input.documentsKey) {
      out.note =
        "The attached file has no contract or spec files, so none were saved. Attach the same export that was reviewed.";
      out.retry = RETRY_DOCUMENTS;
    }
    return out;
  }
  if (
    !input.documentsKey ||
    input.documentsKey !== (await documentsKey(input.batchId, documents))
  ) {
    out.note =
      "The attached file isn't the export that was reviewed, so its contract and spec files weren't saved. Attach the same export again.";
    out.retry = RETRY_DOCUMENTS;
    return out;
  }
  let job: Awaited<ReturnType<typeof resolveJob>>;
  let onJob: OnJob[];
  try {
    const jobId = typeof input.result.job_id === "string" ? input.result.job_id : "";
    const { data, error } = await sb
      .from("mcp_jobs")
      .select("company_id")
      .eq("id", jobId)
      .maybeSingle();
    const companyId = (data as { company_id?: string } | null)?.company_id;
    if (error || !jobId || !companyId) throw new Error("job unavailable");
    job = await resolveJob(sb, input.jobNumber, companyId, "write");
    if (job.job_id !== jobId || job.company_id !== companyId) throw new Error("job mismatch");
    onJob = await jobDocuments(sb, job.job_id, job.company_id);
  } catch {
    out.note =
      "The import is saved, but Athena couldn't confirm the job to add its contract and spec files to. Try saving the documents again.";
    out.retry = RETRY_DOCUMENTS;
    return out;
  }
  const have = new Set(onJob.map((d) => d.file_sha256).filter(Boolean));
  let jobContract = onJob.find((d) => d.kind === "contract");
  for (const d of documents) {
    const line = { name: fileName(d.name), kind: d.kind };
    const hash = await sha256Hex(d.bytes);
    if (have.has(hash)) {
      out.skipped.push({ ...line, reason: "already on the job, not saved again" });
      continue;
    }
    if (d.kind === "contract" && jobContract) {
      out.skipped.push({
        ...line,
        reason: `not saved, the job already has a contract (${jobContract.name}) and Athena kept it`,
      });
      continue;
    }
    try {
      const saved = await storeJobDocument(sb, job, {
        purpose: d.kind,
        filename: d.name,
        bytes: d.bytes,
      });
      const name = String(saved.structured.filename ?? line.name);
      out.stored.push({ name, kind: d.kind });
      have.add(hash);
      if (d.kind === "contract") jobContract = { name, file_sha256: hash, kind: "contract" };
    } catch (e) {
      out.failed.push({
        ...line,
        reason:
          (e instanceof ToolError ? e.message : "")
            .replace(/\s*(Nothing was (stored|saved)|No attachment was confirmed)\.\s*$/, "")
            .trim() || "It couldn't be saved.",
      });
    }
  }
  if (out.failed.length) out.retry = RETRY_DOCUMENTS;
  return out;
}

/** The saved card's Documents section: names and kinds, no ids. */
export function documentsResultSection(outcome: DocumentsOutcome): CardSection | null {
  const rows: CardSection["rows"] = [
    ...outcome.stored.map((d) => ({
      cells: [`${kindWord(d.kind)} saved: ${d.name}`],
      tone: "known" as const,
    })),
    ...outcome.skipped.map((d) => ({
      cells: [`${kindWord(d.kind)} ${d.reason}: ${d.name}`],
      tone: "known" as const,
    })),
    ...outcome.failed.map((d) => ({
      cells: [
        `${kindWord(d.kind)} not saved: ${d.name}. ${/[.!?]$/.test(d.reason) ? d.reason : `${d.reason}.`} The import is saved.`,
      ],
      tone: "action" as const,
    })),
    ...(outcome.note ? [{ cells: [outcome.note], tone: "action" as const }] : []),
  ];
  return rows.length ? { heading: "Documents", kind: "list", rows } : null;
}
