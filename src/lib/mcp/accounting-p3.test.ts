import { describe, expect, it } from "vitest";
import { alert, daysOverdue, entryNumber, overdueAcross, summary, LOG_VIEW_SPEC, type LogEntry } from "./accounting/logs";
import { ALERT_COLOR } from "./alert-color";

const bic = { name: "R. Chen", company: "Arch Studio" };
const E = (p: Partial<LogEntry> & Pick<LogEntry, "log_type" | "number">): LogEntry => ({ title: p.number, opened: "2027-02-01", due: null, closed: null, status: "open", ball_in_court: bic, ...p });
// Job 2701 on 2027-03-10.
const logs: LogEntry[] = [
  E({ log_type: "rfi", number: "RFI-004", opened: "2027-02-10", closed: "2027-02-17", status: "answered" }), // 7 days
  E({ log_type: "rfi", number: "RFI-003", opened: "2027-02-01", closed: "2027-02-09", status: "answered" }), // 8 days
  E({ log_type: "rfi", number: "RFI-005", opened: "2027-02-25", due: "2027-03-07" }), // 3 overdue
  E({ log_type: "rfi", number: "RFI-006", opened: "2027-03-08", due: "2027-03-18" }),
  E({ log_type: "submittal", number: "262726-001.0", opened: "2027-02-15", due: "2027-03-05" }), // 5 overdue
  E({ log_type: "change_order", number: "PCO-002", opened: "2027-02-01", due: "2027-02-15" }), // 23 overdue
  E({ log_type: "transmittal", number: "T-006", opened: "2027-02-01", due: "2027-02-15" }), // 23 overdue
  E({ log_type: "pay_app", number: "App 03", opened: "2027-02-25", due: "2027-03-04" }), // 6 overdue
  E({ log_type: "notice", number: "N-002", opened: "2027-03-01", due: "2027-03-14", condition_precedent: true }),
];

describe("Phase 3 living logs (D6)", () => {
  it("what's overdue on 2701: exactly 5 items, most overdue first", () => {
    const o = overdueAcross(logs, "2027-03-10");
    expect(o.map((x) => x.number)).toEqual(["PCO-002", "T-006", "App 03", "262726-001.0", "RFI-005"]);
    expect(o[0].reason).toBe("23 days overdue");
  });
  it("RFI summary: average days to answer 7.5, 2 open, 1 overdue", () => {
    const s = summary(logs.filter((e) => e.log_type === "rfi"), "2027-03-10");
    expect(s).toMatchObject({ open: 2, overdue: 1, avg_days_to_answer: 7.5 });
  });
  it("N-002 condition-precedent notice: not alert at 4 days, alert at 3 or less and past", () => {
    const n = logs.find((e) => e.number === "N-002")!;
    expect(alert(n, "2027-03-10").on).toBe(false);
    expect(alert(n, "2027-03-11").on).toBe(true);
    expect(alert(n, "2027-03-12").reason).toBe("2 days left on a condition-precedent notice");
    expect(alert(n, "2027-03-15").reason).toMatch(/1 day past the deadline/);
    expect(alert({ ...n, sent: "2027-03-11" }, "2027-03-12").on).toBe(false);
    expect(alert({ ...n, condition_precedent: false }, "2027-03-12").on).toBe(false);
  });
  it("closed or undated entries are never overdue", () => {
    expect(daysOverdue(logs[0], "2027-03-10")).toBe(0);
    expect(alert(E({ log_type: "rfi", number: "RFI-009" }), "2028-01-01").on).toBe(false);
  });
  it("numbers per log", () => {
    expect(entryNumber("rfi", 5)).toBe("RFI-005");
    expect(entryNumber("submittal", 1, { spec_section: "26 27 26", revision: 0 })).toBe("262726-001.0");
    expect(entryNumber("change_order", 2)).toBe("PCO-002");
    expect(entryNumber("change_order", 2, { approved: true })).toBe("CO-002");
    expect(entryNumber("transmittal", 7)).toBe("T-007");
    expect(entryNumber("pay_app", 3)).toBe("App 03");
    expect(entryNumber("notice", 2)).toBe("N-002");
  });
  it("view spec uses the alert color only for overdue", () => {
    expect(LOG_VIEW_SPEC.join(" ")).toContain(ALERT_COLOR);
  });
});
