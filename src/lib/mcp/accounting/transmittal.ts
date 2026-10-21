// Phase 4: transmittals. D10 (Marshall, 2026-10-20): numbered per job (T-001, T-002 …). Athena directs; the host builds
// the PDF and the email card. "Sent" is recorded only after the host confirms the send; Athena never sends.
import { addCountedDays, federalHolidays, diffDays } from "../deadlines";
import { ALERT_COLOR } from "../alert-color";
import { seqLabel } from "./foundations";

export const PURPOSES = ["for_approval", "for_review", "for_information", "for_record", "as_requested"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABEL: Record<Purpose, string> = { for_approval: "For approval", for_review: "For review and comment", for_information: "For information", for_record: "For record", as_requested: "As requested" };
/** Default turnaround in working days when the contract gives none; the contract clause wins when on file. */
export const DUE_BACK_WORKING_DAYS: Record<Purpose, number | null> = { for_approval: 10, for_review: 10, for_information: null, for_record: null, as_requested: null };

export const transmittalNumber = (n: number) => seqLabel("T-", n);

export function dueBack(purpose: Purpose, sentOn: string, contractDays?: number | null): string | null {
  const n = contractDays ?? DUE_BACK_WORKING_DAYS[purpose];
  if (n == null) return null;
  const y = Number(sentOn.slice(0, 4));
  return addCountedDays(sentOn, n, "working", new Set([...federalHolidays(y), ...federalHolidays(y + 1)]));
}

export type TransmittalItem = { ref: string; description?: string; copies?: number };
/** Every item must exist in a log or the job files; missing refs block the draft with an ask. */
export function missingItems(items: TransmittalItem[], known: Set<string>): string[] {
  return items.map((i) => i.ref).filter((r) => !known.has(r));
}

export function overdueBack(due: string | null, returned: string | null, asOf: string): number {
  if (!due || returned) return 0;
  return Math.max(0, diffDays(asOf, due));
}

export function emailCardSpec(t: { job_number: string; number: string; to: string; subject: string; file_name: string }): string[] {
  return [
    "EMAIL CARD (call email_draft for the draft card; Athena never sends):",
    `To: ${t.to}. Subject: ${t.subject}.`,
    `Attachment chip: ${t.file_name} attached as a real file (the generated PDF), not a link. If the host can't attach files, use file_share and put the link in the body.`,
    "Only a separate yes on the draft card (email_confirm_send) sends it. Never send it in the same reply.",
    `After the host confirms the send, call transmittal_mark_sent with host_confirmed true. Until then ${t.number} stays "Ready to send", never "Sent".`,
  ];
}

export const TRANSMITTAL_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – TRANSMITTAL: navy header bar \"Transmittal <T-nnn> · <job>\", then To / From / Date / Purpose / Due back, then the items table (ref, description, copies), then the remarks.",
  `Due back past with nothing returned shows "X days overdue" in ${ALERT_COLOR}; everything else stays navy, blue #2563EB and gray.`,
  "File: <job>-<T-nnn>-<date>.pdf.",
];
export const transmittalFile = (job: string, number: string, date: string) => `${job}-${number}-${date}.pdf`;
