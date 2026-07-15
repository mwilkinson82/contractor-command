import { describe, expect, it } from "vitest";
import {
  isBaselineOutreachAttentionStatus,
  latestBaselineOutreachByEmail,
} from "@/lib/control-admin-campaigns";

describe("baseline campaign send reconciliation", () => {
  it("joins metadata-bearing pending logs to later queue delivery by message id", () => {
    const result = latestBaselineOutreachByEmail(
      [
        {
          message_id: "message-1",
          recipient_email: "member@example.com",
          status: "sent",
          created_at: "2026-07-15T12:01:00.000Z",
          metadata: null,
        },
        {
          message_id: "message-1",
          recipient_email: "MEMBER@example.com",
          status: "pending",
          created_at: "2026-07-15T12:00:00.000Z",
          metadata: { announcement_id: "baseline-campaign" },
        },
      ],
      new Set(["baseline-campaign"]),
    );

    expect(result.get("member@example.com")).toEqual({
      status: "sent",
      createdAt: "2026-07-15T12:01:00.000Z",
    });
  });

  it("ignores logs from other announcement campaigns and unsupported statuses", () => {
    const result = latestBaselineOutreachByEmail(
      [
        {
          message_id: "message-other",
          recipient_email: "other@example.com",
          status: "sent",
          created_at: "2026-07-15T12:01:00.000Z",
          metadata: { announcement_id: "other-campaign" },
        },
        {
          message_id: "message-bad",
          recipient_email: "bad@example.com",
          status: "unknown",
          created_at: "2026-07-15T12:01:00.000Z",
          metadata: { announcement_id: "baseline-campaign" },
        },
      ],
      new Set(["baseline-campaign"]),
    );

    expect(result.size).toBe(0);
  });

  it("identifies statuses that require a different outreach path", () => {
    expect(isBaselineOutreachAttentionStatus("suppressed")).toBe(true);
    expect(isBaselineOutreachAttentionStatus("failed")).toBe(true);
    expect(isBaselineOutreachAttentionStatus("sent")).toBe(false);
    expect(isBaselineOutreachAttentionStatus(null)).toBe(false);
  });
});
