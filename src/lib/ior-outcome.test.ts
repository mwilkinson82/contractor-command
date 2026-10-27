import { describe, expect, it } from "vitest";
import { cedarOutcome } from "./ior-outcome";
import { renderReportBody } from "./report-pages";
import { iorPlainReply } from "./mcp/living";

const JOB = "289ca2cd-b585-419a-8c09-3501d1be48c3";
const fixture = () => ({
  version: 3,
  data_date: "2026-10-25",
  contract_total: 1400000,
  forecast_total: null,
  scope: "full",
  found: true,
  data: {
    actual_cost_to_date: null,
    actual_gross_billed_to_date: null,
    actual_costs_status: "Needed",
    actual_billings_status: "Needed",
    direct_budget: {
      totals: {
        billing: 1400000,
        direct_budget: 1058601.13,
        overhead: 158790.17,
        profit: 182608.7,
      },
      activities: [{ actual_cost: null }],
    },
    holds: {
      c_hold_total: 0,
      c_holds: [],
      e_holds: [
        {
          id: "a",
          equipment: "Fictional ATS",
          amount: 10000,
          status: "Open",
          owner: "Owner",
          objective: "Eliminate exposure",
          sov_line: "26.10",
        },
        {
          id: "b",
          equipment: "Fictional generator",
          amount: 15000,
          status: "Open",
          owner: "Owner",
          objective: "Eliminate exposure",
          sov_line: "26.10",
        },
      ],
      accounting: "Saved sensitivity note",
      c_hold_status: "None assigned",
    },
  },
});
const page = (report = fixture(), jobId = JOB) =>
  renderReportBody(
    { page: "ior", job_number: "2708", job_name: "Fictional project", report },
    { jobId },
  );

describe("owner-confirmed IOR outcome", () => {
  it("leads with contract, planned GP, indicated GP and then both hold totals and details", () => {
    const html = page();
    expect(html).toContain("$1,400,000.00");
    expect(html).toContain("$182,608.70 · 13.04%");
    expect(html).toContain("$157,608.70 · 11.26%");
    expect(html.indexOf("Current indicated gross profit")).toBeLessThan(
      html.indexOf("E-holds and C-holds"),
    );
    expect(html).toContain("$25,000.00");
    expect(html).toContain("$0.00");
    expect(html.match(/Fictional ATS/g)).toHaveLength(1);
    expect(html.match(/Fictional generator/g)).toHaveLength(1);
    expect(html).toContain("Eliminate exposure");
    expect(html).toContain("26.10");
    expect(html).toContain("Needed");
    expect(html).not.toContain("Hold summary: Not available");
    expect(html).toContain("v3");
    expect(html).toContain("2026-10-25");
  });
  it("prints the same outcome and hold details in the plain host", () => {
    const f = fixture();
    const text = iorPlainReply({
      job_id: JOB,
      version: f.version,
      contract_total: f.contract_total,
      forecast_total: null,
      data: f.data,
      no_financials: false,
    });
    expect(text).toContain("Planned gross profit: $182,608.70 · 13.04% of contract");
    expect(text).toContain("Current indicated gross profit: $157,608.70 · 11.26% of contract");
    expect(text).toContain("Equipment: Fictional ATS");
    expect(text).toContain("Objective: Eliminate exposure");
    expect(text).toContain("C-holds: $0.00");
  });
  it("does not reinterpret another job or a later unconfirmed version", () => {
    expect(cedarOutcome("other-job", fixture())).toBeNull();
    expect(page(fixture(), "other-job")).not.toContain("$157,608.70");
    const f = fixture();
    f.version = 4;
    expect(page(f)).toContain(
      'Current indicated gross profit · margin</div><div style="font-size:20px;font-weight:600;color:#1E3A5F">Not available',
    );
    expect(page(f)).not.toContain("$157,608.70");
  });
  it("leaves the outcome unavailable for missing, contradictory, duplicated or realized inputs", () => {
    const empty = fixture();
    empty.contract_total = 0;
    expect(cedarOutcome(JOB, empty)?.indicated).toBeNull();
    const bad = fixture();
    bad.data.direct_budget.totals.profit = 180000;
    expect(cedarOutcome(JOB, bad)?.planned).toBeNull();
    const duplicate = fixture();
    duplicate.data.holds.e_holds[1].id = "a";
    expect(cedarOutcome(JOB, duplicate)?.indicated).toBeNull();
    const status = fixture();
    status.data.holds.e_holds[1].status = "Closed";
    expect(cedarOutcome(JOB, status)?.indicated).toBeNull();
    const actual = fixture();
    actual.data.actual_cost_to_date = 100 as never;
    expect(cedarOutcome(JOB, actual)?.indicated).toBeNull();
    const cMismatch = fixture();
    cMismatch.data.holds.c_hold_total = 10;
    expect(cedarOutcome(JOB, cMismatch)?.indicated).toBeNull();
    expect(page(cMismatch)).toContain("Hold summary: Not available");
    expect(page(cMismatch)).toContain("Fictional ATS");
  });
  it("does not reveal the outcome in restricted views", () => {
    const f = fixture();
    f.scope = "contract";
    const html = page(f);
    expect(html).not.toContain("$157,608.70");
    expect(html).not.toContain("$1,400,000.00");
    expect(
      iorPlainReply({
        job_id: JOB,
        version: 3,
        contract_total: 1400000,
        data: f.data,
        no_financials: true,
      }),
    ).not.toContain("$157,608.70");
  });
});
