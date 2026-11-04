import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportInputError, importJob, toCents, toDay } from "./model";
import { fromOverwatch } from "./overwatch";
import { fromSpreadsheets, parseTable } from "./spreadsheet";
import { appliedCard, nothingToSave, planImport, reviewCard } from "./plan";

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

  it("brings the baseline completion date in as the contract completion, not the forecast", () => {
    const x = sample();
    x.project.baseline_completion_date = "2027-01-19";
    x.project.forecast_completion_date = "2027-03-02";
    const plan = planImport(fromOverwatch(x), { job_exists: false });
    expect(plan.package.contract_facts.substantial_completion).toBe("2027-01-19");
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
    });
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
    expect(plan.held.join(" ")).toMatch(/1 RFI \(1 open\)/);
    expect(plan.held.join(" ")).toMatch(/2 schedule activities/);
    expect(plan.held.join(" ")).toMatch(/daily with no work quantities/);
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
      imported: ["change_order:change_order:c3"],
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
    ]);
  });
});
