import type { CardModel, CardSection } from "./cards/model";
import { requestContent, type RequestDetails } from "./package-purpose";
import { submittalRecordUrl, submittalLogUrl } from "./submittal-record-url";

export type RequestKind = "rfi" | "rfc";
export type RequestRow = {
  id: string;
  number: string;
  title: string;
  spec_section?: string;
  revision: number;
  state: "draft" | "sent" | "answered" | "closed";
  transmittal_number: number;
  request_details: RequestDetails;
};
export type RequestLogPayload = {
  job_id: string;
  job_number: string;
  job_name: string;
  today: string;
  read_only: boolean;
  records: RequestRow[];
};
export type RequestFilter = { state?: RequestRow["state"]; overdue?: boolean };

export function requestLogUrl(board: string | null | undefined, kind: RequestKind): string | null {
  const base = submittalLogUrl(board);
  if (!base) return null;
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/submittals$/, `/${kind}s`);
  return url.toString();
}

export function requestOverdue(row: RequestRow, today: string): boolean {
  return (
    row.state !== "answered" &&
    row.state !== "closed" &&
    !!row.request_details.due_date &&
    row.request_details.due_date < today
  );
}

export function requestSections(details: RequestDetails): CardSection[] {
  return [
    ...requestContent(details).map((section) => ({
      heading: section.heading,
      kind: "list" as const,
      rows: section.lines.map((value) => ({ cells: [value], raw: true, tone: "literal" as const })),
    })),
    ...(details.answer
      ? [
          {
            heading: "Answer · captured, closure is separate",
            kind: "list" as const,
            rows: [
              { cells: [details.answer.text], raw: true, tone: "literal" as const },
              { cells: [`From ${details.answer.received_from}`] },
            ],
          },
        ]
      : []),
  ];
}

export function requestLogCard(
  kind: RequestKind,
  payload: RequestLogPayload,
  board: string | null,
  filter: RequestFilter = {},
  selected?: string,
) {
  const all = payload.records;
  const rows = all.filter(
    (row) =>
      (!selected || row.number.toUpperCase() === selected.toUpperCase()) &&
      (!filter.state || row.state === filter.state) &&
      (!filter.overdue || requestOverdue(row, payload.today)),
  );
  const overdue = rows.filter((row) => requestOverdue(row, payload.today)).length;
  const logUrl = requestLogUrl(board, kind);
  const records = rows.map((row) => ({
    ...row,
    record_url: submittalRecordUrl(board, row.number),
    overdue: requestOverdue(row, payload.today),
  }));
  const card: CardModel = {
    state: "result",
    show_state: false,
    title: `${kind.toUpperCase()} log`,
    job: `${payload.job_number} – ${payload.job_name}`,
    kpis: [
      { label: "Shown", value: String(rows.length) },
      { label: "On this log", value: String(all.length) },
      { label: "Overdue", value: String(overdue), flag: overdue ? "overdue" : null },
    ],
    sections: [
      {
        heading:
          kind === "rfi" ? "Requests for information" : "Bid-stage requests for clarification",
        kind: "table",
        columns: ["Number", "Title", "State", "Ball in court", "Due", "Overdue", "Source"],
        rows: records.length
          ? records.map((row) => ({
              cells: [
                `${row.number} · Revision ${row.revision} · T-${row.transmittal_number}`,
                row.title,
                row.state === "draft"
                  ? "Draft, not sent"
                  : row.state[0].toUpperCase() + row.state.slice(1),
                row.state === "sent"
                  ? row.request_details.recipient_name || "Recipient not named"
                  : "Contractor",
                row.request_details.due_date
                  ? `${row.request_details.due_date} · member target`
                  : "Due date needed",
                row.overdue ? "Yes" : "No",
                row.request_details.references.map((r) => r.citation).join("; "),
              ],
              href: row.record_url,
              flag: row.overdue ? ("overdue" as const) : null,
            }))
          : [
              {
                cells: [
                  all.length
                    ? `No matching ${kind.toUpperCase()}s. ${all.length} on this log.`
                    : `No ${kind.toUpperCase()}s on this job yet.`,
                  "",
                  "",
                  "",
                  "",
                  "",
                  "",
                ],
              },
            ],
      },
      ...(selected && records.length === 1 ? requestSections(records[0].request_details) : []),
      ...(logUrl
        ? [
            {
              heading: "Live log",
              kind: "chips" as const,
              rows: [
                {
                  cells: [`Open live ${kind.toUpperCase()} log`],
                  href: logUrl,
                  tone: "action" as const,
                },
              ],
            },
          ]
        : []),
    ],
    next_move: payload.read_only
      ? "Read-only job view."
      : "Open a record to view its package, supporting documents and history.",
  };
  return {
    card,
    records,
    log_url: logUrl,
    counts: { total: all.length, shown: rows.length, overdue },
  };
}
