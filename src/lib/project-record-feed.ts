// The project record page: one time-stamped list of everything logged on a job, for looking back
// at dates in a dispute. Reads public.mcp_project_record_feed (read-only, full job access only),
// then filters, formats and exports on the member's device. Times show in the job's time zone.
import { buildXlsx, type XlsxCell } from "./xlsx-writer";

export type RecordGroup = "team" | "athena" | "client" | "sub";
export type RecordEvent = {
  id: string;
  source: string;
  at: string;
  happened_on?: string;
  type: string;
  kind: string;
  title: string;
  summary?: string;
  by: string;
  by_role?: string;
  by_group: RecordGroup;
  to?: string;
  how?: string;
  ref_table?: string;
  ref_id?: string;
};
export type RecordFeed = {
  job_id: string;
  job_number: string | null;
  job_name: string | null;
  company: string | null;
  time_zone: string;
  from: string | null;
  to: string | null;
  captured_at: string;
  count: number;
  truncated: boolean;
  unavailable_sources: string[];
  events: RecordEvent[];
};

/** Filter chips, in the order a job runs. */
export const RECORD_TYPES = [
  "estimate",
  "contract",
  "schedule",
  "submittal",
  "rfi",
  "change",
  "notice",
  "daily",
  "billing",
  "items",
  "log",
  "other",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export const TYPE_LABEL: Record<RecordType, string> = {
  estimate: "Estimate & bid",
  contract: "Contract & drawings",
  schedule: "Schedule",
  submittal: "Submittals",
  rfi: "RFIs & RFCs",
  change: "Change orders",
  notice: "Delays & claims",
  daily: "Daily reports",
  billing: "Billing & payments",
  items: "Open items",
  log: "Inspections & decisions",
  other: "Other",
};
export const TYPE_TAG: Record<RecordType, string> = {
  estimate: "Estimate",
  contract: "Contract",
  schedule: "Schedule",
  submittal: "Submittal",
  rfi: "RFI",
  change: "Change order",
  notice: "Delay or claim",
  daily: "Daily report",
  billing: "Billing",
  items: "Open item",
  log: "Job log",
  other: "Record",
};
export const recordType = (t: string): RecordType =>
  (RECORD_TYPES as readonly string[]).includes(t) ? (t as RecordType) : "other";

export const WHO_OPTIONS: { value: "" | RecordGroup; label: string }[] = [
  { value: "", label: "Anyone" },
  { value: "team", label: "Your team" },
  { value: "athena", label: "Athena" },
  { value: "client", label: "Owner and client" },
  { value: "sub", label: "Subs and suppliers" },
];

type RpcClient = {
  rpc: (
    fn: "mcp_project_record_feed",
    args: { _job: string; _from: string | null; _to: string | null },
  ) => PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string; status?: number } | null;
  }>;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (s: string | null | undefined): s is string =>
  !!s && ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Reads the feed. A database "MCP_BAD:" message is shown to the member as written. */
export async function readProjectRecord(
  client: RpcClient,
  jobId: string,
  range: { from?: string | null; to?: string | null } = {},
): Promise<RecordFeed> {
  const from = validDate(range.from) ? range.from : null;
  const to = validDate(range.to) ? range.to : null;
  if (from && to && from > to) throw new Error("Choose a start date on or before the end date.");
  const { data, error } = await client.rpc("mcp_project_record_feed", {
    _job: jobId,
    _from: from,
    _to: to,
  });
  if (error) {
    const m = /MCP_BAD:(.*)$/s.exec(error.message ?? "");
    if (m) throw new Error(m[1].trim());
    throw Object.assign(new Error("The project record could not be read."), {
      code: error.code,
      status: error.status,
    });
  }
  const feed = data as RecordFeed | null;
  if (!feed || !Array.isArray(feed.events))
    throw new Error("The project record could not be read.");
  return { ...feed, unavailable_sources: feed.unavailable_sources ?? [] };
}

export type RecordFilter = { types: ReadonlySet<RecordType>; q: string; who: "" | RecordGroup };

export function filterEvents(events: RecordEvent[], f: RecordFilter): RecordEvent[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return events.filter((e) => {
    if (f.types.size && !f.types.has(recordType(e.type))) return false;
    if (f.who && e.by_group !== f.who) return false;
    if (!words.length) return true;
    const hay = [e.title, e.summary, e.by, e.by_role, e.to, e.how, entryId(e)]
      .join(" ")
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function typeCounts(events: RecordEvent[]): Map<RecordType, number> {
  const out = new Map<RecordType, number>();
  for (const e of events) out.set(recordType(e.type), (out.get(recordType(e.type)) ?? 0) + 1);
  return out;
}

/** A second entry made from the same saved row gets a letter, so every entry ID is unique. */
const SECOND: Record<string, string> = {
  daily_edit: "E",
  confirm_answer: "A",
  payment_void: "V",
  payapp_email: "M",
};
export function entryId(e: Pick<RecordEvent, "id" | "source">): string {
  const hex = (e.id.split(":").pop() ?? "").replace(/-/g, "").slice(0, 8).toUpperCase();
  return `R-${hex}${SECOND[e.source] ? `-${SECOND[e.source]}` : ""}`;
}

// ---------- time, always in the job's time zone ----------
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = zone + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: zone, ...opts });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts });
    }
    fmtCache.set(key, f);
  }
  return f;
}
const part = (f: Intl.DateTimeFormat, d: Date, t: Intl.DateTimeFormatPartTypes) =>
  f.formatToParts(d).find((p) => p.type === t)?.value ?? "";

/** The calendar date (YYYY-MM-DD) of a moment in the job's time zone. */
export function dayKey(at: string, zone: string): string {
  const d = new Date(at);
  const f = fmt(zone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${part(f, d, "year")}-${part(f, d, "month")}-${part(f, d, "day")}`;
}
/** "3:42 PM" in the job's time zone. */
export const clock = (at: string, zone: string) =>
  fmt(zone, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
/** "EST" / "CDT" for that moment in the job's time zone. */
export const zoneAbbr = (at: string, zone: string) =>
  part(fmt(zone, { timeZoneName: "short", hour: "numeric" }), new Date(at), "timeZoneName");
/** "Mon, Oct 5, 2026" for a YYYY-MM-DD date. */
export const dayHeading = (date: string) =>
  fmt("UTC", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${date}T12:00:00Z`),
  );
/** "Oct 5, 2026" for a YYYY-MM-DD date. */
export const shortDate = (date: string) =>
  fmt("UTC", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${date}T12:00:00Z`),
  );
/** "Oct 5, 2026, 3:42 PM EDT": the full stamp used in the drawer and exports. */
export const stampAt = (at: string, zone: string) =>
  `${shortDate(dayKey(at, zone))}, ${clock(at, zone)} ${zoneAbbr(at, zone)}`.trim();

export function groupByDay(
  events: RecordEvent[],
  zone: string,
): { day: string; events: RecordEvent[] }[] {
  const out: { day: string; events: RecordEvent[] }[] = [];
  for (const e of events) {
    const day = dayKey(e.at, zone);
    const last = out[out.length - 1];
    if (last && last.day === day) last.events.push(e);
    else out.push({ day, events: [e] });
  }
  return out;
}

/** The other entries about the same item (one RFI, one pay app, one daily...), oldest first. */
export function itemTrail(events: RecordEvent[], e: RecordEvent): RecordEvent[] {
  if (!e.ref_table || !e.ref_id) return [];
  return events
    .filter((x) => x.ref_table === e.ref_table && x.ref_id === e.ref_id)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Where on the job board the entry's item lives, when it has a page. */
export function itemLink(jobId: string, e: RecordEvent): { href: string; label: string } | null {
  const base = `/r/job/${jobId}`;
  const byTable: Record<string, [string, string]> = {
    mcp_daily_reports: ["daily-log", "Open daily reports"],
    mcp_living_reports: ["schedule", "Open the schedule"],
    mcp_lookaheads: ["lookahead", "Open the lookahead"],
    mcp_lookahead_confirms: ["lookahead", "Open the lookahead"],
    mcp_delay_events: ["schedule", "Open the schedule"],
    mcp_estimate_gap_items: ["gap-check", "Open the gap check"],
    mcp_estimate_verdicts: ["gap-check", "Open the gap check"],
    mcp_payment_applications: ["payment-applications", "Open pay applications"],
    mcp_recorded_payments: ["billing-records", "Open payment records"],
    mcp_portal_payments: ["billing-records", "Open payment records"],
    mcp_job_contracts: ["home#contracts", "Open contracts"],
    mcp_drawing_versions: ["estimate", "Open the estimate"],
    mcp_open_items: ["items", "Open open items"],
  };
  const hit = e.ref_table ? byTable[e.ref_table] : undefined;
  if (hit) return { href: `${base}/${hit[0]}`, label: hit[1] };
  if (e.source !== "record") return null;
  const t = recordType(e.type);
  if (t === "rfi")
    return /^rfc|\brfc\b/i.test(`${e.kind} ${e.title}`)
      ? { href: `${base}/rfcs`, label: "Open the RFC log" }
      : { href: `${base}/rfis`, label: "Open the RFI log" };
  if (t === "change") return { href: `${base}/cos`, label: "Open the change order log" };
  if (t === "submittal") return { href: `${base}/submittals`, label: "Open the submittal log" };
  if (t === "billing")
    return { href: `${base}/payment-applications`, label: "Open pay applications" };
  return null;
}

export function byLine(e: RecordEvent): string {
  return [e.by_role ? `${e.by}, ${e.by_role}` : e.by, e.to ? `To ${e.to}` : "", e.how ?? ""]
    .filter(Boolean)
    .join(" · ");
}

export const recordFileName = (
  jobNumber: string | null,
  ext: "pdf" | "xlsx",
  from?: string | null,
  to?: string | null,
) =>
  `${jobNumber ?? "Job"} Project Record${from || to ? ` ${from ?? "start"} to ${to ?? "today"}` : ""}.${ext}`.replace(
    /[\\/:*?"<>|]/g,
    "-",
  );

/** One row per entry, ready for the spreadsheet and the PDF table. */
export function exportRows(feed: RecordFeed, events: RecordEvent[]) {
  const zone = feed.time_zone;
  return events.map((e) => ({
    id: entryId(e),
    date: dayKey(e.at, zone),
    time: `${clock(e.at, zone)} ${zoneAbbr(e.at, zone)}`.trim(),
    utc: new Date(e.at).toISOString().replace(".000Z", "Z"),
    happened: e.happened_on ?? "",
    type: TYPE_TAG[recordType(e.type)],
    title: e.title,
    summary: e.summary ?? "",
    by: e.by,
    role: e.by_role ?? "",
    to: e.to ?? "",
    how: e.how ?? "",
  }));
}

export function recordXlsx(
  feed: RecordFeed,
  events: RecordEvent[],
  filterNote: string,
): Uint8Array {
  const rows = exportRows(feed, events);
  const head = (s: string): XlsxCell => ({ v: s, s: "head" });
  const sheet: XlsxCell[][] = [
    [
      head("Entry ID"),
      head(`Date (${feed.time_zone})`),
      head("Time"),
      head("System time (UTC)"),
      head("Happened on, when told later"),
      head("Type"),
      head("What"),
      head("Details"),
      head("By"),
      head("Role"),
      head("To"),
      head("How"),
    ],
    ...rows.map((r) => [
      r.id,
      r.date,
      r.time,
      r.utc,
      r.happened,
      r.type,
      { v: r.title, s: "wrap" as const },
      { v: r.summary, s: "wrap" as const },
      r.by,
      r.role,
      r.to,
      r.how,
    ]),
  ];
  const about: XlsxCell[][] = [
    [head("Project record"), head("")],
    ["Company", feed.company ?? ""],
    ["Job", `${feed.job_number ?? ""}${feed.job_name ? ` · ${feed.job_name}` : ""}`],
    ["Dates", `${feed.from ?? "Start of job"} to ${feed.to ?? "today"}`],
    ["Filters", filterNote],
    ["Entries", rows.length],
    ["Exported", new Date().toISOString().replace(/\.\d+Z$/, "Z")],
    ["Time zone", feed.time_zone],
    [
      "Basis",
      "Every entry is time-stamped by the system when it was saved and cannot be edited. The happened-on date is the date someone said it happened, when they told Athena later.",
    ],
    ...(feed.unavailable_sources.length
      ? [
          [
            "Not included",
            `Could not be read: ${feed.unavailable_sources.join(", ")}`,
          ] as XlsxCell[],
        ]
      : []),
    ["", "Powered by Athena"],
  ];
  return buildXlsx([
    {
      name: "Project record",
      rows: sheet,
      widths: [14, 14, 12, 22, 16, 16, 48, 60, 22, 20, 24, 18],
      freezeHeader: true,
    },
    { name: "About", rows: about, widths: [16, 90] },
  ]);
}
