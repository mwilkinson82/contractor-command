import { describe, expect, it } from "vitest";
import { ImportInputError, importJob } from "./model";
import { fromMspdi, fromXer, isMspdi, isXer } from "./schedule-files";
import { planImport } from "./plan";

// ---------------------------------------------------------------------------
// A small P6 XER, written the way P6 writes one (tabs, %T/%F/%R, \x7f in clndr_data).
// ---------------------------------------------------------------------------

const table = (name: string, fields: string[], rows: (string | number)[][]) =>
  [`%T\t${name}`, `%F\t${fields.join("\t")}`, ...rows.map((r) => `%R\t${r.join("\t")}`)].join("\n");

const NL = "\x7f";
const shifts = (...s: string[]) => s.map((x, i) => `(0||${i}(s|${x})())`).join(NL);
const weekday = (n: number, work: boolean) =>
  work ? `(0||${n}()(${NL}${shifts("08:00|f|12:00", "13:00|f|17:00")}))` : `(0||${n}()())`;
const CLNDR_5DAY =
  `(0||CalendarData()(${NL}(0||DaysOfWeek()(${NL}` +
  [1, 2, 3, 4, 5, 6, 7].map((n) => weekday(n, n >= 2 && n <= 6)).join(NL) +
  `))${NL}(0||VIEW(ShowTotal|Y)())${NL}(0||Exceptions()(${NL}` +
  // New Year's Day and Memorial Day 2024 off; 2024-01-09 is a worked (half-day) exception.
  `(0||0(d|45292)())${NL}(0||1(d|45439)())${NL}(0||2(d|45300)(${NL}${shifts("08:00|f|12:00")}))))`;
const CLNDR_4x10 =
  `(0||CalendarData()((0||DaysOfWeek()(` +
  [1, 2, 3, 4, 5, 6, 7].map((n) => weekday(n, n >= 2 && n <= 5)).join("") +
  `))(0||Exceptions()())))`;

const TASK_FIELDS = [
  "task_id",
  "proj_id",
  "wbs_id",
  "clndr_id",
  "phys_complete_pct",
  "complete_pct_type",
  "task_type",
  "status_code",
  "task_code",
  "task_name",
  "target_drtn_hr_cnt",
  "remain_drtn_hr_cnt",
  "act_start_date",
  "act_end_date",
  "early_start_date",
  "early_end_date",
  "target_start_date",
  "target_end_date",
];

function xer(tasks: (string | number)[][], extraProjects = true) {
  return [
    "ERMHDR\t19.12\t2024-02-05\tProject\tADMIN\tadmin\tdbxDatabaseNoName\tProject Management\tUSD",
    table(
      "CALENDAR",
      ["clndr_id", "default_flag", "clndr_name", "day_hr_cnt", "clndr_data"],
      [
        ["10", "N", "ALP 5-day", "8", CLNDR_5DAY],
        ["11", "N", "4x10", "10", CLNDR_4x10],
      ],
    ),
    table(
      "PROJECT",
      [
        "proj_id",
        "proj_short_name",
        "clndr_id",
        "plan_start_date",
        "plan_end_date",
        "scd_end_date",
        "last_recalc_date",
      ],
      [
        [
          "1",
          "JOB-100",
          "10",
          "2024-01-02 08:00",
          "2024-03-01 17:00",
          "2024-02-20 17:00",
          "2024-02-01 00:00",
        ],
        ...(extraProjects
          ? [["2", "JOB-100-BL", "10", "2024-01-02 08:00", "", "", "2023-12-15 00:00"]]
          : []),
      ],
    ),
    table(
      "PROJWBS",
      [
        "wbs_id",
        "proj_id",
        "seq_num",
        "proj_node_flag",
        "parent_wbs_id",
        "wbs_short_name",
        "wbs_name",
      ],
      [
        ["100", "1", "0", "Y", "", "JOB-100", "Riverside Clinic Electrical"],
        ["101", "1", "20", "N", "100", "1", "Underground"],
        ["102", "1", "10", "N", "100", "2", "Rough-in"],
        ["200", "2", "0", "Y", "", "JOB-100-BL", "Riverside Clinic baseline"],
      ],
    ),
    table("TASK", TASK_FIELDS, tasks),
    table(
      "TASKPRED",
      [
        "task_pred_id",
        "task_id",
        "pred_task_id",
        "proj_id",
        "pred_proj_id",
        "pred_type",
        "lag_hr_cnt",
      ],
      [
        ["1", "1001", "1000", "1", "1", "PR_FS", "0"],
        ["2", "1002", "1001", "1", "1", "PR_SS", "16"],
        ["3", "1003", "1002", "1", "1", "PR_FF", "0"],
        ["4", "1004", "1003", "1", "1", "PR_FS", "0"],
        ["5", "1004", "1005", "1", "1", "PR_FS", "0"],
        ["6", "1007", "1003", "1", "1", "PR_FS", "-8"],
        ["7", "1001", "2000", "1", "2", "PR_FS", "0"],
      ],
    ),
    "%E",
  ].join("\r\n");
}

// prettier-ignore
const TASKS: (string | number)[][] = [
  ["1000", "1", "101", "10", "0", "CP_Drtn", "TT_Mile", "TK_Complete", "A1000", "Notice to proceed", "0", "0", "2024-01-02 08:00", "", "2024-01-02 08:00", "2024-01-02 08:00", "", ""],
  ["1001", "1", "101", "10", "0", "CP_Drtn", "TT_Task", "TK_Complete", "A1010", "Underground conduit", "80", "0", "2024-01-02 08:00", "2024-01-15 17:00", "", "", "", ""],
  ["1002", "1", "102", "10", "40", "CP_Phys", "TT_Rsrc", "TK_Active", "A1020", "Rough-in level 1", "120", "64", "2024-01-16 08:00", "", "2024-02-01 08:00", "2024-02-08 17:00", "", ""],
  ["1003", "1", "102", "11", "0", "CP_Drtn", "TT_Task", "TK_NotStart", "A1030", "Rough-in level 2", "40", "40", "", "", "2024-02-09 07:00", "2024-02-14 17:00", "", ""],
  ["1004", "1", "100", "10", "0", "CP_Drtn", "TT_FinMile", "TK_NotStart", "A1040", "Substantial completion", "0", "0", "", "", "2024-02-20 17:00", "2024-02-20 17:00", "", ""],
  ["1005", "1", "100", "10", "0", "CP_Drtn", "TT_LOE", "TK_Active", "A1050", "Project management", "400", "200", "2024-01-02 08:00", "", "2024-01-02 08:00", "2024-02-20 17:00", "", ""],
  ["1006", "1", "100", "10", "0", "CP_Drtn", "TT_WBS", "TK_Active", "A1060", "Electrical summary", "400", "200", "", "", "", "", "", ""],
  ["1007", "1", "102", "10", "0", "CP_Drtn", "TT_Task", "TK_NotStart", "A1030", "Rough-in level 3", "24", "24", "", "", "", "", "2024-02-12 08:00", "2024-02-14 17:00"],
  ["2000", "2", "200", "10", "0", "CP_Drtn", "TT_Mile", "TK_NotStart", "A1000", "Notice to proceed", "0", "0", "", "", "2024-01-02 08:00", "2024-01-02 08:00", "", ""],
];

describe("P6 XER", () => {
  it("recognizes XER text", () => {
    expect(isXer("\uFEFF  ERMHDR\t19.12")).toBe(true);
    expect(isXer("%T\tTASK")).toBe(false);
    expect(isMspdi(xer(TASKS))).toBe(false);
  });

  it("maps project, calendar, WBS, activities, logic and archive", () => {
    const job = fromXer(xer(TASKS), { system: "spreadsheet" });
    expect(() => importJob.parse(job)).not.toThrow();
    expect(job.source).toEqual({
      system: "spreadsheet",
      exported_at: "2024-02-05",
      label: "P6 schedule (XER) for job JOB-100",
    });
    expect(job.job).toEqual({
      source_id: "p6:JOB-100",
      job_number: "JOB-100",
      name: "Riverside Clinic Electrical",
      customer: null,
      pm_name: null,
      pm_email: null,
      completion_date: "2024-02-20",
    });
    expect(job.schedule_data_date).toBe("2024-02-01");
    expect(job.schedule_calendar).toEqual({
      work_days: [1, 2, 3, 4, 5],
      holidays: ["2024-01-01", "2024-05-27"],
    });
    expect(job.schedule_wbs).toEqual([
      { source_id: "wbs:102", name: "2 Rough-in", order: 0, parent: null },
      { source_id: "wbs:101", name: "1 Underground", order: 1, parent: null },
    ]);
    expect(job.schedule).toEqual([
      {
        source_id: "task:1000",
        id: "A1000",
        name: "Notice to proceed",
        start: "2024-01-02",
        finish: "2024-01-02",
        duration_days: 0,
        pct_complete: 100,
        predecessors: [],
        links: [],
        actual_start: "2024-01-02",
        actual_finish: "2024-01-02",
        remaining_days: 0,
        wbs: "wbs:101",
        milestone: true,
      },
      {
        source_id: "task:1001",
        id: "A1010",
        name: "Underground conduit",
        start: "2024-01-02",
        finish: "2024-01-15",
        duration_days: 10,
        pct_complete: 100,
        predecessors: ["A1000"],
        links: [{ id: "A1000", type: "FS", lag: 0 }],
        actual_start: "2024-01-02",
        actual_finish: "2024-01-15",
        remaining_days: 0,
        wbs: "wbs:101",
        milestone: false,
      },
      {
        source_id: "task:1002",
        id: "A1020",
        name: "Rough-in level 1",
        start: "2024-01-16",
        finish: "2024-02-08",
        duration_days: 15,
        pct_complete: 40,
        predecessors: ["A1010"],
        links: [{ id: "A1010", type: "SS", lag: 2 }],
        actual_start: "2024-01-16",
        actual_finish: null,
        remaining_days: 8,
        wbs: "wbs:102",
        milestone: false,
      },
      {
        source_id: "task:1003",
        id: "A1030",
        name: "Rough-in level 2",
        start: "2024-02-09",
        finish: "2024-02-14",
        duration_days: 4, // 40 h on the 10-hour calendar
        pct_complete: 0,
        predecessors: ["A1020"],
        links: [{ id: "A1020", type: "FF", lag: 0 }],
        actual_start: null,
        actual_finish: null,
        remaining_days: 4,
        wbs: "wbs:102",
        milestone: false,
      },
      {
        source_id: "task:1004",
        id: "A1040",
        name: "Substantial completion",
        start: "2024-02-20",
        finish: "2024-02-20",
        duration_days: 0,
        pct_complete: 0,
        predecessors: ["A1030"],
        links: [{ id: "A1030", type: "FS", lag: 0 }],
        actual_start: null,
        actual_finish: null,
        remaining_days: 0,
        wbs: null,
        milestone: true,
      },
      {
        source_id: "task:1007",
        id: "A1030-2",
        name: "Rough-in level 3",
        start: "2024-02-12",
        finish: "2024-02-14",
        duration_days: 3,
        pct_complete: 0,
        predecessors: ["A1030"],
        links: [{ id: "A1030", type: "FS", lag: -1 }], // -8 h on the predecessor's 10-hour calendar
        actual_start: null,
        actual_finish: null,
        remaining_days: 3,
        wbs: "wbs:102",
        milestone: false,
      },
    ]);
    expect(job.schedule.every((a) => a.baseline_start === undefined)).toBe(true);
    expect(job.held.map((h) => [h.kind, h.count])).toEqual([
      ["Other projects", 1],
      ["Level of effort tasks", 1],
      ["WBS summary tasks", 1],
      ["Other-calendar tasks", 1],
      ["Skipped-task logic ties", 1],
      ["Cross-project logic ties", 1],
    ]);
    expect(job.problems).toHaveLength(3);
    expect(job.problems[0]).toMatch(/holds 2 projects; Athena read JOB-100.*JOB-100-BL/);
    expect(job.problems[1]).toMatch(/ALP 5-day has 1 worked exception day/);
    expect(job.problems[2]).toMatch(/A1030 → A1030-2/);
    expect(Object.keys(job.archive.p6_tasks)).toEqual([
      "1000",
      "1001",
      "1002",
      "1003",
      "1004",
      "1005",
      "1006",
      "1007",
    ]);
    expect(job.archive.p6_tasks["1005"].task_type).toBe("TT_LOE");
    expect(Object.keys(job.archive.p6_links)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(Object.keys(job.archive.p6_project)).toEqual(["1"]);
    expect(job.sov).toEqual([]);
    expect(job.change_orders).toEqual([]);
    expect(job.ior).toBeNull();
  });

  it("reads the named project, and opts win over the file's job number and name", () => {
    const job = fromXer(xer(TASKS), {
      system: "procore",
      projectId: "job-100-bl",
      jobNumber: "24-017",
      jobName: "Clinic BL",
    });
    expect(job.job.job_number).toBe("24-017");
    expect(job.job.name).toBe("Clinic BL");
    expect(job.schedule.map((a) => a.id)).toEqual(["A1000"]);
    expect(job.problems.some((p) => /say which project/.test(p))).toBe(false);
    expect(() => fromXer(xer(TASKS), { system: "procore", projectId: "NOPE" })).toThrow(
      /no project NOPE.*JOB-100, JOB-100-BL/,
    );
  });

  it("refuses more than 400 activities and files that aren't XER", () => {
    const many = Array.from({ length: 401 }, (_, i) => {
      const r = [...TASKS[3]];
      r[0] = String(5000 + i);
      r[8] = `B${i}`;
      return r;
    });
    expect(() => fromXer(xer(many, false), { system: "spreadsheet" })).toThrow(ImportInputError);
    expect(() => fromXer(xer(many, false), { system: "spreadsheet" })).toThrow(
      /has 401 activities/,
    );
    expect(() => fromXer("hello, world", { system: "spreadsheet" })).toThrow(ImportInputError);
    expect(() => fromXer("ERMHDR\t19.12\n%T\tPROJECT\n%E", { system: "spreadsheet" })).toThrow(
      /no project with activities/,
    );
  });
});

// ---------------------------------------------------------------------------
// A small MS Project XML (MSPDI).
// ---------------------------------------------------------------------------

const weekDays = [1, 2, 3, 4, 5, 6, 7]
  .map(
    (d) =>
      `<WeekDay><DayType>${d}</DayType><DayWorking>${d >= 2 && d <= 6 ? 1 : 0}</DayWorking>` +
      (d >= 2 && d <= 6
        ? "<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime></WorkingTimes>"
        : "") +
      "</WeekDay>",
  )
  .join("\n        ");

const MSPDI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!-- saved by Microsoft Project -->
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>Riverside Clinic.xml</Name>
  <Title>Riverside Clinic &amp; MOB</Title>
  <LastSaved>2024-02-05T09:30:00</LastSaved>
  <StatusDate>2024-02-01T17:00:00</StatusDate>
  <FinishDate>2024-02-20T17:00:00</FinishDate>
  <CalendarUID>3</CalendarUID>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <Calendars>
    <Calendar>
      <UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID>
      <WeekDays>
        ${weekDays}
      </WeekDays>
      <Exceptions>
        <Exception>
          <EnteredByOccurrences>0</EnteredByOccurrences>
          <TimePeriod><FromDate>2024-01-15T00:00:00</FromDate><ToDate>2024-01-15T23:59:00</ToDate></TimePeriod>
          <Occurrences>1</Occurrences><Name>MLK Day</Name><Type>1</Type><DayWorking>0</DayWorking>
        </Exception>
      </Exceptions>
    </Calendar>
    <Calendar><UID>3</UID><Name>Job</Name><IsBaseCalendar>0</IsBaseCalendar><BaseCalendarUID>1</BaseCalendarUID></Calendar>
  </Calendars>
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>Riverside Clinic</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>1</UID><ID>1</ID><Name>Underground</Name><WBS>1</WBS><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
    <Task>
      <UID>2</UID><ID>2</ID><Name>Notice to proceed</Name><WBS>1.1</WBS><OutlineLevel>2</OutlineLevel>
      <Summary>0</Summary><Milestone>1</Milestone><Duration>PT0H0M0S</Duration>
      <Start>2024-01-02T08:00:00</Start><Finish>2024-01-02T08:00:00</Finish>
      <ActualStart>2024-01-02T08:00:00</ActualStart><ActualFinish>2024-01-02T08:00:00</ActualFinish>
      <PercentComplete>100</PercentComplete><RemainingDuration>PT0H0M0S</RemainingDuration>
      <Baseline><Number>0</Number><Start>2024-01-02T08:00:00</Start><Finish>2024-01-02T08:00:00</Finish></Baseline>
    </Task>
    <Task>
      <UID>3</UID><ID>3</ID><Name><![CDATA[Conduit & duct bank]]></Name><WBS>1.2</WBS><OutlineLevel>2</OutlineLevel>
      <Summary>0</Summary><Milestone>0</Milestone><Duration>PT80H0M0S</Duration>
      <Start>2024-01-03T08:00:00</Start><Finish>2024-01-17T17:00:00</Finish>
      <ActualStart>2024-01-03T08:00:00</ActualStart>
      <PercentComplete>60</PercentComplete><RemainingDuration>PT32H0M0S</RemainingDuration>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><CrossProject>0</CrossProject><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
      <Baseline><Number>0</Number><Start>2024-01-03T08:00:00</Start><Finish>2024-01-16T17:00:00</Finish></Baseline>
      <Baseline><Number>1</Number><Start>2023-12-01T08:00:00</Start><Finish>2023-12-14T17:00:00</Finish></Baseline>
    </Task>
    <Task>
      <UID>4</UID><ID>4</ID><Name>Pull wire</Name><WBS>1.3</WBS><OutlineLevel>2</OutlineLevel>
      <Summary>0</Summary><Duration>P5D</Duration>
      <Start>2024-01-08T08:00:00</Start><Finish>2024-01-19T17:00:00</Finish>
      <PercentComplete>0</PercentComplete><RemainingDuration>PT40H0M0S</RemainingDuration>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>3</Type><LinkLag>9600</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>0</Type><LinkLag>4800</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>28800</LinkLag><LagFormat>8</LagFormat></PredecessorLink>
      <Baseline><Number>0</Number><Start>2024-01-08T08:00:00</Start><Finish>2024-01-12T17:00:00</Finish></Baseline>
    </Task>
    <Task>
      <UID>5</UID><ID>5</ID><Name>Substantial completion</Name><WBS>2</WBS><OutlineLevel>1</OutlineLevel>
      <Milestone>1</Milestone><Duration>PT0H0M0S</Duration>
      <Start>2024-02-20T17:00:00</Start><Finish>2024-02-20T17:00:00</Finish><PercentComplete>0</PercentComplete>
      <PredecessorLink><PredecessorUID>4</PredecessorUID><Type>1</Type><LinkLag>-4800</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
      <Baseline><Number>0</Number><Start>2024-02-16T17:00:00</Start><Finish>2024-02-16T17:00:00</Finish></Baseline>
    </Task>
    <Task>
      <UID>6</UID><ID>6</ID><Name>Closeout punch list</Name><WBS>2.1.1.1.1.1.1.1.1.1.1</WBS><OutlineLevel>1</OutlineLevel>
      <Duration>PT16H0M0S</Duration><Start>2024-02-21T08:00:00</Start><Finish>2024-02-22T17:00:00</Finish>
      <PredecessorLink><PredecessorUID>99</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
  </Tasks>
</Project>`;

describe("MS Project XML", () => {
  it("recognizes MSPDI text", () => {
    expect(isMspdi(MSPDI)).toBe(true);
    expect(isMspdi("<Root><Tasks>\n<Task><UID>1</UID></Task></Tasks></Root>")).toBe(true);
    expect(isMspdi("<html><body>hi</body></html>")).toBe(false);
    expect(isXer(MSPDI)).toBe(false);
  });

  it("maps project, calendar, WBS, activities, logic, baseline and archive", () => {
    const job = fromMspdi(MSPDI, { system: "spreadsheet", jobNumber: "JOB-100" });
    expect(() => importJob.parse(job)).not.toThrow();
    expect(job.source).toEqual({
      system: "spreadsheet",
      exported_at: "2024-02-05T09:30:00",
      label: "MS Project schedule (XML) for job JOB-100",
    });
    expect(job.job).toMatchObject({
      source_id: "msp:Riverside Clinic",
      job_number: "JOB-100",
      name: "Riverside Clinic & MOB",
      completion_date: "2024-02-20",
    });
    expect(job.schedule_data_date).toBe("2024-02-01");
    expect(job.schedule_calendar).toEqual({ work_days: [1, 2, 3, 4, 5], holidays: ["2024-01-15"] });
    expect(job.schedule_wbs).toEqual([
      { source_id: "wbs:1", name: "1 Underground", order: 0, parent: null },
    ]);
    expect(job.schedule).toEqual([
      {
        source_id: "task:2",
        id: "1.1",
        name: "Notice to proceed",
        start: "2024-01-02",
        finish: "2024-01-02",
        duration_days: 0,
        pct_complete: 100,
        predecessors: [],
        links: [],
        actual_start: "2024-01-02",
        actual_finish: "2024-01-02",
        remaining_days: 0,
        wbs: "wbs:1",
        milestone: true,
        baseline_start: "2024-01-02",
        baseline_finish: "2024-01-02",
      },
      {
        source_id: "task:3",
        id: "1.2",
        name: "Conduit & duct bank",
        start: "2024-01-03",
        finish: "2024-01-17",
        duration_days: 10,
        pct_complete: 60,
        predecessors: ["1.1"],
        links: [{ id: "1.1", type: "FS", lag: 0 }],
        actual_start: "2024-01-03",
        actual_finish: null,
        remaining_days: 4,
        wbs: "wbs:1",
        milestone: false,
        baseline_start: "2024-01-03",
        baseline_finish: "2024-01-16",
      },
      {
        source_id: "task:4",
        id: "1.3",
        name: "Pull wire",
        start: "2024-01-08",
        finish: "2024-01-19",
        duration_days: 5,
        pct_complete: 0,
        predecessors: ["1.2", "1.1"],
        links: [
          { id: "1.2", type: "SS", lag: 2 },
          { id: "1.2", type: "FF", lag: 1 },
          { id: "1.1", type: "FS", lag: 1 }, // 2 elapsed days at 5 working days a week
        ],
        actual_start: null,
        actual_finish: null,
        remaining_days: 5,
        wbs: "wbs:1",
        milestone: false,
        baseline_start: "2024-01-08",
        baseline_finish: "2024-01-12",
      },
      {
        source_id: "task:5",
        id: "2",
        name: "Substantial completion",
        start: "2024-02-20",
        finish: "2024-02-20",
        duration_days: 0,
        pct_complete: 0,
        predecessors: ["1.3"],
        links: [{ id: "1.3", type: "FS", lag: -1 }],
        actual_start: null,
        actual_finish: null,
        remaining_days: 0,
        wbs: null,
        milestone: true,
        baseline_start: "2024-02-16",
        baseline_finish: "2024-02-16",
      },
      {
        source_id: "task:6",
        id: "A6",
        name: "Closeout punch list",
        start: "2024-02-21",
        finish: "2024-02-22",
        duration_days: 2,
        pct_complete: null,
        predecessors: [],
        links: [],
        actual_start: null,
        actual_finish: null,
        remaining_days: null,
        wbs: null,
        milestone: false,
      },
    ]);
    expect(job.held.map((h) => [h.kind, h.count])).toEqual([
      ["Summary-task logic ties", 1],
      ["External logic ties", 1],
    ]);
    expect(job.problems).toHaveLength(1);
    expect(job.problems[0]).toMatch(/1 tie uses an elapsed lag/);
    expect(Object.keys(job.archive.msp_tasks)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(job.archive.msp_tasks["4"]).toMatchObject({
      Name: "Pull wire",
      Duration: "P5D",
      BaselineStart: "2024-01-08T08:00:00",
      Predecessors: "3:SS:9600:7; 3:FF:4800:7; 2:FS:28800:8",
    });
  });

  it("asks for a job number when none is given, and refuses bad input", () => {
    const job = fromMspdi(MSPDI, { system: "spreadsheet" });
    expect(job.job.job_number).toBe("");
    expect(job.source.label).toBe("MS Project schedule (XML) for job Riverside Clinic & MOB");
    expect(job.problems[0]).toMatch(/no job number/);
    expect(() => fromMspdi("<html></html>", { system: "spreadsheet" })).toThrow(ImportInputError);
    expect(() => fromMspdi("not xml at all", { system: "spreadsheet" })).toThrow(ImportInputError);
    const many = Array.from(
      { length: 401 },
      (_, i) =>
        `<Task><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>T${i}</Name><OutlineLevel>1</OutlineLevel><Duration>PT8H0M0S</Duration></Task>`,
    ).join("");
    const big = `<Project xmlns="http://schemas.microsoft.com/project"><Tasks>${many}</Tasks></Project>`;
    expect(() => fromMspdi(big, { system: "spreadsheet" })).toThrow(/has 401 activities/);
  });
});

describe("planning an imported schedule file", () => {
  it.each([
    ["XER", () => fromXer(xer(TASKS), { system: "spreadsheet" })],
    ["MSPDI", () => fromMspdi(MSPDI, { system: "spreadsheet", jobNumber: "JOB-100" })],
  ])("%s comes in as Athena's CPM", (_, read) => {
    const plan = planImport(read(), { job_exists: false });
    expect(plan.package.schedule?.what).toMatch(
      /calculated on .* working calendar with data date 2024-02-01/,
    );
    expect(plan.held.join(" ")).not.toMatch(/\b1 \w+s\b/); // held kinds read in the singular
  });
});
