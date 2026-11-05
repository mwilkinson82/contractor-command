import { describe, expect, it } from "vitest";
import { prepareSchedule, readScheduleControl, ScheduleInputError } from "./mcp/schedule-control";
import type { Activity, LivingData } from "./mcp/living";
import { comparisonHtml, delaysHtml, ganttHtml, ganttModel, viewItems } from "./cpm-gantt";
import { layoutActivities } from "./schedule-layouts";
import { layoutCatalog, layoutRows, scopedDelay } from "./mcp/schedule-layout-actions";
import { renderReportBody, scheduleLayoutHref } from "./report-pages";

const act = (
  id: string,
  duration: number,
  preds: string[],
  extra: Partial<Activity> = {},
): Activity => ({
  id,
  name: `Activity ${id}`,
  duration,
  start: null,
  finish: null,
  predecessors: preds.map((p) => ({ id: p, type: "FS" })),
  total_float: null,
  critical: null,
  pct_complete: 0,
  value: null,
  sov_line: null,
  cost_code: null,
  ...extra,
});
// Fictional network: A → B → C → End is the longest path; X and Y float.
function calculated(): LivingData {
  return prepareSchedule(null, 0, {
    operation: "recalculate",
    data_date: "2026-03-02",
    starter_wbs: true,
    settings: {
      project_start: "2026-03-02",
      default_calendar_id: "work",
      calendars: [
        { id: "work", name: "Mon to Fri", work_days: 62, holidays: [], hours_per_day: 8 },
      ],
      finish_convention: "inclusive-last-work-day",
      out_of_sequence: "retained-logic",
    },
    initial_activities: [
      act("A", 3, [], { wbs_id: "general-requirements" }),
      act("B", 5, ["A"], { wbs_id: "construction" }),
      act("C", 5, ["B"], { wbs_id: "construction" }),
      act("X", 6, ["A"], { wbs_id: "construction" }),
      act("Y", 4, ["A"], { wbs_id: "procurement" }),
      act("End", 0, ["C", "X", "Y"], { wbs_id: "closeout" }),
    ],
  }).data as LivingData;
}
const area = {
  id: "area",
  name: "Area",
  values: [
    { id: "L1", name: "Level 1" },
    { id: "L2", name: "Level 2" },
  ],
};
const trade = {
  id: "trade",
  name: "Responsible trade",
  values: [{ id: "elec", name: "Electrical" }],
};
function coded(): LivingData {
  return prepareSchedule(calculated(), 1, {
    operation: "organize",
    data_date: "2026-03-02",
    activity_codes: [area, trade],
    code_assignments: [
      { activity_id: "B", code_id: "area", value_id: "L1" },
      { activity_id: "C", code_id: "area", value_id: "L2" },
      { activity_id: "X", code_id: "area", value_id: "L1" },
      { activity_id: "X", code_id: "trade", value_id: "elec" },
    ],
    layouts: [
      {
        id: "level-1",
        name: "Level 1 by float",
        group: "cascade",
        columns: ["od", "pc", "fi", "tf", "code:area"],
        sort: { key: "tf", dir: "desc" },
        filter: { codes: [{ code_id: "area", value_ids: ["L1"] }] },
        timescale: "week",
      },
    ],
  }).data as LivingData;
}
const control = (d: LivingData) => readScheduleControl(d)!;

describe("activity codes and saved layouts", () => {
  it("saves codes, assignments and layouts with organize and keeps the calculation", () => {
    const d = coded();
    const c = control(d);
    expect(c.calculation.status).toBe("calculated");
    expect(c.activity_codes!.map((x) => x.id)).toEqual(["area", "trade"]);
    expect(c.code_values).toEqual({
      B: { area: "L1" },
      C: { area: "L2" },
      X: { area: "L1", trade: "elec" },
    });
    expect(c.layouts![0].name).toBe("Level 1 by float");
    // Dates are untouched.
    expect(d.activities!.map((a) => a.finish)).toEqual(
      calculated().activities!.map((a) => a.finish),
    );
  });

  it("replaces by ID, clears with null and drops assignments when a code is removed", () => {
    const next = prepareSchedule(coded(), 2, {
      operation: "organize",
      data_date: "2026-03-02",
      code_assignments: [{ activity_id: "B", code_id: "area", value_id: null }],
      remove_code_ids: ["trade"],
      remove_layout_ids: ["level-1"],
    }).data as LivingData;
    const c = control(next);
    expect(c.activity_codes!.map((x) => x.id)).toEqual(["area"]);
    expect(c.code_values).toEqual({ C: { area: "L2" }, X: { area: "L1" } });
    expect(c.layouts).toEqual([]);
  });

  it("refuses unknown values, layouts that name missing codes, and code changes in a baseline", () => {
    const d = coded();
    const bad = (req: Record<string, unknown>) => () =>
      prepareSchedule(d, 2, { operation: "organize", data_date: "2026-03-02", ...req } as never);
    expect(
      bad({ code_assignments: [{ activity_id: "B", code_id: "area", value_id: "L9" }] }),
    ).toThrow(/area has no value L9/);
    expect(
      bad({ code_assignments: [{ activity_id: "Q", code_id: "area", value_id: "L1" }] }),
    ).toThrow(/Unknown activity Q/);
    expect(
      bad({ layouts: [{ id: "x", name: "X", group: "wbs", columns: ["code:phase"] }] }),
    ).toThrow(/unknown activity code phase/);
    expect(() =>
      prepareSchedule(d, 2, {
        operation: "baseline",
        data_date: "2026-03-02",
        baseline: { id: "BL1", name: "B", status: "draft" },
        layouts: [{ id: "x", name: "X", group: "wbs", columns: [] }],
      }),
    ).toThrow(ScheduleInputError);
  });

  it("opens a layout on the page: its grouping, columns, sort, filter and timescale", () => {
    const d = coded();
    const input = {
      data: d,
      control: control(d),
      dataDate: "2026-03-02",
      layout: "level-1",
      layoutHref: scheduleLayoutHref,
    };
    const html = ganttHtml(input);
    expect(html).toMatch(/id="cpm-v-cascade" checked/);
    expect(html).not.toMatch(/id="cpm-v-all" checked/);
    expect(html).toMatch(/id="cpm-s-tf-d" checked/);
    expect(html).not.toMatch(/id="cpm-s-none" checked/);
    expect(html).toMatch(/id="cpm-col-pc" checked/);
    expect(html).toMatch(/id="cpm-col-k0" checked/); // Area code column
    expect(html).not.toMatch(/id="cpm-col-st" checked/);
    expect(html).toContain('data-layout-open="level-1"');
    expect(html).toContain("Layout: Level 1 by float");
    expect(html).toContain('href="../schedule?layout=level-1"');
    // Only Level 1 activities in the cascade view.
    const m = ganttModel(input);
    const ids = viewItems(m, "cascade").flatMap((it) => (it.kind === "act" ? [it.r.a.id] : []));
    expect(ids.sort()).toEqual(["B", "X"]);
    expect(m.scale).toBe(7);
    // The code column shows the value name, and the code filter lists every value.
    expect(html).toMatch(/class="cpm-c c-k0">Level 1</);
    // Each code gets its own filter chip, so Responsible trade filters the whole schedule.
    expect(html).toContain('<span>Area</span><select id="cpm-code0">');
    expect(html).toMatch(/<span>Responsible trade<\/span><select id="cpm-code1">[^]*>Electrical<\/option>/);
  });

  it("shows no layout picker on a share page, and the default view without a layout", () => {
    const d = coded();
    const share = ganttHtml({ data: d, control: control(d), dataDate: "2026-03-02" });
    expect(share).not.toContain('class="cpm-cols cpm-lays"');
    const signedIn = ganttHtml({
      data: d,
      control: control(d),
      dataDate: "2026-03-02",
      layoutHref: scheduleLayoutHref,
    });
    expect(signedIn).toContain("Layout: Default");
    expect(signedIn).toMatch(/id="cpm-v-all" checked/);
    expect(signedIn).toMatch(/id="cpm-s-none" checked/);
    expect(signedIn).toMatch(/id="cpm-col-st" checked/);
    expect(signedIn).not.toMatch(/id="cpm-col-k0" checked/);
  });

  it("passes the layout through the signed-in page render", () => {
    const d = coded();
    const html = renderReportBody(
      {
        page: "schedule",
        job_number: "9001",
        job_name: "Fictional",
        report: { found: true, version: 2, data: d, data_date: "2026-03-02" },
      } as never,
      { jobId: "j", layout: "level-1", layoutHref: scheduleLayoutHref },
    );
    expect(html).toContain('data-layout-open="level-1"');
  });

  it("gives the AI the layout's rows in order with its columns", () => {
    const d = coded();
    const c = control(d);
    const spec = c.layouts![0];
    expect(layoutActivities(d, c, spec).map((a) => a.id)).toEqual(["X", "B"]); // X floats, B is critical
    const rows = layoutRows(d, c, spec);
    expect(rows.columns).toEqual(["id", "name", "od", "pc", "fi", "tf", "code:area"]);
    expect(rows.rows[0]["code:area"]).toBe("Level 1");
    expect(rows.table.split("\n")[0]).toBe("| ID | Activity | OD | % | Finish | TF | Area |");
    const cat = layoutCatalog(c, "job-1");
    expect(cat.layouts[0].url).toBe(
      "https://app.meetathena.io/r/job/job-1/schedule?layout=level-1",
    );
    expect(cat.codes[0].values[0]).toEqual({ id: "L1", name: "Level 1", activities: 2 });
    // A one-off query: WBS construction, cascade, sorted by finish.
    const q = layoutRows(d, c, {
      group: "cascade",
      columns: ["fi"],
      sort: { key: "fi", dir: "asc" },
      filter: { wbs_ids: ["construction"] },
    });
    expect(q.rows.map((r) => r.id)).toEqual(["B", "X", "C"]);
  });

  it("scopes a TIA and the delay register to a layout's activities", () => {
    const d = coded();
    const tia = prepareSchedule(d, 2, {
      operation: "tia",
      data_date: "2026-03-02",
      delay: {
        event_id: "DE-1",
        description: "Fictional late switchgear",
        event_date: "2026-03-03",
        source_refs: ["Fictional RFI 1"],
        assumptions: [],
        add_activities: [act("F1", 10, ["A"], { wbs_id: "construction" })],
        replace_predecessors: [{ activity_id: "X", predecessors: [{ id: "F1", type: "FS" }] }],
      },
    });
    const td = tia.data as LivingData;
    const c = control(td);
    const level1 = c.layouts![0];
    const s = scopedDelay(td, c, level1, tia.changes);
    expect(s.delay_events.map((e) => e.event_id)).toEqual(["DE-1"]);
    expect(s.analysis!.touches_scope).toBe(true);
    expect(s.changed_activity_ids).toContain("X");
    // On the page, a layout that misses the event says so; one that holds it lists it.
    const level2 = prepareSchedule(td, 3, {
      operation: "organize",
      data_date: "2026-03-02",
      layouts: [
        {
          id: "l2",
          name: "Level 2",
          group: "wbs",
          columns: [],
          filter: { codes: [{ code_id: "area", value_ids: ["L2"] }] },
        },
      ],
    }).data as LivingData;
    const c2 = control(level2);
    expect(
      delaysHtml({ data: level2, control: c2, dataDate: "2026-03-02", layout: "l2" }),
    ).toContain("No modeled delay event touches this layout");
    expect(
      delaysHtml({ data: level2, control: c2, dataDate: "2026-03-02", layout: "level-1" }),
    ).toContain('data-delay-event="DE-1"');
    // The fragnet always shows inside a layout, so the delay it causes stays visible.
    const m = ganttModel({ data: level2, control: c2, dataDate: "2026-03-02", layout: "l2" });
    expect(m.byId.get("F1")!.keep).toBe(true);
    expect(
      comparisonHtml({ data: level2, control: c2, dataDate: "2026-03-02", layout: "l2" }),
    ).toBe("");
  });
});
