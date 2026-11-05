import { describe, expect, it } from "vitest";
import { importJob } from "./model";
import { planImport } from "./plan";
import { detectSheetKind, fromSpreadsheets, parseTable } from "./spreadsheet";

// Column layouts as Procore's and Buildertrend's help pages describe their
// exports. Every project here is fictional.
const procore = {
  invoice: `Item No.,Description of Work,Cost Code,Scheduled Value,From Previous Application,This Period,Materials Presently Stored,Total Completed and Stored to Date,% (G/C),Balance to Finish,Retainage
1,General Conditions,01-000,"$120,000.00","$40,000.00","$10,000.00",$0.00,"$50,000.00",41.67%,"$70,000.00","$5,000.00"
2,Electrical Rough,26-100,"$300,000.00","$90,000.00","$30,000.00","$12,000.00","$132,000.00",44%,"$168,000.00","$12,000.00"
,Grand Total,,"$420,000.00",,,,,,,`,
  budget: `Cost Code,Description,Original Budget Amount,Budget Modifications,Approved COs,Revised Budget,Committed Costs,Direct Costs,Projected Costs
01-000,General Conditions,"$95,000.00",$0.00,$0.00,"$95,000.00","$20,000.00","$30,000.00","$95,000.00"
26-100,Electrical Rough,"$240,000.00",$0.00,"$8,000.00","$248,000.00","$180,000.00","$15,000.00","$250,000.00"
31-000,Earthwork,"$15,000.00",$0.00,$0.00,"$15,000.00",$0.00,$0.00,"$15,000.00"`,
  cos: `#,Title,Status,Date Initiated,Due Date,Executed,Amount,Schedule Impact (Days)
PCCO-001,Added panel feeders,Approved,09/02/2026,09/16/2026,09/15/2026,"$18,500.00",3
PCCO-002,Owner lighting upgrade,Pending - In Review,10/01/2026,10/15/2026,,"$6,200.00",`,
  commitmentCos: `#,Contract Company,Title,Status,Amount
CCO-001,Fictional Conduit Co,Extra sleeves,Approved,"$1,100.00"`,
  rfis: `#,Subject,Question,Status,Date Initiated,Due Date,Official Response,Responded By,Date Answered
RFI-001,Panel location,Can panel LP-2 move 4 feet east?,Closed,08/01/2026,08/08/2026,Yes. Keep 36 in clearance.,Fictional Architect,08/05/2026
RFI-002,Fixture type F3,Confirm F3 lens.,Open,10/20/2026,10/27/2026,,,`,
  submittals: `Spec Section,#,Rev.,Title,Type,Status,Issue Date,Distributed Date,Final Due Date
26 05 19,26-1,0,Building wire,Product Information,Approved,07/10/2026,07/20/2026,07/25/2026
26 24 16,26-2,1,Panelboards,Shop Drawing,Revise and Resubmit,08/01/2026,08/12/2026,08/20/2026`,
  inspections: `#,Name,Type,Status,Inspection Date,Responsible Party,Location,Deficient
1,Rough-in electrical,Electrical,Closed,09/20/2026,Fictional Electric,Level 1,0
2,Above ceiling,Electrical,Open,11/12/2026,Fictional Electric,Level 2,
3,Underground,Electrical,Closed,08/02/2026,Fictional Electric,Site,2`,
  observations: `#,Type,Trade,Title,Assignee,Assignee's Company,Date Notified,Due Date,Status,Priority,Location
1,Safety,Electrical,Open junction box,Pat Doe,Fictional Electric,10/01/2026,10/03/2026,Initiated,High,Level 1
2,Quality,Electrical,Conduit strap spacing,Pat Doe,Fictional Electric,10/02/2026,10/09/2026,Closed,Low,Level 2`,
  commitments: `#,Contract Company,Title,Status,Executed,Original Contract Amount,Approved Change Orders,Revised Contract Amount,Invoiced,Payments Issued
SC-001,Fictional Conduit Co,Underground conduit,Approved,Yes,"$60,000.00","$1,100.00","$61,100.00","$30,000.00","$27,000.00"`,
};

const buildertrend = {
  schedule: `Title,Phase,Start Date,End Date,Work Days,Predecessors,% Complete
Demo,Demolition,09/01/2026,09/03/2026,3,,100%
Rough electrical,Rough-In,09/04/2026,09/10/2026,5,Demo,60%
Rough inspection,Rough-In,09/11/2026,09/11/2026,1,Rough electrical FS+1,0%
Drywall,Finishes,09/14/2026,09/18/2026,5,"Rough inspection, 2SS+2",0%`,
  budget: `Cost Code,Title,Original Budget Costs,Revised Budget Costs,Committed Costs,Actual Costs,Original Client Price,Revised Client Price,Amount Invoiced
01-100,Permits,"1,500.00","1,500.00",0.00,"1,450.00","1,800.00","1,800.00","1,800.00"
26-000,Electrical,"18,000.00","19,000.00","12,000.00","6,000.00","24,000.00","25,000.00","10,000.00"`,
  cos: `ID #,Title,Approval Status,Builder Cost,Client Price,Approved Date
CO-1,Extra recessed cans,Approved,"1,200.00","1,650.00",09/12/2026
CO-2,Under-cabinet lights,Pending,800.00,"1,150.00",`,
};

const header = { system: "procore" as const, job_number: "9001", name: "Fictional Clinic" };

describe("recognizing a file by its columns", () => {
  const kind = (text: string, name?: string) => detectSheetKind(parseTable(text)[0], name);
  it("tells each Procore and Buildertrend export apart", () => {
    expect(kind(procore.invoice)).toBe("sov");
    expect(kind(procore.budget)).toBe("budget");
    expect(kind(procore.cos)).toBe("change_orders");
    expect(kind(procore.rfis)).toBe("rfis");
    expect(kind(procore.submittals)).toBe("submittals");
    expect(kind(procore.inspections, "Inspections.csv")).toBe("inspections");
    expect(kind(procore.observations, "Observations.csv")).toBe("observations");
    expect(kind(procore.commitments)).toBe("commitments");
    expect(kind(buildertrend.schedule)).toBe("schedule");
    expect(kind(buildertrend.budget)).toBe("budget");
    expect(kind(buildertrend.cos)).toBe("change_orders");
  });
  it("says so when it can't tell", () => {
    expect(kind("Foo,Bar\n1,2")).toBeNull();
  });
});

describe("Procore exports", () => {
  const job = fromSpreadsheets(
    [
      { text: procore.budget, name: "Budget.csv" },
      { text: procore.invoice, name: "Owner Invoice 7.csv" },
      { text: procore.cos, name: "Prime Change Orders.csv" },
      { text: procore.commitmentCos, name: "Commitment Change Orders.csv" },
      { text: procore.rfis, name: "RFIs.csv" },
      { text: procore.submittals, name: "Submittals.csv" },
      { text: procore.inspections, name: "Inspections.csv" },
      { text: procore.observations, name: "Observations.csv" },
      { text: procore.commitments, name: "Commitments.csv" },
    ],
    header,
  );

  it("passes the import shape", () => {
    expect(importJob.parse(job)).toBeTruthy();
  });

  it("reads the G703 SOV and puts the budget on its cost codes", () => {
    expect(
      job.sov.map((l) => [
        l.cost_code,
        l.scheduled_cents,
        l.work_to_date_cents,
        l.stored_to_date_cents,
        l.retained_cents,
        l.budget_cents,
      ]),
    ).toEqual([
      ["01-000", 12_000_000, 5_000_000, 0, 500_000, 9_500_000],
      ["26-100", 30_000_000, 12_000_000, 1_200_000, 1_200_000, 24_800_000],
    ]);
    expect(Object.keys(job.archive.budget_lines)).toEqual(["01-000", "26-100", "31-000"]);
    expect(job.held.find((h) => h.kind === "budget lines")?.count).toBe(1);
  });

  it("keeps owner change orders and archives the commitment ones", () => {
    expect(
      job.change_orders.map((c) => [c.number, c.status, c.amount_cents, c.schedule_days]),
    ).toEqual([
      ["PCCO-001", "approved", 1_850_000, 3],
      ["PCCO-002", "pending", 620_000, null],
    ]);
    expect(Object.keys(job.archive.commitment_change_orders)).toEqual(["CCO-001"]);
  });

  it("brings RFI answers and submittal dates", () => {
    expect(job.rfis[0]).toMatchObject({
      number: "RFI-001",
      open: false,
      answer_text: "Yes. Keep 36 in clearance.",
      answered_on: "2026-08-05",
      answered_by: "Fictional Architect",
    });
    expect(job.rfis[1].answer_text).toBeUndefined();
    expect(job.submittals[1]).toMatchObject({
      number: "26-2",
      revision: 1,
      submittal_type: "shop_drawing",
      status: "revise_and_resubmit",
      submitted_on: "2026-08-01",
      returned_on: "2026-08-12",
      required_by: "2026-08-20",
    });
  });

  it("maps inspections and keeps observations and commitments whole", () => {
    expect(
      job.inspections?.map((i) => [i.inspection_type, i.status, i.result, i.completed_on]),
    ).toEqual([
      ["Rough-in electrical", "passed", "pass", "2026-09-20"],
      ["Above ceiling", "scheduled", "pending", null],
      ["Underground", "failed", "fail", "2026-08-02"],
    ]);
    expect(job.inspections?.[2].notes).toMatch(/2 deficient items/);
    expect(job.archive.observations["1"]).toMatchObject({
      Title: "Open junction box",
      Priority: "High",
    });
    const obs = job.held.find((h) => h.kind === "observations");
    expect(obs).toMatchObject({ count: 2, archived: true });
    expect(obs?.why).toMatch(/1 still open/);
    expect(job.archive.commitments["SC-001"]).toMatchObject({
      "Revised Contract Amount": "$61,100.00",
    });
  });

  it("plans into one review", () => {
    const plan = planImport(job, { job_exists: false });
    expect(plan.counts.sov_lines).toBe(2);
    expect(plan.archived.join(" ")).toMatch(/observations/);
  });
});

describe("Buildertrend exports", () => {
  const job = fromSpreadsheets(
    [
      { text: buildertrend.schedule, name: "Schedule.xlsx" },
      { text: buildertrend.budget, name: "Job Costing Budget.xlsx" },
      { text: buildertrend.cos, name: "Change Orders.xlsx" },
    ],
    { ...header, system: "buildertrend" },
  );

  it("passes the import shape", () => {
    expect(importJob.parse(job)).toBeTruthy();
  });

  it("numbers the activities, matches dependencies by name or row, and keeps phases", () => {
    expect(
      job.schedule.map((a) => [
        a.id,
        a.name,
        a.duration_days,
        a.pct_complete,
        a.wbs,
        a.links ?? a.predecessors,
      ]),
    ).toEqual([
      ["A10", "Demo", 3, 100, "phase:1", []],
      ["A20", "Rough electrical", 5, 60, "phase:2", ["A10"]],
      ["A30", "Rough inspection", 1, 0, "phase:2", [{ id: "A20", type: "FS", lag: 1 }]],
      [
        "A40",
        "Drywall",
        5,
        0,
        "phase:3",
        [
          { id: "A30", type: "FS", lag: 0 },
          { id: "A20", type: "SS", lag: 2 },
        ],
      ],
    ]);
    expect(job.schedule_wbs?.map((w) => w.name)).toEqual(["Demolition", "Rough-In", "Finishes"]);
    expect(job.schedule_calendar).toEqual({ work_days: [1, 2, 3, 4, 5], holidays: [] });
    expect(job.problems.join(" ")).toMatch(/Monday to Friday/);
  });

  it("builds the SOV from the budget's client prices when no invoice came", () => {
    expect(
      job.sov.map((l) => [l.cost_code, l.scheduled_cents, l.budget_cents, l.work_to_date_cents]),
    ).toEqual([
      ["01-100", 180_000, 150_000, 180_000],
      ["26-000", 2_500_000, 1_900_000, 1_000_000],
    ]);
    expect(job.problems.join(" ")).toMatch(/client prices/);
  });

  it("keeps the builder cost apart from the client price on change orders", () => {
    expect(
      job.change_orders.map((c) => [c.number, c.status, c.amount_cents, c.cost_cents]),
    ).toEqual([
      ["CO-1", "approved", 165_000, 120_000],
      ["CO-2", "pending", 115_000, 80_000],
    ]);
  });

  it("calculates the CPM with the typed logic", () => {
    const plan = planImport(job, { job_exists: false });
    expect(plan.package.schedule).toBeTruthy();
  });
});
