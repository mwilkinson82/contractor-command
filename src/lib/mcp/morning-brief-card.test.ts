import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardHasAlert } from "./cards/model";
import { renderHtml } from "./cards/html";
import { paletteViolations } from "./cards/palette";
import { zonedClock } from "./field-reminder";
import { job2701BriefJob } from "./morning-brief-2701";
import { briefIsDue } from "./morning-brief-push";
import { buildMorningBrief, INBOX_SECTION, MORNING_CARD_GUIDANCE, presentBrief, todayBoardUrl, TODAY_BOARD_LABEL } from "./morning-brief";
import { attachMorningCard, morningCardIsDue, type MorningCardStatus } from "./morning-brief-card";

const NOW = new Date("2026-10-26T15:00:00Z");
const settings = { enabled: true, send_local: "06:30", time_zone: "America/Chicago" };

function dueRow(over: Partial<MorningCardStatus> = {}): MorningCardStatus {
  return {
    enabled: true,
    send_local: "06:30",
    time_zone: "America/New_York",
    local_date: "2026-11-01",
    local_minutes: 390,
    already_shown: false,
    ...over,
  };
}

describe("morning card due once per local day", () => {
  it("follows the same local clock as the push across the DST change", () => {
    const cases = [
      ["2026-03-07T11:29:00Z", false],
      ["2026-03-07T11:30:00Z", true],
      ["2026-03-08T10:29:00Z", false],
      ["2026-03-08T10:30:00Z", true],
      ["2026-10-31T10:30:00Z", true],
      ["2026-11-01T11:29:00Z", false],
      ["2026-11-01T11:30:00Z", true],
    ] as const;
    for (const [iso, due] of cases) {
      const now = new Date(iso);
      const clock = zonedClock("America/New_York", now);
      const row = dueRow({ local_date: clock.date, local_minutes: clock.minutes });
      expect(morningCardIsDue(row), iso).toBe(due);
      expect(morningCardIsDue(row)).toBe(
        briefIsDue({ enabled: true, sendLocal: "06:30", timeZone: "America/New_York", lastSentOn: null }, now),
      );
    }
    expect(morningCardIsDue(dueRow({ already_shown: true }))).toBe(false);
    expect(morningCardIsDue(dueRow({ enabled: false }))).toBe(false);
    expect(morningCardIsDue(dueRow({ local_minutes: 389 }))).toBe(false);
  });

  it("prepends the card on the first reply and not again the same day", async () => {
    let shown = false;
    const marks: string[] = [];
    const sb = {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "mcp_morning_brief_card_status") {
          return { data: dueRow({ already_shown: shown }), error: null };
        }
        if (fn === "mcp_morning_brief_mark_shown") {
          marks.push(String(args?._day));
          if (shown) return { data: { recorded: false }, error: null };
          shown = true;
          return { data: { recorded: true }, error: null };
        }
        if (fn === "mcp_morning_brief_settings_get") {
          return { data: { enabled: true, send_local: "06:30", time_zone: "America/New_York", saved: true }, error: null };
        }
        return { data: null, error: null };
      },
      from: () => ({
        select: () => Promise.resolve({ data: [], error: null }),
      }),
    };
    const first = await attachMorningCard(sb, { content: [{ type: "text", text: "Job body" }] }, { fresh: true, explicit: false });
    const text = first.content?.[0]?.text ?? "";
    expect(text).toContain(INBOX_SECTION);
    expect(text.indexOf(INBOX_SECTION)).toBeLessThan(text.indexOf("Why"));
    expect(text.indexOf("Why")).toBeLessThan(text.indexOf("Job body"));
    expect(text.indexOf("Overnight emails")).toBeLessThan(text.indexOf("Job body"));
    expect(text).toContain("Unanswered emails");
    expect(text).toContain("Today's meetings");
    const guidance = (first.structuredContent as { assistant_guidance?: string[] }).assistant_guidance ?? [];
    expect(guidance[guidance.length - 1]).toBe(MORNING_CARD_GUIDANCE);
    expect(text).toContain(todayBoardUrl());
    expect(text).toContain(TODAY_BOARD_LABEL);
    expect(text).toContain("Job body");
    expect(text.indexOf(TODAY_BOARD_LABEL)).toBeLessThan(text.indexOf("Job body"));
    expect(marks).toEqual(["2026-11-01"]);
    const second = await attachMorningCard(sb, { content: [{ type: "text", text: "Job body" }] }, { fresh: true, explicit: false });
    expect(second.content?.[0]?.text).toBe("Job body");
    const later = await attachMorningCard(sb, { content: [{ type: "text", text: "Job body" }] }, { fresh: false, explicit: false });
    expect(later.content?.[0]?.text).toBe("Job body");
  });

  it("records a good-morning reply without adding a second card", async () => {
    const marks: string[] = [];
    const sb = {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "mcp_morning_brief_card_status") return { data: dueRow(), error: null };
        if (fn === "mcp_morning_brief_mark_shown") {
          marks.push(String(args?._day));
          return { data: { recorded: true }, error: null };
        }
        return { data: null, error: null };
      },
    };
    const result = await attachMorningCard(
      sb,
      { content: [{ type: "text", text: "The morning card." }], structuredContent: { card: { state: "result", title: "Morning brief" } } },
      { fresh: false, explicit: true },
    );
    expect(result.content?.[0]?.text).toBe("The morning card.");
    expect(marks).toEqual(["2026-11-01"]);
    const guidance = (result.structuredContent as { assistant_guidance?: string[] }).assistant_guidance ?? [];
    expect(guidance[guidance.length - 1]).toBe(MORNING_CARD_GUIDANCE);
  });
});

describe("morning card styling", () => {
  it("is role-aware, links to /today, and keeps red for overdue only", () => {
    const superJobs = [job2701BriefJob("superintendent")];
    const pmJobs = [job2701BriefJob("pm")];
    const superCard = buildMorningBrief({ jobs: superJobs, hasCompany: true, now: NOW, settings });
    const pmCard = buildMorningBrief({ jobs: pmJobs, hasCompany: true, now: NOW, settings });
    const superHtml = renderHtml(superCard.card);
    const pmHtml = renderHtml(pmCard.card);
    expect(superCard.card.sections?.[0]?.heading).toBe(INBOX_SECTION);
    expect(superCard.card.sections?.[0]?.rows.map((row) => row.cells[0])).toEqual([
      "Overnight emails",
      "Unanswered emails",
      "Today's meetings",
    ]);
    expect(superCard.card.sections?.slice(1).some((section) => section.heading === "Today" || section.heading === "Open items")).toBe(true);
    expect(superCard.card.sections?.findIndex((section) => section.heading === "Board")).toBeGreaterThan(0);
    const shown = presentBrief(superCard.card);
    const host = (shown.structuredContent as { assistant_guidance?: string[] }).assistant_guidance ?? [];
    expect(host).toContain(MORNING_CARD_GUIDANCE);
    expect(superHtml).toContain(todayBoardUrl());
    expect(pmHtml).toContain("https://app.meetathena.io/today");
    expect(superHtml).toContain("#1E3A5F");
    expect(superHtml).toContain("#1E5FED");
    expect(superHtml).not.toMatch(/\$/);
    expect(superHtml).not.toMatch(/pay app|\bIOR\b/i);
    expect(pmHtml).toContain("$420,000.00");
    expect(pmHtml).not.toBe(superHtml);
    expect(paletteViolations(superHtml, cardHasAlert(superCard.card))).toEqual([]);
    expect(paletteViolations(pmHtml, cardHasAlert(pmCard.card))).toEqual([]);
    const quiet = buildMorningBrief({ jobs: [], hasCompany: true });
    expect(paletteViolations(renderHtml(quiet.card), false)).toEqual([]);
    expect(renderHtml(quiet.card)).toContain(todayBoardUrl());
  });

  it("stores one show per user per day and does not email", () => {
    const sql = readFileSync("supabase/migrations/20261024020000_athena_morning_brief_card.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_shows");
    expect(sql).toContain("PRIMARY KEY (user_id, shown_on)");
    expect(sql).toContain("ON CONFLICT (user_id, shown_on) DO NOTHING");
    expect(sql).toContain("mcp_morning_brief_card_status");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|resend|mailto:/i);
    const card = readFileSync("src/lib/mcp/morning-brief-card.ts", "utf8");
    const guard = readFileSync("src/lib/mcp/guard.ts", "utf8");
    const instructions = readFileSync("src/lib/mcp/index.ts", "utf8");
    expect(card).not.toMatch(/resend|sendTransactional|mailto:/i);
    expect(guard).toContain("attachMorningCard");
    expect(guard).toContain("explicit: tool === \"morning_brief\"");
    expect(instructions).toContain("the morning card leads");
    expect(instructions.indexOf(INBOX_SECTION)).toBeLessThan(instructions.indexOf("followed by the job items"));
    expect(instructions).toContain(INBOX_SECTION);
    expect(instructions).toContain("It links to /today.");
    expect(instructions).toContain("once per local day");
    expect(instructions).toContain("Nothing is emailed.");
    expect(instructions).toContain("Hey Athena, good morning");
  });
});
