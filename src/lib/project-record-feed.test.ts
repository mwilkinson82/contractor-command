import { describe, it, expect } from "vitest";
import {
  clock,
  dayKey,
  entryId,
  filterEvents,
  groupByDay,
  itemLink,
  itemTrail,
  readProjectRecord,
  recordFileName,
  recordXlsx,
  typeCounts,
  zoneAbbr,
  type RecordEvent,
  type RecordFeed,
} from "./project-record-feed";
import { projectRecordPdf } from "./project-record-pdf";

const JOB = "00000000-0000-0000-0000-0000000000a1";
const ev = (p: Partial<RecordEvent>): RecordEvent => ({
  id: "record:6f1c2a9e-1111-2222-3333-444455556666",
  source: "record",
  at: "2026-10-05T01:30:00Z",
  type: "rfi",
  kind: "submittal_sent",
  title: "RFI 14 sent",
  by: "Pat PM",
  by_group: "team",
  ...p,
});
const events: RecordEvent[] = [
  ev({
    id: "daily_edit:aaaaaaaa-0000-0000-0000-000000000001",
    source: "daily_edit",
    type: "daily",
    title: "Daily report edited",
    at: "2026-10-06T12:00:00Z",
    ref_table: "mcp_daily_reports",
    ref_id: "d1",
  }),
  ev({
    id: "daily:aaaaaaaa-0000-0000-0000-000000000001",
    source: "daily",
    type: "daily",
    title: "Daily report saved",
    by: "Sam Super",
    ref_table: "mcp_daily_reports",
    ref_id: "d1",
  }),
  ev({
    title: "RFC 3 sent",
    kind: "rfc_sent",
    by: "Athena",
    by_group: "athena",
    to: "Arch Co",
    how: "Email",
    at: "2026-10-04T15:00:00Z",
  }),
  ev({
    type: "change",
    id: "record:7a000000-0000-0000-0000-000000000004",
    title: "PCO 4 approved",
    by: "Owner Olive",
    by_group: "client",
    at: "2026-10-03T16:00:00Z",
  }),
];
const feed: RecordFeed = {
  job_id: JOB,
  job_number: "2717",
  job_name: "Harbor Clinic",
  company: "ALP Builders",
  time_zone: "America/New_York",
  from: null,
  to: null,
  captured_at: "2026-10-07T00:00:00Z",
  count: events.length,
  truncated: false,
  unavailable_sources: [],
  events,
};

describe("project record feed helpers", () => {
  it("reads times in the job's time zone", () => {
    expect(dayKey("2026-10-05T01:30:00Z", "America/New_York")).toBe("2026-10-04");
    expect(dayKey("2026-10-05T01:30:00Z", "UTC")).toBe("2026-10-05");
    expect(clock("2026-10-05T01:30:00Z", "America/New_York")).toBe("9:30 PM");
    expect(zoneAbbr("2026-10-05T01:30:00Z", "America/New_York")).toBe("EDT");
    expect(zoneAbbr("2026-12-05T01:30:00Z", "America/New_York")).toBe("EST");
  });

  it("groups by local day in feed order", () => {
    const g = groupByDay(events, "America/New_York");
    expect(g.map((x) => [x.day, x.events.length])).toEqual([
      ["2026-10-06", 1],
      ["2026-10-04", 2],
      ["2026-10-03", 1],
    ]);
  });

  it("gives every entry a unique, stable ID", () => {
    const ids = events.map(entryId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("R-AAAAAAAA-E");
    expect(ids[1]).toBe("R-AAAAAAAA");
  });

  it("filters by type, who and words", () => {
    const all = new Set<never>();
    expect(filterEvents(events, { types: new Set(["daily"]), who: "", q: "" })).toHaveLength(2);
    expect(filterEvents(events, { types: all, who: "client", q: "" }).map((e) => e.title)).toEqual([
      "PCO 4 approved",
    ]);
    expect(
      filterEvents(events, { types: all, who: "", q: "arch rfc" }).map((e) => e.title),
    ).toEqual(["RFC 3 sent"]);
    expect(filterEvents(events, { types: all, who: "", q: "r-aaaaaaaa-e" })).toHaveLength(1);
    expect(typeCounts(events).get("daily")).toBe(2);
  });

  it("links each entry to its item and its trail", () => {
    expect(itemLink(JOB, events[1])?.href).toBe(`/r/job/${JOB}/daily-log`);
    expect(itemLink(JOB, events[2])?.href).toBe(`/r/job/${JOB}/rfcs`);
    expect(itemLink(JOB, events[3])?.href).toBe(`/r/job/${JOB}/cos`);
    expect(itemTrail(events, events[0]).map((e) => e.source)).toEqual(["daily", "daily_edit"]);
    expect(itemTrail(events, events[2])).toEqual([]);
  });

  it("shows a database message as written and hides other errors", async () => {
    const client = (error: { message: string } | null, data: unknown = feed) => ({
      rpc: async () => ({ data, error }),
    });
    await expect(
      readProjectRecord(client({ message: "MCP_BAD:The project record needs full access." }), JOB),
    ).rejects.toThrow("The project record needs full access.");
    await expect(
      readProjectRecord(client({ message: "relation x does not exist" }), JOB),
    ).rejects.toThrow("The project record could not be read.");
    await expect(
      readProjectRecord(client(null), JOB, { from: "2026-10-09", to: "2026-10-01" }),
    ).rejects.toThrow(/start date/);
    expect((await readProjectRecord(client(null), JOB, { from: "bad" })).count).toBe(4);
  });

  it("builds the Excel and PDF files", () => {
    const x = recordXlsx(feed, events, "All types · Anyone");
    expect(x[0]).toBe(0x50);
    expect(x[1]).toBe(0x4b);
    const pdf = projectRecordPdf(feed, events, { details: true, filterNote: "All types · Anyone" });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(
      projectRecordPdf({ ...feed, events: [] }, [], { details: false, filterNote: "x" }).length,
    ).toBeGreaterThan(500);
    expect(recordFileName("2717", "pdf", "2026-10-01", null)).toBe(
      "2717 Project Record 2026-10-01 to today.pdf",
    );
  });
});
