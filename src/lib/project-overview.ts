import { z } from "zod";
import { billingReportSchema, buildAccountingReport } from "./accounting-report";
import {
  iorContractValue,
  pickContractValue,
  setupContractValue,
  sovContractValue,
} from "./mcp/contract-value";

export type OverviewFact = {
  module: string;
  key: string;
  value: unknown;
  status?: string;
};

/** Same selector as contract_terms. A fallback must keep its different provenance. */
export function overviewContract(
  facts: OverviewFact[],
  fee: number | null,
  ior: { contract_total?: number | null; data?: unknown } | null,
) {
  const sov = facts
    .filter((f) => f.module === "sov")
    .map((f) => {
      const v = (f.value ?? {}) as {
        executed_change_order?: string;
        fee_included?: boolean;
        description?: string;
        billable_value?: number;
      };
      return {
        item_no: f.key,
        executed_change_order: v.executed_change_order,
        fee_included: v.fee_included,
        description: v.description ?? null,
        scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null,
      };
    });
  const selected = pickContractValue({
    setup: setupContractValue(facts),
    sov: sovContractValue(
      sov,
      fee,
      facts.find((f) => f.module === "contract" && f.key === "retainage")?.value,
    ),
    ior: iorContractValue(ior),
  });
  return {
    ...selected,
    original:
      selected.source === "job setup"
        ? setupContractValue(
            facts.filter((f) => !(f.module === "contract" && f.key === "executed_change_orders")),
          )
        : null,
    executedDelta:
      selected.source === "job setup"
        ? facts.find(
            (f) =>
              f.module === "contract" &&
              f.key === "executed_change_orders" &&
              f.status !== "unknown" &&
              f.status !== "na",
          )?.value
        : null,
    basis:
      selected.source === "job setup"
        ? "Saved setup value plus recorded executed change-order delta."
        : selected.source === "SOV"
          ? "Built schedule-of-values total; executed contract value is not independently verified."
          : selected.source === "IOR"
            ? "IOR contract / budget basis fallback; executed contract value is not independently verified."
            : "Contract value needed. No value inferred from payments or costs.",
  };
}

/** Inception through cutoff. Reuse canonical AR arithmetic; AP is not needed for this read. */
export function overviewPayments(data: unknown, jobId: string, now = new Date()) {
  if (JSON.stringify(data)?.length > 10_000_000)
    throw new Error("Financial source exceeds overview limit.");
  const billing = billingReportSchema.parse(data);
  if (
    [billing.invoices, billing.receipts, billing.allocations, billing.receipt_reversals].some(
      (rows) => rows.length > 10_000,
    )
  )
    throw new Error("Financial source exceeds overview row limit. No partial totals.");
  const report = buildAccountingReport(
    {
      jobId,
      capturedAt: now.toISOString(),
      billing,
      budgets: [],
      costs: { available: false, reason: "Open accounting for cost evidence." },
      orders: { available: false, reason: "Open purchase orders for commitments." },
    },
    { asOf: now.toISOString().slice(0, 10) },
  );
  return {
    asOf: report.asOf,
    capturedAt: report.capturedAt,
    currency: report.currency,
    metrics: report.metrics.filter((m) =>
      ["receipts", "unpaid_invoices", "unapplied_receipts", "retainage"].includes(m.key),
    ),
    // Retain canonical links and source/version identifiers without copying document bytes.
    sources: report.rows.filter(
      (r) => !["posted_cost", "po_commitment", "budget"].includes(r.kind),
    ),
  };
}

const eventSchema = z.object({
  id: z.string(),
  occurred_at: z.string(),
  kind: z.string(),
  title: z.string(),
  ref_table: z.string().nullable().optional(),
  ref_id: z.string().nullable().optional(),
});
const mailSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  submittal_id: z.string(),
  kind: z.enum(["package", "chase"]),
  created_at: z.string(),
  approved_at: z.string().nullable(),
  sent_at: z.string().nullable(),
  provider: z.string().nullable(),
  message_id: z.string().nullable(),
});
export type OverviewCommunication = {
  id: string;
  title: string;
  when: string;
  status:
    | "Draft"
    | "Approved · delivery unverified"
    | "Host-reported sent receipt"
    | "Manually recorded response";
  basis: string;
  page: "submittals" | "rfis" | "rfcs" | null;
  sourceId: string;
  sourceTable: string;
  anchor: string | null;
};

/** Dedicated projection: no inbox bodies, recipients, arbitrary URLs or event payloads. */
export function overviewCommunications(eventsData: unknown, mailData: unknown, jobId: string) {
  const events = z.object({ events: z.array(eventSchema) }).parse(eventsData).events;
  const mails = z.array(mailSchema).parse(mailData);
  if (mails.some((m) => m.job_id !== jobId)) throw new Error("Communication job mismatch.");
  const rows: OverviewCommunication[] = mails.map((m) => {
    const receipt = !!(m.sent_at && m.approved_at && m.provider?.trim() && m.message_id?.trim());
    return {
      id: `mail-${m.id}`,
      title: m.kind === "chase" ? "Submittal follow-up" : "Submittal package",
      when: receipt ? m.sent_at! : (m.approved_at ?? m.created_at),
      status: receipt
        ? "Host-reported sent receipt"
        : m.approved_at
          ? "Approved · delivery unverified"
          : "Draft",
      basis: receipt
        ? "Provider/message receipt recorded by the host; no independent provider delivery confirmation."
        : m.approved_at
          ? "Approved draft; successful delivery has not been recorded."
          : "Saved draft; no send approval or delivery recorded.",
      page: "submittals",
      sourceId: m.id,
      sourceTable: "mcp_submittal_mail",
      anchor: m.submittal_id,
    };
  });
  for (const e of events) {
    // Mail rows are the canonical draft/approval/receipt source; never duplicate their events.
    if (e.ref_table === "mcp_submittal_mail") continue;
    if (e.kind !== "email_sent" && !["rfi_answer", "rfc_answer"].includes(e.kind)) continue;
    const generic = e.kind === "email_sent";
    const page =
      e.kind === "rfi_answer"
        ? "rfis"
        : e.kind === "rfc_answer"
          ? "rfcs"
          : generic
            ? null
            : "submittals";
    rows.push({
      id: `event-${e.id}`,
      title: e.title,
      when: e.occurred_at,
      status: generic ? "Approved · delivery unverified" : "Manually recorded response",
      basis: generic
        ? "Authorization event only. It does not prove the host sent the email."
        : "Response entered into Athena; no personal inbox synchronization is implied.",
      page,
      sourceId: e.id,
      sourceTable: "mcp_project_record_events",
      anchor: e.ref_table === "mcp_submittals" ? (e.ref_id ?? null) : null,
    });
  }
  return rows.sort((a, b) => b.when.localeCompare(a.when) || a.id.localeCompare(b.id)).slice(0, 12);
}

/** Routing only. All mutations remain with the canonical producer's review/confirm flow. */
export function overviewItemAction(item: {
  type?: string | null;
  item_type?: string | null;
  kind?: string | null;
  category?: string | null;
  check_key?: string | null;
}) {
  const kind =
    `${item.type ?? ""} ${item.item_type ?? ""} ${item.kind ?? ""} ${item.category ?? ""} ${item.check_key ?? ""}`.toLowerCase();
  if (/\brfi\b|rfi:/.test(kind))
    return {
      page: "rfis",
      label: "Review RFI date",
      guidance: "Review this request in Athena before confirming a revised due date.",
    };
  if (/\brfc\b|rfc:/.test(kind))
    return {
      page: "rfcs",
      label: "Review RFC date",
      guidance: "Review this request in Athena before confirming a revised due date.",
    };
  if (/submittal/.test(kind))
    return {
      page: "submittals",
      label: "Review submittal date",
      guidance: "Review the saved submittal and confirm its revised due-back date in Athena.",
    };
  if (/schedule|activity|cpm/.test(kind))
    return {
      page: "schedule",
      label: "Review schedule",
      guidance: "Use the scheduling review/save workflow for a CPM date change.",
    };
  return {
    page: "items",
    label: "Review follow-up",
    guidance:
      "Ask Athena to review this item's owner and due date. A universal date editor is not available; confirm any supported change in its source workflow.",
  };
}
