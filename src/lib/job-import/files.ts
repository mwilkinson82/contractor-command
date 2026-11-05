// One attached file -> what the import reads: a workbook's sheets, a ZIP of
// several exports (Procore's Project Archive, or the member's own downloads),
// a P6 .xer or MS Project XML schedule, or a single CSV. Each sheet's kind is
// worked out later from its columns; nothing here guesses what a file is from
// its name alone.
import { isMspdi, isXer } from "./schedule-files";
import type { Sheet } from "./spreadsheet";
import { isXlsx, isZip, readXlsx, toCsv, unzip } from "./xlsx";

export type ScheduleFile = { kind: "xer" | "mspdi"; text: string; name: string };
export type ReadFile = {
  sheets: Sheet[];
  schedule: ScheduleFile | null;
  /** An Overwatch job export found in the bundle. */
  overwatch: string | null;
  /** Files the import doesn't read (PDFs, photos, drawings): name and size. */
  other: { name: string; bytes: number }[];
  problems: string[];
};

const decode = (bytes: Uint8Array): string => {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
};

const base = (name: string) => name.split("/").pop() || name;
const ext = (name: string) => (base(name).match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
const TEXT_TABLE = new Set(["csv", "tsv", "txt", ""]);

export async function readImportFile(bytes: Uint8Array, name = "export"): Promise<ReadFile> {
  const out: ReadFile = { sheets: [], schedule: null, overwatch: null, other: [], problems: [] };
  await readOne(out, bytes, name, 0);
  return out;
}

async function readOne(out: ReadFile, bytes: Uint8Array, name: string, depth: number) {
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
    for (const e of entries) await readOne(out, e.bytes, e.name, depth + 1);
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
      "docx",
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
