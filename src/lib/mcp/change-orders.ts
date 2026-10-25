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
  execution?: { by: string; at: string; reference: string; sov_item: string } | null;
};
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
                : line.unit_rate_cents == null
                  ? "Rate needed"
                  : changeMoney(line.unit_rate_cents),
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
        ...(details.owner_number ? [{ cells: [`Owner's number: ${details.owner_number}`] }] : []),
        ...(details.decision
          ? [{ cells: [`Decision by ${details.decision.by} · ${details.decision.reference}`] }]
          : []),
        ...(details.execution
          ? [
              {
                cells: [
                  `Executed · ${details.execution.reference} · SOV ${details.execution.sov_item}`,
                ],
              },
            ]
          : []),
      ],
    },
  ];
}
export function changeLogCard(
  payload: ChangeLogPayload,
  board: string | null,
  filter: { state?: ChangeDetails["state"]; overdue?: boolean } = {},
  number?: string,
) {
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
    job: `${payload.job_number} – ${payload.job_name}`,
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
                `${[r.number, r.change_order_details.co_number].filter(Boolean).join(" / ")} · Revision ${r.revision} · T-${r.transmittal_number}`,
                r.title,
                ["draft", "priced"].includes(r.change_order_details.state)
                  ? `${r.change_order_details.state === "priced" ? "Priced · " : ""}Draft, not sent`
                  : r.change_order_details.state,
                r.change_order_details.total_cents == null
                  ? "Not priced"
                  : changeMoney(r.change_order_details.total_cents),
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
      "A priced or approved proposal does not change billing. Execution is a separate confirmed action with its supporting reference.",
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
