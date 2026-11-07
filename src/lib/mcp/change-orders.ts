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
/** How the record says the change reached the contract, as the change order page says it. The SOV line and the
 * client's decision id sit with the approval proof on that page, never in this line. */
export function executionLine(execution: NonNullable<ChangeDetails["execution"]>): string {
  const lead =
    execution.channel === "customer_page"
      ? "Added to the contract by the client's approval"
      : "Added to the contract";
  return execution.contract_before_cents != null && execution.contract_after_cents != null
    ? `${lead}: ${changeMoney(execution.contract_before_cents)} → ${changeMoney(execution.contract_after_cents)}`
    : execution.contract_after_cents != null
      ? `${lead} · Contract value now ${changeMoney(execution.contract_after_cents)}`
      : lead;
}
const UUID = /\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Record text without raw ids: "Signed package choice, customer page decision 92f3…" reads "Signed package choice,
 * customer page decision". The ids stay in the saved record and on the page's approval proof. */
export const withoutIds = (text: string) =>
  text
    .replace(UUID, "")
    .replace(/\s{2,}/g, " ")
    .trim();
/** A client's page decision is approval proof, not a construction reference: the card leaves it out, as the page does. */
export const isApprovalProof = (citation: string) =>
  /^Customer page decision\b/i.test(citation.trim());
/** "Marshall Wilkinson <m@x.com>" reads "Marshall Wilkinson". */
export const personName = (by: string | null | undefined) => {
  const raw = (by ?? "").trim();
  const m = /^(.*?)\s*<([^>]+)>$/.exec(raw);
  return m ? m[1].trim() || "Not recorded" : raw || "Not recorded";
};
/** True when the client approved it on their client page. */
const fromClientPage = (d: ChangeDetails) =>
  (d.decision as { channel?: string } | null | undefined)?.channel === "customer_page";
/** The state as the change order page names it. */
export function changeStateLabel(d: ChangeDetails): string {
  switch (d.state) {
    case "executed":
      return "On the contract";
    case "approved":
      return "Approved, not on the contract yet";
    case "rejected":
      return "Declined";
    case "submitted":
      return "Waiting on approval";
    case "priced":
      return "Priced, not sent";
    default:
      return "Draft, not sent";
  }
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
/** Drawing, spec, contract and condition references; a client's page decision is approval proof instead. */
const constructionRefs = (details: ChangeDetails) =>
  details.references.filter((ref) => !isApprovalProof(ref.citation));
/** Who decided and how, by name only. A client's decision id and email sit with the page's approval proof. */
function decisionLine(details: ChangeDetails): string {
  const decision = details.decision as
    | (NonNullable<ChangeDetails["decision"]> & { email_code_verified?: boolean })
    | null
    | undefined;
  if (!decision) return "";
  const verb = details.state === "rejected" ? "Declined" : "Approved";
  if (fromClientPage(details))
    return `${verb} by ${personName(decision.by)} on the client page${decision.email_code_verified ? " with an emailed code" : ""}, signed with their typed name`;
  const ref = withoutIds(decision.reference ?? "");
  return `${verb} by ${personName(decision.by)}${ref ? ` · ${ref}` : ""}`;
}
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
      rows: constructionRefs(details).length
        ? constructionRefs(details).map((ref) => ({
            cells: [requestReferenceText(ref)],
            raw: true,
            tone: "literal" as const,
          }))
        : [
            {
              cells: [
                fromClientPage(details)
                  ? "The client's signed approval on their client page"
                  : "None recorded",
              ],
            },
          ],
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
              withoutIds(line.source),
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
        ...(details.decision ? [{ cells: [decisionLine(details)] }] : []),
        ...(details.state === "executed" && details.execution
          ? [{ cells: [executionLine(details.execution)] }]
          : details.state === "approved"
            ? [{ cells: ["Approved. It joins the contract when it is executed."] }]
            : []),
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
const GENERAL_NEXT =
  "A change order the client approves on their client page joins the contract at once. Any other approved change joins it when you execute it with its supporting reference.";
/** What happens next for the one change order shown, read from its saved state; the general rule otherwise. */
function nextMove(row: ChangeRow | null): string {
  if (!row) return GENERAL_NEXT;
  const d = row.change_order_details;
  const name = d.co_number?.trim() || row.number;
  if (d.state === "executed") {
    const e = d.execution;
    const how = e?.channel === "customer_page" ? " by the client's approval" : "";
    const value =
      e?.contract_before_cents != null && e.contract_after_cents != null
        ? `: ${changeMoney(e.contract_before_cents)} → ${changeMoney(e.contract_after_cents)}`
        : "";
    return `${name} is on the contract${how}${value}. Nothing else to do.`;
  }
  if (d.state === "approved")
    return `${name} is approved. It joins the contract when you execute it with its supporting reference.`;
  return GENERAL_NEXT;
}
/** For the member's AI: an executed change order is already in the contract value and SOV. */
export const EXECUTED_GUIDANCE =
  "A change order whose status reads On the contract is executed: it is already in the contract value and has its own SOV line, as the board shows. Say so plainly. Never call change_order_record with action execute for it, and never say it is blocked, pending execution or not yet executed.";
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
                changeStateLabel(r.change_order_details),
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
                constructionRefs(r.change_order_details).map(requestReferenceText).join("; ") ||
                  (fromClientPage(r.change_order_details)
                    ? "Client's signed approval"
                    : "None recorded"),
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
    next_move: nextMove(number && records.length === 1 ? records[0] : null),
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
