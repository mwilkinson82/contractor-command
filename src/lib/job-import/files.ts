// One attached file -> what the import reads: a workbook's sheets, a ZIP of
// several exports (Procore's Project Archive, or the member's own downloads),
// a P6 .xer or MS Project XML schedule, or a single CSV. Each sheet's kind is
// worked out later from its columns; nothing here guesses what a file is from
// its name alone. The one exception is the job's own documents: a contract or
// specification PDF/DOCX is routed by its path in the ZIP, so the save can store it.
import { DOC_MAX_BYTES } from "../mcp/file-upload";
import { isMspdi, isXer } from "./schedule-files";
import type { Sheet } from "./spreadsheet";
import { isXlsx, isZip, readXlsx, toCsv, unzip } from "./xlsx";

export type ScheduleFile = { kind: "xer" | "mspdi"; text: string; name: string };
export type ImportDocumentKind = "contract" | "spec";
/** A contract or spec file kept with its bytes, stored on the job at save. */
export type ImportDocument = { name: string; kind: ImportDocumentKind; bytes: Uint8Array };
export type ReadFile = {
  sheets: Sheet[];
  schedule: ScheduleFile | null;
  /** An Overwatch job export found in the bundle. */
  overwatch: string | null;
  /** The job's contract (at most one) then its specs, at most MAX_IMPORT_DOCUMENTS. */
  documents: ImportDocument[];
  /** Drawing PDFs: they come in through the drawing import, not this one. */
  drawings: string[];
  /** Files the import doesn't read or store: name, size, and why when it qualified. */
  other: { name: string; bytes: number; note?: string }[];
  problems: string[];
};

export const MAX_IMPORT_DOCUMENTS = 10;

const norm = (path: string) => path.toLowerCase().replace(/_+/g, " ");
// Not this job's contract or spec: subs' contracts (commitments), COs, POs, invoices, waivers.
const NOT_JOB_DOCUMENT =
  /change\s*-?\s*orders?|\bp?co\s*[#-]?\s*\d|commitments?|sub\s*-?\s*contract|purchase\s*-?\s*orders?|\bpo\s*[#-]?\s*\d|invoices?|\blien\b|waivers?|non\s*-?\s*disclosure|\bnda\b/;
const CONTRACT_WORDS =
  /prime\s*-?\s*contracts?|owner\s*-?\s*contract|contract\s*-?\s*agreement|agreement|\baia\s*-?\s*a\s*-?\s*(101|102|401)\b/;
const SPEC_WORDS = /specifications?|project\s*-?\s*manual|spec\s*-?\s*book/;
// A CSI section number: 26 05 19, 26.05.19, 260519 (one separator, never a dash, so dates don't match).
const CSI_SECTION = /(?<![\d-])[0-4]\d([ .]?)\d{2}\1\d{2}(?![\d-])/;
// A drawing sheet number at the start of the name: E-101, A2.01, M101.
const SHEET_NUMBER = /^[a-z]{1,2}[-. ]?(\d{3}|\d{1,2}\.\d{1,2})(?!\d)/;

/**
 * What a PDF or DOCX inside the export is, from its path and name alone:
 * the job's contract, a specification, a drawing sheet, or null (listed only).
 */
export function routeDocument(path: string): ImportDocumentKind | "drawing" | null {
  const kind = ext(path);
  if (kind !== "pdf" && kind !== "docx") return null;
  const full = norm(path);
  if (NOT_JOB_DOCUMENT.test(full)) return null;
  const folders = full.split("/").slice(0, -1);
  const name = norm(base(path)).replace(/\.[a-z0-9]+$/, "");
  if (kind === "pdf" && folders.some((f) => /\bdrawings?\b/.test(f))) return "drawing";
  if (CONTRACT_WORDS.test(full)) return "contract";
  if (SPEC_WORDS.test(name) || CSI_SECTION.test(name)) return "spec";
  if (kind === "pdf" && SHEET_NUMBER.test(name)) return "drawing";
  if (folders.some((f) => SPEC_WORDS.test(f))) return "spec";
  return null;
}

type Candidate = ImportDocument & { named: boolean };

const decode = (bytes: Uint8Array): string => {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
};

const base = (name: string) => name.split("/").pop() || name;
const ext = (name: string) => (base(name).match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
const TEXT_TABLE = new Set(["csv", "tsv", "txt", ""]);

export async function readImportFile(bytes: Uint8Array, name = "export"): Promise<ReadFile> {
  const out: ReadFile = {
    sheets: [],
    schedule: null,
    overwatch: null,
    documents: [],
    drawings: [],
    other: [],
    problems: [],
  };
  const found: Candidate[] = [];
  await readOne(out, found, bytes, name, 0);
  keepDocuments(out, found);
  return out;
}

/** Sends a PDF or DOCX to the job's documents, the drawing line, or the listed-only files. */
function routeOne(out: ReadFile, found: Candidate[], bytes: Uint8Array, name: string): boolean {
  const route = routeDocument(name);
  if (!route) return false;
  if (route === "drawing") out.drawings.push(name);
  else
    found.push({
      name,
      kind: route,
      bytes,
      named: route === "contract" && CONTRACT_WORDS.test(norm(base(name))),
    });
  return true;
}

/** One contract per job (a match on the file's own name wins over its folder), specs after, capped. */
function keepDocuments(out: ReadFile, found: Candidate[]) {
  const listed = (d: Candidate, note: string) =>
    out.other.push({ name: d.name, bytes: d.bytes.length, note });
  const fits: Candidate[] = [];
  for (const d of found) {
    if (d.bytes.length > DOC_MAX_BYTES)
      listed(d, `over ${Math.round(DOC_MAX_BYTES / 1024 / 1024)} MB`);
    else fits.push(d);
  }
  const contracts = fits.filter((d) => d.kind === "contract");
  const contract = contracts.find((d) => d.named) ?? contracts[0];
  for (const d of contracts) if (d !== contract) listed(d, "Athena keeps one contract per job");
  const keep = [...(contract ? [contract] : []), ...fits.filter((d) => d.kind === "spec")];
  keep.forEach((d, i) => {
    if (i < MAX_IMPORT_DOCUMENTS)
      out.documents.push({ name: d.name, kind: d.kind, bytes: d.bytes });
    else listed(d, `over the ${MAX_IMPORT_DOCUMENTS}-document limit for one import`);
  });
}

async function readOne(
  out: ReadFile,
  found: Candidate[],
  bytes: Uint8Array,
  name: string,
  depth: number,
) {
  if (ext(name) === "docx") {
    if (!routeOne(out, found, bytes, name)) out.other.push({ name, bytes: bytes.length });
    return;
  }
  if (isZip(bytes)) {
    const entries = await unzip(bytes);
    if (isXlsx(entries)) {
      for (const sheet of await readXlsx(bytes))
        if (sheet.rows.length)
          out.sheets.push({ text: toCsv(sheet.rows), name: `${base(name)}: ${sheet.name}` });
      return;
    }
    if (depth > 0) {
      out.other.push({ name, bytes: bytes.length });
      return;
    }
    for (const e of entries) await readOne(out, found, e.bytes, e.name, depth + 1);
    return;
  }
  const kind = ext(name);
  if (
    [
      "pdf",
      "jpg",
      "jpeg",
      "png",
      "heic",
      "gif",
      "tif",
      "tiff",
      "dwg",
      "doc",
      "mpp",
      "xls",
    ].includes(kind)
  ) {
    if (kind === "mpp")
      out.problems.push(
        `${base(name)} is a Microsoft Project file. Athena reads Project's XML: in Project, choose File > Save As > XML, and attach that.`,
      );
    if (kind === "xls")
      out.problems.push(
        `${base(name)} is an old Excel file. Open it in Excel, save it as .xlsx or .csv, and attach that.`,
      );
    if (kind === "pdf" && routeOne(out, found, bytes, name)) return;
    out.other.push({ name, bytes: bytes.length });
    return;
  }
  const text = decode(bytes);
  if (isXer(text)) return setSchedule(out, { kind: "xer", text, name: base(name) });
  if (isMspdi(text)) return setSchedule(out, { kind: "mspdi", text, name: base(name) });
  if (kind === "json" || /^\s*\{/.test(text)) {
    if (/"format"\s*:\s*"overwatch\.job_export"/.test(text.slice(0, 4000)) && !out.overwatch)
      out.overwatch = text;
    else out.other.push({ name, bytes: bytes.length });
    return;
  }
  if (TEXT_TABLE.has(kind) && text.trim()) {
    out.sheets.push({ text, name: base(name) });
    return;
  }
  out.other.push({ name, bytes: bytes.length });
}

function setSchedule(out: ReadFile, file: ScheduleFile) {
  if (out.schedule)
    out.problems.push(
      `More than one schedule file came in (${out.schedule.name} and ${file.name}); Athena used ${out.schedule.name}. Attach only the current schedule.`,
    );
  else out.schedule = file;
}
