// Project record for disputes and claims. One insert path: mcp_project_record_add.
// Submittal writes call that function inside the same transaction (mcp_submittal_record).
// This helper is what other tools call. email_reply is reserved and has no writer yet.
import { taskListFlag } from "./delay-notice";
import type { CardModel, CardRow } from "./cards/model";
import { dbError, isMissingFunction, type Sb } from "./guard";
import { ToolError } from "@lovable.dev/mcp-js";

export const EMAIL_REPLY_KIND = "email_reply";

export const PROJECT_RECORD_RULE =
  " When someone asks for the project record or what happened on a job, call project_record_search and show that card. The default card is the job record: the schedule of values, open items, and overdue items. Call it for disputes or claims only when the member asks for disputes or claims. Do not add text after the card. A reply outcome is not logged yet.";

export type RecordActor = "user" | "athena";

export type RecordEventInput = {
  jobId: string;
  kind: string;
  title: string;
  summary: string;
  counterpartyName?: string | null;
  counterpartyEmail?: string | null;
  refTable?: string | null;
  refId?: string | null;
  payload?: Record<string, unknown> | null;
  actor?: RecordActor;
};

export type RecordEvent = {
  id: string;
  occurred_at: string;
  actor: string;
  kind: string;
  title: string;
  summary: string;
  counterparty_name?: string | null;
  counterparty_email?: string | null;
  ref_table?: string | null;
  ref_id?: string | null;
};

/** Words for the card. The stored kind keeps its code. */
export function kindLabel(kind: string): string {
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Append one project-record event. Returns null when the record function is not installed yet.
 * email_reply is not written here. A later pass calls this with kind email_reply and a payload outcome.
 */
export async function recordEvent(sb: Sb, input: RecordEventInput): Promise<string | null> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>)(
    "mcp_project_record_add",
    {
      _job: input.jobId,
      _kind: input.kind,
      _title: input.title,
      _summary: input.summary,
      _counterparty_name: input.counterpartyName ?? null,
      _counterparty_email: input.counterpartyEmail ?? null,
      _ref_table: input.refTable ?? null,
      _ref_id: input.refId ?? null,
      _payload: input.payload ?? {},
      _actor: input.actor ?? "user",
    },
  );
  if (error) {
    if (isMissingFunction(error)) return null;
    dbError(error);
  }
  return typeof data === "string" ? data : null;
}

/** Disputes and claims stay on the event file. Every other project-record ask is the job record. */
export function isDisputeAsk(kind?: string | null, text?: string | null): boolean {
  return /\b(?:dispute|claim)s?\b/i.test(`${kind ?? ""} ${text ?? ""}`);
}

export function presentJobRecord(input: {
  jobNumber: string;
  jobName: string;
  contractTotal: string | null;
  open: number;
  overdue: number;
  items: { action: string; due: string; overdue: boolean }[];
}): { text: string; card: CardModel } {
  const money = input.contractTotal ?? "Needed";
  const lines = input.items.map((item) => `- ${item.action}${item.due ? `. Due ${item.due}.` : ""}${item.overdue ? " Overdue." : ""}`);
  const text = [
    `${input.jobNumber} – ${input.jobName}`,
    "Project record",
    `Schedule of values: ${money}`,
    `Open items: ${input.open} open, ${input.overdue} overdue.`,
    "",
    lines.length ? lines.join("\n") : "No open items.",
  ].join("\n");
  const card: CardModel = {
    state: "result",
    show_state: false,
    title: "Project record",
    job: `${input.jobNumber} – ${input.jobName}`,
    kpis: [
      { label: "Schedule of values", value: money },
      { label: "Open", value: String(input.open) },
      { label: "Overdue", value: String(input.overdue), flag: input.overdue ? "overdue" : null },
    ],
    sections: [
      { heading: "Schedule of values", kind: "list", rows: [{ cells: [money], tone: "known" }] },
      {
        heading: "Open items",
        kind: "list",
        rows: input.items.length
          ? input.items.map((item) => ({ cells: [item.action, item.due || "Needed"], flag: taskListFlag(item, item.overdue) }))
          : [{ cells: ["No open items."] }],
      },
    ],
    next_move: input.overdue ? "Close the overdue item first." : "This is the job record.",
  };
  return { text, card };
}

export function presentProjectRecord(input: {
  jobNumber: string;
  jobName: string;
  events: RecordEvent[];
  note?: string | null;
}): { text: string; card: CardModel } {
  const events = input.events;
  const rows: CardRow[] = events.map((event) => {
    const when = (event.occurred_at ?? "").slice(0, 10) || "Needed";
    const who = [event.counterparty_name, event.counterparty_email].filter(Boolean).join(", ");
    return {
      cells: [event.title, kindLabel(event.kind), when, who || "Needed", event.summary],
      refId: event.id,
    };
  });
  const card: CardModel = {
    state: "result",
    title: "Project record",
    show_state: false,
    job: `${input.jobNumber} – ${input.jobName}`,
    kpis: [{ label: "Events", value: String(events.length) }],
    sections: [
      {
        heading: "Record",
        kind: "table",
        columns: ["Event", "Kind", "Date", "Counterparty", "Summary"],
        rows,
      },
    ],
    next_move: events.length ? "This record is append-only." : "Nothing on the record for that search.",
  };
  const lines = events.map((event) => `- ${(event.occurred_at ?? "").slice(0, 10)} ${kindLabel(event.kind)}. ${event.title}. ${event.summary}`);
  const note = input.note?.trim() ? `${input.note.trim()}\n\n` : "";
  const text = `${note}${input.jobNumber} – ${input.jobName}\nProject record: ${events.length} events.\n\n${lines.length ? lines.join("\n") : "Nothing on the record for that search."}`;
  return { text, card };
}

export function recordHeaderMatches(card: CardModel): boolean {
  const rows = card.sections?.find((section) => section.heading === "Record")?.rows ?? [];
  return card.kpis?.find((kpi) => kpi.label === "Events")?.value === String(rows.length);
}

export function assertRecorded(id: string | null): void {
  if (!id) throw new ToolError("The project record is not available yet. Nothing else was changed.");
}
