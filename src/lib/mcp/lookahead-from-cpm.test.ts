import { describe, expect, it } from "vitest";
import {
  lookaheadDates,
  lookaheadModel,
  lookaheadSourceLine,
  lookaheadView,
  lookaheadWindow,
  scheduleWindowLabel,
  windowActivities,
  type SAct,
} from "./styled-views";
import { phoneLookaheadText } from "./phone-reply";
import { lookaheadPdf } from "./lookahead-pdf";

// Fictional job 2717, Mon–Sat calendar, CPM v4 with data date 2026-06-25.
const DATA_DATE = "2026-06-25";
const ACTS: SAct[] = [
  {
    id: "01-010",
    name: "Mobilization",
    start: "2026-03-02",
    finish: "2026-03-07",
    actual_start: "2026-03-02",
    actual_finish: "2026-03-07",
    pct_complete: 100,
    duration: 6,
    total_float: 0,
  },
  // Done, and its actual finish overlaps the window: still left out.
  {
    id: "07-010",
    name: "Roofing",
    start: "2026-06-10",
    finish: "2026-06-26",
    actual_start: "2026-06-10",
    actual_finish: "2026-06-26",
    pct_complete: 100,
    duration: 14,
    total_float: 4,
  },
  // 100% with no actual finish still counts as done.
  {
    id: "07-020",
    name: "Flashing",
    start: "2026-06-20",
    finish: "2026-06-27",
    actual_start: "2026-06-20",
    pct_complete: 100,
    duration: 6,
    total_float: 4,
  },
  {
    id: "08-010",
    name: "Windows",
    start: "2026-05-12",
    finish: "2026-06-29",
    actual_start: "2026-05-12",
    pct_complete: 80,
    duration: 42,
    total_float: 3,
  },
  {
    id: "09-010",
    name: "Rough inspections",
    start: "2026-05-23",
    finish: "2026-07-04",
    actual_start: "2026-05-23",
    pct_complete: 65,
    duration: 36,
    total_float: 0,
  },
  {
    id: "09-020",
    name: "Drywall",
    start: "2026-06-06",
    finish: "2026-07-08",
    actual_start: "2026-06-06",
    pct_complete: 40,
    duration: 28,
    total_float: 0,
  },
  {
    id: "09-030",
    name: "Tile",
    start: "2026-06-24",
    finish: "2026-07-29",
    actual_start: "2026-06-24",
    pct_complete: 20,
    duration: 30,
    total_float: 6,
  },
  {
    id: "12-010",
    name: "Cabinet fabrication",
    start: "2026-04-20",
    finish: "2026-07-03",
    actual_start: "2026-04-20",
    pct_complete: 50,
    duration: 64,
    total_float: 2,
  },
  {
    id: "32-010",
    name: "Exterior hardscape",
    start: "2026-06-17",
    finish: "2026-08-07",
    actual_start: "2026-06-17",
    pct_complete: 30,
    duration: 44,
    total_float: 12,
  },
  {
    id: "12-020",
    name: "Cabinet install",
    start: "2026-07-09",
    finish: "2026-07-21",
    pct_complete: 0,
    duration: 11,
    total_float: 0,
  },
  {
    id: "MS-100",
    name: "Drywall complete",
    start: "2026-07-08",
    finish: "2026-07-08",
    duration: 0,
    activity_type: "milestone-finish",
    total_float: 0,
  },
  {
    id: "MS-200",
    name: "Substantial completion",
    start: "2026-09-30",
    finish: "2026-09-30",
    duration: 0,
    activity_type: "milestone-finish",
    total_float: 0,
  },
];
const IN_PROGRESS = ["12-010", "08-010", "09-010", "09-020", "32-010", "09-030"];

describe("2717 lookahead straight from the CPM", () => {
  it("defaults to two weeks from the data date and lists the six in-progress activities plus the window milestone", () => {
    const win = lookaheadWindow(null, DATA_DATE)!;
    expect(win).toEqual({ start: "2026-06-25", end: "2026-07-08", source: "cpm", note: null });
    const ids = windowActivities(ACTS, win.start, win.end).map((a) => a.id);
    // Sorted by start, then id. 12-020 starts Jul 9, after the window end, so it is not in.
    expect(ids).toEqual([...IN_PROGRESS, "MS-100"]);
    expect(ids).not.toContain("12-020");
    expect(ids).not.toContain("MS-200");
  });

  it("leaves out done activities even when their dates overlap the window", () => {
    const ids = windowActivities(ACTS, "2026-06-25", "2026-07-08").map((a) => a.id);
    expect(ids).not.toContain("07-010");
    expect(ids).not.toContain("07-020");
    expect(ids).not.toContain("01-010");
  });

  it("keeps an in-progress activity that started long before the window", () => {
    const ids = windowActivities(ACTS, "2026-06-25", "2026-07-08").map((a) => a.id);
    expect(ids).toContain("12-010"); // actual start Apr 20, 50%
    // An in-progress activity with no saved start uses its actual start.
    const only = windowActivities(
      [
        {
          id: "X1",
          name: "Started",
          actual_start: "2026-01-05",
          finish: "2026-07-01",
          pct_complete: 10,
        },
      ],
      "2026-06-25",
      "2026-07-08",
    );
    expect(only.map((a) => [a.id, a.start])).toEqual([["X1", "2026-01-05"]]);
  });

  it("honors a PM-picked start on or after the data date", () => {
    const win = lookaheadWindow({ start_date: "2026-06-27", end_date: "2026-07-10" }, DATA_DATE)!;
    expect(win).toEqual({ start: "2026-06-27", end: "2026-07-10", source: "cpm", note: null });
    // Now the window reaches Jul 9, so the not-started cabinet install is in.
    expect(windowActivities(ACTS, win.start, win.end).map((a) => a.id)).toContain("12-020");
    const sameDay = lookaheadWindow({ start_date: DATA_DATE, end_date: "2026-07-08" }, DATA_DATE)!;
    expect([sameDay.start, sameDay.end, sameDay.note]).toEqual(["2026-06-25", "2026-07-08", null]);
  });

  it("defers a saved start before the data date to the data date and says so", () => {
    const win = lookaheadWindow({ start_date: "2026-06-15", end_date: "2026-06-28" }, DATA_DATE)!;
    expect([win.start, win.end, win.source]).toEqual(["2026-06-25", "2026-07-08", "cpm"]);
    expect(win.note).toBe(
      "The saved lookahead window (Jun 15, 2026 – Jun 28, 2026) doesn't match the CPM data date; this view uses the CPM data date Jun 25, 2026.",
    );
  });

  it("marks actualized dates with A and shows % complete and total float", () => {
    const windows = ACTS.find((a) => a.id === "08-010")!;
    expect(lookaheadDates(windows)).toEqual({
      start: "2026-05-12 A",
      finish: "2026-06-29",
      pct: "80%",
      float: "3",
    });
    expect(scheduleWindowLabel(windows)).toBe("08-010 – Windows, May 12 A to Jun 29");
    const install = ACTS.find((a) => a.id === "12-020")!;
    expect(lookaheadDates(install)).toEqual({
      start: "2026-07-09",
      finish: "2026-07-21",
      pct: "0%",
      float: "0",
    });
    expect(scheduleWindowLabel(install)).toBe("12-020 – Cabinet install, Jul 9 to Jul 21");
    const done = ACTS.find((a) => a.id === "07-010")!;
    expect(lookaheadDates(done).finish).toBe("2026-06-26 A");
  });

  it("says where the activities come from", () => {
    expect(lookaheadSourceLine("2026-07-08", DATA_DATE, 4)).toBe(
      "From CPM v4, data date 06/25/26: activities under 100% that are in progress or start by 07/08/26.",
    );
  });

  it("the chat view, PDF and phone text use the same activity list", () => {
    const start = "2026-06-25";
    const end = "2026-07-08";
    const m = lookaheadModel(start, end, ACTS, [], { today: "2026-06-25", dataDate: DATA_DATE });
    expect(m.rows.map((r) => r.a.id)).toEqual(windowActivities(ACTS, start, end).map((a) => a.id));
    // The 12-010 bar runs from the first window day: it started Apr 20.
    expect(m.rows.find((r) => r.a.id === "12-010")!.cells[0].kind).not.toBe("");

    const view = lookaheadView({
      title: "2717 – Fictional Residence",
      ref: "LA-2717A",
      start,
      end,
      dataDate: DATA_DATE,
      acts: ACTS,
      items: [],
      today: "2026-06-25",
      version: 4,
    });
    expect(view).toContain(
      "From CPM v4, data date 06/25/26: activities under 100% that are in progress or start by 07/08/26.",
    );
    expect(view).toContain("| 08-010 Windows | 2026-05-12 A | 2026-06-29 | 80% | 3 |");
    expect(view).toContain("| 12-010 Cabinet fabrication | 2026-04-20 A | 2026-07-03 | 50% | 2 |");
    expect(view).not.toContain("07-010 Roofing");
    expect(view).not.toContain("12-020 Cabinet install");

    const pdf = Buffer.from(
      lookaheadPdf({
        title: "2717 - Fictional Residence",
        ref: "LA-2717A",
        start,
        end,
        dataDate: DATA_DATE,
        acts: ACTS,
        items: [],
        today: "2026-06-25",
        version: 4,
      }),
    ).toString("latin1");
    expect(pdf).toContain("From CPM v4, data date 06/25/26");
    expect(pdf).toContain("2026-05-12 A");
    expect(pdf).toContain("80%");
    expect(pdf).not.toContain("Roofing");

    const phone = phoneLookaheadText({
      as_of: "2026-06-25",
      window: { start, end },
      data_date: DATA_DATE,
      cpm_version: 4,
      activity_source: lookaheadSourceLine(end, DATA_DATE, 4),
      activities: windowActivities(ACTS, start, end),
      items: [],
    })!;
    expect(phone).toContain(
      "From CPM v4, data date 06/25/26: activities under 100% that are in progress or start by 07/08/26.",
    );
    expect(phone).toContain("- 08-010 – Windows, May 12 A to Jun 29 · 80% complete · TF 3");
    expect(phone).toContain(
      "- 12-010 – Cabinet fabrication, Apr 20 A to Jul 3 · 50% complete · TF 2",
    );
    expect(phone).not.toContain("Roofing");
    expect(phone).not.toContain("Cabinet install");
  });
});
