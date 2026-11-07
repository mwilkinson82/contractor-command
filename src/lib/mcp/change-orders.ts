import type { CardModel } from "./cards/model";
import { requestLogUrl } from "./request-log";
import { submittalRecordUrl } from "./submittal-record-url";
import { requestReferenceText, type PackageReference } from "./package-purpose";
export type ChangeCostLine = {
  category: "labor" | "material" | "equipment" | "subcontract" | "other" | "markup";
  description: string;
  quantity?: number;
  unit?: string;
  unit_rate_cents?: number;
  rate_basis_points?: number;
  source: string;
  amount_cents: number;
};
export type ChangeDetails = {
  state: "draft" | "priced" | "submitted" | "approved" | "rejected" | "executed";
  record_version: number;
  co_number?: string | null;
  owner_number?: string | null;
  origin: "contractor" | "owner";
  condition: string;
  scope: string;
  references: PackageReference[];
  recipient_name?: string | null;
  recipient_email?: string | null;
  due_date?: string | null;
  lines: ChangeCostLine[];
  total_cents: number | null;
  schedule_days?: number | null;
  decision?: { by: string; at: string; reference: string } | null;
  execution?: {
    by: string;
    at: string;
    reference: string;
    /** The SOV line the change was added on; none when the job had no base SOV. */
    sov_item: string | null;
    /** "customer_page" when the client's signed approval on their client page executed it. */
    channel?: string;
    authority?: string;
    contract_before_cents?: number | null;
    contract_after_cents?: number | null;
  } | null;
  /** Set when the change order was made from the customer's own pick on their customer page. */
  customer_choice?: { tier: string; at: string; reference: string; fingerprint?: string } | null;
};
/** A line's per-unit rate: the saved rate, the line amount over its quantity when that divides evenly, or a lump sum. */
export function lineRate(line: ChangeCostLine): string {
  if (line.unit_rate_cents != null) return changeMoney(line.unit_rate_cents);
  if (!Number.isFinite(line.amount_cents)) return "Rate needed";
  const q = line.quantity;
  const each = q && q > 0 ? line.amount_cents / q : null;
  return each != null && Number.isInteger(each) ? changeMoney(each) : "Lump sum";
}
/** How the record says the change reached the contract. */
export function executionLine(execution: NonNullable<ChangeDetails["execution"]>): string {
  const sov = execution.sov_item ? ` · SOV ${execution.sov_item}` : "";
  const after =
    execution.contract_after_cents != null
      ? ` · Contract value now ${changeMoney(execution.contract_after_cents)}`
      : "";
  return execution.channel === "customer_page"
    ? `Added to the contract by the client's signed approval on the client page${sov}${after}`
    : `Executed · ${execution.reference}${sov}${after}`;
}
/** Said wherever a change order came from the customer's own pick, so no reader compares it to an older preview. */
export const SIGNED_VERSION_NOTE =
  "Built from the exact version the customer signed on their customer page. Any earlier preview of this proposal was replaced before the customer chose.";
export type ChangeRow = {
  id: string;
  number: string;
  title: string;
  revision: number;
  transmittal_number: number;
  change_order_details: ChangeDetails;
  history?: {
    record_version: number;
    action: string;
    created_at: string;
    snapshot: ChangeDetails;
  }[];
};
export type ChangeLogPayload = {
  job_id: string;
  job_number: string;
  job_name: string;
  today: string;
  records: ChangeRow[];
  read_only: boolean;
  time_zone?: string;
};
export const changeMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export function changeSections(details: ChangeDetails) {
  return [
    {
      heading: "Condition",
      kind: "list" as const,
      rows: [{ cells: [details.condition], raw: true, tone: "literal" as const }],
    },
    {
      heading: "Requested change",
      kind: "list" as const,
      rows: [{ cells: [details.scope], raw: true, tone: "literal" as const }],
    },
    {
      heading: "References",
      kind: "list" as const,
      rows: details.references.map((ref) => ({
        cells: [requestReferenceText(ref)],
        raw: true,
        tone: "literal" as const,
      })),
    },
    {
      heading: "Pricing",
      kind: "table" as const,
      columns: ["Category", "Description", "Quantity", "Rate", "Amount", "Source"],
      rows: details.lines.length
        ? details.lines.map((line) => ({
            cells: [
              line.category,
              line.description,
              line.category === "markup"
                ? "Direct costs"
                : `${line.quantity ?? "Not recorded"} ${line.unit ?? ""}`.trim(),
              line.category === "markup"
                ? `${(line.rate_basis_points ?? 0) / 100}% of direct costs`
                : lineRate(line),
              changeMoney(line.amount_cents),
              line.source,
            ],
          }))
        : [{ cells: ["Not priced", "Rates and quantities needed", "", "", "", ""] }],
    },
    {
      heading: "Commercial record",
      kind: "list" as const,
      rows: [
        {
          cells: [
            details.total_cents == null
              ? "Total: not priced"
              : `Total: ${changeMoney(details.total_cents)}`,
          ],
        },
        {
          cells: [
            details.schedule_days == null
              ? "Schedule impact: not determined"
              : `Requested schedule change: ${details.schedule_days} days; no CPM adjustment made`,
          ],
        },
        ...(details.customer_choice ? [{ cells: [SIGNED_VERSION_NOTE] }] : []),
        ...(details.owner_number ? [{ cells: [`Owner's number: ${details.owner_number}`] }] : []),
        ...(details.decision
          ? [{ cells: [`Decision by ${details.decision.by} · ${details.decision.reference}`] }]
          : []),
        ...(details.execution ? [{ cells: [executionLine(details.execution)] }] : []),
      ],
    },
  ];
}
/** How a change order is priced, beside the record. Any job can take any basis, whatever its contract type. */
export const PRICING_LABEL: Record<string, string> = {
  lump_sum: "Lump sum",
  unit_price: "Unit price",
  time_and_material: "T&M",
  hourly: "Hourly",
  cost_plus: "Cost plus",
};
export type ChangeExtras = {
  /** submittal id → pricing basis key. */
  pricing?: Record<string, string>;
  /** The job's contract type key, shown as a label. */
  contractType?: string | null;
};
export function changeLogCard(
  payload: ChangeLogPayload,
  board: string | null,
  filter: { state?: ChangeDetails["state"]; overdue?: boolean } = {},
  number?: string,
  extras: ChangeExtras = {},
) {
  const basisOf = (r: ChangeRow) => {
    const b = extras.pricing?.[r.id];
    return b ? (PRICING_LABEL[b] ?? null) : null;
  };
  const contract = extras.contractType ? PRICING_LABEL[extras.contractType] : null;
  const late = (r: ChangeRow) =>
    !["approved", "rejected", "executed"].includes(r.change_order_details.state) &&
    !!r.change_order_details.due_date &&
    r.change_order_details.due_date < payload.today;
  const rows = payload.records.filter(
    (r) =>
      (!number ||
        [r.number, r.change_order_details.co_number].some(
          (n) => n?.toLowerCase() === number.toLowerCase(),
        )) &&
      (!filter.state || r.change_order_details.state === filter.state) &&
      (!filter.overdue || late(r)),
  );
  const base = requestLogUrl(board, "rfi");
  const log_url = base ? base.replace(/\/rfis(?=\?|$)/, "/cos") : null;
  const records = rows.map((r) => ({
    ...r,
    record_url: submittalRecordUrl(board, r.number),
    overdue: late(r),
  }));
  const card: CardModel = {
    state: "result",
    show_state: false,
    title: "Change-order log",
    job: `${payload.job_number} – ${payload.job_name}${contract ? ` · ${contract} contract` : ""}`,
    kpis: [
      { label: "Shown", value: String(rows.length) },
      { label: "On this log", value: String(payload.records.length) },
      {
        label: "Overdue",
        value: String(rows.filter(late).length),
        flag: rows.some(late) ? "overdue" : null,
      },
    ],
    sections: [
      {
        heading: "Potential and issued change orders",
        kind: "table",
        columns: ["Number", "Title", "Status", "Amount", "Due", "Source"],
        rows: records.length
          ? records.map((r) => ({
              cells: [
                `${[r.number, r.change_order_details.co_number].filter(Boolean).join(" / ")} · Revision ${r.revision} · Transmittal ${r.transmittal_number}`,
                r.title,
                ["draft", "priced"].includes(r.change_order_details.state)
                  ? `${r.change_order_details.state === "priced" ? "Priced · " : ""}Draft, not sent`
                  : r.change_order_details.state,
                [
                  r.change_order_details.total_cents == null
                    ? "Not priced"
                    : changeMoney(r.change_order_details.total_cents),
                  basisOf(r),
                ]
                  .filter(Boolean)
                  .join(" · "),
                r.change_order_details.due_date
                  ? `${r.change_order_details.due_date} · member target`
                  : "Due date needed",
                r.change_order_details.references.map(requestReferenceText).join("; "),
              ],
              href: r.record_url,
              flag: r.overdue ? ("overdue" as const) : null,
            }))
          : [
              {
                cells: [
                  payload.records.length
                    ? `No matching change orders. ${payload.records.length} on this log.`
                    : "No change orders on this job yet.",
                  "",
                  "",
                  "",
                  "",
                  "",
                ],
              },
            ],
      },
      ...(number && records.length === 1 ? changeSections(records[0].change_order_details) : []),
      ...(log_url
        ? [
            {
              heading: "Live log",
              kind: "chips" as const,
              rows: [
                { cells: ["Open live change-order log"], href: log_url, tone: "action" as const },
              ],
            },
          ]
        : []),
    ],
    next_move:
      "A change order the client approves on their client page joins the contract at once. Any other approved change joins it when you execute it with its supporting reference.",
  };
  return {
    card,
    records,
    log_url,
    counts: {
      total: payload.records.length,
      shown: records.length,
      overdue: rows.filter(late).length,
    },
  };
}
