import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  approvalFacts,
  filterPurchaseOrders,
  orderVersions,
  orderTotal,
  poMoney,
  prepareRevision,
  revisionFields,
  reviewPoRevision,
  savePoRevision,
  type PurchaseOrderLedger,
  type PurchaseOrder,
  type PurchaseOrderParty,
  type PurchaseOrderTerms,
} from "./purchase-order-workspace";
const party: PurchaseOrderParty = {
  id: randomUUID(),
  version: 2,
  name: "Current supplier",
  kind: "supplier",
  trade: "Electrical",
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  insurance_reference: null,
  contract_reference: null,
};
const terms: PurchaseOrderTerms = {
  id: randomUUID(),
  title: "Net 30",
  body: "Exact saved text",
  scope: "company",
  state: "approved",
  approved_by: randomUUID(),
  parent_id: null,
  source: "Owner source",
  change_note: null,
};
function order(): PurchaseOrder {
  return {
    id: randomUUID(),
    number: "PO-10",
    party_id: party.id,
    versions: [
      {
        version: 1,
        status: "approved",
        terms_id: terms.id,
        party_snapshot: { name: "Historical supplier" },
        order_date: "2026-10-01",
        needed_by: "2026-11-01",
        reason: null,
        lines: [{ description: "Conduit", quantity: 2, unit: "LF", unit_price_cents: 200 }],
      },
      {
        version: 2,
        status: "draft",
        terms_id: terms.id,
        party_snapshot: { name: "Current supplier" },
        order_date: "2026-10-02",
        needed_by: "2026-11-02",
        reason: "Clarification",
        lines: [
          {
            description: "Conduit description revised",
            quantity: 2,
            unit: "LF",
            unit_price_cents: 200,
          },
        ],
      },
    ],
  };
}
const ledger = (orders: PurchaseOrder[]): PurchaseOrderLedger => ({
  parties: [party],
  terms: [terms],
  orders,
  default_terms_id: null,
});
describe("purchase-order workspace source and financial semantics", () => {
  it("sorts revisions without mutating immutable source and uses only current status in filters", () => {
    const o = order();
    expect(orderVersions(o).map((v) => v.version)).toEqual([2, 1]);
    expect(o.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(
      filterPurchaseOrders(ledger([o]), { search: "", status: "approved", supplier: "" }),
    ).toHaveLength(0);
  });
  it("filters on exact supplier identity plus order, trade or retained supplier names", () => {
    const o = order(),
      other = { ...order(), number: "PO-2", id: randomUUID(), party_id: randomUUID() };
    expect(
      filterPurchaseOrders(ledger([o, other]), {
        search: "historical",
        status: "draft",
        supplier: party.id,
      }),
    ).toEqual([o]);
    expect(
      filterPurchaseOrders(ledger([o, other]), {
        search: "electrical",
        status: "",
        supplier: party.id,
      }),
    ).toEqual([o]);
    expect(
      filterPurchaseOrders(ledger([o]), { search: "not found", status: "", supplier: "" }),
    ).toHaveLength(0);
  });
  it("keeps zero, unsupported totals and safe final cents distinct", () => {
    expect(poMoney(0)).toBe("$0.00");
    expect(poMoney(null)).toBe("Unavailable");
    expect(poMoney(9007199250000001)).toBe("$90,071,992,500,000.01");
    const v = orderVersions(order())[0];
    expect(
      orderTotal({
        ...v,
        lines: [{ description: "Fraction", quantity: 0.5, unit: "EA", unit_price_cents: 1 }],
      }),
    ).toBeNull();
  });
  it("keeps approval, issuance and acceptance separate", () => {
    const v = orderVersions(order())[0];
    expect(approvalFacts({ ...v, status: "approved" })).toMatchObject({
      internal: "Internally approved",
      issuance: "Issuance not recorded",
      acceptance: "Supplier acceptance not recorded",
    });
    expect(approvalFacts({ ...v, status: "accepted" }).internal).not.toBe("Internally approved");
  });
  it("freezes new revision identity, supplier version and original terms, and only proposes draft status", () => {
    const o = order(),
      fields = revisionFields(orderVersions(o)[0]);
    fields.reason = "Clarify scope";
    const payload = prepareRevision(o, party, terms, fields, randomUUID());
    expect(payload).toMatchObject({
      id: o.id,
      expected_version: 2,
      status: "draft",
      number: "PO-10",
      party_id: party.id,
      party_version: 2,
      terms_id: terms.id,
    });
    fields.lines[0].description = "Mutated after review";
    expect(payload.lines[0].description).toBe("Conduit description revised");
  });
  it("rejects invalid dates, unsupported money precision and missing explanation before review", () => {
    const o = order(),
      f = revisionFields(orderVersions(o)[0]);
    expect(() => prepareRevision(o, party, terms, f, randomUUID())).toThrow("revision reason");
    f.reason = "Update";
    f.neededBy = "2026-02-31";
    expect(() => prepareRevision(o, party, terms, f, randomUUID())).toThrow("valid needed-by");
    f.neededBy = "2026-11-01";
    f.lines[0].rate = "1.005";
    expect(() => prepareRevision(o, party, terms, f, randomUUID())).toThrow("two decimal");
    f.lines[0].rate = "0.01";
    f.lines[0].quantity = "0.5";
    expect(() => prepareRevision(o, party, terms, f, randomUUID())).toThrow(
      "No amount has been rounded",
    );
  });
  it("does not propose revisions for issued/accepted orders or hidden/unapproved terms", () => {
    const o = order(),
      f = revisionFields(orderVersions(o)[0]);
    f.reason = "Update";
    for (const status of ["issued", "accepted"])
      expect(() =>
        prepareRevision(
          { ...o, versions: o.versions.map((v) => ({ ...v, status })) },
          party,
          terms,
          f,
          randomUUID(),
        ),
      ).toThrow("cannot be revised");
    expect(() =>
      prepareRevision(o, party, { ...terms, state: "proposed" }, f, randomUUID()),
    ).toThrow("unavailable to your role");
  });
  it("review never invokes save and identical retries preserve the exact frozen operation", async () => {
    const o = order(),
      f = revisionFields(orderVersions(o)[0]);
    f.reason = "Update";
    const p = prepareRevision(o, party, terms, f, randomUUID()),
      review = randomUUID();
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: { expires_at: "2026-11-01T00:00:00Z", id: o.id, version: 3 },
      error: null,
    }));
    await reviewPoRevision(rpc, "job-a", p, review);
    expect(rpc).toHaveBeenLastCalledWith("mcp_project_purchase_orders_review", {
      _job: "job-a",
      _action: "order",
      _p: p,
      _review: review,
    });
    await savePoRevision(rpc, "job-a", p, review);
    await savePoRevision(rpc, "job-a", p, review);
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[2]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ _confirmed: true, _p: { status: "draft" } });
  });
});
