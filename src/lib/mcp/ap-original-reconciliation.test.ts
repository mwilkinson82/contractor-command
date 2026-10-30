import { describe, expect, it } from "vitest";
import { reconcileApOriginals } from "./ap-original-reconciliation";
const job = "00000000-0000-4000-8000-000000000001",
  company = "00000000-0000-4000-8000-000000000002",
  record = "00000000-0000-4000-8000-000000000003",
  document = "00000000-0000-4000-8000-000000000004";
const scope = { job_id: job, company_id: company };
const data = {
  snapshot_version: 1,
  complete: true,
  job_id: job,
  company_id: company,
  records: [{ record_id: record, version: 2 }],
  documents: [
    {
      id: document,
      record_id: record,
      version: 1,
      filename: "invoice.pdf",
      size_bytes: 100,
      sha256: "a".repeat(64),
      linked_at: "2026-10-30T00:00:00Z",
    },
  ],
};
describe("supplier-original reconciliation", () => {
  it("does not inherit an older original onto a corrected bill", () => {
    const r = reconcileApOriginals(data, scope);
    expect(r.coverage.state).toBe("checked");
    expect(r.findings[0].message).toContain("version 2");
    expect(
      reconcileApOriginals({ ...data, documents: [{ ...data.documents[0], version: 2 }] }, scope)
        .findings,
    ).toEqual([]);
  });
  it.each([
    null,
    { ...data, complete: false },
    { ...data, company_id: job },
    { ...data, documents: [{ ...data.documents[0], record_id: document }] },
    { ...data, documents: [data.documents[0], data.documents[0]] },
    { ...data, documents: [{ ...data.documents[0], version: 3 }] },
  ])("withholds findings for unavailable or malformed coverage", (raw) => {
    const r = reconcileApOriginals(raw, scope);
    expect(r.coverage.state).toBe("unavailable");
    expect(r.findings).toEqual([]);
  });
});
