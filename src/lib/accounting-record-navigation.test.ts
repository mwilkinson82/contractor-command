import { describe, expect, it, vi } from "vitest";
import {
  accountingContextDates,
  accountingRecordUrl,
  accountingReportUrl,
  accountingTargetFromSearch,
  accountingModeLocation,
  billingRecordLinks,
  costRecordLinks,
  ledgerRecordUrl,
} from "./accounting-record-target";
import { boardSignInReturn } from "./board-sign-in";
import { readAccountingRecord } from "./accounting-record-read";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = id(1),
  invoice = id(2),
  receipt = id(3),
  allocation = id(4),
  credit = id(5),
  payable = id(6),
  payment = id(7),
  original = id(8);
const version = (version: number, amount = 50000) => ({
  version,
  status: "submitted",
  invoice_date: "2026-10-01",
  effective_date: "2026-10-01",
  source: "Synthetic source",
  gross_cents: amount,
  net_due_cents: amount,
  withheld_cents: 0,
  released_cents: 0,
});
const ledger = () => ({
  currency: "USD",
  invoices: [
    {
      id: invoice,
      job_id: job,
      document_number: "SYN-I01",
      kind: "invoice",
      credit_for: null,
      versions: [version(5, 60000), version(4)],
    },
    {
      id: credit,
      job_id: job,
      document_number: "SYN-C01",
      kind: "credit",
      credit_for: invoice,
      versions: [{ ...version(1, 1000), status: "posted" }],
    },
  ],
  receipts: [
    {
      id: receipt,
      job_id: job,
      source: "SYN-R01",
      receipt_date: "2026-10-02",
      amount_cents: 10000,
    },
  ],
  allocations: [
    {
      id: allocation,
      job_id: job,
      receipt_id: receipt,
      invoice_id: invoice,
      effective_date: "2026-10-02",
      amount_cents: 5000,
      reversal_of: null,
      source: "Synthetic allocation",
    },
  ],
  receipt_reversals: [],
});
const bill = () => ({
  id: payable,
  kind: "supplier_bill",
  versions: [2, 1].map((version) => ({
    version,
    reason: version === 2 ? "Corrected quantity" : null,
    facts: {
      document_reference: "SYN-B01",
      description: "Synthetic materials",
      counterparty_name: "Synthetic Supplier",
      currency_code: "CAD",
      amount_cents: 12345,
      allocations: [{ job_id: job, cost_code: "26", amount_cents: 12345 }],
    },
  })),
  posted_version: 1,
  approved_versions: [1],
  payments: [
    {
      id: payment,
      reference: "SYN-P01",
      amount_cents: 1000,
      paid_on: "2026-10-03",
      corrected: true,
      correction: { reason: "Corrected evidence" },
    },
  ],
});
function io(overrides: Record<string, unknown> = {}) {
  return {
    rpc: vi.fn(async (name: string, _args: Record<string, unknown>) => ({
      error: null,
      data:
        (
          {
            mcp_billing_evidence_get: ledger(),
            mcp_billing_documents_get: {
              documents: [{ id: original, filename: "synthetic-v4.pdf" }],
              links: [
                {
                  document_id: original,
                  invoice_id: invoice,
                  invoice_version: 4,
                  receipt_id: null,
                },
              ],
            },
            mcp_cost_submission_read: { records: [bill()] },
            mcp_ap_original_list: {
              originals: [{ id: original, filename: "supplier-v1.pdf", version: 1 }],
            },
            ...overrides,
          } as Record<string, unknown>
        )[name] ?? null,
    })),
  };
}
describe("validated accounting navigation", () => {
  it.each(["invoice", "credit", "receipt", "allocation", "payable"] as const)(
    "round-trips %s identity and report dates through the sign-in return URL",
    (kind) => {
      const target = {
        kind,
        id: invoice,
        ...(["invoice", "credit", "payable"].includes(kind) ? { version: 4 } : {}),
      };
      const url = new URL(
        accountingRecordUrl(job, target, { as_of: "2026-10-31", from: "2026-10-01" }),
      );
      expect(accountingTargetFromSearch(Object.fromEntries(url.searchParams))).toEqual(target);
      expect(url.pathname).toBe(`/r/job/${job}/accounting`);
      expect(url.searchParams.get("as_of")).toBe("2026-10-31");
      expect(boardSignInReturn(url.pathname + url.search)).toBe(url.pathname + url.search);
    },
  );
  it.each([
    { record_id: invoice },
    { record_kind: "invoice" },
    { record_kind: "invoice", record_id: "bad" },
    { record_kind: "receipt", record_id: receipt, version: "1" },
    { record_kind: "payment", record_id: payment },
    { record_kind: "invoice", record_id: invoice, version: "1e2" },
    { record_kind: "invoice", record_id: invoice, version: "0" },
  ])("rejects malformed/incomplete targets rather than opening the general list: %j", (search) =>
    expect(() => accountingTargetFromSearch(search)).toThrow(),
  );
  it("keeps payment and payable identities distinct", () => {
    const url = new URL(
      accountingRecordUrl(job, { kind: "payment", id: payment, payableId: payable }),
    );
    expect(accountingTargetFromSearch(Object.fromEntries(url.searchParams))).toEqual({
      kind: "payment",
      id: payment,
      payableId: payable,
    });
  });
  it("opens statement mode without an evidence fragment, preserving report dates on mode changes", () => {
    expect(new URL(accountingReportUrl(job, "statement")).searchParams.get("report_type")).toBe(
      "statement",
    );
    const next = accountingModeLocation(
      `https://app.meetathena.io/r/job/${job}/accounting?ledger_page=9&as_of=2026-10-31&currency=CAD#invoice:old`,
      "statement",
    );
    expect(next).toBe(`/r/job/${job}/accounting?as_of=2026-10-31&report_type=statement`);
  });
  it("emits exact versions and payment anchors from scoped reads, retaining duplicate human references", () => {
    const links = billingRecordLinks(job, ledger());
    expect(links.filter((l) => l.target.id === invoice).map((l) => l.target.version)).toEqual([
      5, 4,
    ]);
    expect(links.some((l) => l.target.kind === "credit")).toBe(true);
    expect(links.some((l) => l.target.kind === "receipt")).toBe(true);
    expect(links.some((l) => l.target.kind === "allocation")).toBe(true);
    expect(
      costRecordLinks(job, [bill()]).some(
        (l) => l.target.id === payment && l.target.payableId === payable,
      ),
    ).toBe(true);
    expect(
      ledgerRecordUrl(job, { id: `invoice:${invoice}`, kind: "billed", version: 4 }),
    ).toContain("version=4");
    expect(ledgerRecordUrl(job, { id: "invoice:invalid", kind: "billed", version: 4 })).toBeNull();
  });
});
describe("selected financial record reads", () => {
  it("selects v4 even when v5 is current and includes only v4 originals", async () => {
    const source = io();
    const detail = await readAccountingRecord(source, job, {
      kind: "invoice",
      id: invoice,
      version: 4,
    });
    expect(detail.title).toBe("SYN-I01 · v4");
    expect(detail.subtitle).toContain("historical version; current is v5");
    expect(detail.facts).toContainEqual(["net due", "USD 500.00"]);
    expect(detail.originals.map((d) => d.filename)).toEqual(["synthetic-v4.pdf"]);
    expect(detail.related.some((l) => l.target.id === credit)).toBe(true);
    expect(
      source.rpc.mock.calls.every(([, args]) => (args as Record<string, unknown>)._job === job),
    ).toBe(true);
  });
  it.each([
    { kind: "invoice", id: invoice, version: 99 },
    { kind: "invoice", id: id(99) },
    { kind: "credit", id: invoice },
    { kind: "receipt", id: id(99) },
    { kind: "allocation", id: id(99) },
  ] as const)("does not substitute another record for %j", async (target) => {
    await expect(readAccountingRecord(io(), job, target)).rejects.toThrow(/exact record/);
  });
  it("does not consume rows from the wrong project even if returned by a faulty source", async () => {
    const data = ledger();
    data.invoices[0].job_id = id(99);
    await expect(
      readAccountingRecord(io({ mcp_billing_evidence_get: data }), job, {
        kind: "invoice",
        id: invoice,
      }),
    ).rejects.toThrow(/exact record/);
  });
  it("keeps receipt and allocation identities related without changing amounts", async () => {
    const detail = await readAccountingRecord(io(), job, { kind: "receipt", id: receipt });
    expect(detail.title).toBe("SYN-R01");
    expect(detail.facts).toContainEqual(["Currently unapplied", "$50.00"]);
    expect(detail.related.some((l) => l.target.id === allocation)).toBe(true);
    const allocated = await readAccountingRecord(io(), job, { kind: "allocation", id: allocation });
    expect(allocated.related.map((l) => l.target.id)).toEqual([invoice, receipt]);
  });
  it("preserves requested supplier version, posted version and exact original scope", async () => {
    const source = io();
    const detail = await readAccountingRecord(source, job, {
      kind: "payable",
      id: payable,
      version: 1,
    });
    expect(detail.title).toBe("SYN-B01 · v1");
    expect(detail.subtitle).toContain("current v2; posted v1");
    expect(detail.facts).toContainEqual(["amount", "CAD 123.45"]);
    expect(source.rpc).toHaveBeenCalledWith("mcp_ap_original_list", {
      _job: job,
      _record: payable,
      _version: 1,
    });
    expect(detail.related[0].target).toEqual({ kind: "payment", id: payment, payableId: payable });
    await expect(
      readAccountingRecord(source, job, { kind: "payable", id: payable, version: 8 }),
    ).rejects.toThrow(/exact record/);
  });
  it("does not claim missing originals after an original-read denial", async () => {
    const detail = await readAccountingRecord(io({ mcp_ap_original_list: null }), job, {
      kind: "payable",
      id: payable,
      version: 1,
    });
    expect(detail.originals).toEqual([]);
    expect(detail.originalsNote).toContain("access level");
  });
  it("reads recorded payment history using only the existing read step and immutable identities", async () => {
    const source = io({
      mcp_cost_payment_correction: {
        state: {
          payment: {
            id: payment,
            reference: "SYN-P01",
            paid_on: "2026-10-03",
            amount_cents: "1000",
          },
          records: [
            {
              record_id: payable,
              job_id: job,
              document_reference: "SYN-B01",
              description: "Materials",
              current_version: 2,
              posted_version: 1,
              currency_code: "CAD",
              original_amount_cents: "1000",
            },
          ],
          correction: { reason: "Corrected source" },
        },
        history: [{ reason: "Corrected source" }],
      },
    });
    const detail = await readAccountingRecord(source, job, {
      kind: "payment",
      id: payment,
      payableId: payable,
    });
    expect(detail.title).toContain("SYN-P01");
    expect(detail.subtitle).toContain("corrected");
    expect(source.rpc).toHaveBeenCalledExactlyOnceWith("mcp_cost_payment_correction", {
      _job: job,
      _step: "read",
      _p: { id: payable, payment_id: payment },
      _review: null,
      _confirmed: false,
    });
    expect(detail.related[0].target.version).toBe(2);
  });
  it.each(["invoice", "payable", "payment"] as const)(
    "fails closed on access/membership/source denial for %s without financial write calls",
    async (kind) => {
      const source = { rpc: vi.fn(async () => ({ data: null, error: { message: "denied" } })) };
      await expect(
        readAccountingRecord(source, job, {
          kind,
          id: invoice,
          ...(kind === "payment" ? { payableId: payable } : {}),
        }),
      ).rejects.toThrow(/exact record/);
      expect(source.rpc).toHaveBeenCalledOnce();
    },
  );
});

it("does not crash into a generic report when selected-link dates are malformed or reversed", () => {
  expect(() => accountingContextDates({ as_of: "not-a-date" })).toThrow();
  expect(() => accountingContextDates({ from: "2026-10-31", as_of: "2026-10-01" })).toThrow();
});
