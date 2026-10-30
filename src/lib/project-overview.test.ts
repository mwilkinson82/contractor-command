import { describe, expect, it } from "vitest";
import {
  overviewCommunications,
  overviewContract,
  overviewItemAction,
  overviewPayments,
} from "./project-overview";

const job = "job";
const now = new Date("2026-10-30T12:00:00Z");
const invoice = (status = "submitted", net = 90000) => ({
  job_id: job,
  id: "invoice",
  document_number: "TEST-1",
  kind: "invoice",
  credit_for: null,
  versions: [
    {
      version: 1,
      status,
      invoice_date: "2026-09-01",
      effective_date: "2026-09-01",
      source: "synthetic invoice",
      gross_cents: 100000,
      net_due_cents: net,
      withheld_cents: 10000,
      released_cents: 0,
    },
  ],
});
const empty = () => ({
  currency: "USD",
  invoices: [],
  receipts: [],
  allocations: [],
  receipt_reversals: [],
});
const billing = () => ({
  ...empty(),
  invoices: [invoice()],
  receipts: [
    {
      id: "receipt",
      job_id: job,
      receipt_date: "2026-09-02",
      amount_cents: 60000,
      source: "synthetic receipt",
    },
  ],
  receipt_reversals: [
    {
      id: "reverse",
      job_id: job,
      receipt_id: "receipt",
      effective_date: "2026-10-20",
      amount_cents: 10000,
      source: "synthetic correction",
    },
  ],
  allocations: [
    {
      id: "allocation",
      job_id: job,
      receipt_id: "receipt",
      invoice_id: "invoice",
      effective_date: "2026-10-01",
      amount_cents: 40000,
      reversal_of: null,
      source: "synthetic allocation",
    },
  ],
});
const event = (kind = "email_sent") => ({
  id: "event",
  kind,
  title: "Synthetic subject",
  occurred_at: "2026-10-30T09:00:00Z",
  ref_table: null,
  ref_id: null,
  summary: "PRIVATE BODY",
  counterparty_email: "private@example.test",
  payload: { body: "PRIVATE BODY" },
});
const mail = () => ({
  id: "mail",
  job_id: job,
  submittal_id: "submittal",
  kind: "package",
  created_at: "2026-10-29T00:00:00Z",
  approved_at: null as string | null,
  sent_at: null as string | null,
  provider: null as string | null,
  message_id: null as string | null,
  draft: { body: "PRIVATE DRAFT" },
});

describe("overview financial evidence", () => {
  it("uses inception receipts less reversals, keeps allocations separate and uses invoice balance", () => {
    const result = overviewPayments(billing(), job, now);
    const values = Object.fromEntries(result.metrics.map((m) => [m.key, m.cents]));
    expect(values).toEqual({
      receipts: 50000,
      unpaid_invoices: 50000,
      unapplied_receipts: 10000,
      retainage: 10000,
    });
    expect(result.asOf).toBe("2026-10-30");
    expect(result.currency).toBe("USD");
    expect(result.sources.find((s) => s.id === "invoice:invoice")?.version).toBe(1);
  });
  it("preserves unknown with missing opening evidence and distinguishes recorded zero", () => {
    expect(overviewPayments(empty(), job, now).metrics.every((m) => m.cents === null)).toBe(true);
    const data = billing();
    data.receipts[0].amount_cents = 10000;
    data.allocations = [];
    expect(overviewPayments(data, job, now).metrics.find((m) => m.key === "receipts")?.cents).toBe(
      0,
    );
  });
  it("excludes future reversals and draft invoices; refuses mixed jobs/currency", () => {
    const data = billing();
    data.receipt_reversals[0].effective_date = "2026-11-01";
    data.invoices[0] = invoice("draft");
    data.allocations = [];
    const values = overviewPayments(data, job, now).metrics;
    expect(values.find((m) => m.key === "receipts")?.cents).toBe(60000);
    expect(values.find((m) => m.key === "unpaid_invoices")?.cents).toBeNull();
    expect(() => overviewPayments({ ...data, currency: "CAD" }, job, now)).toThrow();
    expect(() => overviewPayments(data, "other-job", now)).toThrow();
  });
  it("keeps setup / executed changes, SOV and IOR provenance distinct", () => {
    const facts = [
      { module: "setup", key: "contract_value", value: 1000 },
      { module: "contract", key: "executed_change_orders", value: -100 },
    ];
    expect(overviewContract(facts, null, { contract_total: 9000 })).toMatchObject({
      amount: 900,
      source: "job setup",
    });
    expect(
      overviewContract(
        [{ module: "sov", key: "1", value: { billable_value: 2500, fee_included: true } }],
        0,
        null,
      ),
    ).toMatchObject({ amount: 2500, source: "SOV" });
    expect(overviewContract([], null, { data: { budget_basis: 4000 } })).toMatchObject({
      amount: 4000,
      source: "IOR",
    });
    expect(overviewContract([], null, null).amount).toBeNull();
    expect(overviewContract([], null, { contract_total: 5000 }).basis).toContain(
      "not independently verified",
    );
    expect(
      overviewContract([{ module: "setup", key: "contract_value", value: 0 }], null, null).amount,
    ).toBe(0);
  });
});

describe("overview communication projection", () => {
  it("never treats the historical email_sent authorization as successful delivery", () => {
    const rows = overviewCommunications({ events: [event()] }, [], job);
    expect(rows[0].status).toBe("Approved · delivery unverified");
    expect(rows[0].basis).toContain("does not prove");
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|private@example/);
    expect(rows[0].sourceId).toBe("event");
    expect(rows[0].page).toBeNull();
  });
  it("distinguishes draft, approved and host receipts without claiming provider confirmation", () => {
    const m = mail();
    expect(overviewCommunications({ events: [] }, [m], job)[0].status).toBe("Draft");
    m.approved_at = "2026-10-30T01:00:00Z";
    expect(overviewCommunications({ events: [] }, [m], job)[0].status).toContain(
      "delivery unverified",
    );
    m.sent_at = "2026-10-30T02:00:00Z";
    m.provider = "test-provider";
    m.message_id = "receipt-id";
    const rows = overviewCommunications(
      { events: [{ ...event("submittal_sent"), ref_table: "mcp_submittal_mail", ref_id: m.id }] },
      [m],
      job,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("Host-reported sent receipt");
    expect(rows[0].basis).toContain("no independent provider");
    expect(JSON.stringify(rows)).not.toContain("PRIVATE DRAFT");
    m.message_id = "";
    expect(overviewCommunications({ events: [] }, [m], job)[0].status).toContain("unverified");
    expect(() => overviewCommunications({ events: [] }, [m], "other-job")).toThrow();
  });
  it("limits to actual supported job records and labels manually entered responses", () => {
    const rows = overviewCommunications(
      { events: [event("rfi_answer"), { ...event("unrelated_audit"), id: "other" }] },
      [],
      job,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("Manually recorded response");
    expect(rows[0].page).toBe("rfis");
    expect(overviewCommunications({ events: [] }, [], job)).toEqual([]);
  });
});

it("routes due dates to their producer and never supplies a mutation or calendar URL", () => {
  for (const [type, page] of [
    ["rfi", "rfis"],
    ["rfc", "rfcs"],
    ["submittal", "submittals"],
    ["cpm", "schedule"],
    ["manual", "items"],
  ]) {
    const action = overviewItemAction({ type });
    expect(action.page).toBe(page);
    expect(Object.keys(action)).toEqual(["page", "label", "guidance"]);
    expect(JSON.stringify(action)).not.toMatch(/https:|calendar|update|rpc/);
  }
});
