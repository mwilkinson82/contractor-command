import { describe, expect, it } from "vitest";
import {
  loadNoticeBrief,
  noticeBriefRows,
  noticeLine,
  noticeSince,
  orderBriefNotices,
} from "./notice-brief";
import { loadMorningBrief } from "./morning-brief-load";
import { renderMarkdown } from "./cards/markdown";
import type { MyNotice } from "../notices/board-notices";

const n = (
  id: string,
  at: string,
  topic: MyNotice["topic"] = "client_decision",
  job = "j1",
  read = false,
): MyNotice => ({
  id,
  job_id: job,
  job_number: job === "j1" ? "2810" : "1234",
  job_name: job === "j1" ? "Willow Creek" : "Riverside",
  topic,
  kind: "x",
  title: `Rosa Delgado approved ${id}`,
  detail: null,
  actor: "Rosa Delgado",
  facts: {},
  board_page: null,
  created_at: at,
  read,
});

describe("since yesterday", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  it("reaches back to the last brief or 24 hours, never more than a week", () => {
    expect(noticeSince(null, now)).toBe("2026-11-04T12:00:00.000Z");
    expect(noticeSince("2026-11-02T11:00:00Z", now)).toBe("2026-11-02T11:00:00.000Z");
    expect(noticeSince("2026-11-05T08:00:00Z", now)).toBe("2026-11-04T12:00:00.000Z");
    expect(noticeSince("2026-09-01T00:00:00Z", now)).toBe("2026-10-29T12:00:00.000Z");
  });
  it("writes one short line per notice", () => {
    expect(noticeLine(n("CO-003", "2026-11-05T10:00:00Z"))).toBe(
      "2810 Willow Creek: Rosa Delgado approved CO-003",
    );
  });
  it("puts client questions first, then groups by job, and skips read ones", () => {
    const ordered = orderBriefNotices([
      n("a", "2026-11-05T10:00:00Z", "client_decision", "j1"),
      n("b", "2026-11-05T11:00:00Z", "submittal_reply", "j2"),
      n("q", "2026-11-05T08:00:00Z", "client_message", "j1"),
      n("c", "2026-11-05T09:00:00Z", "field_confirm", "j2"),
      n("r", "2026-11-05T11:30:00Z", "client_decision", "j1", true),
    ]);
    expect(ordered.map((x) => x.id)).toEqual(["q", "b", "c", "a"]);
  });
  it("lists questions still waiting on a reply first, and answered ones with their job", () => {
    const notices = [
      n("a", "2026-11-05T10:00:00Z", "client_decision", "j1"),
      n("answered", "2026-11-05T11:00:00Z", "client_message", "j1"),
      n("waiting", "2026-11-05T07:00:00Z", "client_message", "j2"),
    ];
    const ordered = orderBriefNotices(notices, new Set(["waiting"]));
    expect(ordered.map((x) => x.id)).toEqual(["waiting", "answered", "a"]);
    const rows = noticeBriefRows(notices, 8, new Set(["waiting"]));
    expect(rows.map((r) => r.flag ?? null)).toEqual(["callout", null, null]);
  });
  it("prints at most 8 lines, then and N more", () => {
    const many = Array.from({ length: 11 }, (_, i) => n(`CO-${i}`, `2026-11-05T0${i % 10}:00:00Z`));
    const rows = noticeBriefRows(many);
    expect(rows).toHaveLength(9);
    expect(rows[8].cells[0]).toBe("and 3 more");
    expect(noticeBriefRows([])).toEqual([]);
  });
  it("asks for unread notices only and never blocks when the feed is missing", async () => {
    const calls: Record<string, unknown>[] = [];
    const sb = {
      rpc: async (_fn: string, args?: Record<string, unknown>) => {
        calls.push(args ?? {});
        return {
          data: {
            notices: [
              { ...n("CO-003", "2026-11-05T10:00:00Z") },
              { ...n("x", "2026-11-05T10:00:00Z", "client_decision", "j2") },
            ],
          },
          error: null,
        };
      },
    };
    const one = await loadNoticeBrief(sb, { jobId: "j1", now });
    expect(one?.heading).toBe("Since yesterday");
    expect(one?.rows.map((r) => r.cells[0])).toEqual([
      "2810 Willow Creek: Rosa Delgado approved CO-003",
    ]);
    expect(calls[0]).toMatchObject({ _unread_only: true, _since: "2026-11-04T12:00:00.000Z" });
    const awaiting = {
      rpc: async (fn: string) =>
        fn === "mcp_job_messages_list"
          ? {
              data: {
                threads: [
                  {
                    access_id: "a",
                    messages: [
                      {
                        id: "m1",
                        author_kind: "client",
                        body: "Is the tile in?",
                        created_at: "2026-11-05T09:00:00Z",
                        team_read_at: null,
                        notice_id: "late",
                      },
                    ],
                  },
                ],
              },
              error: null,
            }
          : {
              data: {
                notices: [
                  n("early", "2026-11-05T11:00:00Z", "client_message"),
                  n("late", "2026-11-05T08:00:00Z", "client_message"),
                ],
              },
              error: null,
            },
    };
    const ordered = await loadNoticeBrief(awaiting, { now, window: "day" });
    expect(ordered?.rows.map((r) => r.refId)).toEqual(["late", "early"]);
    const missing = {
      rpc: async () => ({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      }),
    };
    expect(await loadNoticeBrief(missing, { now })).toBeNull();
  });
});

describe("the morning brief", () => {
  it("leads the job side with Since yesterday", async () => {
    const sb = {
      from: (table: string) => ({
        select: () =>
          table === "mcp_companies"
            ? Promise.resolve({ data: [{ id: "alp", name: "ALP" }], error: null })
            : {
                maybeSingle: async () => ({ data: null, error: null }),
                in: async () => ({ data: [], error: null }),
              },
      }),
      rpc: async (fn: string) => ({
        data:
          fn === "mcp_morning_brief_feed"
            ? [
                {
                  job_id: "j1",
                  job_number: "2810",
                  company_id: "alp",
                  name: "Willow Creek",
                  scope: "full",
                  items: [{ id: "a", action: "Call the inspector" }],
                },
              ]
            : fn === "mcp_my_notices"
              ? {
                  notices: [
                    n("CO-003", new Date().toISOString()),
                    n("q1", new Date().toISOString(), "client_message"),
                  ],
                }
              : null,
        error: null,
      }),
    };
    const brief = await loadMorningBrief(sb as never);
    const card = brief.structuredContent.card;
    const headings = card.sections?.map((s) => s.heading) ?? [];
    expect(headings[0]).toBe("Since yesterday");
    expect(card.sections?.[0].rows[0].cells[0]).toBe("2810 Willow Creek: Rosa Delgado approved q1");
    expect(renderMarkdown(card)).toContain("Call the inspector");
  });
});
