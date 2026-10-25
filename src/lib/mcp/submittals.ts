// Living submittal log. Dates follow deadlines.ts: calendar days, job time zone, never rolled later.
// Package assembly and delivery use these same revision and item records.
import { addDays } from "./deadlines";
import { submittalRecordUrl, submittalPackageUrl, submittalLogUrl, submittalUploadUrl } from "./submittal-record-url";
import type { CardModel, CardRow, CardSection } from "./cards/model";
import { scheduleGroupOverdue, type ScheduleActivity, type TrackingItem } from "./schedule-submittals";

export const DEFAULT_REVIEW_DAYS = 14;

export const SUBMITTAL_TYPES = ["product_data", "shop_drawing", "sample", "other"] as const;
export const SUBMITTAL_STATUSES = [
  "not_started",
  "in_prep",
  "submitted",
  "in_review",
  "approved",
  "approved_as_noted",
  "revise_and_resubmit",
  "rejected",
  "closed",
  "void",
] as const;
export const BALL_PARTIES = ["sub", "gc", "architect_engineer", "owner"] as const;
export const PACKAGE_KINDS = ["product_cut", "shop_drawing", "sample", "calc", "warranty", "other"] as const;
export const PACKAGE_STATUSES = ["needed", "requested", "received", "approved"] as const;
export const CHASE_ROLES = ["supplier", "manufacturer", "sub"] as const;

export type SubmittalType = (typeof SUBMITTAL_TYPES)[number];
export type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];
export type BallParty = (typeof BALL_PARTIES)[number];
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];
export type ChaseRole = (typeof CHASE_ROLES)[number];

export const TYPE_LABEL: Record<SubmittalType, string> = {
  product_data: "Product data",
  shop_drawing: "Shop drawing",
  sample: "Sample",
  other: "Other",
};
export const STATUS_LABEL: Record<SubmittalStatus, string> = {
  not_started: "Not started",
  in_prep: "In prep",
  submitted: "Submitted",
  in_review: "In review",
  approved: "Approved",
  approved_as_noted: "Approved as noted",
  revise_and_resubmit: "Revise and resubmit",
  rejected: "Rejected",
  closed: "Closed",
  void: "Void",
};
export const BALL_LABEL: Record<BallParty, string> = {
  sub: "Sub",
  gc: "GC",
  architect_engineer: "Architect or engineer",
  owner: "Owner",
};
export const PACKAGE_KIND_LABEL: Record<PackageKind, string> = {
  product_cut: "Product cut / product data",
  shop_drawing: "Shop drawing",
  sample: "Sample",
  calc: "Calc",
  warranty: "Warranty",
  other: "Other",
};
export const PACKAGE_STATUS_LABEL: Record<PackageStatus, string> = {
  needed: "Needed",
  requested: "Requested",
  received: "Received",
  approved: "Approved",
};
export const CHASE_ROLE_LABEL: Record<ChaseRole, string> = {
  supplier: "Supplier",
  manufacturer: "Manufacturer",
  sub: "Sub",
};

const RECEIVED: ReadonlySet<string> = new Set(["received", "approved"]);

export type PackageItem = {
  id?: string | null;
  kind: string;
  source_party: string;
  file_ref?: string | null;
  status: string;
  required?: boolean | null;
  requested_at?: string | null;
  received_at?: string | null;
  chase_role?: string | null;
  chase_name?: string | null;
  chase_email?: string | null;
  last_chased_at?: string | null;
  next_chase_at?: string | null;
  chase_count?: number | null;
};

export type SubmittalSource = "spec_derived" | "user" | "imported";
export type SubmittalPosture = "strict" | "advisory";

export type SubmittalRecord = {
  change_order_history?: {record_version:number;action:string;created_at:string;snapshot:import("./change-orders").ChangeDetails}[];
  change_order_details?: import("./change-orders").ChangeDetails | null;
  package_purpose?: import("./package-purpose").PackagePurpose;
  request_details?: import("./package-purpose").RequestDetails | null;
  id: string;
  number: string;
  revision: number;
  previous_id?: string | null;
  transmittal_number: number;
  submission_sent_at?: string | null;
  has_package?: boolean;
  built_package?: { id: string; filename: string; page_count: number; cover_date?: string | null; sent_at?: string | null } | null;
  spec_section: string;
  title: string;
  submittal_type: string;
  status: string;
  ball_in_court: string;
  ball_in_court_name?: string | null;
  source?: string | null;
  required?: boolean | null;
  not_required_reason?: string | null;
  spec_excerpt?: string | null;
  required_by?: string | null;
  submitted_on?: string | null;
  due_back?: string | null;
  returned_on?: string | null;
  notes?: string | null;
  review_days?: number | null;
  package_items?: PackageItem[] | null;
};

/** public_job yes is public (strict). public_job no is private (advisory). A stored posture wins. */
export function resolvePosture(set: string | null | undefined, publicJob: string | null | undefined): SubmittalPosture | null {
  if (set === "strict" || set === "advisory") return set;
  if (publicJob === "yes") return "strict";
  if (publicJob === "no") return "advisory";
  return null;
}

export function postureSentence(posture: SubmittalPosture | null): string {
  if (posture === "strict") return "Strict. On a public job, what the specs say gets installed must be submitted, and nothing goes in without the engineer's approval.";
  if (posture === "advisory") return "Advisory. On a private job, Athena raises the package and defers to you.";
  return "Posture is unset. Public work uses strict. Private work uses advisory.";
}

export function sourceLine(row: Pick<SubmittalRecord, "source" | "required" | "not_required_reason">): string {
  if (row.source === "spec_derived" && row.required === false) return `From the spec. Not required: ${row.not_required_reason?.trim() || "reason needed"}.`;
  if (row.source === "spec_derived") return "From the spec. Required.";
  if (row.source === "imported") return "Imported.";
  return "Entered here.";
}

export type SubmittalFilter = {
  status?: string | null;
  overdue?: boolean | null;
  ball?: string | null;
  today: string;
};

/** Submitted date plus the job's review turnaround, in calendar days. No weekend roll. */
export function dueBackDate(submittedOn: string | null | undefined, reviewDays: number | null | undefined): string | null {
  const day = (submittedOn ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const n = reviewDays == null || !Number.isFinite(reviewDays) ? DEFAULT_REVIEW_DAYS : Math.trunc(reviewDays);
  const days = n >= 1 && n <= 365 ? n : DEFAULT_REVIEW_DAYS;
  return addDays(day, days);
}

/**
 * Overdue when due back has passed and nothing has been returned,
 * or required-by has passed and it has not been submitted.
 */
export function submittalOverdue(
  row: Pick<SubmittalRecord, "required_by" | "submitted_on" | "due_back" | "returned_on">,
  today: string,
): boolean {
  const dueBack = (row.due_back ?? "").slice(0, 10);
  const required = (row.required_by ?? "").slice(0, 10);
  const pastDueBack = /^\d{4}-\d{2}-\d{2}$/.test(dueBack) && dueBack < today && !row.returned_on;
  const pastRequired = /^\d{4}-\d{2}-\d{2}$/.test(required) && required < today && !row.submitted_on;
  return pastDueBack || pastRequired;
}

/** Complete only when every required package item has been received or approved. An empty package is not complete. */
export function packageProgress(items: Pick<PackageItem, "status" | "required" | "file_ref">[] | null | undefined): {
  required: number;
  received: number;
  complete: boolean;
} {
  const required = (items ?? []).filter((item) => item.required !== false);
  const received = required.filter((item) => RECEIVED.has(item.status) && !!item.file_ref?.trim()).length;
  return { required: required.length, received, complete: required.length > 0 && received === required.length };
}

export function packageLine(items: PackageItem[] | null | undefined): string {
  const progress = packageProgress(items);
  if (!progress.required) return "Package not started";
  if (progress.complete) return "All required files collected; package delivery tracked separately";
  return `Package ${progress.received} of ${progress.required} received`;
}

/** One row per submittal number: the highest revision. Same number twice does not count twice. */
export function currentSubmittals<T extends Pick<SubmittalRecord, "id" | "number" | "revision">>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = row.number.trim().toLowerCase();
    const prev = best.get(key);
    if (!prev || row.revision > prev.revision || (row.revision === prev.revision && row.id > prev.id)) best.set(key, row);
  }
  return [...best.values()].sort(
    (a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || a.revision - b.revision || a.id.localeCompare(b.id),
  );
}

export function filterSubmittals(rows: SubmittalRecord[], filter: SubmittalFilter): SubmittalRecord[] {
  return currentSubmittals(rows).filter((row) => {
    if (filter.status && row.status !== filter.status) return false;
    if (filter.ball && row.ball_in_court !== filter.ball) return false;
    if (filter.overdue && !submittalOverdue(row, filter.today)) return false;
    return true;
  });
}

export function labelOf<T extends string>(map: Record<T, string>, value: string): string {
  return (map as Record<string, string>)[value] ?? value.replace(/_/g, " ");
}

export function transmittalLabel(n: number): string {
  return `Transmittal T-${n}`;
}

/** The short name a member uses for a piece in chat: P1, P2… in the order the pieces were logged. */
export function pieceRef(index: number): string {
  return `P${index + 1}`;
}

/** One line per piece with its short name and id, so any host can name the piece to attach a file. */
export function pieceLines(items: PackageItem[] | null | undefined): string[] {
  return (items ?? []).map((item, n) => {
    const stored = !!item.file_ref?.trim() && RECEIVED.has(item.status);
    const contact = item.chase_name?.trim() ? ` Contact ${labelOf(CHASE_ROLE_LABEL, item.chase_role ?? "")} ${item.chase_name.trim()}${item.chase_email ? ` ${item.chase_email}` : ""}.` : "";
    return `${pieceRef(n)}. ${labelOf(PACKAGE_KIND_LABEL, item.kind)} from ${item.source_party}. ${labelOf(PACKAGE_STATUS_LABEL, item.status)}.${item.required === false ? " Not required." : ""} ${stored ? "Stored file on record." : "No stored file yet."}${contact}${item.id ? ` Piece id ${item.id}.` : ""}`;
  });
}

/** Words for an empty filtered view: the log is not empty, nothing matches. Starts with "No submittals" so the header check still holds. */
export function filterWords(filter: Omit<SubmittalFilter, "today"> | undefined): string {
  const parts: string[] = [];
  if (filter?.overdue) parts.push("overdue");
  if (filter?.status) parts.push(labelOf(STATUS_LABEL, filter.status).toLowerCase());
  if (filter?.ball) parts.push(`with ${labelOf(BALL_LABEL, filter.ball)}`);
  return parts.join(", ");
}

export type SubmittalRoute =
  | { tool: "submittal_log"; action: "add" }
  | { tool: "submittals_list"; overdue: boolean; jobNumber: string | null }
  | { tool: "submittals_import"; jobNumber: string | null }
  | { tool: "submittal_chase"; jobNumber: string | null };

const SUBMITTAL_WORD = /\b(?:submittals?|submital|submittle|submittall|sumittal|sumittals|submittels)\b/i;

/** Host routing for the submittal phrases, including the misspellings Marshall named. */
export function routeSubmittal(text: string): SubmittalRoute | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!SUBMITTAL_WORD.test(t) && !/\bchase\b/i.test(t)) return null;
  const job = t.match(/\bjob\s+#?([A-Za-z0-9][\w.-]{0,39})\b/i)?.[1] ?? t.match(/\b(?:for|on)\s+#?(\d[\w.-]{0,39})\b/i)?.[1] ?? null;
  if (/\bchase\b/i.test(t)) return { tool: "submittal_chase", jobNumber: job };
  if (!SUBMITTAL_WORD.test(t)) return null;
  if (/\b(?:import|paste|csv)\b/i.test(t)) return { tool: "submittals_import", jobNumber: job };
  if (/\b(?:overdue|past due)\b/i.test(t)) return { tool: "submittals_list", overdue: true, jobNumber: job };
  if (/\blog\s+(?:a|an|the|my)\b/i.test(t) || /\b(?:add|record|enter|create)\s+(?:a|an|the|my\s+)?(?:subm|sumitt)/i.test(t)) {
    return { tool: "submittal_log", action: "add" };
  }
  return { tool: "submittals_list", overdue: false, jobNumber: job };
}

export const SUBMITTAL_SERVER_RULE =
  " When someone says Hey Athena, log a submittal, log a submittal, or a misspelling such as submital, submittle, sumittal, or submittall, call submittal_log. When someone asks what submittals are overdue, which submittals are overdue, or for the submittal log for a job such as 2701, call submittals_list. submittals_list is the submittal log for every host. It returns each saved submittal: number, title, status, ball in court, due date, and overdue. If the job has none, the card says so and points to submittal setup. Do not answer a submittal log from the schedule activity list or from the morning brief. When someone pastes a log or says import the submittal log, call submittals_import and show the preview card. Write the import only after a separate yes. When someone says chase the missing submittals, chase the submittals, or chase the missing submittals on a job such as 2701, call submittal_chase. A submittal request is the submittal log, not the morning brief and not email or calendar. Spec section is required on a logged row. Due back is the submitted date plus that job's review turnaround, 14 calendar days unless the contract sets another count. Public work is strict. Private work is advisory. Show the submittal card, and when the card is shown do not add text after it. The board link comes from the signed job board for submittals. Do not send a chase email in the same reply. Do not read the spec book or run the kickoff walkthrough from this log.";

export type Presented = { text: string; card: CardModel; rows: SubmittalRecord[] };

function dueLabel(row: SubmittalRecord): string {
  const due = (row.due_back ?? row.required_by ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : "Needed";
}

function ballLabel(row: SubmittalRecord): string {
  const ball = labelOf(BALL_LABEL, row.ball_in_court);
  return row.ball_in_court_name?.trim() ? `${ball}, ${row.ball_in_court_name.trim()}` : ball;
}

function rowLine(row: SubmittalRecord, today: string, recordUrl: string | null = null): string {
  const overdue = submittalOverdue(row, today);
  return `- ${row.number}. ${recordUrl ? `[${row.title}](${recordUrl})` : row.title}. Spec ${row.spec_section}. ${row.transmittal_number > 0 ? `T-${row.transmittal_number}` : "Transmittal not recorded"}, revision ${row.revision}. ${submittalDisplayStatus(row)}. Ball in court: ${ballLabel(row)}. Due ${dueLabel(row)}. Overdue: ${overdue ? "Yes" : "No"}. Source: ${sourceLine(row)}${row.built_package ? ` Package: ${row.built_package.filename}.` : ""}${packageDelivery(row) ? ` ${packageDelivery(row)}.` : ""}`;
}

/** One status label for the log and the record page: a built, unsent package reads as a draft, never as submitted or in review. */
export const SUBMITTAL_DRAFT_LABEL = "Ready for internal review · Draft, not sent";
export function submittalDisplayStatus(
  row: Pick<SubmittalRecord, "status" | "built_package" | "submission_sent_at" | "revision">,
  packages?: { revision: number; is_current?: boolean; sent_at?: string | null; revoked_at?: string | null }[] | null,
): string {
  if (row.status === "void") return labelOf(STATUS_LABEL, row.status);
  const built = row.built_package ?? packages?.find((p) => p.revision === row.revision && p.is_current !== false && !p.revoked_at) ?? null;
  return built && !built.sent_at && !row.submission_sent_at ? SUBMITTAL_DRAFT_LABEL : labelOf(STATUS_LABEL, row.status);
}
export function packageDelivery(row: SubmittalRecord): string {
  return row.submission_sent_at ? `Sent ${row.submission_sent_at.slice(0, 10)}`
    : row.has_package || row.built_package ? "Send receipt not recorded" : "";
}

/** Plain-text fallback. Header counts are the deduped rows, and the card uses that same list. */
export function presentSubmittalLog(input: {
  jobNumber: string;
  jobName: string;
  rows: SubmittalRecord[];
  today: string;
  boardUrl: string | null;
  readOnly?: boolean;
  note?: string | null;
  posture?: string | null;
  filter?: Omit<SubmittalFilter, "today">;
  schedule?: ScheduleActivity[];
  tracking?: TrackingItem[];
  /** The submittal just saved: its pieces are listed with their short names and ids. */
  focusId?: string | null;
}): Presented {
  const loggedNumbers = new Set(input.rows.map((row) => row.number.trim().toLowerCase()));
  const schedule = (input.schedule ?? []).filter((group) => !loggedNumbers.has(group.id.trim().toLowerCase()));
  const tracking = input.tracking ?? [];
  const voided = input.filter?.status === "void" ? [] : currentSubmittals(input.rows).filter((row) => row.status === "void");
  const pool = input.filter?.status === "void" ? input.rows : input.rows.filter((row) => row.status !== "void");
  const rows = filterSubmittals(pool, { ...input.filter, today: input.today });
  const logged = currentSubmittals(pool);
  const filtered = !!(input.filter?.overdue || input.filter?.status || input.filter?.ball);
  const focus = input.focusId ? input.rows.find((row) => row.id === input.focusId) ?? null : null;
  const scheduleLate = schedule.filter((group) => scheduleGroupOverdue(group, input.today)).length;
  const trackingLate = tracking.filter((item) => item.overdue).length;
  const loggedLate = rows.filter((row) => submittalOverdue(row, input.today)).length;
  const overdue = loggedLate + scheduleLate + trackingLate;
  const count = rows.length + schedule.length;
  const head = `${input.jobNumber} – ${input.jobName}\nSubmittal log: ${count} submittals, ${overdue} overdue.`;
  const scheduleLines = schedule.map((group) => {
    const due = (group.finish ?? "").slice(0, 10) || "Needed";
    const late = scheduleGroupOverdue(group, input.today);
    return `- ${group.id} ${group.name}. Due ${due}.${group.critical ? " Critical path." : ""}${late ? " Overdue." : ""}`;
  });
  const trackingLines = tracking.map((item) => `- ${item.action}${item.due ? `. Due ${item.due}.` : ""}${item.overdue ? " Overdue." : ""}`);
  // A filtered view of a log that has rows is not an empty log: say what was asked for and how many rows the log holds.
  const nothing = !rows.length && !voided.length && !schedule.length && !tracking.length && !(filtered && logged.length);
  const noMatch = !rows.length && filtered && logged.length > 0;
  const noMatchLine = `No submittals ${filterWords(input.filter)} on this job. ${logged.length} on the log, none ${filterWords(input.filter)}.`;
  const loggedBody = rows.length
    ? rows.map((row) => rowLine(row, input.today, submittalRecordUrl(input.boardUrl, row.number))).join("\n")
    : noMatch
      ? noMatchLine
      : voided.length
        ? "No open submittals."
        : nothing
          ? "No submittals on this job yet. Set the log up: say log a submittal, or paste the log to import it."
          : "No submittals logged yet.";
  const historyBody = voided.length
    ? `History\n${voided.map((row) => `- ${row.number}. ${row.title}. Status ${submittalDisplayStatus(row)}.`).join("\n")}`
    : "";
  const focusLines = focus ? pieceLines(focus.package_items) : [];
  const focusBody = focus
    ? `Package pieces for ${focus.number}\n${focusLines.length ? focusLines.join("\n") : "No pieces logged yet. Name the cuts, drawings and documents this submittal needs and who supplies each."}`
    : "";
  const body = [scheduleLines.length ? `Schedule\n${scheduleLines.join("\n")}` : "", trackingLines.length ? `Tracking\n${trackingLines.join("\n")}` : "", loggedBody, historyBody, focusBody].filter(Boolean).join("\n\n");
  const note = input.note?.trim() ? `${input.note.trim()}\n\n` : "";
  const access = input.readOnly ? "\n\nRead only." : "";
  const logUrl = submittalLogUrl(input.boardUrl);
  const text = `${note}${head}\n\n${body}${access}${logUrl ? `\n\n[Open live submittal log](${logUrl})${rows.map(row => `\n[Upload a piece · ${row.number}](${submittalUploadUrl(logUrl, row.number)})`).join("")}` : ""}`;
  const tableRows: CardRow[] = rows.map((row) => {
    const late = submittalOverdue(row, input.today);
    return {
      cells: [row.number, row.title, row.spec_section, row.transmittal_number > 0 ? `T-${row.transmittal_number}` : "Transmittal not recorded", String(row.revision), submittalDisplayStatus(row), ballLabel(row), dueLabel(row), late ? "Yes" : "No", packageDelivery(row), sourceLine(row), row.built_package?.filename ?? (row.has_package ? "Rebuild needed" : "")],
      flag: late ? "overdue" : null,
      href: submittalRecordUrl(input.boardUrl, row.number),
      linkCell: 1,
      refId: row.id,
    };
  });
  const focusRows: CardRow[] = focus
    ? (focus.package_items ?? []).map((item, n) => ({
        cells: [pieceRef(n), labelOf(PACKAGE_KIND_LABEL, item.kind), item.source_party, labelOf(PACKAGE_STATUS_LABEL, item.status), item.file_ref?.trim() && RECEIVED.has(item.status) ? "Stored" : "No file yet", item.chase_name?.trim() || "No contact"],
        refId: item.id ?? undefined,
      }))
    : [];
  const card: CardModel = {
    state: "result",
    title: "Submittal log",
    show_state: false,
    job: `${input.jobNumber} – ${input.jobName}`,
    kpis: [
      { label: "Submittals", value: String(count) },
      { label: "Overdue", value: String(overdue), flag: overdue ? "overdue" : null },
    ],
    sections: [
      ...(logUrl ? [{ heading: "Live log", kind: "list" as const, rows: [{ cells: ["Open live submittal log"], href: logUrl }] }] : []),
      ...(input.posture
        ? [{ heading: "Posture", kind: "chips" as const, rows: [{ cells: [input.posture], tone: "known" as const }] }]
        : []),
      ...(schedule.length
        ? [{
            heading: "Schedule",
            kind: "table" as const,
            columns: ["Activity", "Package", "Due", "Path"],
            rows: schedule.map((group) => ({
              cells: [group.id, group.name, (group.finish ?? "").slice(0, 10) || "Needed", group.critical ? "Critical path" : ""],
              flag: scheduleGroupOverdue(group, input.today) ? ("overdue" as const) : null,
              refId: group.id,
            })),
          }]
        : []),
      ...(tracking.length
        ? [{
            heading: "Tracking",
            kind: "list" as const,
            rows: tracking.map((item) => ({
              cells: [item.action, item.due || "Needed"],
              flag: item.overdue ? ("overdue" as const) : null,
              refId: item.id,
            })),
          }]
        : []),
      rows.length
        ? {
            heading: "Log",
            kind: "table" as const,
            columns: ["Number", "Title", "Spec section", "Transmittal", "Revision", "Status", "Ball in court", "Due", "Overdue", "Package delivery", "Source", "Package PDF"],
            rows: tableRows,
          }
        : {
            heading: "Log",
            kind: "list" as const,
            rows: [{ cells: [noMatch ? noMatchLine : voided.length ? "No open submittals." : nothing ? "No submittals on this job yet." : "No submittals logged yet."] }],
          },
      ...(voided.length
        ? [{
            heading: "History",
            kind: "table" as const,
            columns: ["Number", "Title", "Status"],
            rows: voided.map((row) => ({
              cells: [row.number, row.title, submittalDisplayStatus(row)],
              href: submittalRecordUrl(input.boardUrl, row.number),
              linkCell: 1,
              refId: row.id,
            })),
          }]
        : []),
      ...(rows.some(row => row.built_package) ? [{ heading: "Package PDFs", kind: "list" as const,
        rows: rows.filter(row => row.built_package).map(row => ({ cells: [`Open package PDF · ${row.number} · ${row.built_package!.filename}`], href: submittalPackageUrl(input.boardUrl, row.number, row.built_package!.id) })) }] : []),
      ...(logUrl && rows.length ? [{ heading: "Upload package pieces", kind: "list" as const,
        rows: rows.map(row => ({ cells: [`Upload a piece · ${row.number}`], href: submittalUploadUrl(logUrl, row.number) })) }] : []),
      ...(focus
        ? [{
            heading: `Package pieces for ${focus.number}`,
            kind: focusRows.length ? ("table" as const) : ("list" as const),
            ...(focusRows.length ? { columns: ["Piece", "Item", "Source", "Status", "File", "Contact"] } : {}),
            rows: focusRows.length ? focusRows : [{ cells: ["No pieces logged yet."] }],
          }]
        : []),
    ] as CardSection[],
    next_move: input.readOnly
      ? "Read only on this job."
      : noMatch
        ? "Ask for the full log to see every row."
        : nothing
          ? "Set the log up: say log a submittal, or paste the log to import it."
          : focus
            ? "Attach a received file to a piece by its short name, or log the next submittal."
            : "Log the next submittal when it is ready.",
  };
  return { text, card, rows };
}

export type ImportDraft = {
  number: string;
  revision: number;
  spec_section: string;
  title: string;
  submittal_type: SubmittalType;
  status: SubmittalStatus;
  ball_in_court: BallParty;
  ball_in_court_name: string | null;
  required_by: string | null;
  submitted_on: string | null;
  returned_on: string | null;
  notes: string | null;
  required: boolean;
  not_required_reason: string | null;
  disposition: "new" | "update";
};

export type ImportProblem = { line: number; text: string; why: string };

export type ImportPreview = {
  ready: ImportDraft[];
  problems: ImportProblem[];
  duplicates: number;
  key: string;
};

const HEADER_FIELDS: Record<string, string[]> = {
  number: ["number", "no", "submittal", "submittal no", "submittal number", "sub no", "item", "#"],
  revision: ["revision", "rev", "rev no", "revision no"],
  spec_section: ["spec", "spec section", "section", "spec sec", "specification"],
  title: ["title", "description", "name", "submittal title", "item description"],
  submittal_type: ["type", "submittal type", "kind"],
  status: ["status", "state"],
  ball_in_court: ["ball", "ball in court", "bic", "with", "holder"],
  ball_in_court_name: ["ball name", "responsible", "company", "reviewer", "from"],
  required_by: ["required by", "need by", "needed by", "date required"],
  submitted_on: ["submitted", "submitted on", "date submitted", "sent"],
  returned_on: ["returned", "returned on", "date returned"],
  notes: ["notes", "note", "comments", "remarks"],
  required: ["spec required", "required item"],
  not_required_reason: ["reason", "not required reason", "waiver"],
};

function normHeader(value: string): string {
  return value.toLowerCase().replace(/[#.]/g, " ").replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
}

function fieldForHeader(value: string): string | null {
  const key = normHeader(value);
  for (const [field, names] of Object.entries(HEADER_FIELDS)) if (names.includes(key)) return field;
  return null;
}

function splitCells(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quote = false;
      else cur += ch;
    } else if (ch === '"') quote = true;
    else if (ch === delim) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function delimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes("|")) return "|";
  return ",";
}

function looksLikeHeader(cells: string[]): boolean {
  return cells.filter((cell) => fieldForHeader(cell)).length >= 2;
}

function mapType(value: string): SubmittalType {
  const t = value.toLowerCase();
  if (/shop/.test(t)) return "shop_drawing";
  if (/sample/.test(t)) return "sample";
  if (/product|cut|data/.test(t)) return "product_data";
  return "other";
}

function mapStatus(value: string): SubmittalStatus {
  const t = value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const table: Record<string, SubmittalStatus> = {
    "": "not_started",
    "not started": "not_started",
    open: "not_started",
    "in prep": "in_prep",
    prep: "in_prep",
    submitted: "submitted",
    sent: "submitted",
    "in review": "in_review",
    review: "in_review",
    approved: "approved",
    "approved as noted": "approved_as_noted",
    aan: "approved_as_noted",
    "revise and resubmit": "revise_and_resubmit",
    revise: "revise_and_resubmit",
    resubmit: "revise_and_resubmit",
    rejected: "rejected",
    closed: "closed",
  };
  return table[t] ?? "not_started";
}

function mapBall(value: string): BallParty {
  const t = value.toLowerCase();
  if (/architect|engineer|\bae\b|\ba\/e\b/.test(t)) return "architect_engineer";
  if (/\bowner\b/.test(t)) return "owner";
  if (/\bgc\b|general contractor|contractor/.test(t)) return "gc";
  return "sub";
}

function mapDate(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const month = m[1].padStart(2, "0");
  const day = m[2].padStart(2, "0");
  const iso = `${year}-${month}-${day}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31 ? iso : null;
}

function mapRequired(value: string): boolean {
  return !/^(n|no|false|not required|waived)$/i.test(value.trim());
}

function draftKey(rows: ImportDraft[]): string {
  const body = JSON.stringify(rows.map((row) => [row.number, row.revision, row.spec_section, row.title, row.status, row.required]));
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) >>> 0;
  return `I${h.toString(16).toUpperCase().padStart(8, "0").slice(0, 8)}`;
}

/** CSV or a pasted log. Columns are matched loosely. Same number and revision collapse to the last row. */
export function parseSubmittalImport(text: string, existing: { number: string; revision: number }[] = []): ImportPreview {
  const lines = text.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const problems: ImportProblem[] = [];
  const parsed: ImportDraft[] = [];
  if (!lines.length) return { ready: [], problems, duplicates: 0, key: draftKey([]) };
  const delim = delimiter(lines[0]);
  const first = splitCells(lines[0], delim);
  const header = looksLikeHeader(first);
  const fields = header ? first.map(fieldForHeader) : ["number", "revision", "spec_section", "title", "submittal_type", "status", "ball_in_court", "ball_in_court_name", "required_by", "submitted_on", "returned_on", "notes"].slice(0, first.length);
  const body = header ? lines.slice(1) : lines;
  body.forEach((line, index) => {
    const cells = splitCells(line, delimiter(line));
    const rec: Record<string, string> = {};
    fields.forEach((field, i) => { if (field) rec[field] = cells[i] ?? ""; });
    if (!header && cells.length <= 4) {
      rec.number = cells[0] ?? "";
      rec.spec_section = cells[1] ?? "";
      rec.title = cells[2] ?? "";
      rec.status = cells[3] ?? "";
    }
    const number = (rec.number ?? "").trim();
    const spec = (rec.spec_section ?? "").trim();
    const title = (rec.title ?? "").trim();
    const lineNo = header ? index + 2 : index + 1;
    if (!number || !spec || /^(needed|unknown|n\/?a|tbd|pending)$/i.test(spec) || !title) {
      problems.push({ line: lineNo, text: line.slice(0, 120), why: !number ? "Number is missing" : !spec || /^(needed|unknown|n\/?a|tbd|pending)$/i.test(spec) ? "Required spec section is missing" : "Title is missing" });
      return;
    }
    const required = rec.required == null || rec.required === "" ? true : mapRequired(rec.required);
    const reason = (rec.not_required_reason ?? "").trim() || null;
    if (!required && (!reason || reason.length < 3)) {
      problems.push({ line: lineNo, text: line.slice(0, 120), why: "Not required needs a reason" });
      return;
    }
    const revision = /^\d+$/.test(rec.revision ?? "") ? Number(rec.revision) : 0;
    const known = existing.some((row) => row.number.trim().toLowerCase() === number.toLowerCase() && row.revision === revision);
    parsed.push({
      number,
      revision,
      spec_section: spec,
      title,
      submittal_type: mapType(rec.submittal_type ?? ""),
      status: mapStatus(rec.status ?? ""),
      ball_in_court: mapBall(rec.ball_in_court ?? ""),
      ball_in_court_name: (rec.ball_in_court_name ?? "").trim() || null,
      required_by: mapDate(rec.required_by ?? ""),
      submitted_on: mapDate(rec.submitted_on ?? ""),
      returned_on: mapDate(rec.returned_on ?? ""),
      notes: (rec.notes ?? "").trim() || null,
      required,
      not_required_reason: required ? null : reason,
      disposition: known ? "update" : "new",
    });
  });
  const byKey = new Map<string, ImportDraft>();
  let duplicates = 0;
  for (const row of parsed) {
    const key = `${row.number.trim().toLowerCase()}|${row.revision}`;
    if (byKey.has(key)) duplicates += 1;
    byKey.set(key, row);
  }
  const ready = [...byKey.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || a.revision - b.revision);
  return { ready, problems, duplicates, key: draftKey(ready) };
}

export const IMPORT_CONFIRM = "Write this import onto the submittal log? Yes or no?";

export function presentImportPreview(jobNumber: string, jobName: string, preview: ImportPreview): Presented {
  const rows: CardRow[] = preview.ready.map((row) => ({
    cells: [
      `${row.number} revision ${row.revision}, ${row.title}`,
      row.spec_section,
      labelOf(STATUS_LABEL, row.status),
      row.disposition === "update" ? "Update" : "New",
    ],
  }));
  const fixes: CardRow[] = preview.problems.map((problem) => ({ cells: [`Line ${problem.line}: ${problem.why}`], tone: "unknown" }));
  const card: CardModel = {
    state: "ask",
    title: "Import preview",
    show_state: false,
    job: `${jobNumber} – ${jobName}`,
    ask: { prompt: IMPORT_CONFIRM },
    kpis: [
      { label: "Ready", value: String(preview.ready.length) },
      { label: "Needs a fix", value: String(preview.problems.length) },
    ],
    sections: [
      { heading: "Ready", kind: "table", columns: ["Submittal", "Spec", "Status", "On the log"], rows },
      ...(fixes.length ? [{ heading: "Needs a fix", kind: "list" as const, rows: fixes }] : []),
    ],
    next_move: preview.ready.length ? "Nothing is written until you say yes." : "Nothing to write.",
  };
  const lines = preview.ready.map((row) => `- ${row.number} revision ${row.revision}, ${row.title}. Spec ${row.spec_section}. ${row.disposition === "update" ? "Update" : "New"}.`);
  const fixLines = preview.problems.map((problem) => `- Line ${problem.line}: ${problem.why}`);
  const text = [
    `${jobNumber} – ${jobName}`,
    `Import preview: ${preview.ready.length} ready, ${preview.problems.length} need a fix.${preview.duplicates ? ` ${preview.duplicates} duplicate rows combined.` : ""}`,
    "",
    lines.length ? lines.join("\n") : "No rows are ready.",
    fixLines.length ? `\nNeeds a fix:\n${fixLines.join("\n")}` : "",
    "",
    IMPORT_CONFIRM,
  ].join("\n");
  return { text, card, rows: [] };
}

/** Header KPI equals the table. Overdue KPI equals the overdue rows. Both use the deduped list. */
export function headerMatchesRows(card: CardModel): boolean {
  const rows = (card.sections?.find((section) => section.heading === "Log")?.rows ?? []).filter(
    (row) => !row.cells.every((cell) => !cell.trim() || /^No submittals\b/.test(cell.trim())),
  );
  const total = card.kpis?.find((kpi) => kpi.label === "Submittals")?.value;
  const late = card.kpis?.find((kpi) => kpi.label === "Overdue")?.value;
  const overdueRows = rows.filter((row) => row.flag === "overdue").length;
  return total === String(rows.length) && late === String(overdueRows);
}

/** Sample rows for test job 2701. Inserted by submittal_log, never by the migration. */
export const SAMPLE_SUBMITTALS_2701 = [
  {
    title: "SAMPLE Switchgear product data",
    spec_section: "26 24 16",
    submittal_type: "product_data" as const,
    status: "submitted" as const,
    ball_in_court: "architect_engineer" as const,
    ball_in_court_name: "Bayline Design Studio",
    required_by: "2026-10-01",
    submitted_on: "2026-10-01",
    notes: "SAMPLE on job 2701. Not a real submittal.",
    package_items: [
      { kind: "product_cut" as const, source_party: "GearCo", status: "received" as const, required: true, file_ref: null },
    ],
  },
  {
    title: "SAMPLE Lighting shop drawing",
    spec_section: "26 51 00",
    submittal_type: "shop_drawing" as const,
    status: "in_prep" as const,
    ball_in_court: "sub" as const,
    ball_in_court_name: "Harbor Electric",
    required_by: "2026-10-10",
    notes: "SAMPLE on job 2701. Not a real submittal.",
    package_items: [
      {
        kind: "shop_drawing" as const,
        source_party: "Harbor Electric",
        status: "needed" as const,
        required: true,
        chase_role: "sub" as const,
        chase_name: "SAMPLE Chase Contact",
        chase_email: "sample-chase@example.com",
      },
    ],
  },
  {
    title: "SAMPLE Floor box sample",
    spec_section: "26 27 26",
    submittal_type: "sample" as const,
    status: "approved" as const,
    ball_in_court: "gc" as const,
    ball_in_court_name: "ALP Field",
    required_by: "2026-10-01",
    submitted_on: "2026-10-01",
    returned_on: "2026-10-18",
    notes: "SAMPLE on job 2701. Not a real submittal.",
  },
  {
    title: "SAMPLE Panelboard warranty package",
    spec_section: "26 24 16",
    submittal_type: "other" as const,
    status: "in_review" as const,
    ball_in_court: "owner" as const,
    ball_in_court_name: "Harbor Point Owner",
    submitted_on: "2026-10-20",
    notes: "SAMPLE on job 2701. Not a real submittal.",
    package_items: [
      { kind: "product_cut" as const, source_party: "PanelCo", status: "received" as const, required: true },
      {
        kind: "warranty" as const,
        source_party: "PanelCo",
        status: "needed" as const,
        required: true,
        chase_role: "manufacturer" as const,
        chase_name: "SAMPLE Warranty Desk",
        chase_email: "sample-warranty@example.com",
      },
    ],
  },
] as const;
