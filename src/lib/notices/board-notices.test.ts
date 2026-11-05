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
import {
  MessagesNotForYou,
  awaitingNoticeIds,
  lastAbout,
  listJobMessages,
  parseJobMessages,
  replyProblem,
  replySentLine,
  threadWaiting,
  unreadNoticeIds,
} from "./job-messages";
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
      notices: [
        notice("CO-003", "2026-11-05T10:00:00Z"),
        { id: 4 },
        notice("x", "2026-11-05T09:00:00Z", false, "billing"),
      ],
      unread: 7,
    });
    expect(list?.notices.map((n) => n.id)).toEqual(["CO-003"]);
    expect(list?.unread).toBe(7);
  });
  it("treats a reply without notices as unavailable, never as zero", async () => {
    expect(parseNoticeList(null)).toBeNull();
    expect(parseNoticeList({ unread: 0 })).toBeNull();
    const rpc = async () => ({
      data: null,
      error: { message: "MCP_BAD:You don't have access to this job." },
    });
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
    expect(calls).toEqual([
      { _job: job, _ids: ["a", "b"] },
      { _job: job, _ids: null },
    ]);
  });
  it("updates the count right away when the member opens one or marks all read", () => {
    const list = parseNoticeList({
      notices: [
        notice("a", "2026-11-05T10:00:00Z"),
        notice("b", "2026-11-05T09:00:00Z"),
        notice("c", "2026-11-04T09:00:00Z", true),
      ],
      unread: 2,
    })!;
    expect(withLocalReads(list, NO_LOCAL_READS).unread).toBe(2);
    const one = withLocalReads(list, { ids: new Set(["a"]), allAt: null });
    expect(one.unread).toBe(1);
    expect(one.notices[0].read).toBe(true);
    expect(withLocalReads(list, { ids: new Set(), allAt: "2026-11-05T11:00:00Z" }).unread).toBe(0);
    // A notice that arrives after mark all read still counts.
    const later = parseNoticeList({
      notices: [notice("d", "2026-11-05T12:00:00Z"), ...list.notices],
      unread: 3,
    })!;
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
      {
        ...notice("a", "2026-11-05T10:00:00Z"),
        job_id: "j1",
        job_number: "2810",
        job_name: "Willow Creek",
      },
      {
        ...notice("b", "2026-11-05T11:00:00Z", true),
        job_id: "j2",
        job_number: "1234",
        job_name: "1234 Riverside",
      },
      {
        ...notice("c", "2026-11-05T09:00:00Z"),
        job_id: "j1",
        job_number: "2810",
        job_name: "Willow Creek",
      },
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

const co = (
  number: string,
  state: ChangeRow["change_order_details"]["state"],
  extra: Partial<ChangeRow["change_order_details"]> = {},
  history: ChangeRow["history"] = [],
): ChangeRow => ({
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
      co(
        "PCO-002",
        "approved",
        {
          co_number: "CO-003",
          decision: {
            by: "Rosa Delgado <rosa@example.com>",
            at: "2026-11-05T19:14:00Z",
            reference: "r",
            channel: "customer_page",
          } as never,
        },
        [
          {
            record_version: 2,
            action: "approve",
            created_at: "2026-11-05T19:14:00Z",
            snapshot: {} as never,
          },
        ],
      ),
      co("PCO-003", "rejected", {
        decision: { by: "Sam Ortiz", at: "2026-11-04T15:00:00Z", reference: "r" },
      }),
    ],
  };
  it("shows the client's decision with who and when, fresh decisions first, and never cost lines", () => {
    const rows = boardCoRows(payload);
    expect(rows[0]).toMatchObject({
      number: "CO-003",
      status: "Approved",
      amount: "$2,671.92",
      days: "+2 days",
    });
    expect(rows[0].decision).toBe("Approved by Rosa Delgado on the client page · Nov 5, 2:14 PM");
    expect(rows[1].decision).toMatch(/^Declined by Sam Ortiz · Nov 4/);
    expect(rows[2]).toMatchObject({
      status: "Waiting on client",
      amount: null,
      days: "Not set",
      decision: null,
    });
    expect(JSON.stringify(rows)).not.toMatch(/markup|fee|rosa@example\.com/);
    expect(coCounts(rows)).toEqual({ total: 3, waiting: 1, approved: 1, declined: 1 });
    expect(decisionName("  ")).toBeNull();
  });
});

describe("client messages data layer", () => {
  const msg = (
    id: string,
    kind: "client" | "team",
    at: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    author_kind: kind,
    author_name: kind === "team" ? "Jay" : "Rosa",
    author_user_id: null,
    body: `body ${id}`,
    created_at: at,
    item_id: null,
    about_kind: null,
    about_label: null,
    client_read_at: null,
    team_read_at: null,
    notice_id: kind === "client" ? `n-${id}` : null,
    read: kind === "team",
    ...extra,
  });
  const list = parseJobMessages({
    job_id: "j",
    job_number: "2810",
    job_name: "Willow Creek",
    unread: 2,
    awaiting_reply: 1,
    threads: [
      {
        access_id: "acc-2",
        customer_name: "",
        customer_email: "sam@example.com",
        can_reply: false,
        last_at: "2026-11-05T11:00:00Z",
        awaiting_reply: 0,
        unread: 1,
        messages: [
          msg("m3", "client", "2026-11-05T11:00:00Z", { team_read_at: "2026-11-05T11:30:00Z" }),
        ],
      },
      {
        access_id: "acc-1",
        customer_name: "Rosa Delgado",
        customer_email: "rosa@example.com",
        can_reply: true,
        last_at: "2026-11-05T10:00:00Z",
        awaiting_reply: 1,
        unread: 1,
        messages: [
          msg("m1", "client", "2026-11-05T09:00:00Z", { item_id: "item-1", about_label: "CO-003" }),
          msg("m2", "team", "2026-11-05T10:00:00Z"),
        ],
      },
    ],
  })!;
  it("keeps the database order and reads awaiting_reply, unread and can_reply", () => {
    expect(list.threads.map((t) => t.access_id)).toEqual(["acc-2", "acc-1"]);
    expect(list.awaiting_reply).toBe(1);
    expect(list.threads[0]).toMatchObject({ customer_name: "Client", can_reply: false });
    expect(list.threads[1].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(threadWaiting(list.threads[1])).toBe(true);
    expect(threadWaiting(list.threads[0])).toBe(false);
    expect(lastAbout(list.threads[1])).toEqual({ id: "item-1", label: "CO-003" });
    expect(unreadNoticeIds(list.threads[1])).toEqual(["n-m1"]);
    expect(awaitingNoticeIds(list)).toEqual(["n-m1"]);
    expect(parseJobMessages({})).toBeNull();
  });
  it("hides the panel for a member without full access instead of erroring", async () => {
    const denied = async () => ({
      data: null,
      error: { message: "MCP_BAD:The customer page needs full access to the job." },
    });
    await expect(listJobMessages(denied, job)).rejects.toBeInstanceOf(MessagesNotForYou);
    const broken = async () => ({ data: null, error: { message: "timeout" } });
    await expect(listJobMessages(broken, job)).rejects.not.toBeInstanceOf(MessagesNotForYou);
  });
  it("checks the reply before sending and confirms how the client hears about it", () => {
    expect(replyProblem("   ")).toBe("Write your reply first.");
    expect(replyProblem("x".repeat(4001))).toBe("Keep the reply to 4,000 characters.");
    expect(replyProblem("Yes, Friday.")).toBeNull();
    const r = {
      message_id: "m",
      customer_name: "Rosa Delgado",
      customer_email: "rosa@example.com",
    };
    expect(replySentLine({ ...r, email: "sent" })).toContain("emailed rosa@example.com");
    expect(replySentLine({ ...r, email: "off" })).toContain("Client email is off");
    expect(replySentLine({ ...r, email: "failed" })).toContain("didn't go out");
  });
  it("never posts a reply from the browser", async () => {
    const { readFileSync } = await import("node:fs");
    const panel = readFileSync("src/components/athena/JobHomeMessages.tsx", "utf8");
    expect(panel).not.toContain("mcp_job_message_reply");
    expect(panel).toContain("replyJobMessageFn");
    const fn = readFileSync("src/lib/notices/job-messages.functions.ts", "utf8");
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain("replyToClient");
    expect(fn).not.toMatch(/SERVICE_ROLE/);
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
    expect(sup.cells.filter((c) => c.allowed).map((c) => c.topic)).toEqual([
      "submittal_reply",
      "field_confirm",
      "sub_contract",
    ]);
    expect(sup.cells.find((c) => c.topic === "client_decision")?.email).toBe(false);
    expect(
      grid.rows.find((r) => r.role === "owner")!.cells.find((c) => c.topic === "client_message")
        ?.email,
    ).toBe(true);
    expect(grid.rows.map((r) => r.role)).toEqual([
      "job_pm",
      "owner",
      "all_access",
      "pm",
      "super",
      "ap",
      "estimating",
      "contracts",
    ]);
    expect(prefGrid({ can_change: true })).toBeNull();
  });
  it("never sends a change for the job's PM or a super money topic", async () => {
    const rpc = async () => ({ data: prefs, error: null });
    await expect(
      saveNoticePref(rpc, { jobId: job, role: "job_pm", topic: "client_message", email: false }),
    ).rejects.toThrow("always");
    await expect(
      saveNoticePref(rpc, { jobId: job, role: "super", topic: "client_decision", email: true }),
    ).rejects.toThrow("field notices only");
    expect(
      (await saveNoticePref(rpc, { jobId: job, role: "ap", topic: "client_decision", email: true }))
        .canChange,
    ).toBe(true);
  });
});
