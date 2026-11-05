import { emailShell, esc } from "@/lib/email/athena-shell";
import type { PortalEmail } from "@/lib/customer-portal/email";

/**
 * Job notices: one record for every client and field action on a job (a customer approving a change order, a
 * client question, an architect returning a submittal, a supplier confirming a look-ahead date, a sub signing).
 * The record feeds the project board's "What's new", the account page and the morning brief, and emails the
 * people the job's PM chose for that kind of notice (supabase/migrations/20261105150000_athena_job_notices.sql).
 */
export const NOTICE_TOPICS = [
  "client_decision",
  "client_message",
  "submittal_reply",
  "field_confirm",
  "sub_contract",
] as const;
export type NoticeTopic = (typeof NOTICE_TOPICS)[number];

export const TOPIC_LABEL: Record<NoticeTopic, string> = {
  client_decision: "Client approvals and choices",
  client_message: "Client questions and messages",
  submittal_reply: "Submittal replies",
  field_confirm: "Supplier and sub date confirmations",
  sub_contract: "Subcontract signatures",
};

export type JobNoticeInput = {
  jobId: string;
  topic: NoticeTopic;
  /** Lower snake case, like co_approved or lookahead_confirmed. */
  kind: string;
  /** One line the team reads first, like "Rosa Delgado approved CO-003". */
  title: string;
  detail?: string | null;
  /** Who did it, as they gave their name. */
  actor?: string | null;
  refTable?: string | null;
  refId?: string | null;
  /** Small facts the board can show (amount_cents, days, date). Never cost, markup or fees. */
  facts?: Record<string, unknown>;
  /** The board section it belongs to, like cos, submittals, lookahead, messages. */
  boardPage?: string | null;
  /** Same key, same notice: a retried webhook or double click records and emails once. */
  dedupeKey?: string | null;
};

export type RecordedNotice = {
  notice_id: string;
  created: boolean;
  topic: NoticeTopic;
  title: string;
  detail: string | null;
  actor: string | null;
  job_number: string;
  job_name: string;
  company: string;
  recipients: { email: string; role: string }[];
};

export type NoticeDeps = {
  /** A service-role rpc: mcp_job_notice_record and mcp_job_notice_email_result are server only. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  send: (m: PortalEmail) => Promise<"sent" | "off" | "failed">;
  /** Where the team opens the job's board, when the caller has a link. */
  boardUrl?: (jobId: string) => Promise<string | null>;
};

const HEADING: Record<NoticeTopic, string> = {
  client_decision: "Your client made a decision",
  client_message: "Your client sent a message",
  submittal_reply: "A submittal came back",
  field_confirm: "A date was confirmed",
  sub_contract: "A subcontract was signed",
};

/** The team email for one notice. Team emails are Athena's own, so Athena leads up top. */
export function noticeTeamEmail(n: RecordedNotice, to: string, board: string | null): PortalEmail {
  const where = `${n.job_number} ${n.job_name}`.trim();
  const line = `${n.title} on ${where}.`;
  const foot = board
    ? "You get this because the job's PM chose these emails for your role. They can change it on the job board."
    : "Ask Athena for what's new on this job to see it. The job's PM chooses who gets these emails.";
  return {
    to,
    key: `job-notice:${n.notice_id}:${to.toLowerCase()}`,
    subject: `${where}: ${n.title}`.slice(0, 180),
    text: [
      line,
      ...(n.detail ? ["", n.detail] : []),
      ...(board ? ["", `Open the job board: ${board}`] : []),
      "",
      foot,
    ].join("\n"),
    html: emailShell({
      brand: "athena",
      tagline: "Athena powered by ALP",
      preview: line,
      heading: HEADING[n.topic],
      lines: [esc(line), ...(n.detail ? [esc(n.detail)] : [])],
      ...(board ? { button: { href: board, label: "Open the job board" } } : {}),
      foot: esc(foot),
      legal: "Athena powered by ALP · app.meetathena.io",
    }),
  };
}

/**
 * Records the notice and emails each chosen person once. A repeat with the same dedupe key sends nothing. A failed
 * email never undoes the client's action: it is kept as failed on the notice so the board still shows it.
 */
export async function recordJobNotice(
  deps: NoticeDeps,
  input: JobNoticeInput,
): Promise<RecordedNotice | null> {
  const n = (await deps
    .rpc("mcp_job_notice_record", {
      _job: input.jobId,
      _topic: input.topic,
      _kind: input.kind,
      _title: input.title.slice(0, 200),
      _detail: input.detail ? input.detail.slice(0, 2000) : null,
      _actor: input.actor ? input.actor.slice(0, 120) : null,
      _ref_table: input.refTable ?? null,
      _ref_id: input.refId ?? null,
      _facts: input.facts ?? {},
      _board_page: input.boardPage ?? null,
      _dedupe_key: input.dedupeKey ? input.dedupeKey.slice(0, 200) : null,
    })
    .catch(() => null)) as RecordedNotice | null;
  if (!n?.notice_id) return null;
  if (!n.created || !n.recipients?.length) return n;
  const board = deps.boardUrl ? await deps.boardUrl(input.jobId).catch(() => null) : null;
  for (const r of n.recipients) {
    const status = await deps
      .send(noticeTeamEmail(n, r.email, board))
      .catch(() => "failed" as const);
    await deps
      .rpc("mcp_job_notice_email_result", {
        _notice: n.notice_id,
        _email: r.email,
        _status: status,
      })
      .catch(() => null);
  }
  return n;
}
