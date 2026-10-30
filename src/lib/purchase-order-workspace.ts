import { extendedCents, sumCents } from "./accounting-report";

export type PurchaseOrderLine = {
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
};
export type PurchaseOrderParty = {
  id: string;
  name: string;
  kind: string;
  version?: number;
  trade: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  insurance_reference: string | null;
  contract_reference: string | null;
};
export type PurchaseOrderTerms = {
  id: string;
  title: string;
  body: string;
  scope: string;
  state: "proposed" | "approved";
  parent_id: string | null;
  source: string;
  change_note: string | null;
  approved_by?: string | null;
  party_id?: string | null;
  po_id?: string | null;
};
export type PurchaseOrderVersion = {
  version: number;
  status: string;
  terms_id: string;
  party_snapshot: { name: string; version?: number };
  order_date: string;
  needed_by: string;
  reason: string | null;
  lines: PurchaseOrderLine[];
  created_at?: string;
  created_by?: string;
};
export type PurchaseOrder = {
  id: string;
  number: string;
  party_id: string;
  versions: PurchaseOrderVersion[];
};
export type PurchaseOrderLedger = {
  parties: PurchaseOrderParty[];
  terms: PurchaseOrderTerms[];
  orders: PurchaseOrder[];
  default_terms_id: string | null;
};
export type PurchaseOrderContext = {
  companyName: string;
  companyId: string;
  jobNumber: string;
  jobName: string;
};
export const orderVersions = (order: PurchaseOrder) =>
  [...order.versions].sort((a, b) => b.version - a.version);
export const orderTotal = (v: PurchaseOrderVersion) =>
  sumCents(v.lines.map((line) => extendedCents(line.quantity, line.unit_price_cents)));
export function poMoney(cents: number | null) {
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0) return "Unavailable";
  const n = BigInt(cents);
  return `$${new Intl.NumberFormat("en-US").format(n / 100n)}.${String(n % 100n).padStart(2, "0")}`;
}
export function poDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Not recorded";
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(d)
    : "Not recorded";
}
export const statusLabel = (status: string) =>
  ({
    draft: "Draft",
    reviewed: "Reviewed",
    approved: "Internally approved",
    issued: "Issued",
    accepted: "Accepted",
  })[status] ?? "Status unavailable";
export function filterPurchaseOrders(
  ledger: PurchaseOrderLedger,
  filters: { search: string; status: string; supplier: string },
) {
  const q = filters.search.trim().toLowerCase();
  return ledger.orders
    .filter((order) => {
      const current = orderVersions(order)[0],
        party = ledger.parties.find((p) => p.id === order.party_id);
      return (
        (!filters.status || current?.status === filters.status) &&
        (!filters.supplier || order.party_id === filters.supplier) &&
        (!q ||
          [
            order.number,
            party?.name,
            party?.trade,
            ...order.versions.map((v) => v.party_snapshot.name),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q))
      );
    })
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}
export function approvalFacts(version: PurchaseOrderVersion) {
  return {
    internal:
      version.status === "approved"
        ? "Internally approved"
        : version.status === "reviewed"
          ? "Reviewed; approval not recorded"
          : version.status === "draft"
            ? "Draft; approval not recorded"
            : "See immutable history for internal approval",
    issuance:
      version.status === "issued"
        ? "Recorded issued"
        : version.status === "accepted"
          ? "Accepted status; issuance evidence not shown"
          : "Issuance not recorded",
    acceptance:
      version.status === "accepted" ? "Recorded accepted" : "Supplier acceptance not recorded",
  };
}
export type RevisionFields = {
  orderDate: string;
  neededBy: string;
  reason: string;
  lines: Array<{ description: string; quantity: string; unit: string; rate: string }>;
};
export type RevisionPayload = {
  id: string;
  request_id: string;
  expected_version: number;
  party_id: string;
  party_version: number;
  number: string;
  terms_id: string;
  status: "draft";
  lines: PurchaseOrderLine[];
  order_date: string;
  needed_by: string;
  reason: string;
};
export function revisionFields(v: PurchaseOrderVersion): RevisionFields {
  return {
    orderDate: v.order_date,
    neededBy: v.needed_by,
    reason: "",
    lines: v.lines.map((l) => ({
      description: l.description,
      quantity: String(l.quantity),
      unit: l.unit,
      rate: (l.unit_price_cents / 100).toFixed(2),
    })),
  };
}
function dollarsToCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error("Enter a nonnegative rate in USD with at most two decimal places.");
  const [a, b = ""] = value.split(".");
  const cents = BigInt(a) * 100n + BigInt(b.padEnd(2, "0"));
  if (cents > 9000000000000n) throw new Error("The unit rate exceeds the supported limit.");
  return Number(cents);
}
export function prepareRevision(
  order: PurchaseOrder,
  party: PurchaseOrderParty,
  terms: PurchaseOrderTerms,
  fields: RevisionFields,
  requestId: string,
): RevisionPayload {
  const current = orderVersions(order)[0];
  if (!current || ["issued", "accepted"].includes(current.status))
    throw new Error("Issued or accepted orders cannot be revised in this workspace.");
  if (party.id !== order.party_id || !party.version || party.version < 1)
    throw new Error("Refresh the current project supplier before reviewing a revision.");
  if (terms.id !== current.terms_id || terms.state !== "approved" || !terms.approved_by)
    throw new Error(
      "The approved terms for this revision are unavailable to your role. Ask the company owner to review them.",
    );
  if (!fields.reason.trim() || fields.reason.trim().length > 2000)
    throw new Error("Give a revision reason of up to 2,000 characters.");
  for (const [label, value] of [
    ["order", fields.orderDate],
    ["needed-by", fields.neededBy],
  ]) {
    const d = new Date(`${value}T12:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(d.valueOf()) ||
      d.toISOString().slice(0, 10) !== value
    )
      throw new Error(`Enter a valid ${label} date.`);
  }
  if (fields.lines.length < 1 || fields.lines.length > 100)
    throw new Error("Keep between 1 and 100 line items.");
  const lines = fields.lines.map((line) => {
    const quantity = Number(line.quantity);
    if (
      !line.description.trim() ||
      line.description.trim().length > 2000 ||
      !line.unit.trim() ||
      line.unit.trim().length > 100 ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1e9
    )
      throw new Error(
        "Each line needs a description, unit and positive quantity within the supported limit.",
      );
    return {
      description: line.description.trim(),
      quantity,
      unit: line.unit.trim(),
      unit_price_cents: dollarsToCents(line.rate.trim()),
    };
  });
  if (sumCents(lines.map((l) => extendedCents(l.quantity, l.unit_price_cents))) === null)
    throw new Error(
      "A line or total cannot be represented as supported whole cents. No amount has been rounded.",
    );
  return {
    id: order.id,
    request_id: requestId,
    expected_version: current.version,
    party_id: party.id,
    party_version: party.version,
    number: order.number,
    terms_id: terms.id,
    status: "draft",
    lines,
    order_date: fields.orderDate,
    needed_by: fields.neededBy,
    reason: fields.reason.trim(),
  };
}
export type PoRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
function errorMessage(message: string) {
  return message.startsWith("MCP_BAD:")
    ? message.slice(8)
    : "This request could not be confirmed. Refresh the order and check your project access.";
}
export async function reviewPoRevision(
  rpc: PoRpc,
  jobId: string,
  payload: RevisionPayload,
  reviewId: string,
) {
  const r = await rpc("mcp_project_purchase_orders_review", {
    _job: jobId,
    _action: "order",
    _p: payload,
    _review: reviewId,
  });
  if (r.error) throw new Error(errorMessage(r.error.message));
  return r.data as { expires_at: string };
}
export async function savePoRevision(
  rpc: PoRpc,
  jobId: string,
  payload: RevisionPayload,
  reviewId: string,
) {
  const r = await rpc("mcp_project_purchase_orders_record", {
    _job: jobId,
    _action: "order",
    _p: payload,
    _review: reviewId,
    _confirmed: true,
  });
  if (r.error) throw new Error(errorMessage(r.error.message));
  return r.data as { id: string; version: number; already_applied?: boolean };
}
