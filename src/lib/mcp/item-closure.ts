import { sha256Hex } from "./file-share";
import type { CardModel } from "./cards/model";

export type ClosureItem = {
  id: string;
  action?: string | null;
  accountable?: string | null;
  owner?: string | null;
  needed_by?: string | null;
  due_date?: string | null;
  updated_at?: string | null;
};
export type ClosureRequest = {
  kind: string;
  evidence?: string;
  stated_by?: string;
  stated_on?: string;
  reason?: string;
  approval?: string;
  billing?: string;
  collection?: string;
};

/** A commitment to the reviewed item snapshot and proposed resolution, not an access token. */
export async function itemClosureKey(
  jobId: string,
  userId: string | undefined,
  item: ClosureItem,
  request: ClosureRequest,
): Promise<string> {
  const proposed = [
    request.kind,
    request.evidence,
    request.stated_by,
    request.stated_on,
    request.reason,
    request.approval,
    request.billing,
    request.collection,
  ].map((value) => value?.trim() ?? "");
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify([
        "athena-item-closure-v1",
        jobId,
        userId ?? null,
        item.id,
        item.action ?? null,
        item.accountable?.trim() || item.owner?.trim() || null,
        item.needed_by || item.due_date || null,
        item.updated_at ?? null,
        proposed,
      ]),
    ),
  );
}

/** Acknowledge only the outcome returned by the existing database write. */
export function itemClosureOutcome(job: string, message: string, closed: boolean): CardModel {
  return {
    state: "result",
    show_state: false,
    title: closed ? "Item closed" : "Item updated — still open",
    job,
    sections: [{ heading: "Saved result", kind: "list", rows: [{ cells: [message] }] }],
    next_move: null,
  };
}

export function itemClosurePreview(
  job: string,
  item: ClosureItem,
  ref: string,
  request: ClosureRequest,
  key: string | null,
  evidenceAsk?: string,
) {
  const title = (item.action ?? "Open item").replace(/^\S+ – /, "");
  const owner = item.accountable?.trim() || item.owner?.trim() || null;
  const due = item.needed_by || item.due_date || null;
  const resolution =
    (
      {
        verified: "Close as verified",
        member_statement: "Close as member statement",
        waive: "Waive",
        commercial_close: "Close commercially",
      } as Record<string, string>
    )[request.kind] ?? "Close";
  const question = evidenceAsk ?? `${resolution} ${ref} — ${title}? Yes or no?`;
  const details = [
    ["Resolution", resolution],
    ["Evidence", request.evidence],
    ["Stated by", request.stated_by],
    ["Stated on", request.stated_on],
    ["Reason", request.reason],
    ["Approval", request.approval],
    ["Billing", request.billing],
    ["Collection", request.collection],
  ]
    .filter(([, value]) => value?.trim())
    .map(([label, value]) => ({
      cells: [`${label}:\n${value!.trim()}`],
      tone: "literal" as const,
    }));
  const card: CardModel = {
    state: "ask",
    show_state: false,
    title: "Review item closure",
    job,
    sections: [
      {
        heading: "Selected item — still open",
        kind: "list",
        rows: [
          {
            cells: [
              `${ref} — ${title}`,
              `Owner: ${owner ?? "Owner needed"}`,
              `Due: ${due ?? "Due date needed"}`,
            ],
          },
        ],
      },
      { heading: "Proposed resolution", kind: "list", rows: details },
    ],
    ask: { prompt: question },
    next_move: null,
  };
  return {
    card,
    selected_items: [
      {
        item_id: item.id,
        item_ref: ref,
        action: title,
        owner,
        due,
      },
    ],
    confirmation_key: key,
    confirmation_required: true,
    evidence_required: !!evidenceAsk,
    closed: false,
    question,
  };
}
