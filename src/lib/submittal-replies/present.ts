// Returned submittals in chat and on the submittal log card. Team facing.
import type { CardModel } from "../mcp/cards/model";

export type ReplyRow = {
  id: string;
  submittal_id: string;
  number: string;
  revision: number;
  title: string;
  submittal_status: string;
  source: "page" | "email";
  action: string | null;
  action_label: string;
  review_status: "recorded" | "needs_review" | "confirmed" | "dismissed";
  reviewer_name: string | null;
  reviewer_email: string | null;
  sender_known: boolean | null;
  subject: string | null;
  comments: string | null;
  files: { filename?: string }[];
  received_at: string;
  confirmed_at: string | null;
  confirmed_by_name: string | null;
};

export type ReplyList = { can_confirm: boolean; needs_review: number; replies: ReplyRow[] };

const day = (iso: string | null | undefined) => (iso ?? "").slice(0, 10);

function state(r: ReplyRow): string {
  switch (r.review_status) {
    case "recorded":
      return `${r.action_label}, on the log`;
    case "confirmed":
      return `${r.action_label}, confirmed${r.confirmed_by_name ? ` by ${r.confirmed_by_name}` : ""}`;
    case "dismissed":
      return "Not a return";
    default:
      return "Received, needs review";
  }
}

function who(r: ReplyRow): string {
  const name = r.reviewer_name?.trim() || r.reviewer_email || "Reviewer";
  return r.sender_known === false ? `${name} (not on the package email)` : name;
}

export function presentReplies(
  jobNumber: string,
  jobName: string,
  list: ReplyList,
  note?: string,
): { text: string; card: CardModel } {
  const rows = list.replies.map((r) => ({
    cells: [
      r.number,
      who(r),
      r.source === "page" ? "Return page" : "Email",
      day(r.received_at),
      state(r),
      r.files.length ? String(r.files.length) : "None",
    ],
    tone: r.review_status === "needs_review" ? ("action" as const) : ("known" as const),
    refId: r.id,
  }));
  const comments = list.replies
    .filter((r) => r.comments?.trim())
    .slice(0, 5)
    .map((r) => ({
      cells: [`${r.number}, ${who(r)}: ${r.comments!.trim().slice(0, 600)}`],
      tone: "literal" as const,
      raw: true,
    }));
  const card: CardModel = {
    state: "result",
    title: "Returned submittals",
    show_state: false,
    job: `${jobNumber} ${jobName}`.trim(),
    kpis: [
      { label: "Returns", value: String(list.replies.length) },
      { label: "Need your review", value: String(list.needs_review) },
    ],
    sections: [
      ...(note
        ? [
            {
              heading: "Saved",
              kind: "list" as const,
              rows: [{ cells: [note], tone: "known" as const }],
            },
          ]
        : []),
      rows.length
        ? {
            heading: "Replies",
            kind: "table" as const,
            columns: ["Submittal", "From", "How", "Received", "Status", "Files"],
            rows,
          }
        : {
            heading: "Replies",
            kind: "list" as const,
            rows: [{ cells: ["No submittal has come back yet."], tone: "unknown" as const }],
          },
      ...(comments.length
        ? [{ heading: "What they wrote", kind: "list" as const, rows: comments }]
        : []),
    ],
    next_move:
      list.needs_review && list.can_confirm
        ? "Tell me the status for each emailed reply (approved, approved as noted, revise and resubmit, rejected, for record only), or say it isn't a return."
        : null,
  };
  const lines = [
    `Returned submittals for ${card.job}: ${list.replies.length}, ${list.needs_review} need review.`,
    ...list.replies.map(
      (r) =>
        `- ${r.number} from ${who(r)} by ${r.source === "page" ? "the return page" : "email"} ${day(r.received_at)}: ${state(r)}. Reply id ${r.id}.`,
    ),
  ];
  return { text: lines.join("\n"), card };
}
