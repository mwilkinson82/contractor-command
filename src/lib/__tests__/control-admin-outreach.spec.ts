import { describe, expect, it } from "vitest";
import {
  baselineOutreachLabel,
  baselineOutreachNeedsAttention,
  baselineOutreachState,
  buildControlNudge,
  buildControlRoomCsv,
  controlActivationState,
  controlRoomExportFilename,
  memberCountLabel,
} from "@/lib/control-admin-outreach";
import type { MemberControlRow } from "@/lib/control-admin.functions";

const baseRow: MemberControlRow = {
  userId: "member-1",
  email: "marshall@example.com",
  fullName: "Marshall Wilkinson",
  tier: "circle",
  orientationOpenedAt: null,
  assessmentStartedAt: null,
  baselineSavedAt: null,
  latestBaselineId: null,
  baselineState: "missing",
  score: null,
  primaryCategory: null,
  primaryConstraint: null,
  planStartedAt: null,
  planUpdatedAt: null,
  planCompletedAt: null,
  planPercent: 0,
  planState: "not_started",
  planActionsCompleted: 0,
  planActionsTotal: 0,
  reviewDate: null,
  reassessmentDue: false,
  weeklyReviewedAt: null,
  weeklyCurrent: false,
  constraintTrend: null,
  weeklyBlocked: false,
  weeklyBlocker: null,
  weeklyNextAction: null,
  weeklyNextOwner: null,
  weeklyNeedsPressure: false,
  weeklyPressureNote: null,
  baselineOutreachStatus: null,
  baselineOutreachAt: null,
};

describe("Control Room outreach", () => {
  it("uses correct singular and plural member labels", () => {
    expect(memberCountLabel(0)).toBe("0 members");
    expect(memberCountLabel(1)).toBe("1 member");
    expect(memberCountLabel(2)).toBe("2 members");
  });

  it("distinguishes missing and legacy baselines", () => {
    expect(controlActivationState(baseRow)).toBe("Needs baseline");
    expect(controlActivationState({ ...baseRow, baselineState: "needs_refresh" })).toBe(
      "Refresh baseline",
    );
    expect(buildControlNudge({ ...baseRow, baselineState: "needs_refresh" })).toContain(
      "predates the live 90-day plan",
    );
  });

  it("distinguishes baseline campaign delivery and subsequent activation", () => {
    expect(baselineOutreachState(baseRow)).toBe("not_contacted");
    expect(baselineOutreachLabel({ ...baseRow, baselineOutreachStatus: "pending" })).toBe("Queued");
    expect(baselineOutreachLabel({ ...baseRow, baselineOutreachStatus: "sent" })).toBe("Sent");
    expect(
      baselineOutreachState({
        ...baseRow,
        baselineState: "current",
        baselineSavedAt: "2026-07-16T12:00:00.000Z",
        baselineOutreachStatus: "sent",
        baselineOutreachAt: "2026-07-15T12:00:00.000Z",
      }),
    ).toBe("activated");
    expect(baselineOutreachNeedsAttention({ ...baseRow, baselineOutreachStatus: "bounced" })).toBe(
      true,
    );
  });

  it("exports a segmented, CSV-safe outreach record", () => {
    const csv = buildControlRoomCsv([
      {
        ...baseRow,
        fullName: 'Marshall "MW" Wilkinson',
        primaryConstraint: "Cash, capacity",
      },
    ]);

    expect(csv).toContain("Activation state");
    expect(csv).toContain('"Marshall ""MW"" Wilkinson"');
    expect(csv).toContain('"Cash, capacity"');
    expect(csv).toContain("Suggested nudge");
    expect(csv).toContain("Baseline outreach");
    expect(csv).toContain("Not contacted");
  });

  it("neutralizes spreadsheet formulas in member-controlled fields", () => {
    const csv = buildControlRoomCsv([{ ...baseRow, fullName: '=HYPERLINK("bad")' }]);

    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  });

  it("builds a local-date filename for the active segment", () => {
    expect(controlRoomExportFilename("Needs baseline", new Date(2026, 6, 15))).toBe(
      "control-room-needs-baseline-2026-07-15.csv",
    );
  });
});
