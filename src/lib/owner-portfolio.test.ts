import { describe, expect, it } from "vitest";
import {
  buildOwnerPortfolio,
  jobMoneyFromReport,
  shortMoney,
  sortCards,
  type JobMoney,
  type JobMoneyRead,
} from "./owner-portfolio";
import type { AccountingReport } from "./accounting-report";
import type { PortfolioJob, PortfolioPayload } from "./report-pages";

const TODAY = "2026-11-04";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (over: Partial<JobMoney> = {}): JobMoneyRead => ({
  ok: true,
  money: {
    originalCents: 100_000_000,
    changeCents: 5_000_000,
    contractCents: 105_000_000,
    billedCents: 52_500_000,
    receivedCents: 45_000_000,
    retainageCents: 2_625_000,
    unpaidCents: 4_875_000,
    costCents: 40_000_000,
    budgetCents: 88_000_000,
    oldestUnpaidDate: "2026-10-20",
    ...over,
  },
});
const job = (n: number, over: Partial<PortfolioJob> = {}): PortfolioJob => ({
  job_id: id(n),
  job_number: String(3100 + n),
  name: `Synthetic job ${n}`,
  pm: "Morgan",
  completion_date: "2026-12-18",
  cpm: { version: 2, data_date: "2026-10-30", updated_at: "2026-10-30T12:00:00Z", tia: null },
  ior: null,
  ...over,
});
const payload = (jobs: PortfolioJob[]): PortfolioPayload => ({
  page: "portfolio",
  company: "Synthetic Electric",
  jobs,
  money: true,
});

describe("owner portfolio model", () => {
  it("rolls up contract, billing, cash and cost from each job's own records", () => {
    const p = buildOwnerPortfolio(
      payload([job(1), job(2)]),
      { [id(1)]: money(), [id(2)]: money({ contractCents: 95_000_000, billedCents: 47_500_000 }) },
      TODAY,
    );
    expect(p.totals.activeJobs).toBe(2);
    expect(p.totals.contractCents).toBe(200_000_000);
    expect(p.totals.billedCents).toBe(100_000_000);
    expect(p.totals.receivedCents).toBe(90_000_000);
    expect(p.totals.pctComplete).toBeCloseTo(0.5);
    expect(p.totals.plannedMargin).toBeCloseTo((200_000_000 - 176_000_000) / 200_000_000);
  });

  it("keeps jobs with no contract or billing out of the totals as estimating", () => {
    const p = buildOwnerPortfolio(
      payload([job(1), job(2)]),
      {
        [id(1)]: money(),
        [id(2)]: money({ contractCents: null, billedCents: 0, originalCents: null }),
      },
      TODAY,
    );
    expect(p.active.map((c) => c.jobId)).toEqual([id(1)]);
    expect(p.estimating.map((e) => e.jobId)).toEqual([id(2)]);
    expect(p.totals.contractCents).toBe(105_000_000);
  });

  it("never counts an unreadable job as zero and says so on its card", () => {
    const p = buildOwnerPortfolio(
      payload([job(1), job(2)]),
      { [id(1)]: money(), [id(2)]: { ok: false, reason: "no access" } },
      TODAY,
    );
    expect(p.totals.activeJobs).toBe(2);
    expect(p.totals.readJobs).toBe(1);
    expect(p.totals.contractCents).toBe(105_000_000);
    const bad = p.active.find((c) => c.jobId === id(2))!;
    expect(bad.money).toBeNull();
    expect(bad.health).toBe("watch");
    expect(bad.reasons).toContain("Money records couldn't be read");
  });

  it("splits work left between this year and next by finish date", () => {
    const p = buildOwnerPortfolio(
      payload([job(1), job(2, { completion_date: "2027-11-04" })]),
      { [id(1)]: money(), [id(2)]: money() },
      TODAY,
    );
    const [now, later] = [
      p.active.find((c) => c.jobId === id(1))!,
      p.active.find((c) => c.jobId === id(2))!,
    ];
    expect(now.spills).toBe(false);
    expect(now.leftThisYearCents).toBe(52_500_000);
    expect(later.spills).toBe(true);
    expect(later.leftThisYearCents! + later.leftNextYearCents!).toBe(52_500_000);
    expect(later.leftThisYearCents!).toBeLessThan(later.leftNextYearCents!);
    expect(p.totals.finishingThisYear.map((c) => c.jobId)).toEqual([id(1)]);
    expect(p.totals.runningIntoNextYear.map((c) => c.jobId)).toEqual([id(2)]);
  });

  it("uses the saved delay analysis finish and flags a late finish", () => {
    const late = job(1, {
      cpm: {
        version: 3,
        data_date: "2026-10-30",
        tia: { prior_completion: "2026-12-01", updated_completion: "2026-12-22" },
      },
    });
    const card = buildOwnerPortfolio(payload([late]), { [id(1)]: money() }, TODAY).active[0];
    expect(card.finish).toBe("2026-12-22");
    expect(card.finishBasis).toBe("tia");
    expect(card.slipWorkingDays).toBeGreaterThan(10);
    expect(card.health).toBe("risk");
  });

  it("sets health from cost burn, unpaid invoices and stale schedules", () => {
    const reads = {
      [id(1)]: money({ costCents: 70_000_000 }),
      [id(2)]: money({ oldestUnpaidDate: "2026-08-01" }),
      [id(3)]: money({ oldestUnpaidDate: "2026-09-20" }),
      [id(4)]: money(),
    };
    const jobs = [job(1), job(2), job(3), job(4, { cpm: { version: 1, data_date: "2026-09-01" } })];
    const cards = buildOwnerPortfolio(payload(jobs), reads, TODAY).active;
    const by = (n: number) => cards.find((c) => c.jobId === id(n))!;
    expect(by(1).health).toBe("risk");
    expect(by(2).health).toBe("risk");
    expect(by(2).reasons[0]).toMatch(/unpaid 95 days/);
    expect(by(3).health).toBe("watch");
    expect(by(4).health).toBe("watch");
    expect(by(4).reasons).toContain("Schedule not updated in 64 days");
  });

  it("counts jobs with an IOR saved so owners can see which are missing", () => {
    const p = buildOwnerPortfolio(
      payload([job(1, { ior: { version: 1, data: {} } }), job(2)]),
      { [id(1)]: money(), [id(2)]: money() },
      TODAY,
    );
    expect(p.totals.iorSavedJobs).toBe(1);
    expect(p.totals.iorOutcomeJobs).toBe(0);
    expect(p.totals.iorProfitCents).toBeNull();
    expect(p.active.find((c) => c.jobId === id(2))!.iorSaved).toBe(false);
  });

  it("sorts at-risk jobs first by default", () => {
    const reads = { [id(1)]: money(), [id(2)]: money({ costCents: 99_000_000 }) };
    const p = buildOwnerPortfolio(payload([job(1), job(2)]), reads, TODAY);
    expect(sortCards(p.active, "health")[0].jobId).toBe(id(2));
    expect(sortCards(p.active, "number")[0].jobId).toBe(id(1));
  });
});

describe("job money from an accounting report", () => {
  it("takes the recorded contract and billing metrics, and the oldest unpaid invoice", () => {
    const report = {
      recordedContract: { original_cents: 100, recorded_change_cents: 20, approved_cents: 120 },
      metrics: [
        { key: "billed_gross", cents: 90 },
        { key: "credits", cents: 10 },
        { key: "receipts", cents: 50 },
        { key: "retainage", cents: 4 },
        { key: "unpaid_invoices", cents: 26 },
        { key: "actual_costs", cents: null },
        { key: "budget", cents: 100 },
      ],
      rows: [
        { kind: "billed", date: "2026-10-01", balanceCents: 0 },
        { kind: "billed", date: "2026-10-15", balanceCents: 26 },
      ],
    } as unknown as AccountingReport;
    expect(jobMoneyFromReport(report)).toEqual({
      originalCents: 100,
      changeCents: 20,
      contractCents: 120,
      billedCents: 80,
      receivedCents: 50,
      retainageCents: 4,
      unpaidCents: 26,
      costCents: null,
      budgetCents: 100,
      oldestUnpaidDate: "2026-10-15",
    });
  });

  it("leaves the contract unknown when the billing read can't establish it", () => {
    const report = {
      recordedContract: { original_cents: 100, recorded_change_cents: null, approved_cents: null },
      metrics: [],
      rows: [],
    } as unknown as AccountingReport;
    expect(jobMoneyFromReport(report).contractCents).toBeNull();
  });
});

describe("short money", () => {
  it("formats millions, thousands and missing values", () => {
    expect(shortMoney(264_000_000)).toBe("$2.64M");
    expect(shortMoney(41_200_000)).toBe("$412K");
    expect(shortMoney(-3_400_000)).toBe("−$34K");
    expect(shortMoney(null)).toBe("Not available");
  });
});
