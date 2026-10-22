// Chase loop. Drafts only. The member confirms each send through email_confirm_send.
import { addDays } from "./deadlines";
import type { CardModel, CardRow } from "./cards/model";
import type { EmailDraft } from "./email-safety";
import type { ScheduleActivity } from "./schedule-submittals";
import { scheduleGroupOverdue } from "./schedule-submittals";
import { submittalOverdue, type SubmittalRecord, type PackageItem } from "./submittals";

export const CHASE_FOLLOW_DAYS = 7;

export const CHASE_SERVER_RULE =
  " When someone says chase the missing submittals, chase the submittals, or a submittal is overdue or a required package item is missing, call submittal_chase and show that card. Scheduled submittal groups that are not marked submitted are chase targets. The card includes one draft marked Not sent. Needs confirm. Do not send the chase in that reply. On yes, call email_confirm_send with confirmed true and the job number, and the submittal id only when the card has one. A follow-up that is due appears on the morning brief. Nothing is sent automatically.";

export type ChaseRow = {
  submittal_id: string;
  job_id?: string;
  job_number?: string;
  job_name?: string;
  number: string;
  revision: number;
  title: string;
  spec_section: string;
  status?: string;
  overdue: boolean;
  missing: string;
  chase_role?: string | null;
  chase_name?: string | null;
  chase_email?: string | null;
  chase_count: number;
  last_chased_at?: string | null;
  next_chase_at?: string | null;
  ball_in_court?: string;
  ball_in_court_name?: string | null;
  required_by?: string | null;
  submitted_on?: string | null;
  due_back?: string | null;
  returned_on?: string | null;
};

const RECEIVED = new Set(["received", "approved"]);

export function missingPackage(items: PackageItem[] | null | undefined): string {
  return (items ?? [])
    .filter((item) => item.required !== false && !RECEIVED.has(item.status))
    .map((item) => item.kind.replace(/_/g, " "))
    .join(", ");
}

/** A chase is due when the follow-up date has arrived, or it has never been chased and it is overdue or missing. */
export function chaseIsDue(row: ChaseRow, today: string): boolean {
  const next = (row.next_chase_at ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(next) && next <= today) return true;
  if ((row.chase_count ?? 0) > 0) return false;
  return row.overdue || !!row.missing;
}

export function chaseFromSubmittal(row: SubmittalRecord, today: string): ChaseRow | null {
  const missing = missingPackage(row.package_items);
  const overdue = submittalOverdue(row, today);
  const contact = (row.package_items ?? []).find((item) => item.chase_email && item.required !== false && !RECEIVED.has(item.status))
    ?? (row.package_items ?? []).find((item) => item.chase_email);
  const chase: ChaseRow = {
    submittal_id: row.id,
    number: row.number,
    revision: row.revision,
    title: row.title,
    spec_section: row.spec_section,
    status: row.status,
    overdue,
    missing,
    chase_role: contact?.chase_role ?? null,
    chase_name: contact?.chase_name ?? row.ball_in_court_name ?? null,
    chase_email: contact?.chase_email ?? null,
    chase_count: 0,
    ball_in_court: row.ball_in_court,
    ball_in_court_name: row.ball_in_court_name,
    required_by: row.required_by,
    submitted_on: row.submitted_on,
    due_back: row.due_back,
    returned_on: row.returned_on,
  };
  if (!overdue && !missing) return null;
  return chase;
}

export function nextChaseDate(today: string): string {
  return addDays(today.slice(0, 10), CHASE_FOLLOW_DAYS);
}

/** Scheduled packages that are not already logged as submitted. No id is invented for the send. */
export function chaseFromSchedule(groups: ScheduleActivity[], today: string): ChaseRow[] {
  return groups.map((group) => {
    const due = (group.finish ?? "").slice(0, 10);
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
    return {
      submittal_id: "",
      number: group.id,
      revision: 0,
      title: group.name,
      spec_section: "Needed",
      overdue: scheduleGroupOverdue(group, today),
      missing: "not submitted",
      chase_count: 0,
      required_by: dated,
      due_back: dated,
    };
  });
}

export function chaseDraft(jobNumber: string, row: ChaseRow): EmailDraft {
  const who = row.chase_name?.trim() || "there";
  const gap = row.missing ? `Still needed: ${row.missing}.` : "The submittal is still open.";
  const late = row.overdue ? `Due back ${row.due_back?.slice(0, 10) || "the required date"}. This one is overdue.` : `Due back ${row.due_back?.slice(0, 10) || "Needed"}.`;
  const body = [
    `${who},`,
    "",
    "This is a follow-up on one submittal.",
    "",
    `Job ${jobNumber}`,
    `Submittal ${row.number} revision ${row.revision}, ${row.title}`,
    `Spec section ${row.spec_section}`,
    late,
    gap,
    "",
    "Please send it back, or reply with the date it will be ready.",
  ].join("\n");
  return {
    to: row.chase_email?.trim() || null,
    cc: [],
    subject: `Job ${jobNumber} submittal ${row.number} follow-up`,
    body,
    link: null,
    attachment: null,
  };
}

export function presentChaseCard(input: {
  jobNumber: string;
  jobName: string;
  chases: ChaseRow[];
  today: string;
  readOnly?: boolean;
}): { text: string; card: CardModel; draft: EmailDraft | null; current: ChaseRow | null } {
  const due = input.chases.filter((row) => chaseIsDue(row, input.today));
  const current = due[0] ?? null;
  const draft = current && !input.readOnly ? chaseDraft(input.jobNumber, current) : null;
  const rows: CardRow[] = due.map((row, index) => ({
    cells: [
      `${row.number} revision ${row.revision}, ${row.title}`,
      row.chase_name?.trim() || "Needed",
      row.chase_email?.trim() || "Needed",
      String(row.chase_count),
      row.next_chase_at?.slice(0, 10) || "Now",
    ],
    flag: row.overdue ? "overdue" : null,
    tone: index === 0 ? "action" : "known",
    refId: row.submittal_id,
  }));
  const overdue = due.filter((row) => row.overdue).length;
  const card: CardModel = {
    state: draft ? "ask" : "result",
    title: "Submittal chase",
    show_state: false,
    job: `${input.jobNumber} – ${input.jobName}`,
    ask: draft ? { prompt: `Send this chase to ${draft.to || "the contact"}? Yes or no?` } : null,
    kpis: [
      { label: "Chases", value: String(due.length) },
      { label: "Overdue", value: String(overdue), flag: overdue ? "overdue" : null },
    ],
    sections: [
      {
        heading: "Due",
        kind: "table",
        columns: ["Submittal", "Who", "Email", "Times", "Next"],
        rows,
      },
      ...(draft
        ? [{
            heading: "Draft",
            kind: "list" as const,
            rows: [
              { cells: ["Not sent. Needs confirm."], tone: "action" as const },
              { cells: [`To: ${draft.to || "Needed"}`], tone: "action" as const },
              { cells: [`Subject: ${draft.subject}`] },
              { cells: [draft.body], raw: true },
            ],
          }]
        : []),
    ],
    next_move: input.readOnly
      ? "Read only. Ask the PM to send the chase."
      : draft
        ? "Nothing is sent until you say yes."
        : "No chase is due.",
  };
  const lines = due.map((row) => `- ${row.number} revision ${row.revision}, ${row.title}. ${row.chase_name || "Needed"}. Chased ${row.chase_count} time${row.chase_count === 1 ? "" : "s"}.${row.overdue ? " Overdue." : ""}`);
  const text = [
    `${input.jobNumber} – ${input.jobName}`,
    `Submittal chase: ${due.length} due, ${overdue} overdue.`,
    "",
    lines.length ? lines.join("\n") : "No chase is due.",
    draft ? `\nNot sent. Needs confirm.\n\nTo: ${draft.to || "Needed"}\nSubject: ${draft.subject}\n\n${draft.body}\n\nSend this chase to ${draft.to || "the contact"}? Yes or no?` : "",
    input.readOnly ? "\nRead only." : "",
  ].join("\n");
  return { text, card, draft, current };
}

export function chaseHeaderMatches(card: CardModel): boolean {
  const rows = card.sections?.find((section) => section.heading === "Due")?.rows ?? [];
  const total = card.kpis?.find((kpi) => kpi.label === "Chases")?.value;
  const late = card.kpis?.find((kpi) => kpi.label === "Overdue")?.value;
  return total === String(rows.length) && late === String(rows.filter((row) => row.flag === "overdue").length);
}

/** Morning-brief rows. One line per due chase. Red only when that chase is overdue. */
export function chaseBriefRows(chases: ChaseRow[]): CardRow[] {
  return chases.map((row) => ({
    cells: [`${row.job_number ?? ""} ${row.number} revision ${row.revision}, ${row.title}. Chase ${row.chase_name || "the contact"}.`.replace(/\s+/g, " ").trim()],
    flag: row.overdue ? "overdue" : null,
    refId: row.submittal_id,
  }));
}
