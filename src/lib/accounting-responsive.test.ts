import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const state = vi.hoisted(() => ({ queries: {} as Record<string, unknown>, rpc: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "synthetic" } }, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: state.queries[queryKey[0]],
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/athena/BoardSignIn", () => ({ BoardSignIn: () => null }));
import { PurchaseOrdersPage } from "@/components/athena/PurchaseOrdersPage";
import { OrderLines, PurchaseOrderComparison, PurchaseOrderDetails } from "@/components/athena/PurchaseOrderDetails";
import { PurchaseOrderRevision } from "@/components/athena/PurchaseOrderRevision";
import { AccountingReports } from "@/components/athena/AccountingReports";
import { AccountingReportView } from "@/components/athena/AccountingReportPage";
import { AccountingRecordView } from "@/components/athena/AccountingRecordPage";
import { AccountingWorkspace } from "@/components/athena/AccountingWorkspace";
import { BillingEvidencePage } from "@/components/athena/BillingEvidencePage";
import { buildAccountingReport } from "./accounting-report";
import type { PurchaseOrderLedger } from "./purchase-order-workspace";
import type { RecordDetail } from "./accounting-record-read";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = id(1),
  invoice = id(2),
  receipt = id(3),
  partyId = id(4),
  termsId = id(5);
const long = "Synthetic reference " + "REFERENCE".repeat(16);
const ledger: PurchaseOrderLedger = {
  default_terms_id: termsId,
  parties: [
    {
      id: partyId,
      name: long,
      trade: "Materials and equipment",
      contact_name: "Synthetic contact",
      contact_email: "synthetic-long-contact-name-for-layout-testing@example.invalid",
      contact_phone: null,
      contract_reference: long,
      insurance_reference: null,
      version: 1,
    },
  ],
  terms: [
    {
      id: termsId,
      title: "Reviewed company terms",
      body: long,
      scope: "company",
      state: "approved",
      parent_id: null,
      source: "Synthetic fixture",
      change_note: null,
    },
  ],
  orders: [
    {
      id: id(6),
      number: "SYN-PO-001",
      party_id: partyId,
      versions: [2, 1].map((version) => ({
        version,
        status: "draft",
        terms_id: termsId,
        party_snapshot: { name: long },
        order_date: "2026-10-01",
        needed_by: "2026-11-02",
        reason: long,
        lines: [
          {
            description: "Conduit materials for the long synthetic distribution run",
            quantity: 1234567.5,
            unit: "linear feet",
            unit_price_cents: 100,
          },
          { description: long, quantity: 200, unit: "EA", unit_price_cents: 2200 },
        ],
      })),
    },
  ],
} as PurchaseOrderLedger;
const billing = {
  currency: "USD" as const,
  invoices: [
    {
      job_id: job,
      id: invoice,
      document_number: "SYN-INVOICE-001",
      kind: "invoice" as const,
      credit_for: null,
      versions: [
        {
          version: 4,
          status: "certified" as const,
          invoice_date: "2026-10-01",
          effective_date: "2026-10-01",
          source: long,
          gross_cents: 9000000000000,
          net_due_cents: 9000000000000,
          withheld_cents: 0,
          released_cents: 0,
        },
      ],
    },
  ],
  receipts: [
    {
      job_id: job,
      id: receipt,
      receipt_date: "2026-10-02",
      source: "SYN-RECEIPT-001",
      amount_cents: 10000,
    },
  ],
  allocations: [],
  receipt_reversals: [],
  recorded_contract: {
    original_cents: 9000000000000,
    recorded_change_cents: null,
    approved_cents: null,
  },
};
const report = buildAccountingReport(
  {
    jobId: job,
    capturedAt: "2026-11-01T00:00:00Z",
    billing,
    budgets: [],
    costs: { available: false, reason: long },
    orders: { available: false, reason: "Unknown" },
  },
  { asOf: "2026-10-31" },
);
report.ap = {
  basis: "Synthetic reviewed-currency evidence",
  limitations: ["Net AP unknown"],
  hasUnknown: true,
  rows: [
    {
      id: `ap:${id(9)}:2:0`,
      recordId: id(9),
      version: 2,
      currency: "CAD",
      costCode: "26.01",
      effectiveOn: "2026-10-01",
      incurredOn: "2026-10-01",
      amountCents: "9000000000000",
      inPeriod: true,
      source: long,
      counterparty: long,
      reference: "SYN-BILL-001",
    },
  ],
  groups: [
    {
      currency: "CAD",
      postedCents: "9000000000000",
      knownSubtotalCents: "9000000000000",
      selectedPeriodCents: "9000000000000",
      unpaidCents: null,
      unknownRows: 0,
    },
  ],
  costCodes: [{ currency: "CAD", code: "26.01", postedCents: "9000000000000" }],
};
const detail: RecordDetail = {
  title: "Synthetic invoice · v4",
  subtitle: "Current selected version",
  facts: [
    ["Net due", "USD 90,000,000,000.00"],
    ["Source", long],
  ],
  history: [{ label: "Version 3", facts: [["Source", long]] }],
  originals: [{ id: id(8), filename: "synthetic-" + "original".repeat(14) + ".pdf", version: 4 }],
  originalsNote: "",
  related: [
    { label: long, url: "/r/job/" + job + "/accounting", target: { kind: "receipt", id: receipt } },
  ],
};
const workspace = (title: string, child: React.ReactNode) =>
  h(AccountingWorkspace, { jobId: job, title }, child);
const previews: Record<string, () => React.ReactNode> = {
  "po-current": () => h(PurchaseOrdersPage, { jobId: job }),
  "po-header-regression": () => h(PurchaseOrdersPage, { jobId: job }),
  "po-suppliers": () => h(PurchaseOrdersPage, { jobId: job, initialTab: "suppliers" }),
  "po-terms": () => h(PurchaseOrdersPage, { jobId: job, initialTab: "terms" }),
  "po-history": () =>
    h(
      "main",
      { className: "po-workspace", style: { padding: 16 } },
      h(PurchaseOrderDetails, { order: ledger.orders[0], ledger, initialVersion: 1 }),
    ),
  "po-comparison-tables": () =>
    h(
      "main",
      { className: "po-workspace", style: { padding: 16 } },
      h(PurchaseOrderComparison, {
        versions: ledger.orders[0].versions,
        ledger,
        onClose: () => {},
      }),
    ),
  "po-revision": () =>
    h(
      "main",
      { className: "po-workspace", style: { padding: 16 } },
      h(PurchaseOrderRevision, {
        jobId: job,
        order: ledger.orders[0],
        party: ledger.parties[0],
        terms: ledger.terms[0],
        context: {
          companyId: id(20),
          companyName: "Synthetic contractor",
          jobNumber: "SYN-1",
          jobName: long,
        },
        rpc: state.rpc,
        onFinish: async () => {},
      }),
    ),
  billing: () => h(BillingEvidencePage, { jobId: job }),
  record: () => workspace(detail.title, h(AccountingRecordView, { detail, download: () => {} })),
  ...Object.fromEntries(
    (["summary", "receivables", "costs", "statement", "evidence"] as const).map((mode) => [
      `accounting-${mode}`,
      () =>
        workspace(
          "Synthetic financial reports",
          h(AccountingReports, {
            report,
            identity: long,
            initialType: mode,
            initialFilters: {
              currency: mode === "costs" ? "CAD" : "USD",
              vendor: "",
              costCode: "",
            },
            evidence: h(AccountingReportView, { report }),
          }),
        ),
    ]),
  ),
};
beforeAll(() => {
  state.queries = {
    "purchase-order-context": {
      companyId: id(20),
      companyName: "Synthetic contractor",
      jobNumber: "SYN-1",
      jobName: long,
    },
    "purchase-orders-workspace": ledger,
    "purchase-orders": ledger,
    "billing-evidence": billing,
    "billing-documents": { documents: [], links: [] },
  };
});
describe("financial responsive fixtures", () => {
  it.each(Object.keys(previews))("renders %s without invoking financial operations", (key) => {
    const savedLedger = state.queries["purchase-orders"];
    if (key === "po-header-regression")
      state.queries["purchase-orders"] = {
        ...ledger,
        orders: ledger.orders.map((o) => ({
          ...o,
          versions: o.versions.map((v) => ({
            ...v,
            lines: [
              {
                description: "Conduit materials for the synthetic raceway",
                quantity: 4000,
                unit: "LF",
                unit_price_cents: 200,
              },
              {
                description: "Distribution materials",
                quantity: 200,
                unit: "EA",
                unit_price_cents: 2200,
              },
            ],
          })),
        })),
      };
    const markup = renderToStaticMarkup(h("div", null, previews[key]()));
    state.queries["purchase-orders"] = savedLedger;
    expect(markup).toContain("Synthetic");
    expect(state.rpc).not.toHaveBeenCalled();
    const directory = process.env.ATHENA_RESPONSIVE_ARTIFACTS;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      const assets = ".output/public/assets";
      const font = readFileSync("src/routes/__root.tsx", "utf8").match(
        /https:\/\/fonts\.googleapis\.com\/css2[^"\s]+/,
      )?.[0];
      const css = readdirSync(assets)
        .filter((f) => f.endsWith(".css"))
        .map((f) => readFileSync(join(assets, f), "utf8"))
        .join("\n");
      writeFileSync(
        join(directory, key + ".html"),
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${key}</title>${font ? `<link rel="stylesheet" href="${font.replaceAll("&", "&amp;")}">` : ""}<style>${css}</style></head><body>${markup}</body></html>`,
      );
    }
  });
});
