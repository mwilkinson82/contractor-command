import { describe, it, expect, vi } from "vitest";
import { localToInstant, assertAnnounceable, summary, type SessionRow } from "./model";
import { nextAny } from "@/lib/program";
import { nextCadence, rolloverSession, type ConfirmedEvent, type RolloverPort } from "./rollover";
import { resolveAnnouncement } from "./announcement.server";
import { revealMeeting, assertQueuedSessionCurrent } from "./store.server";
export const row: SessionRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Circle",
  starts_at: "2026-10-25T21:00:00.000Z",
  duration_min: 90,
  time_zone: "America/New_York",
  meeting_url: "https://meet.google.com/abc-defg-hij",
  description: "Work session",
  kind: "Biweekly Call",
  status: "scheduled",
  version: 1,
  calendar_id: "owner",
  calendar_event_id: "source",
  cadence_date: "2026-10-25",
  rollover_enabled: true,
};
function db(session = row, state = "eligible", error = false) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      data: { ...session, email: "member@example.test" },
      error: error ? { message: "offline" } : null,
    }),
  };
  return {
    from: () => chain,
    rpc: async () => ({
      data: { state, hasAccess: state === "eligible", reason: state },
      error: error ? { message: "offline" } : null,
    }),
  };
}
describe("Circle sessions", () => {
  it("uses Eastern calendar dates across autumn and spring DST", () => {
    expect(nextCadence("2026-10-11").startsAt).toBe("2026-10-25T21:00:00.000Z");
    expect(nextCadence("2026-10-25").startsAt).toBe("2026-11-08T22:00:00.000Z");
    expect(nextCadence("2027-03-07").startsAt).toBe("2027-03-21T21:00:00.000Z");
    expect(() => localToInstant("2026-03-08T02:30", "America/New_York")).toThrow(/ambiguous/);
    expect(() => localToInstant("2026-11-01T01:30", "America/New_York")).toThrow(/ambiguous/);
    expect(() => localToInstant("2026-02-30T17:00", "America/New_York")).toThrow();
    expect(() => localToInstant("2026-10-25T17:00", "Bogus/Zone")).toThrow();
  });
  it("never falls back to ended sessions and keeps an in-progress call", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T21:10:00Z"));
    expect(nextAny()).toBeUndefined();
    const session = {
      title: "Circle",
      kind: "Biweekly Call" as const,
      date: row.starts_at,
      durationMin: 90,
      zoomUrl: "/calls",
      meetingProvider: "Google Meet" as const,
      description: "",
    };
    expect(nextAny([session])).toEqual(session);
    vi.setSystemTime(new Date("2026-10-25T22:30:00Z"));
    expect(nextAny([session])).toBeUndefined();
    vi.useRealTimers();
  });
  it("rejects stale, canceled, started and invalid sessions", () => {
    expect(() => assertAnnounceable(row, 2, 0)).toThrow(/changed/);
    expect(() => assertAnnounceable({ ...row, status: "canceled" }, 1, 0)).toThrow(/future/);
    expect(() => assertAnnounceable(row, 1, Date.parse(row.starts_at))).toThrow(/future/);
    expect(summary(row)).not.toHaveProperty("meeting_url");
  });
  it("rechecks current membership before revealing any Meet URL", async () => {
    await expect(revealMeeting(db(), "user", row.id, 0)).resolves.toEqual({ url: row.meeting_url });
    for (const state of ["ineligible", "review"])
      await expect(revealMeeting(db(row, state), "user", row.id, 0)).rejects.toThrow(/membership/);
    await expect(revealMeeting(db(row, "eligible", true), "user", row.id, 0)).rejects.toThrow();
    await expect(
      revealMeeting(db({ ...row, status: "canceled" }), "user", row.id, 0),
    ).rejects.toThrow();
    await expect(
      revealMeeting(db(), "user", row.id, Date.parse(row.starts_at) + 90 * 60000),
    ).rejects.toThrow();
  });
  it("uses matching session snapshots in previews and rejects pasted Meet links", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const input = {
      mode: "call" as const,
      session: { id: row.id, version: 1 },
      subject: "Next call",
      headline: "Next call",
      body: "Welcome",
    };
    const a = await resolveAnnouncement(db(), input);
    const b = await resolveAnnouncement(db(), input);
    expect(a.hash).toBe(b.hash);
    expect(JSON.stringify(a)).not.toContain("meet.google.com");
    expect(a.props.callSession?.details).toContain("5:00 PM EDT");
    expect((await resolveAnnouncement(db(), { ...input, body: "Changed" })).hash).not.toBe(a.hash);
    await expect(resolveAnnouncement(db(), { ...input, body: row.meeting_url })).rejects.toThrow(
      /Hub/,
    );
    await expect(resolveAnnouncement(db(), { ...input, mode: "general" })).rejects.toThrow();
    const general = await resolveAnnouncement(db(), {
      ...input,
      mode: "general",
      session: undefined,
    });
    expect(general.props.callSession).toBeUndefined();
    expect(general.props.ctaUrl).toBeUndefined();
    await expect(
      assertQueuedSessionCurrent(db({ ...row, version: 2 }), { circle_session: input.session }),
    ).rejects.toThrow(/changed/);
    vi.useRealTimers();
  });
});
describe("calendar rollover adapter contract", () => {
  const current = { ...row, starts_at: "2026-10-11T21:00:00.000Z", cadence_date: "2026-10-11" };
  function port(status: ConfirmedEvent["conferenceStatus"] = "success") {
    const target: ConfirmedEvent = {
      id: "next",
      calendarId: "owner",
      status: "confirmed",
      startsAt: row.starts_at,
      endsAt: "2026-10-25T22:30:00.000Z",
      timeZone: row.time_zone,
      updatedAt: "2026-10-11T21:01:00Z",
      conferenceStatus: status,
      meetingUrl: "https://meet.google.com/klm-nopq-rst",
    };
    return {
      ensureEvent: vi.fn(async (_input: Parameters<RolloverPort["ensureEvent"]>[0]) => ({
        id: "next",
      })),
      readEvent: vi.fn(async (id: string) =>
        id === "source" ? { ...target, id, startsAt: current.starts_at } : target,
      ),
      publish: vi.fn(async () => {}),
    };
  }
  it("uses stable identity on retries, publishes only confirmed fresh conference, no member invites", async () => {
    const p = port();
    const now = Date.parse(current.starts_at);
    await rolloverSession(current, p, now);
    await rolloverSession(current, p, now);
    expect(p.ensureEvent.mock.calls[0]).toEqual(p.ensureEvent.mock.calls[1]);
    expect(p.ensureEvent.mock.calls[0][0]).toMatchObject({
      sendUpdates: "none",
      attendees: [],
      addGoogleMeet: true,
    });
    expect(p.publish).toHaveBeenCalledTimes(2); // publish is a DB upsert, verified separately.
  });
  it("does not publish pending/failed conferences or create before start", async () => {
    const p = port("pending");
    expect(await rolloverSession(current, p, Date.parse(current.starts_at))).toBe("pending");
    expect(p.publish).not.toHaveBeenCalled();
    const f = port("failure");
    await expect(rolloverSession(current, f, Date.parse(current.starts_at))).rejects.toThrow(
      /failed/,
    );
    expect(f.publish).not.toHaveBeenCalled();
    const early = port();
    expect(await rolloverSession(current, early, 0)).toBe("not_due");
    expect(early.ensureEvent).not.toHaveBeenCalled();
  });
  it("pauses cancellations, exceptions and missed cadence", async () => {
    const p = port();
    expect(
      await rolloverSession({ ...current, status: "canceled" }, p, Date.parse(current.starts_at)),
    ).toBe("paused");
    await expect(rolloverSession(current, p, Date.parse("2026-11-20T00:00:00Z"))).rejects.toThrow(
      /Missed/,
    );
    p.readEvent.mockResolvedValue({
      id: "source",
      calendarId: "owner",
      status: "cancelled",
      startsAt: current.starts_at,
      endsAt: row.starts_at,
      timeZone: row.time_zone,
      updatedAt: row.starts_at,
      conferenceStatus: "success",
    });
    await expect(rolloverSession(current, p, Date.parse(current.starts_at))).rejects.toThrow(
      /changed/,
    );
    expect(p.ensureEvent).not.toHaveBeenCalled();
  });
});
