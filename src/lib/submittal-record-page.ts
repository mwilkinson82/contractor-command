import { changeSections, changeMoney } from "./mcp/change-orders";
// The submittal record page: /r/job/<job>/submittal/<number>. One address per submittal number; every log row opens it.
// Pure logic: payload types and one HTML renderer shared by the signed-in page and the board-token page.
// Navy, blue and gray; red only for an overdue clock. Member-facing text never names tools or vendors.
import { submittalHistoryOrder } from "./submittal-history-order";
import { ALERT_HEX } from "./mcp/alert-color";
import { hostLabel } from "./mcp/call-host";
import {
  BALL_LABEL,
  CHASE_ROLE_LABEL,
  PACKAGE_KIND_LABEL,
  PACKAGE_STATUS_LABEL,
  STATUS_LABEL,
  SUBMITTAL_DRAFT_LABEL,
  labelOf,
  packageLine,
  pieceRef,
  sourceLine,
  submittalDisplayStatus,
  submittalOverdue,
  transmittalLabel,
  type PackageItem,
  type SubmittalRecord,
} from "./mcp/submittals";
import { jobHeading } from "./mcp/job-label";
import { kindLabel } from "./mcp/project-record";
import { storedPiece } from "./mcp/submittal-package";
import { esc } from "./report-pages";
import { submittalBuildTime, type SubmittalTimeZones } from "./submittal-build-time";
import { packagePurpose, requestContent, requestState } from "./mcp/package-purpose";

export type RecordPackage = {
  id: string;
  submittal_id: string;
  revision: number;
  is_current?: boolean;
  transmittal_id?: string | null;
  transmittal_number?: number | null;
  filename: string;
  path: string;
  size_bytes?: number | null;
  page_count?: number | null;
  cover_date?: string | null;
  created_at: string;
  approved_at?: string | null;
  sent_at?: string | null;
  revoked_at?: string | null;
  expires_at?: string | null;
  download_url?: string | null;
  /** Signed storage link added by the page for members and token readers. */
  url?: string | null;
};
export type RecordMail = {
  id: string;
  submittal_id: string;
  revision: number;
  kind: "package" | "chase";
  package_id?: string | null;
  package_item_id?: string | null;
  to?: string | null;
  subject?: string | null;
  created_at: string;
  approved_at?: string | null;
  sent_at?: string | null;
  provider?: string | null;
  message_id?: string | null;
};
export type RecordTransmittal = {
  id: string;
  number: number;
  revision: number;
  to_name?: string | null;
  to_email?: string | null;
  subject?: string | null;
  sent_on?: string | null;
  cover_note?: string | null;
};
export type RecordRevision = {
  id: string;
  revision: number;
  status: string;
  title: string;
  spec_section: string;
  transmittal_number: number;
  submitted_on?: string | null;
  due_back?: string | null;
  returned_on?: string | null;
  ball_in_court: string;
  ball_in_court_name?: string | null;
  created_at: string;
  updated_at?: string | null;
};
export type RecordEventRow = {
  id: string;
  occurred_at: string;
  actor: string;
  actor_name?: string | null;
  mine?: boolean | null;
  kind: string;
  title: string;
  summary: string;
  counterparty_name?: string | null;
  counterparty_email?: string | null;
  ref_table?: string | null;
  ref_id?: string | null;
  host?: string | null;
  thread_ref?: string | null;
  payload?: Record<string, unknown> | null;
};
export type SubmittalRecordPayload = {
  page: "submittal";
  time_zone?: string;
  time_zone_context?: SubmittalTimeZones;
  company_id?: string;
  company?: string;
  job_id?: string;
  job_number?: string;
  job_name?: string;
  read_only?: boolean;
  review_days?: number;
  today?: string;
  number: string;
  current: SubmittalRecord & {
    package_items?: (PackageItem & { url?: string | null })[] | null;
    created_at?: string | null;
  };
  revisions?: RecordRevision[];
  packages?: RecordPackage[];
  mail?: RecordMail[];
  transmittals?: RecordTransmittal[];
  events?: RecordEventRow[];
};

/** Storage path of a stored piece: athena-submittals/<company>/<job>/pieces/<id>/<name> → the path inside the bucket. */
export function submittalStoragePath(fileRef: string | null | undefined): string | null {
  const match = /^athena-submittals\/(.+)$/.exec(fileRef ?? "");
  return match && !match[1].includes("..") && !match[1].startsWith("/") ? match[1] : null;
}

/** The authorized record bounds every storage signature, including service-role token reads. */
export function submittalRecordFile(
  payload: Pick<SubmittalRecordPayload, "company_id" | "job_id">,
  fileRef: string | null | undefined,
): { bucket: string; path: string; name: string } | null {
  if (!payload.company_id || !payload.job_id || !fileRef) return null;
  try {
    return storedPiece(fileRef, payload.company_id, payload.job_id);
  } catch {
    return null;
  }
}

/** /r/job/<job>/submittal/<number>; the number is percent-encoded once. */
export function submittalRecordPath(jobId: string, number: string): string {
  return `/r/job/${jobId}/submittal/${encodeURIComponent(number.trim())}`;
}

/** Only the exact, non-revoked package in the already-authorized record may open automatically. */
export function submittalPackageTarget(
  payload: SubmittalRecordPayload,
  packageId?: string,
): string | null {
  if (!packageId) return null;
  const pkg = payload.packages?.find((p) => p.id === packageId && !p.revoked_at);
  if (!pkg?.url || !submittalRecordFile(payload, `athena-submittals/${pkg.path}`)) return null;
  try {
    const url = new URL(pkg.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.pathname.endsWith(`/storage/v1/object/sign/athena-submittals/${pkg.path}`) ||
      !url.searchParams.get("token")
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

const NAVY = "#1E3A5F",
  BLUE = "#2563EB",
  G1 = "#6B7280",
  G2 = "#9CA3AF",
  G3 = "#D1D5DB",
  G4 = "#F3F4F6",
  RED = ALERT_HEX;
const card = (inner: string) =>
  `<section style="background:#fff;border:1px solid ${G3};border-radius:12px;padding:16px;margin:0 0 16px">${inner}</section>`;
const tile = (label: string, value: string, alert = false) =>
  `<div style="flex:1 1 160px;background:#fff;border:1px solid ${alert ? RED : G3};border-radius:10px;padding:12px"><div style="font-size:12px;color:${G1}">${esc(label)}</div><div style="font-size:20px;font-weight:600;color:${alert ? RED : NAVY}">${esc(value)}</div></div>`;
const tiles = (t: string[]) =>
  `<div style="display:flex;flex-wrap:wrap;gap:12px;margin:0 0 16px">${t.join("")}</div>`;
const h2 = (t: string) =>
  `<h2 style="margin:0 0 12px;font-size:13px;letter-spacing:.06em;color:${NAVY}">${esc(t)}</h2>`;
const muted = (t: string) => `<span style="font-size:12px;color:${G1}">${t}</span>`;
const day = (s: string | null | undefined) => (s ?? "").slice(0, 10);
const link = (href: string | null | undefined, label: string) =>
  href
    ? `<a href="${esc(href)}" style="color:${BLUE};font-weight:600;text-decoration:none">${esc(label)}</a>`
    : `<span style="color:${NAVY};font-weight:600">${esc(label)}</span>`;

function pieceName(item: PackageItem): string {
  return `${labelOf(PACKAGE_KIND_LABEL, item.kind)} from ${item.source_party}`;
}

function piecesHtml(items: (PackageItem & { url?: string | null })[], readOnly: boolean): string {
  if (!items.length)
    return card(
      h2("PACKAGE PIECES") +
        `<p style="margin:0;color:${G1}">No pieces logged yet.${readOnly ? "" : " Name the cuts, drawings and documents this submittal needs and who supplies each."}</p>`,
    );
  const rows = items
    .map((item, n) => {
      const stored = !!item.file_ref?.trim() && ["received", "approved"].includes(item.status);
      const contact = item.chase_name?.trim()
        ? ` · ${esc(labelOf(CHASE_ROLE_LABEL, item.chase_role ?? ""))} ${esc(item.chase_name.trim())}${item.chase_email ? ` (${esc(item.chase_email)})` : ""}`
        : "";
      const chased = item.chase_count
        ? ` · Chased ${esc(String(item.chase_count))}×${item.last_chased_at ? `, last ${esc(day(item.last_chased_at))}` : ""}${item.next_chase_at ? `, next ${esc(day(item.next_chase_at))}` : ""}`
        : "";
      const file = stored
        ? link(item.url, item.file_ref!.split("/").at(-1) ?? "file")
        : muted("No stored file yet");
      return `<div id="piece-${esc(item.id ?? String(n + 1))}" data-piece="${esc(pieceRef(n))}" style="padding:8px 0;border-top:1px solid ${G4}"><div style="color:${NAVY}"><strong>${esc(pieceRef(n))}</strong> · ${esc(pieceName(item))} · ${esc(labelOf(PACKAGE_STATUS_LABEL, item.status))}${item.required === false ? " · Not required" : ""}</div><div style="font-size:12px;color:${G1};margin-top:2px">${file}${contact}${chased}</div></div>`;
    })
    .join("");
  return card(
    h2("PACKAGE PIECES") +
      `<p style="margin:0 0 4px;font-size:12px;color:${G1}">${esc(packageLine(items))}. Say the piece's short name (P1, P2) when you attach a file in chat.</p>${rows}`,
  );
}

function filesHtml(packages: RecordPackage[], transmittals: RecordTransmittal[], zones: SubmittalTimeZones): string {
  if (!packages.length)
    return card(
      h2("FILES") +
        `<p style="margin:0;color:${G1}">No package has been built yet. The cover and transmittal are the first pages of the package when it is built.</p>`,
    );
  const order = submittalHistoryOrder(packages);
  const rows = packages
    .map((p) => {
      const state = p.revoked_at
        ? "Link turned off"
        : p.sent_at
          ? `Sent ${day(p.sent_at)}`
          : p.approved_at
            ? "Approved, send receipt not recorded"
            : "Draft, not sent";
      const t = p.transmittal_id
        ? transmittals.find((row) => row.id === p.transmittal_id)
        : p.transmittal_id === undefined && transmittals.filter((row) => row.revision === p.revision).length === 1
          ? transmittals.find((row) => row.revision === p.revision) : undefined;
      const number = p.transmittal_number ?? t?.number;
      const version = p.is_current === true ? "Current package" : p.is_current === false ? "Superseded" : "Historical package";
      const expiry =
        p.download_url && p.expires_at
          ? ` · Recipient link works until ${esc(day(p.expires_at))}`
          : "";
      return `<div id="package-${esc(p.id)}" style="padding:8px 0;border-top:1px solid ${G4}"><div>${link(p.url ?? p.download_url, p.filename)} ${muted(`· ${esc(order.get(p.id) ?? "Historical build")} · Revision ${esc(String(p.revision))}${number ? ` · ${esc(transmittalLabel(number))}` : " · Transmittal not recorded"} · ${esc(String(p.page_count ?? ""))} pages · Built ${esc(submittalBuildTime(p.created_at, zones))} · Copy ${esc(p.id.slice(0, 8))}`)}</div><div style="font-size:12px;color:${G1};margin-top:2px">${esc(version)} · ${esc(state)}${expiry}${t?.to_email ? ` · To ${esc(t.to_name?.trim() || t.to_email)}` : ""}</div></div>`;
    })
    .join("");
  return card(
    h2("FILES") +
      `<p style="margin:0 0 4px;font-size:12px;color:${G1}">Every package version is kept. Build order identifies each copy; original transmittal numbers and PDFs stay as issued. The cover and transmittal are the first pages of each one.</p>${rows}`,
  );
}

function eventLine(e: RecordEventRow): string {
  const who = e.actor === "athena" ? "Athena" : e.actor_name?.trim() || "a member";
  const host = hostLabel(e.host);
  const through = host ? ` through ${host}` : "";
  // Only the member who had the chat gets the conversation link; a teammate would land in someone else's chat.
  const thread =
    e.thread_ref && e.mine && host ? ` · ${muted("Conversation reference on file")}` : "";
  return `<div id="event-${esc(e.id)}" style="padding:8px 0;border-top:1px solid ${G4}"><div style="color:${NAVY}"><strong>${esc(e.title)}</strong> ${muted(`· ${esc(kindLabel(e.kind))}`)}</div><div style="font-size:12px;color:${G1};margin-top:2px">${esc(e.summary)}</div><div style="font-size:12px;color:${G2};margin-top:2px">${esc(day(e.occurred_at))} · by ${esc(who)}${esc(through)}${thread}</div></div>`;
}

function mailHtml(mail: RecordMail[]): string {
  if (!mail.length) return "";
  const rows = mail
    .map((m) => {
      const state = m.sent_at
        ? `Sent ${day(m.sent_at)} · provider receipt ${m.provider ?? ""} ${m.message_id ?? ""}`
        : m.approved_at
          ? "Approved, send receipt not recorded"
          : "Draft saved, not sent";
      return `<div id="mail-${esc(m.id)}" style="padding:8px 0;border-top:1px solid ${G4}"><div style="color:${NAVY}"><strong>${m.kind === "package" ? "Package email" : "Chase"}</strong> ${muted(`· to ${esc(m.to ?? "")} · ${esc(m.subject ?? "")}`)}</div><div style="font-size:12px;color:${G1};margin-top:2px">${esc(state.trim())}</div></div>`;
    })
    .join("");
  return card(
    h2("EMAILS") +
      `<p style="margin:0 0 4px;font-size:12px;color:${G1}">A send counts only when the email provider returned a receipt.</p>${rows}`,
  );
}

function revisionsHtml(revisions: RecordRevision[]): string {
  if (revisions.length < 2) return "";
  const rows = revisions
    .map(
      (r) =>
        `<div style="padding:6px 0;border-top:1px solid ${G4};color:${NAVY}">Revision ${esc(String(r.revision))} ${muted(`· ${esc(transmittalLabel(r.transmittal_number))} · ${esc(labelOf(STATUS_LABEL, r.status))} · ${r.submitted_on ? `Submitted ${esc(day(r.submitted_on))}` : "Not submitted"}${r.returned_on ? ` · Returned ${esc(day(r.returned_on))}` : ""}`)}</div>`,
    )
    .join("");
  return card(h2("REVISIONS") + rows);
}

/** Labels submittalDisplayStatus returns once a package has actually been submitted. */
const SUBMITTED_OR_LATER = new Set<string>([
  STATUS_LABEL.submitted,
  STATUS_LABEL.in_review,
  STATUS_LABEL.approved,
  STATUS_LABEL.approved_as_noted,
  STATUS_LABEL.revise_and_resubmit,
  STATUS_LABEL.rejected,
  STATUS_LABEL.closed,
]);

function calendarDay(value: string | null | undefined): string {
  const d = (value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

/** The same package submittalDisplayStatus treats as the current build, and only its send receipt. */
function sendReceiptDay(
  row: Pick<SubmittalRecord, "built_package" | "submission_sent_at" | "revision">,
  packages: SubmittalRecordPayload["packages"],
): string {
  if (calendarDay(row.submission_sent_at)) return calendarDay(row.submission_sent_at);
  const built =
    row.built_package ??
    packages?.find((p) => p.revision === row.revision && p.is_current !== false && !p.revoked_at) ??
    null;
  return calendarDay(built?.sent_at);
}

/**
 * Submitted date on "What it is". A draft display status never shows one, even when submitted_on is filled in.
 * The decision is submittalDisplayStatus plus the send receipt that function already consults.
 */
export function submittalSubmittedFact(
  row: SubmittalRecord & { created_at?: string | null },
  packages: SubmittalRecordPayload["packages"],
): string {
  const display = submittalDisplayStatus(row, packages);
  const receipt = sendReceiptDay(row, packages);
  const submitted = display !== SUBMITTAL_DRAFT_LABEL && SUBMITTED_OR_LATER.has(display);
  if (receipt || submitted) {
    const when = receipt || calendarDay(row.submitted_on);
    return when ? ` · Submitted ${esc(when)}` : "";
  }
  const drafted = calendarDay(row.created_at);
  return drafted ? ` · Not yet submitted · Drafted ${esc(drafted)}` : " · Not yet submitted";
}

function timelineText(e: RecordEventRow): string {
  return `${e.title}\n${e.summary}`.replace(/\s+/g, " ").trim().toLowerCase().replace(/\.+$/g, "");
}

function timelineStatus(e: RecordEventRow): string {
  const raw =
    typeof e.payload?.status === "string" && e.payload.status.trim()
      ? e.payload.status
      : (e.summary.match(/(?:^|\. )([^.]+)\.?\s*$/)?.[1] ?? "");
  return raw.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase().replace(/\.+$/g, "");
}

/** Boilerplate status echo: "Submittal N revision R" plus "<title>. Spec <section>. in review." */
function isGenericInReview(e: RecordEventRow): boolean {
  const summary = e.summary.replace(/\s+/g, " ").trim();
  const title = e.title.replace(/\s+/g, " ").trim();
  const genericTitle = title === "" || /^Submittal\s+.+\srevision\s+\d+$/i.test(title);
  if (!genericTitle) return false;
  return /^in review\.?$/i.test(summary) || /^.+\. Spec .+\. in review\.$/i.test(summary);
}

/**
 * Timeline for an approval submittal. Drops generic "in review." echoes and
 * collapses consecutive entries that repeat the same status and text. Order of what remains is unchanged.
 */
export function submittalRecordTimeline(events: RecordEventRow[]): RecordEventRow[] {
  const kept: RecordEventRow[] = [];
  for (const event of events) {
    if (isGenericInReview(event)) continue;
    const prev = kept.at(-1);
    if (prev && timelineStatus(prev) === timelineStatus(event) && timelineText(prev) === timelineText(event)) continue;
    kept.push(event);
  }
  return kept;
}

/** Page body (no <html>). Used inside the signed-in page and the board-token page. */
export function renderSubmittalRecordBody(p: SubmittalRecordPayload): string {
  const today = day(p.today);
  const row = p.current;
  const purpose = packagePurpose(row.package_purpose);
  const request = purpose !== "approval";
  const requestBody = request && row.request_details ? requestContent(row.request_details).map(section =>
    card(h2(section.heading.toUpperCase()) + section.lines.map(value => `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(value)}</p>`).join(""))
  ).join("") + (row.request_details.answer ? card(h2("ANSWER · CAPTURED") + `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(row.request_details.answer.text)}</p><p>From ${esc(row.request_details.answer.received_from)} · Received ${esc(submittalBuildTime(row.request_details.answer.received_at,p.time_zone_context ?? {job:p.time_zone}))}</p>`) : "") : "";
  const changeBody = purpose === "change_order" && row.change_order_details ? changeSections(row.change_order_details).map(section=>card(h2(section.heading.toUpperCase())+section.rows.map(r=>`<p style="overflow-wrap:anywhere">${r.cells.map(esc).join(" · ")}</p>`).join(""))).join("") : "";
  const changeHistory = purpose === "change_order" && row.change_order_history?.length ? card(h2("CHANGE-ORDER HISTORY") + row.change_order_history.map(h=>`<p>Version ${h.record_version} · ${esc(h.action)} · ${esc(submittalBuildTime(h.created_at,p.time_zone_context ?? {job:p.time_zone}))} · ${h.snapshot.total_cents == null ? "Not priced" : esc(changeMoney(h.snapshot.total_cents))}</p>`).join("")) : "";
  const late = today ? submittalOverdue(row, today) : false;
  const who = row.ball_in_court_name?.trim()
    ? `${labelOf(BALL_LABEL, row.ball_in_court)}, ${row.ball_in_court_name.trim()}`
    : labelOf(BALL_LABEL, row.ball_in_court);
  const due = row.due_back?.slice(0, 10) || row.required_by?.slice(0, 10) || (request ? "Due date needed" : "Needed");
  const stateLabel=purpose === "change_order" && row.change_order_details ? (["draft","priced"].includes(row.change_order_details.state) && row.submission_sent_at ? "Submitted" : row.change_order_details.state === "draft" ? "Draft, not sent" : row.change_order_details.state) : request ? ({draft:"Draft, not sent",sent:"Sent",answered:"Answered",closed:"Closed"}[requestState(row)]) : submittalDisplayStatus(row, p.packages);
  const items = row.package_items ?? [];
  const title = `${esc(jobHeading({ job_number: p.job_number ?? "", name: p.job_name ?? "" }, " "))} · ${request ? "" : "Submittal "}${esc(row.number)}`;
  const logHref = p.job_id ? `/r/job/${p.job_id}/${purpose === "change_order" ? "cos" : request ? purpose+"s" : "submittals"}` : null;
  const head =
    `<div data-submittal-record="${esc(row.number)}" data-revision="${esc(String(row.revision))}" data-overdue="${late ? 1 : 0}">` +
    `<p style="margin:0 0 12px;font-size:13px;color:${G1}">${logHref ? `<a href="${esc(logHref)}" style="color:${BLUE};text-decoration:none">${purpose === "change_order" ? "Change-order" : request ? purpose.toUpperCase() : "Submittal"} log</a> · ` : ""}${link("#upload", "Upload a package piece")} · ${late ? `<strong style="color:${RED}">Overdue</strong> · ` : ""}${esc(stateLabel)} · Ball in court: ${esc(who)}${p.read_only ? " · Read only" : ""}</p>` +
    tiles([
      tile("Revision", String(row.revision)),
      tile(
        "Transmittal",
        row.transmittal_number > 0 ? `T-${row.transmittal_number}` : "Not recorded",
      ),
      tile(
        row.returned_on ? "Returned" : row.submitted_on ? "Due back" : "Required by",
        row.returned_on ? day(row.returned_on) : due,
        late,
      ),
      tile("Package", packageLine(items).replace(/;.*$/, "")),
    ]) +
    `</div>`;
  const submittedFact = request
    ? row.submitted_on
      ? ` · Submitted ${esc(day(row.submitted_on))}`
      : ""
    : submittalSubmittedFact(row, p.packages);
  const what = card(
    h2("WHAT IT IS") +
      `<div style="font-weight:700;color:${NAVY}">${esc(row.title)}</div><div style="font-size:12px;color:${G1};margin-top:4px">${row.spec_section ? `Spec ${esc(row.spec_section)} · ` : ""}${esc(sourceLine(row))} · ${esc(transmittalLabel(row.transmittal_number))}${submittedFact}${row.due_back ? ` · Due back ${esc(day(row.due_back))}` : ""}${row.returned_on ? ` · Returned ${esc(day(row.returned_on))}` : ""}${row.submission_sent_at ? ` · Package sent ${esc(day(row.submission_sent_at))}` : " · Package send receipt not recorded"}</div>${row.notes?.trim() ? `<p style="margin:8px 0 0;font-size:13px;color:${NAVY}">${esc(row.notes.trim())}</p>` : ""}`,
  );
  const events = request ? (p.events ?? []) : submittalRecordTimeline(p.events ?? []);
  const timeline = card(
    h2("TIMELINE") +
      (events.length
        ? events.map(eventLine).join("")
        : `<p style="margin:0;color:${G1}">No events recorded yet.</p>`),
  );
  const foot = `<p style="margin:24px 0 0;font-size:12px;color:${G2}">Private to your company · updates as the record changes · Athena powered by ALP</p>`;
  return `<div style="max-width:1100px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${NAVY}"><h1 style="margin:0 0 8px;font-size:22px;color:${NAVY}">${title}</h1>${head}${what}${requestBody}${changeBody}${changeHistory}${piecesHtml(items, p.read_only === true)}${filesHtml(p.packages ?? [], p.transmittals ?? [], p.time_zone_context ?? { job: p.time_zone })}${mailHtml(p.mail ?? [])}${revisionsHtml(p.revisions ?? [])}${timeline}${foot}</div>`;
}
