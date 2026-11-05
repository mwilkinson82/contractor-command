import { describe, expect, it } from "vitest";
import { noticeTeamEmail, recordJobNotice, type RecordedNotice } from "./send";

const notice: RecordedNotice = {
  notice_id: "n1",
  created: true,
  topic: "client_decision",
  title: "Rosa Delgado approved CO-003",
  detail: "Adds $2,671.92 and 2 days.",
  actor: "Rosa Delgado",
  job_number: "2810",
  job_name: "Willow Creek",
  company: "Northline Electric",
  recipients: [
    { email: "pm@example.com", role: "job_pm" },
    { email: "owner@example.com", role: "owner" },
  ],
};

describe("job notice emails", () => {
  it("emails each recipient once and keeps each outcome", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const sent: string[] = [];
    const n = await recordJobNotice(
      {
        rpc: async (fn, args) => {
          calls.push([fn, args]);
          return fn === "mcp_job_notice_record" ? notice : null;
        },
        send: async (m) => {
          sent.push(m.to);
          return m.to.startsWith("owner") ? "failed" : "sent";
        },
        boardUrl: async () => "https://app.meetathena.io/r/job/j1/home",
      },
      {
        jobId: "j1",
        topic: "client_decision",
        kind: "co_approved",
        title: notice.title,
        dedupeKey: "d:1",
      },
    );
    expect(n?.notice_id).toBe("n1");
    expect(sent).toEqual(["pm@example.com", "owner@example.com"]);
    expect(
      calls.filter(([f]) => f === "mcp_job_notice_email_result").map(([, a]) => a._status),
    ).toEqual(["sent", "failed"]);
    expect(calls[0]![1]).toMatchObject({ _dedupe_key: "d:1", _facts: {} });
  });

  it("sends nothing for a repeat", async () => {
    const sent: string[] = [];
    await recordJobNotice(
      {
        rpc: async () => ({ ...notice, created: false, recipients: [] }),
        send: async (m) => (sent.push(m.to), "sent"),
      },
      { jobId: "j1", topic: "client_decision", kind: "co_approved", title: "x" },
    );
    expect(sent).toEqual([]);
  });

  it("writes a readable team email with the board button only when there is a link", () => {
    const m = noticeTeamEmail(notice, "pm@example.com", null);
    expect(m.subject).toBe("2810 Willow Creek: Rosa Delgado approved CO-003");
    expect(m.text).toContain("Adds $2,671.92 and 2 days.");
    expect(m.html).not.toContain("Open the job board");
    expect(noticeTeamEmail(notice, "pm@example.com", "https://app.meetathena.io/x").html).toContain(
      "Open the job board",
    );
  });
});
