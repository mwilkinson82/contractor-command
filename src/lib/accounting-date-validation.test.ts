import { describe, expect, it, vi } from "vitest";
import { AccountingDateRangeError, validateAccountingDates } from "./accounting-report";
import { readAccountingReport } from "./accounting-report-read";

describe("accounting report date input", () => {
  it.each([
    [{ from: "2026-10-20", asOf: "2026-10-10" }, /start date must be on or before/],
    [{ asOf: "2026-10-31" }, /cannot be after today/],
    [{ from: "2026-02-30", asOf: "2026-10-30" }, /valid start date/],
    [{ asOf: "not a date" }, /valid as-of date/],
  ] as const)("returns a specific expected error for %j", (dates, message) => {
    expect(() => validateAccountingDates(dates, "2026-10-30")).toThrow(AccountingDateRangeError);
    expect(() => validateAccountingDates(dates, "2026-10-30")).toThrow(message);
  });
  it("accepts equal boundaries and inception through today", () => {
    expect(() =>
      validateAccountingDates({ from: "2026-10-30", asOf: "2026-10-30" }, "2026-10-30"),
    ).not.toThrow();
    expect(() => validateAccountingDates({ asOf: "2026-10-30" }, "2026-10-30")).not.toThrow();
  });
  it("rejects reversed dates before reading any source or budget", async () => {
    const rpc = vi.fn(),
      budgetPage = vi.fn();
    await expect(
      readAccountingReport(
        { rpc, budgetPage },
        "job",
        { from: "2026-10-20", asOf: "2026-10-10" },
        "company",
        new Date("2026-10-30T00:00:00Z"),
      ),
    ).rejects.toThrow(/start date must be on or before/);
    expect(rpc).not.toHaveBeenCalled();
    expect(budgetPage).not.toHaveBeenCalled();
  });
});
