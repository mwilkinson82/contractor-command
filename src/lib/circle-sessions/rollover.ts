import { createHash } from "node:crypto";
import { localToInstant, meetUrlSchema, type SessionRow } from "./model";

/** Cadence follows calendar dates, never UTC + 336 hours across DST. */
export function nextCadence(cadenceDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cadenceDate)) throw new Error("Invalid cadence date");
  const date = new Date(`${cadenceDate}T12:00:00Z`);
  if (date.toISOString().slice(0, 10) !== cadenceDate || date.getUTCDay() !== 0)
    throw new Error("Cadence anchor must be a Sunday");
  date.setUTCDate(date.getUTCDate() + 14);
  const day = date.toISOString().slice(0, 10);
  return {
    cadenceDate: day,
    startsAt: localToInstant(`${day}T17:00`, "America/New_York"),
    timeZone: "America/New_York",
  };
}
export type ConfirmedEvent = {
  id: string;
  calendarId: string;
  status: "confirmed" | "cancelled";
  startsAt: string;
  endsAt: string;
  timeZone: string;
  updatedAt: string;
  conferenceStatus: "pending" | "success" | "failure";
  meetingUrl?: string;
  recurrence?: string[];
};
export type RolloverPort = {
  // Must provide atomic provider idempotency (e.g. Calendar events.insert id), not search-then-create.
  ensureEvent: (input: {
    eventId: string;
    conferenceRequestId: string;
    cadenceDate: string;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    addGoogleMeet: true;
    sendUpdates: "none";
    attendees: [];
  }) => Promise<{ id: string }>;
  readEvent: (id: string) => Promise<ConfirmedEvent>;
  publish: (event: ConfirmedEvent, cadenceDate: string) => Promise<void>;
};
/** No credentials, job registration or live adapter. Parent supplies an authorized integration. */
export async function rolloverSession(current: SessionRow, port: RolloverPort, now = Date.now()) {
  if (
    !current.rollover_enabled ||
    current.status !== "scheduled" ||
    !current.cadence_date ||
    !current.calendar_id ||
    !current.calendar_event_id
  )
    return "paused";
  if (Date.parse(current.starts_at) > now) return "not_due";
  // Reconcile cancellation / reschedule before making another event.
  const source = await port.readEvent(current.calendar_event_id);
  if (
    source.status !== "confirmed" ||
    Date.parse(source.startsAt) !== Date.parse(current.starts_at) ||
    source.calendarId !== current.calendar_id
  )
    throw new Error("Source event changed; reconcile before rollover");
  const next = nextCadence(current.cadence_date);
  if (Date.parse(next.startsAt) <= now)
    throw new Error("Missed cadence requires review; do not backfill past events");
  const key = createHash("sha256")
    .update(`${current.calendar_id}/circle/${next.cadenceDate}`)
    .digest("hex");
  const endsAt = new Date(Date.parse(next.startsAt) + 90 * 60_000).toISOString();
  const result = await port.ensureEvent({
    eventId: `cc${key}`,
    conferenceRequestId: key,
    ...next,
    endsAt,
    addGoogleMeet: true,
    sendUpdates: "none",
    attendees: [],
  });
  const event = await port.readEvent(result.id);
  if (
    event.status !== "confirmed" ||
    event.calendarId !== current.calendar_id ||
    event.recurrence?.length ||
    Date.parse(event.startsAt) !== Date.parse(next.startsAt) ||
    Date.parse(event.endsAt) !== Date.parse(endsAt) ||
    event.timeZone !== next.timeZone
  )
    throw new Error("Calendar exception requires review");
  if (event.conferenceStatus === "pending") return "pending";
  if (event.conferenceStatus !== "success")
    throw new Error("Conference generation failed; retry same event only");
  const url = meetUrlSchema.parse(event.meetingUrl);
  if (url === current.meeting_url)
    throw new Error("Google Meet URL must be unique to the next call");
  await port.publish(event, next.cadenceDate);
  return "published";
}
