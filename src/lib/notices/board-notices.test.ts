import { describe, expect, it } from "vitest";
import {
  NO_LOCAL_READS,
  badgeText,
  bellLabel,
  groupNoticesByJob,
  jobLabel,
  markJobNoticesRead,
  noticeBoardHref,
  parseMyNotices,
  parseNoticeList,
  readJobNotices,
  relativeTime,
  withLocalReads,
  type MyNotice,
} from "./board-notices";
import { boardCoRows, coCounts, decisionName } from "./board-change-orders";
import { lastAbout, parseThreads, replyJobMessage, replyProblem, threadWaiting } from "./job-messages";
import { prefGrid, saveNoticePref } from "./notice-prefs";
import type { ChangeLogPayload, ChangeRow } from "../mcp/change-orders";

const job = "22222222-2222-4222-8222-222222222222";
const notice = (id: string, at: string, read = false, topic = "client_decision") => ({
  id,
  topic,
  kind: "co_approved",
  title: `Rosa Delgado approved ${id}`,
  detail: null,
  actor: "Rosa Delgado",
  facts: {},
  board_page: "cos",
  created_at: at,
  read,
});

describe("reading a job's notices", () => {
  it("keeps the unread count from the database and drops rows it cannot read", () => {
    const list = parseNoticeList({
      notices: [notice("CO-003", "2026-11-05T10:00:00Z"), { id: 4 }, notice("x", "2026-11-05T09:00:00Z", false, "billing")],
      unread: 7,
    });
    expect(list?.notices.map((n) => n.id)).toEqual(["CO-003"]);
    expect(list?.unread).toBe(7);
  });
  it("treats a reply without notices as unavailable, never as zero", async () => {
    expect(parseNoticeList(null)).toBeNull();
    expect(parseNoticeList({ unread: 0 })).toBeNull();
    const rpc = async () => ({ data: null, error: { message: "MCP_BAD:You don't have access to this job." } });
    await expect(readJobNotices(rpc, job)).rejects.toThrow("You don't have access to this job.");
  });
  it("asks the database for 30 so the panel, bell and nav share one read", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await readJobNotices(async (fn, args) => {
      calls.push([fn, args]);
      return { data: { notices: [], unread: 0 }, error: null };
    }, job);
    expect(calls).toEqual([["mcp_job_notices_list", { _job: job, _limit: 30 }]]);
  });
  it("marks named notices read, or every one on the job with null", async () => {
    const calls: Record<string, unknown>[] = [];
    const rpc = async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { data: 2, error: null };
    };
    expect(await markJobNoticesRead(rpc, job, ["a", "b"])).toBe(2);
    await markJobNoticesRead(rpc, job, null);
    expect(await markJobNoticesRead(rpc, job, [])).toBe(0);
    expect(calls).toEqual([{ _job: job, _ids: ["a", "b"] }, { _job: job, _ids: null }]);
  });
  it("updates the count right away when the member opens one or marks all read", () => {
    const list = parseNoticeList({
      notices: [notice("a", "2026-11-05T10:00:00Z"), notice("b", "2026-11-05T09:00:00Z"), notice("c", "2026-11-04T09:00:00Z", true)],
      unread: 2,
    })!;
    expect(withLocalReads(list, NO_LOCAL_READS).unread).toBe(2);
    const one = withLocalReads(list, { ids: new Set(["a"]), allAt: null });
    expect(one.unread).toBe(1);
    expect(one.notices[0].read).toBe(true);
    expect(withLocalReads(list, { ids: new Set(), allAt: "2026-11-05T11:00:00Z" }).unread).toBe(0);
    // A notice that arrives after mark all read still counts.
    const later = parseNoticeList({ notices: [notice("d", "2026-11-05T12:00:00Z"), ...list.notices], unread: 3 })!;
    expect(withLocalReads(later, { ids: new Set(), allAt: "2026-11-05T11:00:00Z" }).unread).toBe(1);
  });
});

describe("board links", () => {
  it("sends each topic to its board page and drops pages that do not exist", () => {
    expect(noticeBoardHref(job, "cos")?.href).toBe(`/r/job/${job}/cos`);
    expect(noticeBoardHref(job, "submittals", "tok")?.href).toBe(`/r/job/${job}/submittals?t=tok`);
    expect(noticeBoardHref(job, "billing", "tok")?.href).toBe(`/r/job/${job}/payment-applications`);
    expect(noticeBoardHref(job, "lookahead")?.label).toBe("Open look-ahead");
    expect(noticeBoardHref(job, "field-board")?.href).toBe(`/r/job/${job}/field`);
    expect(noticeBoardHref(job, "messages")?.href).toBe(`/r/job/${job}/home#job-messages`);
    expect(noticeBoardHref(job, "nowhere")).toBeNull();
    expect(noticeBoardHref(job, null)).toBeNull();
  });
});

describe("times and counts", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  it("reads like a person would say it", () => {
    expect(relativeTime("2026-11-05T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-11-05T11:55:00Z", now)).toBe("5 min ago");
    expect(relativeTime("2026-11-05T09:00:00Z", now)).toBe("3 hr ago");
    expect(relativeTime("2026-11-04T09:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-11-01T09:00:00Z", now)).toBe("4 days ago");
    expect(relativeTime("2026-10-01T09:00:00Z", now)).toBe("Oct 1");
    expect(relativeTime("not a date", now)).toBe("");
  });
  it("caps the badge at 99+ and labels the bell", () => {
    expect(badgeText(3)).toBe("3");
    expect(badgeText(140)).toBe("99+");
    expect(bellLabel(3)).toBe("Notifications, 3 new");
    expect(bellLabel(0)).toBe("Notifications");
    expect(bellLabel(null)).toBe("Notifications");
  });
});

describe("notices across jobs", () => {
  const mine = parseMyNotices({
    notices: [
      { ...notice("a", "2026-11-05T10:00:00Z"), job_id: "j1", job_number: "2810", job_name: "Willow Creek" },
      { ...notice("b", "2026-11-05T11:00:00Z", true), job_id: "j2", job_number: "1234", job_name: "1234 Riverside" },
      { ...notice("c", "2026-11-05T09:00:00Z"), job_id: "j1", job_number: "2810", job_name: "Willow Creek" },
    ],
  }) as MyNotice[];
  it("groups by job, newest job first, with an unread count each", () => {
    const groups = groupNoticesByJob(mine);
    expect(groups.map((g) => [g.job_number, g.unread, g.notices.length])).toEqual([
      ["1234", 0, 1],
      ["2810", 2, 2],
    ]);
    expect(jobLabel(groups[0])).toBe("1234 Riverside");
    expect(jobLabel(groups[1])).toBe("2810 Willow Creek");
  });
});

const co = (number: string, state: ChangeRow["change_order_details"]["state"], extra: Partial<ChangeRow["change_order_details"]> = {}, history: ChangeRow["history"] = []): ChangeRow => ({
  id: `id-${number}`,
  number,
  title: `Change ${number}`,
  revision: 0,
  transmittal_number: 1,
  history,
  change_order_details: {
    state,
    record_version: 1,
    origin: "contractor",
    condition: "",
    scope: "",
    references: [],
    lines: [{ category: "markup", description: "fee", source: "x", amount_cents: 999 }],
    total_cents: 267192,
    schedule_days: 2,
    ...extra,
  },
});

describe("board change order rows", () => {
  const payload: ChangeLogPayload = {
    job_id: job,
    job_number: "2810",
    job_name: "Willow Creek",
    today: "2026-11-05",
    read_only: false,
    time_zone: "America/New_York",
    records: [
      co("PCO-001", "submitted", { schedule_days: null, total_cents: null }),
      co("PCO-002", "approved", {
        co_number: "CO-003",
        decision: { by: "Rosa Delgado <rosa@example.com>", at: "2026-11-05T19:14:00Z", reference: "r", channel: "customer_page" } as never,
      }, [{ record_version: 2, action: "approve", created_at: "2026-11-05T19:14:00Z", snapshot: {} as never }]),
      co("PCO-003", "rejected", { decision: { by: "Sam Ortiz", at: "2026-11-04T15:00:00Z", reference: "r" } }),
    ],
  };
  it("shows the client's decision with who and when, fresh decisions first, and never cost lines", () => {
    const rows = boardCoRows(payload);
    expect(rows[0]).toMatchObject({ number: "CO-003", status: "Approved", amount: "$2,671.92", days: "+2 days" });
    expect(rows[0].decision).toBe("Approved by Rosa Delgado on the client page · Nov 5, 2:14 PM");
    expect(rows[1].decision).toMatch(/^Declined by Sam Ortiz · Nov 4/);
    expect(rows[2]).toMatchObject({ status: "Waiting on client", amount: null, days: "Not set", decision: null });
    expect(JSON.stringify(rows)).not.toMatch(/markup|fee|rosa@example\.com/);
    expect(coCounts(rows)).toEqual({ total: 3, waiting: 1, approved: 1, declined: 1 });
    expect(decisionName("  ")).toBeNull();
  });
});

describe("client messages data layer", () => {
  const threads = parseThreads({
    threads: [
      { customer_name: "Rosa Delgado", access_id: "acc-1", messages: [
        { id: "m2", author_kind: "team", author_name: "Jay", body: "We will check.", about_label: null, created_at: "2026-11-05T10:00:00Z" },
        { id: "m1", author_kind: "client", author_name: "Rosa", body: "Is the tile in?", about_label: "CO-003", created_at: "2026-11-05T09:00:00Z" },
      ] },
      { customer_name: "", access_id: "acc-2", messages: [
        { id: "m3", author_kind: "client", author_name: null, body: "When do you start?", about_label: null, created_at: "2026-11-05T11:00:00Z" },
      ] },
    ],
  })!;
  it("puts the newest thread first and reads each oldest first", () => {
    expect(threads.map((t) => t.access_id)).toEqual(["acc-2", "acc-1"]);
    expect(threads[1].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(threads[0].customer_name).toBe("Client");
    expect(threadWaiting(threads[0])).toBe(true);
    expect(threadWaiting(threads[1])).toBe(false);
    expect(lastAbout(threads[1])).toBe("CO-003");
    expect(parseThreads({})).toBeNull();
  });
  it("sends a reply with the agreed arguments and refuses an empty one", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      return { data: { id: "new" }, error: null };
    };
    expect(await replyJobMessage(rpc, { jobId: job, accessId: "acc-1", body: "  Yes, Friday. " })).toEqual({ id: "new" });
    expect(calls).toEqual([["mcp_job_message_reply", { _job: job, _access: "acc-1", _body: "Yes, Friday.", _about_item: null }]]);
    expect(replyProblem("   ")).toBe("Write your reply first.");
    await expect(replyJobMessage(rpc, { jobId: job, accessId: "acc-1", body: "" })).rejects.toThrow("Write your reply first.");
  });
});

describe("notice email choices", () => {
  const prefs = {
    can_change: true,
    prefs: [
      { role: "job_pm", topic: "client_decision", email: false },
      { role: "owner", topic: "client_message", email: true },
      { role: "super", topic: "submittal_reply", email: true },
    ],
  };
  it("locks the job's PM on and keeps money topics away from supers", () => {
    const grid = prefGrid(prefs)!;
    const pm = grid.rows.find((r) => r.role === "job_pm")!;
    expect(pm.cells.every((c) => c.email && c.locked)).toBe(true);
    const sup = grid.rows.find((r) => r.role === "super")!;
    expect(sup.cells.filter((c) => c.allowed).map((c) => c.topic)).toEqual(["submittal_reply", "field_confirm", "sub_contract"]);
    expect(sup.cells.find((c) => c.topic === "client_decision")?.email).toBe(false);
    expect(grid.rows.find((r) => r.role === "owner")!.cells.find((c) => c.topic === "client_message")?.email).toBe(true);
    expect(grid.rows.map((r) => r.role)).toEqual(["job_pm", "owner", "all_access", "pm", "super", "ap", "estimating", "contracts"]);
    expect(prefGrid({ can_change: true })).toBeNull();
  });
  it("never sends a change for the job's PM or a super money topic", async () => {
    const rpc = async () => ({ data: prefs, error: null });
    await expect(saveNoticePref(rpc, { jobId: job, role: "job_pm", topic: "client_message", email: false })).rejects.toThrow("always");
    await expect(saveNoticePref(rpc, { jobId: job, role: "super", topic: "client_decision", email: true })).rejects.toThrow("field notices only");
    expect((await saveNoticePref(rpc, { jobId: job, role: "ap", topic: "client_decision", email: true })).canChange).toBe(true);
  });
});
