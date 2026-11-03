import { jsPDF } from "jspdf";
import type { BidBreakdown } from "./estimating-bid";
import { canonicalBidCsv } from "./estimating-bid-csv";
import { zipStored } from "./estimating-sheet";
import { validBidProvenance, type BidProvenance } from "./estimating-bid-provenance";

type Row = { label: string; detail: string; cents: number; total?: boolean };
type Input = {
  job: string;
  version: number | string;
  ready: boolean;
  breakdown: BidBreakdown | null;
  provenance?: BidProvenance;
};

const amount = (cents: number) => {
  const digits = String(cents).padStart(3, "0");
  return `$${digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${digits.slice(-2)}`;
};
const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const enc = (s: string) => new TextEncoder().encode(s);

/** Exact stored amounts are output, not recalculated by the workbook or PDF.
 * A version identifies the snapshot used; it does not assert it remains current. */
function buildBidFiles(input: Input, requested: "pdf" | "xlsx" | "both") {
  const csv = canonicalBidCsv(input);
  const b = input.breakdown;
  if (!csv || !b) return null;
  if (input.provenance && !validBidProvenance(input.provenance, b)) return null;
  const rows: Row[] = [
    ...b.direct.map((r) => ({
      label: r.ref,
      detail:
        r.basis === "quote"
          ? `Selected quote ${r.quoteId}${input.provenance ? `: ${input.provenance.selectedQuotes.find((q) => q.quoteId === r.quoteId)?.sub}` : ""}`
          : "Direct labor and material",
      cents: r.amountCents,
    })),
    {
      label: "Direct and selected subcontract cost",
      detail: "Subtotal",
      cents: b.directCents,
      total: true,
    },
    ...b.generalConditions.map((r) => ({
      label: r.ref ? `${r.label} (${r.ref})` : r.label,
      detail: "General conditions",
      cents: r.amountCents,
    })),
    {
      label: "General conditions",
      detail: "Subtotal",
      cents: b.generalConditionsCents,
      total: true,
    },
    ...b.requirements.map((r) => ({
      label: `${r.label} (${r.ref})`,
      detail: "Requirement",
      cents: r.amountCents,
    })),
    { label: "Requirements", detail: "Subtotal", cents: b.requirementsCents, total: true },
    { label: "Overhead", detail: "Markup", cents: b.overheadCents },
    { label: "Profit", detail: "Markup", cents: b.profitCents },
    { label: "Bid total", detail: "Total", cents: b.totalCents, total: true },
  ];
  // Excel numeric cells retain at most 15 significant decimal digits. Reject
  // higher amounts rather than generate a workbook that may change cents.
  if (rows.some((r) => r.cents > 999_999_999_999_999)) return null;
  const provenanceLines = input.provenance
    ? [
        `Company ID: ${input.provenance.companyId}`,
        `Job ID: ${input.provenance.jobId}`,
        `Source SHA-256 (schema 1): ${input.provenance.sourceSha256}`,
      ]
    : [];
  // Helvetica's WinAnsi repertoire includes the punctuation used by Athena's
  // real job labels. Unrepresentable PDF text remains an explicit failure;
  // XLSX uses Unicode inline strings and does not inherit that restriction.
  const pdfText = (s: string) =>
    s.length <= 512 &&
    /^[\x20-\x7e\xa0-\xff\u20ac\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u2122\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc]*$/.test(
      s,
    );
  const strings = [input.job, ...provenanceLines, ...rows.flatMap((r) => [r.label, r.detail])];
  const invalidText = (s: string) =>
    s.length > 512 ||
    Array.from(s).some((char) => {
      const code = char.codePointAt(0)!;
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        code === 0xfffe ||
        code === 0xffff
      );
    });
  if (strings.some(invalidText)) return null;
  let pdf = new Uint8Array();
  if (requested !== "xlsx") {
    if (!strings.every(pdfText)) return null;
    const doc = new jsPDF({ unit: "pt", format: "letter", compress: false });
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = 54;
    const header = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.text("Bid summary", 42, 42);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const headerLines = doc.splitTextToSize(
        `${input.job} | Estimate version ${input.version}`,
        520,
      ) as string[];
      doc.text(headerLines, 42, 58);
      y = 58 + headerLines.length * 11;
      doc.setFontSize(7);
      for (const line of provenanceLines) {
        const parts = doc.splitTextToSize(line, 520) as string[];
        doc.text(parts, 42, y);
        y += parts.length * 9;
      }
      y += 19;
      doc.setDrawColor(160);
      doc.line(42, y - 10, 570, y - 10);
    };
    header();
    for (const row of rows) {
      doc.setFont("helvetica", row.total ? "bold" : "normal");
      doc.setFontSize(10);
      const text = doc.splitTextToSize(`${row.label} - ${row.detail}`, 390) as string[];
      const h = Math.max(18, text.length * 12 + 6);
      if (y + h > pageHeight - 45) {
        doc.addPage();
        header();
      }
      doc.setFont("helvetica", row.total ? "bold" : "normal");
      doc.setFontSize(10);
      doc.text(text, 42, y);
      doc.text(amount(row.cents), 570, y, { align: "right" });
      y += h;
    }
    for (let page = 1; page <= doc.getNumberOfPages(); page++) {
      doc.setPage(page);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Page ${page} of ${doc.getNumberOfPages()}`, 570, pageHeight - 20, {
        align: "right",
      });
    }
    pdf = new Uint8Array(doc.output("arraybuffer"));
  }
  const cells = (items: (string | number)[], n: number) => {
    const lines = Math.max(
      1,
      ...items.map((item) => (typeof item === "string" ? Math.ceil(item.length / 25) : 1)),
    );
    return `<row r="${n}" ht="${lines * 15}" customHeight="1">${items
      .map((item, i) => {
        const ref = `${String.fromCharCode(65 + i)}${n}`;
        return typeof item === "number"
          ? `<c r="${ref}" s="1"><v>${item}</v></c>`
          : `<c r="${ref}" s="2" t="inlineStr"><is><t xml:space="preserve">${xml(item)}</t></is></c>`;
      })
      .join("")}</row>`;
  };
  const prefixRows = [
    cells(["Bid summary", input.job, `Estimate version ${input.version}`], 1),
    ...provenanceLines.map((line, i) => cells([line], i + 2)),
  ];
  const sheetRows = [
    ...prefixRows,
    cells(["Scope or cost", "Basis", "Amount (USD)"], prefixRows.length + 1),
    ...rows.map((r, i) => cells([r.label, r.detail, r.cents / 100], i + prefixRows.length + 2)),
  ].join("");
  const files = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bid summary" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      "xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
    [
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="45" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/><col min="3" max="3" width="22" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`,
    ],
  ].map(([name, data]) => ({ name, data: enc(data) }));
  return { csv, pdf, xlsx: zipStored(files) };
}

export function canonicalBidFiles(input: Input) {
  return buildBidFiles(input, "both");
}

export function canonicalBidExport(
  input: Input & { provenance: BidProvenance },
  format: "pdf" | "xlsx",
) {
  const result = buildBidFiles(input, format);
  return result ? { csv: result.csv, bytes: result[format] } : null;
}
