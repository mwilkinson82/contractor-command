import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  signedIn: true,
  data: {} as Record<string, unknown>,
  rpc: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: fixture.signedIn ? { user: { id: "owner" } } : null, loading: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: fixture.data, isLoading: false, error: null }),
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
beforeEach(() => {
  fixture.signedIn = true;
  fixture.data = ledger();
  fixture.rpc.mockClear();
});

describe("saved PO version amounts", () => {
  it("shows both extensions and the $12,400 USD total while retaining draft and approved-terms states", () => {
    const html = render();
    expect(html).toContain("$8,000.00");
    expect(html).toContain("$4,400.00");
    expect(html).toContain("Order total (USD): $12,400.00");
    expect(html).toContain("Version 1 · draft");
    expect(html).toContain("Net 30 · company · approved");
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
    const current = html.slice(html.indexOf("Version 2"), html.indexOf("Version 1"));
    const previous = html.slice(html.indexOf("Version 1"), html.indexOf("Terms history"));
    expect(current).toContain("Order total (USD): $12,400.00");
    expect(current).not.toContain("$4,000.00");
    expect(previous).toContain("Order total (USD): $4,000.00");
    expect(previous).toContain("internally approved");
    expect(previous).toContain("Supplier at this version: Supplier at version one");
  });
  it("uses the report's exact decimal extension without binary rounding", () => {
    fixture.data = ledger([version(1, [{ ...lines[0], quantity: 0.29, unit_price_cents: 100 }])]);
    expect(extendedCents(0.29, 100)).toBe(29);
    expect(render()).toContain("Order total (USD): $0.29");
  });
  it("does not silently round a fractional cent or present a partial total", () => {
    fixture.data = ledger([
      version(1, [{ ...lines[0], quantity: 0.5, unit_price_cents: 1 }, lines[1]]),
    ]);
    const html = render();
    expect(html).toContain("Order total (USD): Unavailable");
    expect(html).toContain("No amount has been rounded.");
    expect(html).not.toContain("Order total (USD): $4,400.00");
  });
  it.each([
    [{ ...lines[0], quantity: 1e9, unit_price_cents: 9e12 }],
    [
      { ...lines[0], quantity: 1000, unit_price_cents: 9e12 },
      { ...lines[1], quantity: 1000, unit_price_cents: 9e12 },
    ],
  ])("keeps an unsafe extension or sum unavailable: %j", (...items) => {
    fixture.data = ledger([version(1, items)]);
    expect(render()).toContain("Order total (USD): Unavailable");
  });
  it("formats safe large totals without losing the final cent in cents-to-dollars division", () => {
    fixture.data = ledger([
      version(1, [
        { ...lines[0], quantity: 900719925, unit_price_cents: 10000000 },
        { ...lines[1], quantity: 1e-7, unit_price_cents: 10000000 },
      ]),
    ]);
    expect(render()).toContain("Order total (USD): $90,071,992,500,000.01");
  });
  it("retains the sign-in gate", () => {
    fixture.signedIn = false;
    const html = render();
    expect(html).toContain("Sign in required");
    expect(html).not.toContain("WC-2810-PO01");
  });
});