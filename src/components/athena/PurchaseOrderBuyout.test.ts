import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { BuyoutLedger, PackageFacts } from "@/lib/mcp/buyout";
const f = vi.hoisted(() => ({ data: null as unknown, isLoading: false, error: null as unknown }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ ...f, refetch: vi.fn() }) }));
import { PurchaseOrderBuyout } from "./PurchaseOrderBuyout";
const rpc = vi.fn(),
  open = vi.fn();
const render = () =>
  renderToStaticMarkup(
    React.createElement(PurchaseOrderBuyout, {
      jobId: "job",
      companyId: "company",
      userId: "user",
      rpc,
      onOpenOrder: open,
    }),
  );
beforeEach(() => {
  f.data = null;
  f.isLoading = false;
  f.error = null;
  rpc.mockClear();
  open.mockClear();
});
describe("selected PO interface reads integrated buyout semantics", () => {
  it("does not substitute zero or ready when the domain is unavailable", () => {
    f.error = new Error("Denied");
    const s = render();
    expect(s).toContain("No exposure or readiness has been assumed");
    expect(s).not.toContain("$0.00");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows an explicit loading state", () => {
    f.isLoading = true;
    expect(render()).toContain("Loading saved buyout records");
  });
  it("retains approved exposure after cancellation and shows exact PO/schedule pins", () => {
    const party = randomUUID(),
      po = randomUUID();
    const p: PackageFacts = {
      code: "ELEC",
      title: "Electrical scope",
      scope: "Materials",
      budget_cents: 1600000,
      currency: "USD",
      status: "cancelled",
      candidates: [
        {
          party_id: party,
          party_version: 1,
          quote_cents: 1240000,
          scope: "Materials",
          exclusions: null,
          source: "Quote",
          quoted_on: null,
          expected_delivery_on: null,
        },
      ],
      selected_party_id: party,
      commitment_refs: [{ po_id: po, version: 1 }],
      expected_award_on: null,
      needed_by: null,
      submittal_ids: [],
      schedule_ref: { report_version: 1, activity_id: "DELIVERY-1" },
      source: "Scope register",
    };
    const l: BuyoutLedger = {
      company_id: "company",
      job_id: "job",
      today: "2026-10-30",
      can_manage_directory: true,
      can_record: true,
      records: [{ id: randomUUID(), kind: "package", version: 2, facts: p, versions: [] }],
      parties: [{ id: party, name: "Supplier", version: 1 }],
      orders: [
        {
          id: po,
          number: "PO-1",
          party_id: party,
          versions: [
            { version: 2, status: "draft", lines: [{ quantity: 1, unit_price_cents: 1440000 }] },
            { version: 1, status: "approved", lines: [{ quantity: 1, unit_price_cents: 1240000 }] },
          ],
        },
      ],
      documents: [],
      submittals: [],
      bills: [],
      schedule_activities: [{ activity_id: "DELIVERY-1", label: "Delivery", report_version: 2 }],
    };
    f.data = l;
    const s = render();
    expect(s).toContain("$12,400.00");
    expect(s).not.toContain("$14,400.00");
    expect(s).toContain("approved PO commitments remain in canonical exposure");
    expect(s).toContain("pinned version 1");
    expect(s).toContain("Pinned schedule version 1");
    expect(s).toContain("activity DELIVERY-1");
    expect(open).not.toHaveBeenCalled();
  });
  it("keeps unknown amounts and missing requirements explicit in an empty source", () => {
    f.data = {
      company_id: "company",
      job_id: "job",
      today: "2026-10-30",
      records: [],
      parties: [],
      orders: [],
      documents: [],
      submittals: [],
      bills: [],
      schedule_activities: [],
      can_manage_directory: false,
      can_record: false,
    };
    const s = render();
    expect(s).toContain("Unavailable");
    expect(s).toContain("No buyout scope packages recorded");
  });
});
