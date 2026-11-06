import { describe, expect, it } from "vitest";
import { MAX_IMPORT_DOCUMENTS, readImportFile, routeDocument } from "./files";
import { importJob } from "./model";
import { planImport } from "./plan";
import { readExport } from "../mcp/tools/job-import-tools";
import { zip } from "../../../tests/support/zip";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const col = (i: number) => String.fromCharCode(65 + i);
function xlsx(sheets: Record<string, string[][]>): Uint8Array {
  const names = Object.keys(sheets);
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  };
  names.forEach((n, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheets[
        n
      ]
        .map(
          (row, r) =>
            `<row r="${r + 1}">${row
              .map((v, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)
              .join("")}</row>`,
        )
        .join("")}</sheetData></worksheet>`;
  });
  return zip(files);
}

const XER = [
  "ERMHDR\t19.12\t2026-11-01\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tUSD",
  "%T\tCALENDAR",
  "%F\tclndr_id\tclndr_name\tday_hr_cnt\tclndr_data",
  "%R\t1\tStandard\t8\t(0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|08:00|f|16:00)())))(0||3()((0||0(s|08:00|f|16:00)())))(0||4()((0||0(s|08:00|f|16:00)())))(0||5()((0||0(s|08:00|f|16:00)())))(0||6()((0||0(s|08:00|f|16:00)())))(0||7()()))))",
  "%T\tPROJECT",
  "%F\tproj_id\tproj_short_name\tclndr_id\tlast_recalc_date\tscd_end_date",
  "%R\t10\t9001\t1\t2026-09-07 00:00\t2026-09-30 00:00",
  "%T\tPROJWBS",
  "%F\twbs_id\tproj_id\tparent_wbs_id\tproj_node_flag\tseq_num\twbs_short_name\twbs_name",
  "%R\t100\t10\t\tY\t0\t9001\tFictional Clinic",
  "%R\t101\t10\t100\tN\t1\t1\tRough-In",
  "%T\tTASK",
  "%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tact_start_date\tact_end_date\tearly_start_date\tearly_end_date\ttarget_start_date\ttarget_end_date\tphys_complete_pct\tcomplete_pct_type",
  "%R\t1\t10\t101\t1\tA1000\tRough electrical\tTT_Task\tTK_Active\t40\t16\t2026-09-01 08:00\t\t2026-09-01 08:00\t2026-09-08 16:00\t2026-09-01 08:00\t2026-09-07 16:00\t60\tCP_Phys",
  "%R\t2\t10\t101\t1\tA1010\tRough inspection\tTT_Task\tTK_NotStart\t8\t8\t\t\t2026-09-09 08:00\t2026-09-09 16:00\t2026-09-08 08:00\t2026-09-08 16:00\t0\tCP_Phys",
  "%T\tTASKPRED",
  "%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt",
  "%R\t1\t2\t1\t10\t10\tPR_SS\t16",
  "%E",
].join("\r\n");

describe("one attached file", () => {
  it("reads a ZIP of Procore exports: workbook sheets, CSVs, the P6 file, and lists the rest", async () => {
    const bundle = zip({
      "Fictional Clinic/Budget.csv": `Cost Code,Description,Original Budget Amount,Revised Budget\n26-100,Electrical Rough,"$240,000.00","$248,000.00"`,
      "Fictional Clinic/Owner Invoice 7.xlsx": xlsx({
        G703: [
          [
            "Item No.",
            "Description of Work",
            "Cost Code",
            "Scheduled Value",
            "Total Completed and Stored to Date",
            "Materials Presently Stored",
            "Retainage",
          ],
          ["1", "Electrical Rough", "26-100", "300000", "132000", "12000", "12000"],
        ],
      }),
      "Fictional Clinic/Submittals.xlsx": xlsx({
        Items: [
          ["Spec Section", "#", "Rev.", "Title", "Type", "Status"],
          ["26 05 19", "26-1", "0", "Building wire", "Product Information", "Approved"],
        ],
      }),
      "Fictional Clinic/Schedule/9001.xer": XER,
      "Fictional Clinic/Drawings/E-101.pdf": new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      "__MACOSX/._Budget.csv": "junk",
    });
    const read = await readImportFile(bundle, "Fictional Clinic.zip");
    expect(read.sheets.map((s) => s.name)).toEqual([
      "Budget.csv",
      "Owner Invoice 7.xlsx: G703",
      "Submittals.xlsx: Items",
    ]);
    expect(read.schedule?.kind).toBe("xer");
    expect(read.drawings).toEqual(["Fictional Clinic/Drawings/E-101.pdf"]);
    expect(read.other).toEqual([]);

    const job = readExport({
      source: "procore",
      sheets: read.sheets,
      schedule_file: read.schedule,
      job_name: "Fictional Clinic",
    });
    expect(importJob.parse(job)).toBeTruthy();
    expect(job.job.job_number).toBe("9001");
    expect(job.sov).toEqual([
      expect.objectContaining({
        cost_code: "26-100",
        scheduled_cents: 30_000_000,
        work_to_date_cents: 12_000_000,
        budget_cents: 24_800_000,
      }),
    ]);
    expect(job.submittals.map((s) => s.number)).toEqual(["26-1"]);
    expect(job.schedule.map((a) => a.id)).toEqual(["A1000", "A1010"]);
    expect(job.schedule[1].links).toEqual([{ id: "A1000", type: "SS", lag: 2 }]);
    expect(job.schedule_data_date).toBe("2026-09-07");
    expect(job.schedule_calendar?.work_days).toEqual([1, 2, 3, 4, 5]);
    const plan = planImport(job, { job_exists: false });
    expect(plan.package.schedule).toBeTruthy();
  });

  it("takes a bare CSV and a bare P6 file", async () => {
    const csv = await readImportFile(
      new TextEncoder().encode("RFI #,Subject\n1,Panel"),
      "rfis.csv",
    );
    expect(csv.sheets).toEqual([{ text: "RFI #,Subject\n1,Panel", name: "rfis.csv" }]);
    const xer = await readImportFile(new TextEncoder().encode(XER), "upload");
    expect(xer.schedule?.kind).toBe("xer");
    const job = readExport({ source: "procore", export_text: XER });
    expect(job.schedule).toHaveLength(2);
  });

  it("asks for Project's XML instead of a .mpp file", async () => {
    const read = await readImportFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "Schedule.mpp");
    expect(read.problems[0]).toMatch(/Save As > XML/);
  });
});

const PDF = (n = 0) => new TextEncoder().encode(`%PDF-1.7 fictional ${n}`);
// A minimal Word file: a ZIP with word/document.xml.
const DOCX = zip({ "word/document.xml": "<w:document><w:t>Section 26 05 19</w:t></w:document>" });

describe("the job's contract and spec files in an export", () => {
  it("routes by path and name, and leaves out subs' contracts, COs, POs, invoices and waivers", () => {
    const cases: [string, ReturnType<typeof routeDocument>][] = [
      ["Fictional Clinic/Prime Contracts/Executed.pdf", "contract"],
      ["Owner Contract.pdf", "contract"],
      ["Docs/Contract Agreement.docx", "contract"],
      ["Docs/AIA A101 2017.pdf", "contract"],
      ["Docs/AIA_A401.pdf", "contract"],
      ["Docs/Client Agreement.pdf", "contract"],
      ["Specifications/Division 26.pdf", "spec"],
      ["Docs/Project Manual Vol 1.pdf", "spec"],
      ["Docs/Spec Book.docx", "spec"],
      ["Docs/26 05 19 Low-Voltage Wire.pdf", "spec"],
      ["Docs/260519.pdf", "spec"],
      ["Drawings/Power Plan.pdf", "drawing"],
      ["Sheets/E-101 Power Plan.pdf", "drawing"],
      ["A2.01.pdf", "drawing"],
      ["Docs/A101.pdf", "drawing"],
      ["Commitments/ABC Electric Agreement.pdf", null],
      ["Prime Contracts/Change Orders/CO 3 Agreement.pdf", null],
      ["Docs/Subcontract Agreement.pdf", null],
      ["Docs/Purchase Order 12 Agreement.pdf", null],
      ["Docs/PO-12 Specifications.pdf", null],
      ["Docs/Invoice 7 Agreement.pdf", null],
      ["Docs/Lien Waiver Agreement.pdf", null],
      ["Docs/Prime Contract.png", null],
      ["Docs/Prime Contract.doc", null],
      ["Photos/2026-01-15 site.pdf", null],
      ["Docs/Meeting minutes.pdf", null],
    ];
    for (const [path, want] of cases) expect([path, routeDocument(path)]).toEqual([path, want]);
  });

  it("keeps the contract and spec bytes, one contract per job, and lists the rest", async () => {
    const bundle = zip({
      "Job/Prime Contracts/Exhibit list.pdf": PDF(1),
      "Job/Prime Contracts/Prime Contract.pdf": PDF(2),
      "Job/Specifications/26 05 19 Wire.docx": DOCX,
      "Job/Project Manual.pdf": PDF(3),
      "Job/Commitments/ABC Electric Subcontract.pdf": PDF(4),
      "Job/Drawings/E-101.pdf": PDF(5),
      "Job/Photos/site.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
    });
    const read = await readImportFile(bundle, "Job.zip");
    expect(read.documents.map((d) => [d.kind, d.name])).toEqual([
      ["contract", "Job/Prime Contracts/Prime Contract.pdf"],
      ["spec", "Job/Specifications/26 05 19 Wire.docx"],
      ["spec", "Job/Project Manual.pdf"],
    ]);
    expect(read.documents[0].bytes).toEqual(PDF(2));
    expect(read.drawings).toEqual(["Job/Drawings/E-101.pdf"]);
    expect(read.other).toEqual([
      { name: "Job/Commitments/ABC Electric Subcontract.pdf", bytes: PDF(4).length },
      { name: "Job/Photos/site.jpg", bytes: 3 },
      {
        name: "Job/Prime Contracts/Exhibit list.pdf",
        bytes: PDF(1).length,
        note: "Athena keeps one contract per job",
      },
    ]);
  });

  it("stores at most ten documents from one export and lists the rest with a note", async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 12; i++) files[`Specifications/Section ${i}.pdf`] = PDF(i);
    const read = await readImportFile(zip(files), "Specs.zip");
    expect(read.documents).toHaveLength(MAX_IMPORT_DOCUMENTS);
    expect(read.other.map((o) => [o.name, o.note])).toEqual([
      ["Specifications/Section 11.pdf", "over the 10-document limit for one import"],
      ["Specifications/Section 12.pdf", "over the 10-document limit for one import"],
    ]);
  });

  it("routes a single attached contract PDF the same way", async () => {
    const read = await readImportFile(PDF(), "Owner Contract.pdf");
    expect(read.documents.map((d) => d.kind)).toEqual(["contract"]);
  });
});

describe("Overwatch export with its documents", () => {
  it("reads the job file and saves the contract and specs from Overwatch's folders", async () => {
    const json = JSON.stringify({ format: "overwatch.job_export", format_version: 2, project: {} });
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const read = await readImportFile(
      zip({
        "overwatch-job-2717-for-athena.json": json,
        "Prime Contracts/Signed_Final_v3.pdf": pdf,
        "Prime Contracts/Exhibit B.pdf": pdf,
        "Specifications/Spec Book Vol 1.pdf": pdf,
      }),
      "overwatch-job-2717-for-athena.zip",
    );
    expect(read.overwatch).toBe(json);
    expect(read.documents.map((d) => [d.name, d.kind])).toEqual([
      ["Prime Contracts/Signed_Final_v3.pdf", "contract"],
      ["Specifications/Spec Book Vol 1.pdf", "spec"],
    ]);
    expect(read.other.map((o) => o.name)).toEqual(["Prime Contracts/Exhibit B.pdf"]);
  });
});
