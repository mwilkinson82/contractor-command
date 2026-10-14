import { z } from "zod";

export const HUB_CALLS_URL = "https://app.alpcontractorcircle.com/calls";
export const timeZoneSchema = z
  .string()
  .min(1)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid IANA time zone, such as America/New_York");
export const meetUrlSchema = z
  .string()
  .regex(
    /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/,
    "Enter this session's unique Google Meet URL",
  );
export const sessionInputSchema = z.object({
  id: z.string().uuid().optional(),
  expectedVersion: z.number().int().positive().optional(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine(
      (value) => !/meet\.google\.com/i.test(value),
      "Keep Meet URLs in the private meeting-link field",
    ),
  localStart: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timeZone: timeZoneSchema,
  durationMin: z.number().int().min(15).max(480),
  meetingUrl: meetUrlSchema,
  description: z
    .string()
    .max(2000)
    .refine(
      (value) => !/meet\.google\.com/i.test(value),
      "Keep Meet URLs in the private meeting-link field",
    ),
  kind: z.enum(["Biweekly Call", "Monthly Bootcamp"]).default("Biweekly Call"),
});
export type SessionRow = {
  id: string;
  title: string;
  starts_at: string;
  time_zone: string;
  duration_min: number;
  meeting_url: string;
  description: string;
  kind: "Biweekly Call" | "Monthly Bootcamp";
  status: "scheduled" | "canceled";
  version: number;
  calendar_event_id: string | null;
  calendar_id: string | null;
  cadence_date: string | null;
  rollover_enabled: boolean;
};
export type SessionSummary = Omit<SessionRow, "meeting_url" | "calendar_id" | "calendar_event_id">;
export function summary(row: SessionRow): SessionSummary {
  const { meeting_url: _url, calendar_id: _calendar, calendar_event_id: _event, ...safe } = row;
  return safe;
}
export function localDateTime(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
/** Reject nonexistent AND ambiguous wall times; never silently pick a DST offset. */
export function localToInstant(local: string, timeZone: string): string {
  timeZoneSchema.parse(timeZone);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("Invalid local date/time");
  const guess = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(guess) || new Date(guess).toISOString().slice(0, 16) !== local)
    throw new Error("Invalid local date/time");
  const matches: string[] = [];
  // IANA modern offsets are multiples of 15 minutes, including half/quarter-hour zones.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const iso = new Date(guess + offset * 60_000).toISOString();
    if (localDateTime(iso, timeZone) === local) matches.push(iso);
  }
  if (matches.length !== 1)
    throw new Error(
      "This time is ambiguous or does not exist due to daylight saving. Choose another time.",
    );
  return matches[0];
}
export function assertAnnounceable(row: SessionRow, version?: number, now = Date.now()) {
  if (
    row.status !== "scheduled" ||
    Date.parse(row.starts_at) <= now ||
    !Number.isFinite(Date.parse(row.starts_at))
  )
    throw new Error("Select a future, scheduled session");
  meetUrlSchema.parse(row.meeting_url);
  if (version !== undefined && row.version !== version)
    throw new Error("Session changed. Refresh and preview it again.");
}
export function sessionLabel(row: Pick<SessionRow, "starts_at" | "time_zone" | "duration_min">) {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: row.time_zone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(row.starts_at))} · ${row.duration_min} minutes`;
}
export function sessionHubUrl(id: string) {
  return `${HUB_CALLS_URL}#session-${id}`;
}
export const sessionSelectionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
});
