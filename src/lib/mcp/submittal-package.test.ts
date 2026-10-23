import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { createHash } from "node:crypto";
import {
  buildSubmittalPdf,
  packageGaps,
  storedPiece,
  type PackageContext,
} from "./submittal-package";
const ctx: PackageContext = {
  submittal: {
    id: "s",
    number: "26-001",
    revision: 0,
    transmittal_number: 1,
    spec_section: "26 24 16",
    title: "Switchgear",
    submittal_type: "product_data",
    status: "in_prep",
    ball_in_court: "gc",
    source: "user",
    required: true,
    company_id: "company",
    job_id: "job",
  },
  items: [
    {
      id: "p",
      kind: "product_cut",
      source_party: "Test Manufacturer",
      status: "received",
      required: true,
      file_ref: "athena-submittals/company/job/pieces/one/cuts.pdf",
    },
  ],
  brand: {
    name: "Fictional Construction",
    contact_phone: "555-0100",
    website: "https://example.com",
  },
  job_number: "2701",
  job_name: "Test Job",
  today: "2026-10-23",
  transmittal_number: 14,
  fingerprint: "test",
  package: null,
};
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
describe("submittal package documents", () => {
  it("puts company cover before all original pages and preserves source bytes", async () => {
    const source = await PDFDocument.create();
    const f = await source.embedFont(StandardFonts.Helvetica);
    source.addPage().drawText("Manufacturer ORIGINAL", { font: f });
    source.addPage().drawText("Shop drawing ORIGINAL", { font: f });
    const bytes = await source.save(),
      before = hash(bytes);
    const built = await buildSubmittalPdf(ctx, [{ item: ctx.items[0], name: "cuts.pdf", bytes }]);
    expect(built.coverPages).toBe(1);
    expect(built.pageCount).toBe(3);
    expect(built.manifest[0].pages).toBe(2);
    expect(hash(bytes)).toBe(before);
    const pdf = await PDFDocument.load(built.bytes);
    expect(pdf.getPageCount()).toBe(3);
  });
  it("keeps native documents embedded and identified on the cover", async () => {
    const built = await buildSubmittalPdf(ctx, [
      {
        item: ctx.items[0],
        name: "manufacturer.csv",
        bytes: new TextEncoder().encode("Fictional data,example.com"),
      },
    ]);
    expect(built.manifest[0].embedded).toBe(true);
    const pdf = await PDFDocument.load(built.bytes);
    expect(pdf.catalog.has(PDFName.of("Names"))).toBe(true);
  });
  it("blocks missing files even if someone marked a piece received", async () => {
    const incomplete = { ...ctx, items: [{ ...ctx.items[0], file_ref: null }] };
    expect(packageGaps(incomplete).join()).toContain("stored file needed");
    await expect(buildSubmittalPdf(incomplete, [])).rejects.toThrow("stored file needed");
  });
  it.each(["Needed", "TBD", "Unknown", ""])("requires a real spec section: %s", (spec) => {
    expect(packageGaps({ ...ctx, submittal: { ...ctx.submittal, spec_section: spec } })).toContain(
      "Required spec section",
    );
  });
  it("does not import arbitrary URLs or another job storage", () => {
    expect(storedPiece("athena-files/company/job/id/cuts.pdf", "company", "job").name).toBe(
      "cuts.pdf",
    );
    for (const ref of [
      "https://example.com/cuts.pdf",
      "athena-files/company/other/id/cuts.pdf",
      "athena-files/company/job/../cuts.pdf",
    ])
      expect(() => storedPiece(ref, "company", "job")).toThrow();
  });
  it("rejects corrupt or locked PDF input instead of publishing a partial package", async () => {
    await expect(
      buildSubmittalPdf(ctx, [
        { item: ctx.items[0], name: "bad.pdf", bytes: new Uint8Array([1, 2, 3]) },
      ]),
    ).rejects.toThrow("valid PDF");
  });
});
