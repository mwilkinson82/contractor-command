import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalBidFiles } from "./estimating-bid-files";
import type { BidBreakdown } from "./estimating-bid";
const source = readFileSync(new URL("./cards/takeoff-client.js", import.meta.url), "utf8");
const validator = source.slice(source.indexOf("  async function validateLocalExport("), source.indexOf("  function addPreparedDownload("));
const validate = runInNewContext(`${validator}; validateLocalExport`, { Blob, Uint8Array, TextDecoder, crypto: webcrypto, atob, btoa });
const breakdown: BidBreakdown = { direct: [{ ref: "T-1", basis: "direct", quoteId: null, amountCents: 10000 }], directCents: 10000,
  generalConditions: [], requirements: [], generalConditionsCents: 0, requirementsCents: 0, overheadCents: 0, profitCents: 0, totalCents: 10000 };
const expected = { company_id: "company", job_id: "job", snapshot_version: 7, source_sha256: "a".repeat(64) };
async function fixture(format: "pdf" | "xlsx") {
  const files = canonicalBidFiles({ job: "Synthetic", version: 7, ready: true, breakdown });
  if (!files) throw Error("fixture generation failed");
  const bytes = files[format];
  return { delivery: "local", filename: `Bid-summary-v7.${format}`, mime_type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: bytes.length, content_base64: Buffer.from(bytes).toString("base64"), sha256: Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex"), ...expected };
}
describe("local download browser payload validation", () => {
  it.each(["pdf", "xlsx"] as const)("prepares real %s Blob bytes with matching MIME and filename", async (format) => {
    const input = await fixture(format), result = await validate(input, expected);
    expect(result.blob.type).toBe(input.mime_type); expect(result.filename).toBe(input.filename);
    expect(Buffer.from(await result.blob.arrayBuffer()).toString("base64")).toBe(input.content_base64);
  });
  it.each([
    { filename: "../bid.pdf" }, { filename: "Bid-summary-v7.pdf\r\nX: bad" }, { mime_type: "text/html" },
    { size: 0 }, { size: 10485761 }, { content_base64: "!!!!" }, { sha256: "b".repeat(64) },
    { snapshot_version: 6 }, { source_sha256: "b".repeat(64) }, { company_id: "other" }, { job_id: "other" },
  ])("rejects invalid response %j", async (change) => {
    await expect(validate({ ...await fixture("pdf"), ...change }, expected)).rejects.toThrow();
  });
  it("rejects non-PDF bytes even with a matching digest", async () => {
    const bytes = new TextEncoder().encode("not a pdf");
    const file = { ...await fixture("pdf"), size: bytes.length, content_base64: Buffer.from(bytes).toString("base64"),
      sha256: Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex") };
    await expect(validate(file, expected)).rejects.toThrow(/content/);
  });
  it("rejects workbook formula elements even with matching digest", async () => {
    const original = await fixture("xlsx"), bytes = Buffer.concat([Buffer.from(original.content_base64, "base64"), Buffer.from("<f>HYPERLINK()</f>")]);
    await expect(validate({ ...original, size: bytes.length, content_base64: bytes.toString("base64"),
      sha256: Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex") }, expected)).rejects.toThrow(/content/);
  });
});