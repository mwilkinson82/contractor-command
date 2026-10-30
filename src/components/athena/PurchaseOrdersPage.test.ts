import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  signedIn: true,
  data: {} as Record<string, unknown>,
  rpc: vi.fn(),
  loading: false,
  queryLoading: false,
  queryError: null as unknown,
  contextError: null as unknown,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: fixture.signedIn ? { user: { id: "owner" } } : null,
    loading: fixture.loading,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "purchase-order-context"
      ? {
          data: fixture.contextError
            ? undefined
            : {
                companyName: "ALP Construction",
                companyId: "company",
                jobNumber: "2810",
                jobName: "Willow Creek",
              },
          isLoading: false,
          error: fixture.contextError,
        }
      : {
          data: fixture.data,
          isLoading: fixture.queryLoading,
          error: fixture.queryError,
          refetch: vi.fn(),
          isFetching: false,
        },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock("./AccountingWorkspace", () => ({
  AccountingWorkspace: ({ children }: { children: React.ReactNode }) =>
    React.createElement("main", null, children),
}));
vi.mock("./BoardSignIn", () => ({
  BoardSignIn: () => React.createElement("p", null, "Sign in required"),
}));
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";
import { extendedCents } from "@/lib/accounting-report";

const lines = [
  { description: "Conduit materials", quantity: 4000, unit: "LF", unit_price_cents: 200 },
  { description: "Distribution materials", quantity: 200, unit: "EA", unit_price_cents: 2200 },
];
const version = (n: number, items = lines, status = "draft") => ({
  version: n,
  status,
  terms_id: "terms",
  party_snapshot: { name: "Summit Electrical Supply" },
  order_date: "2026-10-30",
  needed_by: "2026-11-02",
  reason: null,
  lines: items,
});
function ledger(versions = [version(1)]) {
  return {
    parties: [],
    default_terms_id: null,
    terms: [
      {
        id: "terms",
        title: "Net 30",
        body: "Payment due 30 days after invoice.",
        scope: "company",
        state: "approved",
        parent_id: null,
        source: "Owner base",
        change_note: null,
      },
    ],
    orders: [{ id: "order", number: "WC-2810-PO01", party_id: "supplier", versions }],
  };
}
const render = () =>
  renderToStaticMarkup(React.createElement(PurchaseOrdersPage, { jobId: "2810" }));
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
beforeEach(() => {
  fixture.signedIn = true;
  fixture.data = ledger();
  fixture.rpc.mockClear();
  fixture.loading = false;
  fixture.queryLoading = false;
  fixture.queryError = null;
  fixture.contextError = null;
});

describe("saved PO version amounts", () => {
  it("shows both extensions and the $12,400 USD total while retaining draft and approved-terms states", () => {
    const html = render();
    expect(html).toContain("$8,000.00");
    expect(html).toContain("$4,400.00");
    expect(plain(html)).toContain("Order total (USD) $12,400.00");
    expect(html).toContain("Version 1 · draft");
    expect(plain(html)).toContain("Net 30 · company · approved");
    expect(html).not.toContain("internally approved");
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("calculates each saved version independently and preserves its supplier snapshot and status", () => {
    fixture.data = ledger([
      version(2),
      {
        ...version(1, [{ ...lines[0], quantity: 2000 }], "approved"),
        party_snapshot: { name: "Supplier at version one" },
      },
    ]);
    const html = render();
    const history = html.slice(html.indexOf("Immutable version history"));
    const current = plain(
      history.slice(history.indexOf("Version 2"), history.indexOf("Version 1")),
    );
    const previous = plain(history.slice(history.indexOf("Version 1")));
    expect(current).toContain("Order total (USD) $12,400.00");
    expect(current).not.toContain("$4,000.00");
    expect(previous).toContain("Order total (USD) $4,000.00");
    expect(previous).toContain("internally approved");
    expect(previous).toContain("Supplier at this version: Supplier at version one");
  });
  it("uses the report's exact decimal extension without binary rounding", () => {
    fixture.data = ledger([version(1, [{ ...lines[0], quantity: 0.29, unit_price_cents: 100 }])]);
    expect(extendedCents(0.29, 100)).toBe(29);
    expect(plain(render())).toContain("Order total (USD) $0.29");
  });
  it("does not silently round a fractional cent or present a partial total", () => {
    fixture.data = ledger([
      version(1, [{ ...lines[0], quantity: 0.5, unit_price_cents: 1 }, lines[1]]),
    ]);
    const html = render();
    expect(plain(html)).toContain("Order total (USD) Unavailable");
    expect(html).toContain("No amount has been rounded.");
    expect(plain(html)).not.toContain("Order total (USD) $4,400.00");
  });
  it.each([
    [{ ...lines[0], quantity: 1e9, unit_price_cents: 9e12 }],
    [
      { ...lines[0], quantity: 1000, unit_price_cents: 9e12 },
      { ...lines[1], quantity: 1000, unit_price_cents: 9e12 },
    ],
  ])("keeps an unsafe extension or sum unavailable: %j", (...items) => {
    fixture.data = ledger([version(1, items)]);
    expect(plain(render())).toContain("Order total (USD) Unavailable");
  });
  it("formats safe large totals without losing the final cent in cents-to-dollars division", () => {
    fixture.data = ledger([
      version(1, [
        { ...lines[0], quantity: 900719925, unit_price_cents: 10000000 },
        { ...lines[1], quantity: 1e-7, unit_price_cents: 10000000 },
      ]),
    ]);
    expect(plain(render())).toContain("Order total (USD) $90,071,992,500,000.01");
  });
  it("retains the sign-in gate", () => {
    fixture.signedIn = false;
    const html = render();
    expect(html).toContain("Sign in required");
    expect(html).not.toContain("WC-2810-PO01");
  });
});

describe("PO workspace state and permission boundaries", () => {
  it("shows company/job identity and actual tabs without fabricated source rows", () => {
    const html = render();
    expect(plain(html)).toContain("ALP Construction / 2810 - Willow Creek");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Search orders or suppliers");
    expect(html).toContain("<table");
    expect(html).toContain('aria-label="View revision"');
  });
  it("shows loading without financial rows", () => {
    fixture.queryLoading = true;
    const html = render();
    expect(html).toContain("Loading purchase orders");
    expect(html).not.toContain("WC-2810-PO01");
  });
  it("fails closed on inaccessible/error data and offers an actual retry", () => {
    fixture.data = undefined as unknown as Record<string, unknown>;
    fixture.queryError = new Error("denied");
    const html = render();
    expect(html).toContain("full project access");
    expect(html).toContain("Retry loading");
    expect(html).not.toContain("$12,400");
  });
  it("has a clear empty state without dummy orders or a working-looking revision action", () => {
    fixture.data = { parties: [], terms: [], orders: [], default_terms_id: null };
    const html = render();
    expect(html).toContain("No purchase orders recorded");
    expect(html).not.toContain("WC-2810-PO01");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Propose revision/);
  });
  it("keeps stale data read-only after a refresh error", () => {
    fixture.queryError = new Error("unavailable");
    const html = render();
    expect(html).toContain("showing previously loaded records".replace("showing", "Showing"));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Propose revision/);
  });
  it("does not synthesize terms hidden by backend permissions", () => {
    fixture.data = { ...ledger(), terms: [] };
    const html = render();
    expect(html).toContain("Terms are unavailable to this view");
    expect(html).not.toContain("Payment due 30 days");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Propose revision/);
  });
  it("does not equate internal approval with issuance or acceptance", () => {
    fixture.data = ledger([version(1, lines, "approved")]);
    const html = plain(render());
    expect(html).toContain("Internally approved");
    expect(html).toContain("Issuance not recorded");
    expect(html).toContain("Supplier acceptance not recorded");
  });
});
