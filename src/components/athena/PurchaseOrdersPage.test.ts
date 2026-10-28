import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ signedIn: true, error: false }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: state.signedIn ? { user: { id: "member" } } : null, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("./BoardSignIn", () => ({
  BoardSignIn: ({ returnTo }: { returnTo: string }) =>
    React.createElement("div", null, `Sign in: ${returnTo}`),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isLoading: false,
    error: state.error ? new Error("denied") : null,
    data: {
      parties: [
        {
          id: "p",
          name: "Current Supplier",
          kind: "supplier",
          trade: null,
          contact_name: null,
          contact_email: null,
          contact_phone: null,
          insurance_reference: "Policy QA",
          contract_reference: null,
        },
      ],
      terms: [
        {
          id: "t",
          title: "Standard",
          body: "Payment terms",
          scope: "company",
          parent_id: null,
          source: "Policy",
          change_note: null,
        },
      ],
      default_terms_id: "t",
      orders: [
        {
          id: "o",
          number: "PO-1",
          party_id: "p",
          versions: [
            {
              version: 1,
              status: "draft",
              terms_id: "t",
              party_snapshot: { name: "Supplier at review" },
              order_date: "2026-11-01",
              needed_by: "2026-12-01",
              reason: null,
              lines: [{ description: "Cable", quantity: 2, unit: "roll", unit_price_cents: 2500 }],
            },
          ],
        },
      ],
    },
  }),
}));
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";
const job = "22222222-2222-4222-8222-222222222222";
describe("private purchase order view", () => {
  it("renders saved records and the supplier snapshot", () => {
    state.signedIn = true;
    state.error = false;
    const html = renderToStaticMarkup(React.createElement(PurchaseOrdersPage, { jobId: job }));
    expect(html).toContain("Supplier at review");
    expect(html).toContain("PO-1");
    expect(html).toContain("$25.00");
    expect(html).toContain("Payment terms");
    expect(html).toContain("Policy QA");
  });
  it("hides cached data when denied and requests sign-in", () => {
    state.error = true;
    let html = renderToStaticMarkup(React.createElement(PurchaseOrdersPage, { jobId: job }));
    expect(html).toContain("unavailable");
    expect(html).not.toContain("Payment terms");
    state.signedIn = false;
    state.error = false;
    html = renderToStaticMarkup(React.createElement(PurchaseOrdersPage, { jobId: job }));
    expect(html).toContain(`Sign in: /r/job/${job}/purchase-orders`);
  });
});
