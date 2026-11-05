import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportInputError, importJob, toCents, toDay } from "./model";
import { fromOverwatch } from "./overwatch";
import { fromSpreadsheets, parseTable } from "./spreadsheet";
import {
  appliedCard,
  nothingToSave,
  planImport,
  planScheduleReplace,
  reviewCard,
  type ImportContext,
} from "./plan";
import { iorRollup, readIorModel } from "../ior-model";
import { readScheduleControl } from "../mcp/schedule-control";
import type { LivingData } from "../mcp/living";

const sample = () =>
  JSON.parse(readFileSync("src/lib/job-import/fixtures/overwatch-sample.json", "utf8"));

describe("parsing helpers", () => {
  it("reads money and dates exactly", () => {
    expect(toCents("$1,234.56")).toBe(123456);
    expect(toCents("(1,500.00)")).toBe(-150000);
    expect(toCents("")).toBeNull();
    expect(toCents("n/a")).toBeNull();
    expect(toDay("2026-11-04T10:00:00Z")).toBe("2026-11-04");
    expect(toDay("3/7/26")).toBe("2026-03-07");
    expect(toDay("2/30/2026")).toBeNull();
  });

  it("splits quoted CSV with commas and line breaks", () => {
    expect(parseTable('a,b\n"x, y","line1\nline2"\n')).toEqual([
      ["a", "b"],
      ["x, y", "line1\nline2"],
    ]);
    expect(parseTable("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("Overwatch export", () => {
  const job = fromOverwatch(sample());

  it("is a valid import", () => {
    expect(() => importJob.parse(job)).not.toThrow();
    expect(job.job).toMatchObject({
      job_number: "3101",
      name: "Fictional Clinic Renovation",
      customer: "Example Health",
      pm_name: "Pat Example",
    });
    expect(job.contract).toEqual({ original_cents: 25_000_000, retainage_pct: 10 });
  });

  it("builds the SOV from live buckets plus approved change-order allocations", () => {
    expect(job.sov.map((l) => [l.cost_code, l.scheduled_cents])).toEqual([
      ["01-000", 5_000_000],
      ["09-200", 11_850_000],
      ["26-000", 8_600_000],
    ]);
    expect(job.problems).toEqual([]);
  });

  it("takes billing to date from the latest sent pay app only", () => {
    expect(job.billing).toEqual({ last_application: "2", period_to: "2026-10-31" });
    expect(job.sov[1]).toMatchObject({
      work_to_date_cents: 3_000_000,
      stored_to_date_cents: 500_000,
      retained_cents: 350_000,
    });
    expect(job.held.find((h) => h.kind === "Earlier pay applications")?.count).toBe(1);
  });

  it("maps change-order status, and treats entered-in-error as void", () => {
    expect(job.change_orders.map((c) => [c.number, c.status, c.amount_cents])).toEqual([
      ["CO-01", "approved", 600_000],
      ["CO-02", "approved", -150_000],
      ["CO-03", "pending", 875_050],
      ["CO-04", "rejected", 220_000],
      ["CO-05", "void", 99_900],
    ]);
  });

  it("splits RFIs from submittals and maps Overwatch review codes", () => {
    expect(job.rfis).toHaveLength(1);
    expect(job.rfis[0]).toMatchObject({ number: "RFI-001", open: true });
    expect(job.submittals.map((s) => [s.number, s.revision, s.status, s.ball_in_court])).toEqual([
      ["092900-01", 0, "approved", "gc"],
      ["260519-01", 1, "revise_and_resubmit", "sub"],
      ["LOOSE-1", 0, "in_prep", "sub"],
    ]);
  });

  it("keeps recent dailies, with crew as people and voided lines dropped", () => {
    expect(job.dailies.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(job.dailies[0].lines).toEqual([
      { work: "Hang drywall", qty: 2400, unit: "SF", crew: 6, hours: 8, pct_complete: 45 },
    ]);
    expect(job.dailies[1].lines).toEqual([]);
    expect(job.held.find((h) => h.kind === "Older daily reports")?.count).toBe(1);
  });

  it("lists what stays behind", () => {
    expect(job.held.map((h) => h.kind)).toEqual(
      expect.arrayContaining(["cost actuals", "subcontracts", "project documents"]),
    );
  });

  it("refuses anything that isn't an Overwatch export", () => {
    expect(() => fromOverwatch({ format: "something" })).toThrow(ImportInputError);
    expect(() => fromOverwatch(null)).toThrow(ImportInputError);
  });

  it("flags a pay app whose scheduled value disagrees with the bucket", () => {
    const x = sample();
    x.billing_line_items[0].scheduled_value_cents = 4_900_000;
    expect(fromOverwatch(x).problems[0]).toMatch(/General conditions/);
  });

  it("treats a zero bucket budget as no budget, not a $0 budget", () => {
    const x = sample();
    for (const b of x.cost_buckets) b.original_budget = 0;
    const zeroed = fromOverwatch(x);
    expect(zeroed.sov.every((l) => l.budget_cents === null)).toBe(true);
    expect(planImport(zeroed, { job_exists: false }).counts.budget_lines).toBe(0);
  });

  it("names what stays behind without doubling the plural", () => {
    const x = sample();
    x.counts = { exposures: 8, decisions: 1 };
    const held = planImport(fromOverwatch(x), { job_exists: false }).held.join(" ");
    expect(held).toMatch(/8 exposures:/);
    expect(held).toMatch(/1 decision:/);
    expect(held).not.toMatch(/ss:/);
  });

  it("drops the missing-job-number warning once a number is given at import", () => {
    const x = sample();
    x.project.job_number = "";
    expect(fromOverwatch(x).problems.join(" ")).toMatch(/no job number/);
    const named = fromOverwatch(x, { jobNumber: "2712" });
    expect(named.job.job_number).toBe("2712");
    expect(named.problems.join(" ")).not.toMatch(/no job number/);
  });

  it("brings the baseline completion date in as the contract completion, not the forecast", () => {
    const x = sample();
    x.project.baseline_completion_date = "2027-01-19";
    x.project.forecast_completion_date = "2027-03-02";
    const plan = planImport(fromOverwatch(x), { job_exists: false });
    expect(plan.package.contract_facts.substantial_completion).toBe("2027-01-19");
    expect(plan.package.job.contract_completion).toBe("2027-01-19");
  });

  it("carries the contract completion for the CPM header even when the contract terms are kept", () => {
    const x = sample();
    x.project.baseline_completion_date = "2027-01-19";
    const plan = planImport(fromOverwatch(x), {
      job_exists: true,
      contract_keys: ["substantial_completion"],
    } as ImportContext);
    expect(plan.package.contract_facts.substantial_completion).toBeUndefined();
    expect(plan.package.job.contract_completion).toBe("2027-01-19");
    const card = JSON.stringify(reviewCard(plan, "2712", true));
    expect(card).toContain("Contract completion for the CPM: Jan 19, 2027");
    const none = sample();
    delete none.project.baseline_completion_date;
    expect(planImport(fromOverwatch(none), { job_exists: false }).package.job).not.toHaveProperty(
      "contract_completion",
    );
  });
});

describe("Overwatch export, format 2 (whole job)", () => {
  const v2 = () =>
    JSON.parse(readFileSync("src/lib/job-import/fixtures/overwatch-v2-sample.json", "utf8"));
  const job = fromOverwatch(v2());

  it("reads the same job, SOV and change orders as version 1, now with cost and probability", () => {
    expect(() => importJob.parse(job)).not.toThrow();
    expect(job.sov.map((l) => l.scheduled_cents)).toEqual([5_000_000, 11_850_000, 8_600_000]);
    expect(job.change_orders.map((c) => [c.number, c.cost_cents, c.probability])).toEqual([
      ["CO-01", 450_000, 100],
      ["CO-02", -120_000, 100],
      ["CO-03", 610_000, 60],
      ["CO-04", 180_000, 100],
      ["CO-05", 70_000, 100],
    ]);
  });

  it("builds the IOR from the project, cost codes, change orders and open exposures", () => {
    const ior = job.ior!;
    expect(ior).toMatchObject({
      original_contract: 250000,
      original_cost_budget: 210000,
      actual_cost_to_date: 95000,
      cost_growth: 9000,
      phase: "Middle",
      percent_complete: 42,
      baseline_completion: "2027-03-31",
      forecast_completion: "2027-04-15",
    });
    // Denied and entered-in-error change orders stay off, as on Overwatch's IOR.
    expect(
      ior.change_orders.map((c) => [c.number, c.status, c.cost_amount, c.probability]),
    ).toEqual([
      ["CO-01", "Approved", 4500, 100],
      ["CO-02", "Approved", -1200, 100],
      ["CO-03", "Pending", 6100, 60],
    ]);
    // E-Hold -> E, C-Hold -> C, Both -> one of each, None and closed -> off.
    expect(ior.exposures.map((e) => [e.source_id, e.hold, e.dollar_risk, e.probability])).toEqual([
      ["exposure:e1", "E", 12000, 50],
      ["exposure:e2", "C", 8000, 25],
      ["exposure:e3:E", "E", 7500, 40],
      ["exposure:e3:C", "C", 7500, 40],
    ]);
    expect(ior.exposures[0]).toMatchObject({
      category: "owner_decision",
      response: "recover",
      owner: "Pat Example",
      opened: "2026-09-01",
      next_review: "2026-11-15",
      next_move: "Release when: Owner signs finish schedule",
    });
    expect(job.held.find((h) => h.kind === "exposures with no hold")).toMatchObject({
      count: 1,
      archived: true,
    });
  });

  it("matches Overwatch's held amounts, with a Both risk in E and C", () => {
    const plan = planImport(job, { job_exists: false });
    const read = readIorModel({ ior_model: plan.package.ior!.model });
    expect(read.problems).toEqual([]);
    const r = iorRollup(read.model!);
    // e1 6,000 + e3 (4,000 weighted less 1,000 released) 3,000; e2 2,000 + e3 3,000.
    expect([r.eHold, r.cHold]).toEqual([900_000, 500_000]);
  });

  it("archives every row in the file, keyed by its own id", () => {
    expect(Object.keys(job.archive.exposures)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(job.archive.projects["p-1"]).toMatchObject({ phase: "Middle" });
    expect(Object.keys(job.archive.billing_forecast_settings)).toEqual(["p-1"]);
    // Rows with no id get a stable hash, the same on every read.
    const keys = Object.keys(job.archive.billing_line_items);
    expect(keys).toHaveLength(3);
    expect(keys.every((k) => /^row:[0-9a-f]{16}$/.test(k))).toBe(true);
    expect(Object.keys(fromOverwatch(v2()).archive.billing_line_items)).toEqual(keys);
    expect(job.archive).not.toHaveProperty("counts");
    expect(job.archive).not.toHaveProperty("left_out");
  });

  it("holds back only what isn't live in Athena yet, with honest reasons", () => {
    const plan = planImport(job, { job_exists: false });
    const held = plan.held.join(" ");
    expect(held).toMatch(/1 project document: Each file's name and storage path/);
    expect(held).not.toMatch(/cost actual|subcontract|exposure|decision|inspection|schedule|RFI/);
    expect(plan.archived.join(" ")).toMatch(/earlier pay application/);
  });

  it("shows the IOR, the archive by group and the PCO cost on the card", () => {
    const plan = planImport(job, { job_exists: false });
    expect(plan.counts).toMatchObject({ ior: 1, archive_rows: 48, change_orders: 1 });
    expect(plan.package.change_orders[0].cost_cents).toBe(610_000);
    const card = reviewCard(plan, "3101", false);
    const saved = card.sections?.[0].rows.map((r) => r.cells[0]).join(" | ");
    expect(saved).toMatch(
      /IOR, version 1: 4 risks \(E-holds \$9,000\.00, C-holds \$5,000\.00\), 3 change orders with cost/,
    );
    expect(saved).toMatch(
      /Read-only archive of every Overwatch record: 48 records \(Job 1, Commercial /,
    );
    expect(saved).toMatch(/our cost on 1 goes to the IOR only, never on the PCO/);
    const cos = card.sections?.find((s) => s.heading === "Open change orders");
    expect(cos?.columns).toEqual(["CO", "Title", "Amount", "Our cost"]);
    expect(cos?.rows[0].cells).toEqual([
      "CO-03",
      "Relocate nurse station wall",
      "$8,750.50",
      "$6,100.00",
    ]);
  });

  it("keeps Athena's IOR and skips archived rows on a rerun onto an existing job", () => {
    const plan = planImport(job, {
      job_exists: true,
      scope: "full",
      has_ior: true,
      archived: ["exposures:e1", "projects:p-1"],
    });
    expect(plan.package.ior).toBeNull();
    expect(plan.kept.join(" ")).toMatch(/already has an IOR in Athena; kept Athena's/);
    expect(plan.counts.archive_rows).toBe(46);
    expect(plan.package.archive?.exposures).not.toHaveProperty("e1");
  });

  it("leaves the IOR out, and says why, when the file has no phase or no CO cost", () => {
    const x = v2();
    delete x.project.phase;
    const noPhase = fromOverwatch(x);
    expect(noPhase.ior).toBeNull();
    expect(noPhase.held.find((h) => h.kind === "exposures")?.why).toMatch(/phase/);
    const y = v2();
    delete y.change_orders[2].cost_amount;
    expect(fromOverwatch(y).held.find((h) => h.kind === "exposures")?.why).toMatch(
      /change-order cost/,
    );
  });

  it("refuses a format version Athena doesn't read", () => {
    const x = v2();
    x.format_version = 3;
    expect(() => fromOverwatch(x)).toThrow(/versions 1 and 2/);
  });

  it("drops the archive with a plain fix if the package would be too large", () => {
    const x = v2();
    x.cost_actuals = Array.from({ length: 4000 }, (_, i) => ({
      id: `big-${i}`,
      note: "x".repeat(1500),
    }));
    const plan = planImport(fromOverwatch(x), { job_exists: false });
    expect(plan.package.archive).toBeNull();
    expect(plan.counts.archive_rows).toBe(0);
    expect(plan.fixes.join(" ")).toMatch(/archive is too large/);
    expect(plan.package.ior).not.toBeNull();
  });
});

describe("Overwatch export: schedule, RFIs and job logs", () => {
  const v2 = () =>
    JSON.parse(readFileSync("src/lib/job-import/fixtures/overwatch-v2-sample.json", "utf8"));
  const job = fromOverwatch(v2());

  it("organizes the schedule as CPM version 1: logic FS 0, milestones as milestone activities, no dollars", () => {
    const plan = planImport(job, { job_exists: false });
    const sched = plan.package.schedule;
    expect(sched).toMatchObject({ activity_count: 3, milestones: 1, data_date: "2026-11-04" });
    const acts = (sched?.data as { activities: Record<string, unknown>[] }).activities;
    expect(acts.map((a) => [a.id, a.duration, a.pct_complete])).toEqual([
      ["A100", 10, 100],
      ["A200", 22, 60],
      ["MS-01", 0, null],
    ]);
    expect(acts[1].predecessors).toEqual([{ id: "A100", type: "FS", lag: 0 }]);
    expect(acts[2]).toMatchObject({ activity_type: "milestone-finish", start: "2027-04-14" });
    expect(acts.every((a) => a.value === null)).toBe(true);
    const saved = reviewCard(plan, "3101", false)
      .sections?.[0].rows.map((r) => r.cells[0])
      .join(" | ");
    expect(saved).toMatch(/CPM, version 1: 3 activities with 1 milestone, .*not cost loaded/);
  });

  it("keeps Athena's CPM when the job has one", () => {
    const plan = planImport(job, { job_exists: true, scope: "full", has_cpm: true });
    expect(plan.package.schedule).toBeNull();
    expect(plan.counts.schedule_activities).toBe(0);
    expect(plan.kept.join(" ")).toMatch(/already has a CPM in Athena; kept Athena's/);
  });

  it("leaves out a schedule with broken logic and says why, saving the rest", () => {
    const x = v2();
    x.schedule_activities[0].predecessor_activity_ids = ["A200"];
    const plan = planImport(fromOverwatch(x), { job_exists: false });
    expect(plan.package.schedule).toBeNull();
    expect(plan.fixes.join(" ")).toMatch(/schedule can't come in as Athena's CPM yet/);
    expect(plan.counts.sov_lines).toBe(3);
  });

  it("records RFIs as handled outside Athena, answered or still waiting, never re-sent", () => {
    const plan = planImport(job, { job_exists: false });
    expect(
      plan.package.rfis?.map((r) => [
        r.payload.source_number,
        r.payload.sent_on,
        r.payload.answered_on,
      ]),
    ).toEqual([
      ["RFI-001", "2026-10-05", null],
      ["RFI-002", "2026-10-01", "2026-10-06"],
    ]);
    expect(plan.package.rfis?.[1].payload.answer_text).toBe(
      "Use the stud anchor in detail 4/A501.",
    );
    const saved = reviewCard(plan, "3101", false)
      .sections?.[0].rows.map((r) => r.cells[0])
      .join(" | ");
    expect(saved).toMatch(
      /RFI log: 2 RFIs recorded as handled outside Athena \(1 answered, 1 sent and waiting\); none is re-sent/,
    );
  });

  it("maps decisions, claims with events, and inspections with their reinspection link", () => {
    const plan = planImport(job, { job_exists: false });
    expect(plan.package.decisions).toEqual([
      expect.objectContaining({
        source_id: "decision:d1",
        payload: expect.objectContaining({
          status: "open",
          exposure_ref: "Owner finish selections late",
        }),
      }),
    ]);
    expect(plan.package.claims?.[0]).toMatchObject({
      change_order: "change_order:c3",
      payload: {
        number: "CL-001",
        claim_type: "extension_of_time",
        money_claimed_cents: 1_250_000,
      },
    });
    expect(plan.package.claims?.[0].events.map((e) => e.payload.event_type)).toEqual([
      "submitted",
      "received",
    ]);
    expect(
      plan.package.inspections?.map((i) => [
        i.source_id,
        i.parent,
        i.payload.result,
        i.payload.attempt,
      ]),
    ).toEqual([
      ["inspection:i1", null, "pass", 1],
      ["inspection:i2", null, "fail", 1],
      ["inspection:i3", "inspection:i2", "pending", 2],
    ]);
    expect(plan.held.join(" ")).not.toMatch(/decision|claim|inspection/);
  });

  it("skips logs, RFIs and the schedule that came in on an earlier import", () => {
    const plan = planImport(job, {
      job_exists: true,
      scope: "full",
      imported: [
        "rfi:rfi:r1",
        "rfi:rfi:r2",
        "decision:decision:d1",
        "claim:claim:cl1",
        "inspection:inspection:i1",
        "inspection:inspection:i2",
        "inspection:inspection:i3",
        `schedule:${job.job.source_id}`,
      ],
    });
    expect(plan.counts).toMatchObject({
      schedule_activities: 0,
      rfis: 0,
      decisions: 0,
      claims: 0,
      inspections: 0,
    });
  });
});

describe("spreadsheet export", () => {
  const sov = `Item No,Description of Work,Cost Code,Scheduled Value,Work Completed to Date,Retainage
1,General conditions,01-000,"$50,000.00","20,000.00",2000
2,Drywall,09-200,"118,500.00",30000,3500
,Total,,"168,500.00",,`;
  const cos = `CO #,Title,Amount,Status,Date
PCO-7,Extra blocking,"1,250.00",Pending,10/20/2026
CO-1,Outlets,600,Approved,9/20/2026`;
  const subs = `Submittal #,Rev,Spec Section,Title,Status,Date Submitted
05-1,0,05 12 00,Steel shop drawings,Approved as noted,9/1/2026
05-2,0,,Anchor bolts,Open,`;

  it("matches headers loosely and skips total rows", () => {
    const job = fromSpreadsheets(
      [
        { kind: "sov", text: sov },
        { kind: "change_orders", text: cos },
        { kind: "submittals", text: subs },
      ],
      {
        system: "procore",
        job_number: "4001",
        name: "Fictional Warehouse",
        original_contract: 168_500,
      },
    );
    expect(importJob.parse(job)).toBeTruthy();
    expect(job.sov.map((l) => [l.description, l.scheduled_cents, l.work_to_date_cents])).toEqual([
      ["General conditions", 5_000_000, 2_000_000],
      ["Drywall", 11_850_000, 3_000_000],
    ]);
    expect(job.change_orders.map((c) => [c.number, c.status, c.amount_cents, c.date])).toEqual([
      ["PCO-7", "pending", 125_000, "2026-10-20"],
      ["CO-1", "approved", 60_000, "2026-09-20"],
    ]);
    expect(job.submittals[0]).toMatchObject({
      number: "05-1",
      status: "approved_as_noted",
      spec_section: "05 12 00",
    });
  });

  it("says what is wrong instead of guessing", () => {
    const job = fromSpreadsheets([{ kind: "sov", text: "Name,Scheduled Value\nDrywall,lots" }], {
      system: "spreadsheet",
      job_number: "1",
      name: "x",
    });
    expect(job.sov).toEqual([]);
    expect(job.problems[0]).toMatch(/isn't a number/);
    expect(() =>
      fromSpreadsheets([], { system: "spreadsheet", job_number: "1", name: "x" }),
    ).toThrow(ImportInputError);
  });
});

describe("import plan and review", () => {
  const job = fromOverwatch(sample());

  it("plans a new job: contract, SOV, balances, budget, open COs, submittals, dailies", () => {
    const plan = planImport(job, { job_exists: false });
    expect(plan.counts).toEqual({
      job: 1,
      contract_facts: 6,
      sov_lines: 3,
      opening_balances: 3,
      budget_lines: 3,
      change_orders: 1,
      submittals: 2,
      dailies: 1,
      ior: 0,
      archive_rows: 29,
      schedule_activities: 2,
      rfis: 1,
      decisions: 0,
      claims: 0,
      inspections: 0,
    });
    // A version 1 file has no change-order cost, so no IOR; its rows still go to the archive.
    expect(plan.package.version).toBe(3);
    expect(plan.package.ior).toBeNull();
    expect(plan.archived.join(" ")).toMatch(/rejected or void change order/);
    expect(plan.package.contract_facts).toMatchObject({
      contract_value: 250000,
      executed_change_orders: 4500,
      retainage: "10%",
      customer: "Example Health",
    });
    expect(plan.package.sov?.lines["03"]).toEqual({
      description: "Electrical",
      billable_value: 86000,
      cost_codes: ["26-000"],
    });
    expect(plan.package.change_orders[0]).toMatchObject({
      number: "CO-03",
      amount_cents: 875_050,
      schedule_days: 3,
    });
    expect(plan.package.submittals.map((s) => s.payload.number)).toEqual([
      "092900-01",
      "260519-01",
    ]);
    expect(plan.fixes).toEqual([
      "Submittal LOOSE-1 has no spec section; it is left out until one is added.",
    ]);
    expect(plan.package.dailies[0]).toMatchObject({
      date: "2026-11-02",
      subs: "Not recorded in Overwatch",
    });
    expect(plan.package.dailies[0].transcript).toMatch(
      /^Imported from Overwatch\. Work performed: Hung board/,
    );
    expect(plan.held.join(" ")).not.toMatch(/RFI|schedule/);
    expect(plan.package.rfis).toHaveLength(1);
    expect(plan.package.schedule?.activity_count).toBe(2);
    expect(plan.archived.join(" ")).toMatch(/daily with no work quantities/);
  });

  it("keeps what Athena already has and skips what came in before", () => {
    const plan = planImport(job, {
      job_exists: true,
      scope: "full",
      has_official_sov: true,
      contract_keys: ["contract_value"],
      budget_keys: ["01-000"],
      submittals: ["092900-01#0"],
      daily_dates: ["2026-11-02"],
      imported: ["change_order:change_order:c3"],
    });
    expect(plan.counts).toMatchObject({
      job: 0,
      sov_lines: 0,
      opening_balances: 0,
      budget_lines: 2,
      change_orders: 0,
      submittals: 1,
      dailies: 0,
    });
    expect(plan.package.contract_facts).not.toHaveProperty("contract_value");
    expect(plan.kept.join(" ")).toMatch(/already has an SOV/);
    expect(plan.kept).toContain("The contract value is already on the job; kept Athena's.");
  });

  it("adds nothing twice when an older export runs after a newer one", () => {
    const old = fromOverwatch(sample());
    const keyless = Object.keys(old.archive.change_order_allocations ?? {});
    expect(keyless.length).toBeGreaterThan(0);
    expect(keyless.every((k) => k.startsWith("row:"))).toBe(true);
    const plan = planImport(old, {
      job_exists: true,
      scope: "full",
      has_ior: true,
      archived: ["change_order_allocations:some-id-from-a-newer-export"],
    });
    expect(plan.package.archive?.change_order_allocations).toBeUndefined();
    expect(plan.held.join(" ")).not.toMatch(/IOR can't come in/);
  });

  it("lists every kept contract fact on one plain line", () => {
    const plan = planImport(job, {
      job_exists: true,
      contract_keys: ["contract_value", "contract_value_basis", "retainage", "customer"],
    });
    const lines = plan.kept.filter((k) => /contract value/i.test(k));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/Contract contract/);
    expect(lines[0]).toMatch(
      /^The contract value, the contract value basis, .* are already on the job; kept Athena's\.$/,
    );
  });

  it("leaves the SOV out when a credit has no line to sit on", () => {
    const x = sample();
    x.change_order_allocations = x.change_order_allocations.filter(
      (a: { change_order_id: string }) => a.change_order_id !== "c2",
    );
    x.billing_line_items[1].change_order_value_cents = 0;
    const plan = planImport(fromOverwatch(x), { job_exists: false });
    expect(plan.package.sov).toBeNull();
    expect(plan.fixes.join(" ")).toMatch(/negative/);
  });

  it("flags an SOV that does not tie to the contract", () => {
    const x = sample();
    x.project.original_contract = 260000;
    expect(planImport(fromOverwatch(x), { job_exists: false }).fixes.join(" ")).toMatch(
      /doesn't|but the contract/,
    );
  });

  it("shows one card that asks for a yes, and nothing to save on a rerun", () => {
    const plan = planImport(job, { job_exists: false });
    const card = reviewCard(plan, "3101", false);
    expect(card.state).toBe("ask");
    expect(card.ask?.prompt).toMatch(/Save all of this to job 3101\?/);
    expect(card.sections?.map((s) => s.heading)).toEqual([
      "Will be saved",
      "Open change orders",
      "Kept in the archive, not live in Athena",
      "Staying in Overwatch for now",
      "Check before you say yes",
    ]);
    const rerun = planImport(job, {
      job_exists: true,
      scope: "full",
      has_official_sov: true,
      contract_keys: [
        "contract_value",
        "contract_value_basis",
        "executed_change_orders",
        "retainage",
        "customer",
        "substantial_completion",
      ],
      budget_keys: ["01-000", "09-200", "26-000"],
      submittals: ["092900-01#0", "260519-01#1"],
      daily_dates: ["2026-11-02"],
      imported: ["change_order:change_order:c3", "rfi:rfi:r1"],
      has_cpm: true,
      archived: Object.entries(job.archive).flatMap(([t, rows]) =>
        Object.keys(rows).map((id) => `${t}:${id}`),
      ),
    });
    expect(nothingToSave(rerun)).toBe(true);
    expect(reviewCard(rerun, "3101", true).ask).toBeNull();
  });

  it("reports what was saved", () => {
    const card = appliedCard(
      {
        job_created: true,
        sov_lines: 3,
        change_orders: 1,
        ior: 1,
        ior_risks: 4,
        archive_rows: 42,
        skipped: ["A daily for 2026-11-02 is already on the job; kept it."],
      },
      "3101",
      "overwatch",
    );
    expect(card.title).toBe("Job 3101 imported from Overwatch");
    expect(card.sections?.[0].rows.map((r) => r.cells[0])).toEqual([
      "Created job 3101",
      "SOV: 3 lines",
      "1 PCO draft, not sent",
      "IOR version 1 with 4 risks",
      "Archive: 42 records, read-only",
    ]);
    expect(card.next_move).toMatch(
      /^Open change orders are drafts\..*open job 3101's board so you can check the IOR\?$/,
    );
  });

  it("says the kept contract facts once, in words, and offers the next step", () => {
    const card = appliedCard(
      {
        schedule_activities: 20,
        decisions: 4,
        skipped: [
          "Contract contract value is already on the job; kept it.",
          "Contract retainage is already on the job; kept it.",
          "The job already has an SOV; the imported SOV and opening balances were not written.",
        ],
      },
      "2717",
      "overwatch",
    );
    const kept = card.sections?.[1].rows.map((r) => r.cells[0]);
    expect(kept).toEqual([
      "The contract value and retainage were already on the job; kept them as they were.",
      "The job already has an SOV; the imported SOV and opening balances were not written.",
    ]);
    expect(card.next_move).toBe(
      "Next: want me to open job 2717's board so you can check the CPM and the job logs?",
    );
    expect(appliedCard({ already_applied: true }, "2717", "overwatch").next_move).toMatch(
      /Nothing more to save/,
    );
  });
});

describe("Overwatch schedule on its own calendar", () => {
  // Mon–Sat work week, a WBS tree, activities that name their section by
  // division, Overwatch baseline dates, and progress with no remaining days.
  const x = () => {
    const v = JSON.parse(
      readFileSync("src/lib/job-import/fixtures/overwatch-v2-sample.json", "utf8"),
    );
    v.project.schedule_workdays = [1, 2, 3, 4, 5, 6];
    v.project.schedule_holidays = [];
    v.schedule_milestones = [];
    v.schedule_wbs_sections = [
      { id: "w-06", name: "06 - Wood", sort_order: 10, parent_id: null },
      { id: "w-fr", name: "Framing", sort_order: 10, parent_id: "w-06" },
      { id: "w-99", name: "99 - Closeout", sort_order: 20, parent_id: null },
    ];
    const row = (id: string, name: string, division: string, s: string, f: string, extra = {}) => ({
      id: `r-${id}`,
      activity_id: id,
      name,
      division,
      start_date: s,
      finish_date: f,
      baseline_start_date: s,
      baseline_finish_date: f,
      forecast_start_date: s,
      forecast_finish_date: f,
      planned_duration_days: Math.round((Date.parse(f) - Date.parse(s)) / 864e5) + 1,
      percent_complete: 0,
      predecessor_activity_ids: [],
      ...extra,
    });
    v.schedule_activities = [
      row("A100", "Framing", "06 - Wood / Framing", "2026-03-02", "2026-03-14", {
        percent_complete: 100,
        actual_start_date: "2026-03-02",
        actual_finish_date: "2026-03-14",
        sort_order: 1,
      }),
      row("A200", "Sheathing", "06 - Wood / Framing", "2026-03-16", "2026-03-28", {
        percent_complete: 50,
        actual_start_date: "2026-03-16",
        forecast_finish_date: "2026-04-01",
        predecessor_activity_ids: ["A100"],
        sort_order: 2,
      }),
      row("A300", "Punch", "99 - Closeout", "2026-03-30", "2026-04-04", {
        predecessor_activity_ids: ["A200"],
        sort_order: 3,
      }),
      row("A400", "Touch-up", "99 - Closeout", "2026-03-30", "2026-03-31", {
        predecessor_activity_ids: ["A100"],
        sort_order: 4,
      }),
    ];
    return v;
  };

  it("reads the calendar, counts working days, and keeps the WBS tree and division sections", () => {
    const job = fromOverwatch(x());
    expect(job.schedule_calendar).toEqual({ work_days: [1, 2, 3, 4, 5, 6], holidays: [] });
    // Mar 2–14 is 13 calendar days and 12 Mon–Sat working days.
    expect(job.schedule.map((a) => a.duration_days)).toEqual([12, 12, 6, 2]);
    expect(job.schedule_wbs?.find((w) => w.name === "Framing")?.parent).toBe("wbs:w-06");
    expect(job.schedule.map((a) => a.wbs)).toEqual([
      "wbs:w-fr",
      "wbs:w-fr",
      "wbs:w-99",
      "wbs:w-99",
    ]);
  });

  it("uses Overwatch's own status date from its latest schedule update, never the import day", () => {
    const v = x();
    v.exported_at = "2026-11-05T04:11:47.869Z";
    v.schedule_updates = [
      { id: "u1", data_date: "2026-03-10" },
      { id: "u2", data_date: "2026-03-21" },
    ];
    const plan = planImport(fromOverwatch(v), { job_exists: false });
    expect(plan.package.schedule!.data_date).toBe("2026-03-21");
    expect(
      readScheduleControl(plan.package.schedule!.data as LivingData)!.calculation,
    ).toMatchObject({ status: "calculated", data_date: "2026-03-21" });
    expect(plan.fixes.join(" ")).not.toMatch(/keeps no status date/);
    delete v.schedule_updates;
    expect(planImport(fromOverwatch(v), { job_exists: false }).package.schedule!.data_date).toBe(
      "2026-03-17",
    );
  });

  it("replaces an imported CPM with the same calculation, and only that schedule", () => {
    const job = fromOverwatch(x());
    const sid = job.job.source_id;
    const ctx = {
      job_exists: true,
      scope: "full",
      has_cpm: true,
      imported: [`schedule:${sid}`, `job:${sid}`],
    } as ImportContext;
    const first = planImport(job, { job_exists: false });
    const plan = planScheduleReplace(job, ctx);
    const sched = plan.package.schedule!;
    expect(sched.replace).toBe(true);
    expect(sched.data_date).toBe(first.package.schedule!.data_date);
    expect(sched.data).toEqual(first.package.schedule!.data);
    const control = readScheduleControl(sched.data as LivingData)!;
    expect(control.baselines[0]).toMatchObject({ id: "BL1" });
    expect(control.calculation.status).toBe("calculated");
    expect(plan.counts).toMatchObject({
      schedule_activities: 4,
      sov_lines: 0,
      change_orders: 0,
      job: 0,
    });
    expect(plan.package.change_orders).toEqual([]);
    const card = reviewCard(plan, "2717", true);
    expect(card.title).toBe("Replace job 2717's CPM from Overwatch");
    expect(card.ask?.prompt).toMatch(/Earlier versions stay in its history/);
    expect(JSON.stringify(card)).toContain("replacing the imported one");
    // A normal import onto the same job still keeps Athena's CPM.
    expect(planImport(job, ctx).package.schedule ?? null).toBeNull();
    // No CPM on the job: nothing to replace.
    const none = planScheduleReplace(job, { job_exists: true, has_cpm: false } as ImportContext);
    expect(nothingToSave(none)).toBe(true);
    expect(reviewCard(none, "2717", true).next_move).toBe("The CPM stays as it is.");
  });

  it("saves a calculated CPM with Overwatch's baseline, the data date after the last progress, and the longest path", () => {
    const plan = planImport(fromOverwatch(x()), { job_exists: false });
    const sched = plan.package.schedule!;
    expect(sched.data_date).toBe("2026-03-17");
    const data = sched.data as LivingData;
    const control = readScheduleControl(data)!;
    expect(control.calculation.status).toBe("calculated");
    expect(control.settings).toMatchObject({
      project_start: "2026-03-02",
      critical_definition: "longest-path",
    });
    expect(control.settings!.calendars[0].work_days).toBe(0b1111110);
    expect(control.wbs.find((w) => w.name === "Framing")?.parent_id).toBe("wbs:w-06");
    expect(control.baselines[0]).toMatchObject({ id: "BL1", name: "Overwatch baseline" });
    expect(control.baselines[0].activities.map((a) => a.finish)).toEqual([
      "2026-03-14",
      "2026-03-28",
      "2026-04-04",
      "2026-03-31",
    ]);
    const acts = new Map(data.activities!.map((a) => [a.id, a]));
    // In progress with no remaining days keeps Overwatch's forecast finish.
    expect(acts.get("A200")).toMatchObject({
      remaining_duration: 14,
      finish: "2026-04-01",
      critical: true,
    });
    expect(acts.get("A100")!.critical).toBe(false);
    expect(acts.get("A400")!.critical).toBe(false);
    expect(control.calculation.longest_path).toEqual(["A200", "A300"]);
    expect(control.calculation.activity_results!.A400.free_float).toBeGreaterThan(0);
    expect(plan.fixes.join(" ")).toMatch(/data date is Mar 17, 2026/);
    expect(plan.fixes.join(" ")).toMatch(/baseline dates are kept as the job's baseline/);
  });

  it("keeps percent complete with no actual start scheduled, and says so", () => {
    const v = x();
    v.schedule_activities[1].actual_start_date = null;
    const plan = planImport(fromOverwatch(v), { job_exists: false });
    const data = plan.package.schedule!.data as LivingData;
    expect(readScheduleControl(data)!.calculation.status).toBe("calculated");
    expect(data.activities!.find((a) => a.id === "A200")).toMatchObject({ pct_complete: 0 });
    expect(plan.fixes.join(" ")).toMatch(
      /A200 shows percent complete in Overwatch with no actual start/,
    );
  });
});
