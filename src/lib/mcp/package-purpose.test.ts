import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildSubmittalPdf, packageGaps, type PackageContext } from "./submittal-package";
import { packagePurpose, requestContent, type RequestDetails } from "./package-purpose";
type PdfTextDocument = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getTextContent: () => Promise<{ items: ({ str: string } | { type: string })[] }>;
  }>;
  destroy: () => Promise<void>;
};
const parsePdfText = getDocument as unknown as (args: {
  data: Uint8Array;
  useSystemFonts: boolean;
  disableWorker: boolean;
  isEvalSupported: boolean;
}) => { promise: Promise<PdfTextDocument> };

const details: RequestDetails = {
  condition: "Drawing A101 detail 4 conflicts with spec 05 12 00 ¶2.3. Bulletin #4 is referenced.",
  question: "Which connection applies at grid B/3? Please clarify RFI #12.",
  references: [
    { kind: "drawing", citation: "A101 · detail 4 · grid B/3", revision: "2", page: 1 },
    { kind: "spec", citation: "05 12 00 ¶2.3" },
  ],
  recipient_name: "Pat Example",
  recipient_role: "construction_manager",
};

function context(purpose: "rfi" | "rfc"): PackageContext {
  return {
    submittal: {
      id: "request",
      company_id: "company",
      job_id: "job",
      number: `${purpose.toUpperCase()}-001`,
      title: "Connection clarification #12",
      revision: 0,
      spec_section: "",
      submittal_type: "other",
      status: "in_prep",
      ball_in_court: "gc",
      source: "user",
      required: true,
      transmittal_number: 1,
      package_purpose: purpose,
      request_details: details,
    },
    brand: { name: "Fictional Construction" },
    job_number: "2701",
    job_name: "Fictional Job",
    today: "2026-10-25",
    transmittal_number: 18,
    fingerprint: "fixture",
    package: null,
    items: [],
  };
}

describe("RFI/RFC use the existing package engine", () => {
  it("keeps the default purpose and refuses unknown purposes", () => {
    expect(packagePurpose(undefined)).toBe("approval");
    expect(() => packagePurpose("other-model-package")).toThrow("Unknown package purpose");
  });

  it.each(["rfi", "rfc"] as const)(
    "builds a %s question without inventing a spec section or requiring an attachment",
    async (purpose) => {
      const ctx = context(purpose);
      expect(packageGaps(ctx)).toEqual([]);
      const built = await buildSubmittalPdf(ctx, []);
      const loaded = await parsePdfText({
        data: new Uint8Array(built.bytes),
        useSystemFonts: true,
        disableWorker: true,
        isEvalSupported: false,
      }).promise;
      const words: string[] = [];
      for (let i = 1; i <= loaded.numPages; i++) {
        const page = await loaded.getPage(i);
        const text = await page.getTextContent();
        words.push(...text.items.flatMap((item) => ("str" in item ? [item.str] : [])));
      }
      const text = words.join(" ");
      expect(text).toContain("T-18");
      expect(text).toContain("Pat Example");
      expect(text).toContain("construction manager");
      expect(text).toContain("Bulletin #4");
      expect(text).toContain("RFI #12");
      expect(text).toContain("A101");
      expect(text).toContain("05 12 00 ¶2.3");
      expect(text).not.toContain("Required by spec section");
      await loaded.destroy();
    },
  );

  it("keeps an attached marked-up drawing behind the request, without changing the source", async () => {
    const original = await PDFDocument.create();
    const font = await original.embedFont(StandardFonts.Helvetica);
    original.addPage().drawText("A101 markup · original bytes", { font });
    const bytes = await original.save();
    const before = new Uint8Array(bytes);
    const ctx = context("rfi");
    const item = {
      id: "piece",
      kind: "shop_drawing" as const,
      source_party: "Fictional Architect",
      status: "received" as const,
      required: true,
      file_ref: "athena-submittals/company/job/pieces/id/A101.pdf",
    };
    ctx.items = [item];
    const built = await buildSubmittalPdf(ctx, [{ item, name: "A101.pdf", bytes }]);
    expect(built.pageCount).toBe(built.coverPages + 1);
    expect(built.manifest[0].pages).toBe(1);
    expect(bytes).toEqual(before);
  });

  it("requires the actual condition, question and citation before a request can build", () => {
    const ctx = context("rfi");
    ctx.submittal.request_details = { condition: "", question: "", references: [] };
    expect(packageGaps(ctx)).toEqual([
      "The condition that needs clarification",
      "The exact question",
      "A drawing, specification, contract or condition reference",
    ]);
    expect(requestContent(details)[1].lines[0]).toBe(details.question);
  });
});
