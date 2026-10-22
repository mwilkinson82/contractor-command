import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jobLinksMissingToken } from "./board-url";
import { cardHasAlert } from "./cards/model";
import { renderHtml } from "./cards/html";
import { renderMarkdown } from "./cards/markdown";
import { paletteViolations } from "./cards/palette";
import { CARD_SHOWN } from "./cards/silence";
import { briefIsShown, loadBriefJobs, loadMorningBrief, mergeBriefJobs } from "./morning-brief-load";
import { emptyCssValues } from "./cards/palette";
import { countOpenItems, openItemFeed } from "./open-feed";
import { job2701BriefCard, job2701BriefJob } from "./morning-brief-2701";
import {
  BRIEF_ALREADY,
  alreadyShownBrief,
  briefView,
  INBOX_HOST_LINE,
  buildMorningBrief,
  ensureBriefCard,
  jobTitle,
  parseBriefingTime,
  presentBrief,
  settingsLine,
  type BriefJob,
} from "./morning-brief";
import { jobHeading } from "./job-label";

const NOW = new Date("2026-10-26T15:00:00Z");
const TODAY = "2026-10-26";

function textOf(card: ReturnType<typeof buildMorningBrief>["card"]): string {
  return `${renderMarkdown(card)}\n${renderHtml(card)}`;
}

describe("morning brief feed", () => {
  it("keeps job 2701 when the feed comes back empty", () => {
    const kept = mergeBriefJobs([{ job_number: "2701", name: "Harbor Point", company_id: "c" }], []);
    expect(kept.map((job) => job.job_number)).toEqual(["2701"]);
    expect(kept[0].name).toBe("Harbor Point");
  });
});

describe("morning brief settings", () => {
  it("parses 6am and keeps the 6:30 AM default", () => {
    expect(parseBriefingTime("6am")).toBe("06:00");
    expect(parseBriefingTime("6:30 AM")).toBe("06:30");
    expect(parseBriefingTime("6:30pm")).toBe("18:30");
    expect(parseBriefingTime("06:30")).toBe("06:30");
    expect(parseBriefingTime("noon")).toBeNull();
    expect(settingsLine({ enabled: true, send_local: "06:30", time_zone: "America/Chicago" })).toBe(
      "Morning briefing is on at 6:30 AM in America/Chicago. Nothing is sent.",
    );
  });

  it("stores one row per user and does not delete", () => {
    const sql = readFileSync("supabase/migrations/20261023200000_athena_morning_brief.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_settings");
    expect(sql).toContain("send_local time NOT NULL DEFAULT '06:30'");
    expect(sql).toContain("FOR SELECT TO authenticated");
    expect(sql).toContain("FOR INSERT TO authenticated");
    expect(sql).toContain("FOR UPDATE TO authenticated");
    expect(sql.match(/user_id = auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("REVOKE DELETE ON public.mcp_morning_brief_settings FROM authenticated");
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE|TRUNCATE/i);
  });
});

describe("morning brief builder", () => {
  const pm = job2701BriefCard("pm", NOW);
  const superCard = job2701BriefCard("superintendent", NOW);

  it("filters by role, and a superintendent never sees IOR or the pay app", () => {
    expect(briefView("pm", "full")).toBe("pm");
    expect(briefView("super", "super")).toBe("superintendent");
    expect(briefView("ap", "full")).toBe("accounting");
    expect(briefView("owner", "full")).toBe("executive");
    const pmText = textOf(pm.card);
    const superText = textOf(superCard.card);
    expect(pmText).toContain("IOR:");
    expect(pmText).toContain("Pay app");
    expect(pmText).toContain("CO-14");
    expect(pmText).toContain("A1110");
    expect(superText).not.toMatch(/\bIOR\b|pay app|\/ior|\/payapp/i);
    expect(superText).not.toContain("$");
    expect(superText).toContain("A1110");
    expect(superText).toContain("Fire alarm");
    expect(superText).toContain("Daily isn't in yet");
    const accounting = buildMorningBrief({
      jobs: [{ ...job2701BriefJob("pm"), seat: "ap" }],
      hasCompany: true,
      now: NOW,
      settings: { enabled: true, send_local: "06:30", time_zone: "America/Chicago" },
    });
    const books = textOf(accounting.card);
    expect(books).toContain("Pay app");
    expect(books).toContain("CO-14");
    expect(books).toContain("$420,000.00");
    expect(books).not.toContain("Daily isn't in yet");
    expect(books).not.toContain("A1110");
    const owner = buildMorningBrief({
      jobs: [{ ...job2701BriefJob("pm"), seat: "owner" }],
      hasCompany: true,
      now: NOW,
      settings: { enabled: true, send_local: "06:30", time_zone: "America/Chicago" },
    });
    expect(owner.card.sections?.some((s) => s.heading === "Portfolio")).toBe(true);
    expect(owner.card.sections?.find((s) => s.heading === "Don't forget")?.rows.length).toBeLessThanOrEqual(3);
    expect(owner.card.sections?.find((s) => s.heading === "Open items")).toBeUndefined();
  });

  it("covers more than one job", () => {
    const second: BriefJob = {
      ...job2701BriefJob("pm"),
      job_id: "28010000-0000-4000-8000-000000000002",
      job_number: "2801",
      name: "Pier Shed",
      items: [{ id: "r", action: "RFI-9 pier lighting", due_date: "2026-10-20" }],
      activities: [],
      payApps: [],
      dailyToday: true,
    };
    const built = buildMorningBrief({
      jobs: [job2701BriefJob("pm"), second],
      hasCompany: true,
      now: NOW,
      settings: { enabled: true, send_local: "06:30", time_zone: "America/Chicago" },
    });
    const text = textOf(built.card);
    expect(text).toContain("2701 Harbor Point");
    expect(text).toContain("2801 Pier Shed");
    expect(built.card.kpis?.find((k) => k.label === "Jobs")?.value).toBe("2");
  });

  it("points an empty company at first-job setup", () => {
    const noJob = buildMorningBrief({ jobs: [], hasCompany: true });
    const noCompany = buildMorningBrief({ jobs: [], hasCompany: false });
    expect(noJob.card.title).toBe("Let's set up your first job");
    expect(noJob.card.ask?.prompt).toContain("job number");
    expect(noCompany.card.title).toBe("Let's set up your company");
    expect(textOf(noJob.card)).toContain("Let's set up your first job");
  });

  it("uses each job's time zone for today and overdue", () => {
    const item = (due: string, id: string) => ({ id, action: `RFI-${id} answer`, due_date: due });
    const job = (zone: string, items: BriefJob["items"]): BriefJob => ({
      ...job2701BriefJob("pm"),
      time_zone: zone,
      items,
      activities: [],
      payApps: [],
      lookahead: null,
      dailyToday: undefined,
    });
    const inspection = { id: "i", action: "City inspection", due_date: "2026-10-22" };
    const early = new Date("2026-10-22T03:30:00.000Z");
    const late = new Date("2026-10-22T04:30:00.000Z");
    const nyEarly = buildMorningBrief({
      jobs: [job("America/New_York", [item("2026-10-21", "a"), item("2026-10-22", "b"), inspection])],
      hasCompany: true,
      now: early,
    });
    expect(nyEarly.counts.overdue).toBe(0);
    expect(nyEarly.todayCount).toBe(0);
    const nyLate = buildMorningBrief({
      jobs: [job("America/New_York", [item("2026-10-21", "a"), item("2026-10-22", "b"), inspection])],
      hasCompany: true,
      now: late,
    });
    expect(nyLate.counts.overdue).toBe(1);
    expect(nyLate.todayCount).toBe(1);
    const laLate = buildMorningBrief({
      jobs: [job("America/Los_Angeles", [item("2026-10-21", "a"), item("2026-10-22", "b"), inspection])],
      hasCompany: true,
      now: late,
    });
    expect(laLate.counts.overdue).toBe(0);
    expect(laLate.todayCount).toBe(0);
    const open = nyLate.card.sections?.find((s) => s.heading === "Open items")?.rows ?? [];
    expect(open.filter((r) => r.flag === "overdue")).toHaveLength(1);
    expect(nyLate.card.sections?.find((s) => s.heading === "Today")?.rows.some((r) => r.flag === "overdue")).toBe(false);
  });

  it("keeps counts equal to the deduped lists", () => {
    const job = job2701BriefJob("pm");
    job.items = [
      ...job.items,
      { id: "dup-a", action: "Crews confirmed", check_key: "pm:crews", due_date: "2026-10-20", updated_at: "2026-10-01T00:00:00Z" },
      { id: "dup-b", action: "Crews confirmed later", check_key: "pm:crews", due_date: "2026-10-21", updated_at: "2026-10-02T00:00:00Z" },
    ];
    const built = buildMorningBrief({
      jobs: [job],
      hasCompany: true,
      now: NOW,
      settings: { enabled: true, send_local: "06:30", time_zone: "America/Chicago" },
    });
    const openRows = built.card.sections?.find((s) => s.heading === "Open items")?.rows ?? [];
    const todayRows = built.card.sections?.find((s) => s.heading === "Today")?.rows ?? [];
    expect(openRows).toHaveLength(built.counts.open);
    expect(openRows.filter((r) => r.flag === "overdue")).toHaveLength(built.counts.overdue);
    expect(todayRows).toHaveLength(built.counts.today);
    expect(built.card.kpis?.find((k) => k.label === "Open")?.value).toBe(String(built.counts.open));
    expect(built.card.kpis?.find((k) => k.label === "Overdue")?.value).toBe(String(built.counts.overdue));
    const feed = openItemFeed(built.openItems, TODAY);
    expect(countOpenItems(feed.items, TODAY)).toEqual({
      open: built.counts.open,
      overdue: built.counts.overdue,
      due_in_7_days: built.counts.due_in_7_days,
    });
    expect(feed.items.filter((it) => it.check_key === "pm:crews")).toHaveLength(1);
    expect(built.card.sections?.find((s) => s.heading === "Don't forget")?.rows.length).toBeLessThanOrEqual(3);
    expect(built.card.sections?.some((section) => section.heading === "From your inbox and calendar")).toBe(false);
  });

  it("renders the shared card, the same text, and signed job links", () => {
    const shown = presentBrief(pm.card);
    const text = shown.content.find((c) => c.type === "text")?.text ?? "";
    expect(text.trim().endsWith(CARD_SHOWN)).toBe(true);
    expect(text).toContain("Today");
    expect(text).toContain("Open items");
    expect(text).toContain("Don't forget");
    expect(renderHtml(pm.card)).toContain("#1E3A5F");
    expect(jobLinksMissingToken(text)).toEqual([]);
    expect(jobLinksMissingToken(renderHtml(pm.card))).toEqual([]);
    expect(text).toContain("/r/job/");
    expect(text).toContain("?t=");
    expect(paletteViolations(renderHtml(pm.card), cardHasAlert(pm.card))).toEqual([]);
    expect(paletteViolations(renderMarkdown(pm.card), cardHasAlert(pm.card))).toEqual([]);
    expect(paletteViolations(renderHtml(superCard.card), cardHasAlert(superCard.card))).toEqual([]);
    const bare = job2701BriefJob("pm");
    bare.items = [];
    bare.activities = [];
    bare.payApps = [];
    bare.dailyToday = true;
    bare.lookahead = null;
    const quiet = buildMorningBrief({ jobs: [bare], hasCompany: true, now: NOW });
    const filled = ensureBriefCard(quiet.card);
    expect(filled.sections?.some((s) => s.rows.some((row) => row.cells[0] === "Nothing on the list yet, here's my next move."))).toBe(true);
    expect(filled.next_move).toBeTruthy();
    const empty = buildMorningBrief({ jobs: [], hasCompany: true });
    expect(paletteViolations(renderHtml(empty.card), false)).toEqual([]);
  });

  it("is one unescaped HTML card for Claude, with inbox, calendar, jobs, and a link", () => {
    const shown = presentBrief(pm.card);
    const text = shown.content.find((c) => c.type === "text")?.text ?? "";
    const before = text.trim().slice(0, -CARD_SHOWN.length).trim();
    expect(before.match(/<!doctype html/gi)).toHaveLength(1);
    expect(before.endsWith("</html>")).toBe(true);
    expect(before).not.toContain("```html");
    expect(before).not.toContain("&lt;!doctype");
    expect(before).not.toContain(">Result<");
    expect(emptyCssValues(before)).toEqual([]);
    expect(before).toContain("#1E3A5F");
    expect(before).toContain("#1E5FED");
    expect(before).toContain(INBOX_HOST_LINE);
    expect(before).toContain("Gmail and Calendar");
    expect(before).toContain("leave the section out");
    expect(before).toContain("Never render an empty heading");
    expect(shown.structuredContent.html).not.toContain("From your inbox and calendar");
    expect(before).toContain("2701");
    expect(before).toContain("/r/job/");
  });
});

describe("a second good morning", () => {
  it("returns the short reply and does not rebuild the brief", async () => {
    expect(briefIsShown({ shown: true, day: "2026-10-22" })).toBe(true);
    expect(briefIsShown({ shown: false })).toBe(false);
    const repeat = alreadyShownBrief();
    const repeatText = repeat.content.find((c) => c.type === "text")?.text ?? "";
    expect(repeatText).toContain(BRIEF_ALREADY);
    expect(repeatText).not.toContain("From your inbox and calendar");
    const sb = {
      rpc: async (fn: string) => {
        if (fn === "mcp_morning_brief_shows") return { data: { shown: true, day: "2026-10-22" }, error: null };
        throw new Error(fn);
      },
      from: () => { throw new Error("query"); },
    };
    const result = await loadMorningBrief(sb as never);
    const text = result.content.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain("Your brief is above, want anything else?");
    expect(text).not.toContain("From your inbox and calendar");
    expect(text.match(/<!doctype html/gi)).toHaveLength(1);
  });

  it("marks the brief shown after the first build", async () => {
    const calls: string[] = [];
    const sb = {
      rpc: async (fn: string) => {
        calls.push(fn);
        if (fn === "mcp_morning_brief_shows") return { data: { shown: false }, error: null };
        if (fn === "mcp_morning_brief_mark_shown") return { data: { shown: true }, error: null };
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      },
      from: () => {
        const done = Promise.resolve({ data: [], error: null });
        return { select: () => Object.assign(done, { in: () => done, eq: () => done, maybeSingle: () => done }) };
      },
    };
    const result = await loadMorningBrief(sb as never);
    expect(calls[0]).toBe("mcp_morning_brief_shows");
    expect(calls).toContain("mcp_morning_brief_mark_shown");
    expect(result.content.find((c) => c.type === "text")?.text ?? "").not.toContain(BRIEF_ALREADY);
  });

  it("reads the show flag once and does not reload living reports per job", () => {
    const sql = readFileSync("supabase/migrations/20261024180000_athena_brief_once_and_fast.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_shows");
    expect(sql).toContain("FUNCTION public.mcp_morning_brief_shows()");
    expect(sql).toContain("FUNCTION public.mcp_morning_brief_mark_shown()");
    expect(sql).toContain("ON CONFLICT (user_id, shown_on) DO NOTHING");
    expect(sql).not.toContain("mcp_living_report_get");
    expect(sql.match(/PERFORM public\.mcp_assert_active\(\)/g)).toHaveLength(3);
    expect(sql).not.toMatch(/\bDELETE FROM\b|\bDROP TABLE\b|\bTRUNCATE\b/i);
  });
});

describe("job labels and every company", () => {
  it("prints the job number once when the name already starts with it", () => {
    expect(jobTitle({ job_number: "1234", name: "1234 Riverside" })).toBe("1234 Riverside");
    expect(jobTitle({ job_number: "1234", name: "Riverside" })).toBe("1234 Riverside");
    expect(jobTitle({ job_number: "1234", name: "1234" })).toBe("1234");
    expect(jobTitle({ job_number: "1234", name: "1234 Riverside Clinic Renovation" })).toBe("1234 Riverside Clinic Renovation");
    expect(jobTitle({ job_number: "1234", name: "1234 1234 Riverside Clinic Renovation" })).toBe("1234 Riverside Clinic Renovation");
    expect(jobHeading({ job_number: "1234", name: "1234 Riverside Clinic Renovation" })).toBe("1234 Riverside Clinic Renovation");
    expect(jobHeading({ job_number: "1234", name: "Riverside Clinic Renovation" })).toBe("1234 – Riverside Clinic Renovation");
    const doubled = buildMorningBrief({
      jobs: [{
        ...job2701BriefJob("pm"),
        job_number: "1234",
        name: "1234 Riverside Clinic Renovation",
        company_id: "alp",
        company_name: "ALP Construction",
      }],
      hasCompany: true,
      now: NOW,
    });
    const text = renderMarkdown(doubled.card);
    expect(text).toContain("1234 Riverside");
    expect(text).not.toContain("1234 1234");
  });

  it("groups every company and still names 2701 when another company is active", async () => {
    const alp = "alp";
    const aop = "aop";
    const companies = [
      { id: alp, name: "ALP Construction" },
      { id: aop, name: "AOP Construction" },
    ];
    const jobs = [
      { id: "job-1234", job_number: "1234", name: "Riverside", company_id: alp, updated_at: null },
      { id: "job-2701", job_number: "2701", name: "Harbor Point", company_id: aop, updated_at: null },
    ];
    const sb = {
      from(table: string) {
        if (table === "mcp_companies") return { select: async () => ({ data: companies, error: null }) };
        if (table === "mcp_user_settings") return { select: () => ({ maybeSingle: async () => ({ data: { current_company: alp }, error: null }) }) };
        if (table === "mcp_jobs") return { select: () => ({ in: async () => ({ data: jobs, error: null }) }) };
        return { select: () => ({ in: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
      },
      rpc: async () => ({ data: [], error: null }),
    };
    const loaded = await loadBriefJobs(sb as never, alp);
    expect(loaded.jobs.map((job) => job.job_number).sort()).toEqual(["1234", "2701"]);
    const built = buildMorningBrief({ jobs: loaded.jobs, hasCompany: true, now: NOW });
    const headings = built.card.sections?.map((section) => section.heading) ?? [];
    expect(headings).toContain("ALP Construction");
    expect(headings).toContain("AOP Construction");
    const text = renderMarkdown(built.card);
    expect(text).toContain("1234 Riverside");
    expect(text).toContain("2701 Harbor Point");
    expect(text).not.toContain("1234 1234");
    expect(built.card.sections?.some((section) => section.heading === "From your inbox and calendar")).toBe(false);
  });
});
