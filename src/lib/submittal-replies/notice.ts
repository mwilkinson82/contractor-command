// The job notice for a returned submittal: the job's PM always, the job's supers by default (topic submittal_reply).
import { recordJobNotice, type NoticeDeps, type RecordedNotice } from "../notices/send";
import { submittalRecordPath } from "../submittal-record-page";
import { REPLY_ORIGIN } from "./reply-link";

/** What the reply functions return about one reply (mcp_private.submittal_reply_json). */
export type RecordedReply = {
  response_id: string;
  job_id: string;
  company_id: string;
  submittal_id: string;
  package_id: string;
  source: "page" | "email";
  action: string | null;
  action_label: string;
  review_status: string;
  reviewer_name: string | null;
  reviewer_email: string | null;
  sender_known: boolean | null;
  file_count: number;
  number: string;
  revision: number;
  title: string;
  job_number: string;
  job_name: string;
  company: string;
};

export function replyNotice(r: RecordedReply, comments?: string | null) {
  const who = r.reviewer_name?.trim() || r.reviewer_email || "The reviewer";
  const page = r.source === "page";
  const files = r.file_count
    ? r.file_count === 1
      ? "One file is attached."
      : `${r.file_count} files are attached.`
    : page
      ? "No file was attached."
      : "No file was attached. The email text is kept.";
  const note = comments?.trim() ? ` Their note: ${comments.trim().slice(0, 500)}` : "";
  const detail = page
    ? `${r.title}, revision ${r.revision}. The submittal log now shows ${r.action_label}. ${files}${note}`
    : `${r.title}, revision ${r.revision}. An emailed reply is not a status yet: confirm it on the board or ask Athena.${r.sender_known === false ? " It came from an address the package email did not go to." : ""} ${files}${note}`;
  return {
    jobId: r.job_id,
    topic: "submittal_reply" as const,
    kind: page ? "submittal_returned" : "submittal_reply_received",
    title: page
      ? `${who} returned submittal ${r.number}: ${r.action_label}`
      : `${who} replied about submittal ${r.number}`,
    detail,
    actor: who,
    refTable: "mcp_submittal_responses",
    refId: r.response_id,
    facts: {
      number: r.number,
      revision: r.revision,
      source: r.source,
      action: r.action,
      needs_review: !page,
      file_count: r.file_count,
    },
    boardPage: "submittals",
    dedupeKey: `submittal-reply:${r.response_id}`,
  };
}

/** Records the notice; the team email opens the submittal's own record page, which asks the member to sign in. */
export function recordReplyNotice(
  deps: Pick<NoticeDeps, "rpc" | "send">,
  r: RecordedReply,
  comments?: string | null,
): Promise<RecordedNotice | null> {
  return recordJobNotice(
    {
      ...deps,
      boardUrl: async () => `${REPLY_ORIGIN}${submittalRecordPath(r.job_id, r.number)}`,
    },
    replyNotice(r, comments),
  );
}
