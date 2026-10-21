import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ATHENA_VERSION } from "./server-info-branding";
import { CADENCE_FACT_KEY, CADENCE_ITEMS, CADENCE_SETUP_SPEC, NEXT_MOVES, NEXT_MOVE_CHOICES, NEXT_MOVE_RULE, cadenceCardLines, nextCadenceDate, nextCadenceItem, nextMoveGuidance, withNextMove, type CoachStep } from "./coach";
import { FIELD_UPDATE_QUESTIONS, MORNING_BRIEFING_RULE, MORNING_BRIEFING_VIEW_SPEC, MORNING_CHECKIN_RULE, isMorningAsk, stripDollars, todaysActivities, visibleForRole } from "./morning";
import { GREETING_RULE } from "./greeting";
import { guide } from "./visible";
import { coachStepFor } from "./tools/living-tools";
import { jobCadence, jobCadenceReminders } from "./tools/cadence-tools";
import { morningBriefing } from "./tools/morning-tools";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")) as { mcp: { tools: { name: string; annotations: Record<string, boolean> }[] } };
const ALL_TEXT = [NEXT_MOVE_RULE, ...CADENCE_SETUP_SPEC, ...Object.values(NEXT_MOVES).flatMap((m) => [m.action, m.why]), ...MORNING_BRIEFING_VIEW_SPEC, MORNING_CHECKIN_RULE, GREETING_RULE].join("\n");

describe("0.8.13 version", () => {
  it("is 0.8.15", () => expect(ATHENA_VERSION).toBe("0.8.15"));
});

describe("0.8.13 next move card", () => {
  const steps: CoachStep[] = ["setup", "cpm", "sov", "notice", "pay_app", "ior", "tia", "briefing"];
  it("every step has one action and a why", () => {
    for (const s of steps) {
      expect(NEXT_MOVES[s].action.length).toBeGreaterThan(5);
      expect(NEXT_MOVES[s].why).toMatch(/^we should .+ so /);
    }
  });
  it("rule: one card, two choices, no action without a yes", () => {
    expect(NEXT_MOVE_RULE).toContain('ONE styled "Next move" card');
    expect(NEXT_MOVE_CHOICES).toEqual(["Yes, let's do it", "Not now"]);
    expect(NEXT_MOVE_RULE).toContain("Never create reminders, send emails or save anything without a clear yes.");
    expect(NEXT_MOVE_RULE).toContain("Athena directs; your AI does the work.");
  });
  it("is in the server instructions", () => expect(src("./index.ts")).toContain("NEXT_MOVE_RULE"));
  it("withNextMove adds structured data and guidance, keeps prior guidance", () => {
    const r = withNextMove(guide({ content: [{ type: "text" as const, text: "x" }] }, "prior"), "sov", guide) as unknown as { structuredContent: { next_move: { step: string }; assistant_guidance: string[] } };
    expect(r.structuredContent.next_move.step).toBe("sov");
    expect(r.structuredContent.assistant_guidance[0]).toBe("prior");
    expect(r.structuredContent.assistant_guidance.join("\n")).toContain("Why it matters: we should cost-load");
  });
  it("cpm next move carries the cadence setup", () => {
    expect(nextMoveGuidance("cpm").join("\n")).toContain("JOB CADENCE SETUP");
    expect(nextMoveGuidance("sov").join("\n")).not.toContain("JOB CADENCE SETUP");
  });
  it("wired into setup, CPM, SOV, notices, pay app, IOR and TIA results", () => {
    const w = src("./tools/workflow-tools.ts");
    for (const s of ['"setup", guide', '"sov", guide', '"notice", guide']) expect(w).toContain(s);
    expect(coachStepFor("cpm", {})).toBe("cpm");
    expect(coachStepFor("cpm", { tia: { fragnet: "D1060" } } as never)).toBe("tia");
    expect(coachStepFor("billing_forecast")).toBe("pay_app");
    expect(coachStepFor("ior")).toBe("ior");
    expect(coachStepFor("dashboard")).toBeNull();
  });
});

describe("0.8.13 job cadence", () => {
  it("six items in order with defaults", () => {
    expect(CADENCE_ITEMS.map((i) => i.key)).toEqual(["pm_meeting", "lookahead_day", "daily_update_time", "morning_briefing_time", "pay_app_dates", "update_cycle"]);
    expect(CADENCE_ITEMS.map((i) => i.default)).toEqual(["Tue 10:00", "Thu, issued to subs Fri", "4:00 PM daily", "7:00 AM workdays", "Pay apps due the 25th; billing period ends the last day of the month", "Monthly, data date = pay app cutoff"]);
  });
  it("asks one at a time", () => {
    expect(nextCadenceItem({})!.key).toBe("pm_meeting");
    expect(nextCadenceItem({ pm_meeting: "Tue 10:00", lookahead_day: "Thu" })!.key).toBe("daily_update_time");
    expect(nextCadenceItem(Object.fromEntries(CADENCE_ITEMS.map((i) => [i.key, i.default])))).toBeNull();
  });
  it("card lists all six", () => {
    const l = cadenceCardLines({ pm_meeting: "Tue 10:00" });
    expect(l[0]).toBe("Job cadence");
    expect(l).toHaveLength(7);
    expect(l[2]).toContain("not set");
  });
  it("reuses job facts, no new table", () => {
    expect(CADENCE_FACT_KEY).toBe("job_cadence");
    const c = src("./tools/cadence-tools.ts");
    expect(c).toContain('"mcp_set_facts"');
    expect(c).toContain('_module: "scope"');
    expect(c).toContain('"mcp_add_item"');
  });
  it("next reminder date", () => {
    expect(nextCadenceDate("Tue 10:00", "2026-10-20")).toBe("2026-10-27");
    expect(nextCadenceDate("Thu, issued to subs Fri", "2026-10-20")).toBe("2026-10-22");
    expect(nextCadenceDate("4:00 PM daily", "2026-10-23")).toBe("2026-10-26");
  });
  it("reminders need an explicit yes and are ask-first", () => {
    expect(jobCadenceReminders.name).toBe("job_cadence_reminders");
    const t = manifest.mcp.tools.find((x) => x.name === "job_cadence_reminders")!;
    expect(t.annotations.destructiveHint).toBe(true);
    expect(src("./tools/cadence-tools.ts")).toContain('approved: z.literal(true)');
    expect(manifest.mcp.tools.find((x) => x.name === "job_cadence")!.annotations.destructiveHint).toBe(false);
    expect(jobCadence.name).toBe("job_cadence");
  });
  it("morning briefing time offers the daily check-in only on a yes", () => {
    expect(CADENCE_SETUP_SPEC.join("\n")).toContain(MORNING_CHECKIN_RULE);
    expect(MORNING_CHECKIN_RULE).toContain("Only on a clear yes");
  });
});

describe("0.8.13 morning briefing", () => {
  it("good morning triggers it; bare hi/hey/hello stays the short greeting", () => {
    for (const s of ["good morning", "Athena, good morning", "Good morning Athena", "morning briefing"]) expect(isMorningAsk(s)).toBe(true);
    for (const s of ["Hi Athena", "Hey Athena", "Hello Athena"]) expect(isMorningAsk(s)).toBe(false);
    expect(GREETING_RULE).toContain('bare "Hi Athena", "Hey Athena" or "Hello Athena"');
    expect(GREETING_RULE).not.toMatch(/"Good morning" and similar/);
    expect(GREETING_RULE).toContain(MORNING_BRIEFING_RULE);
    expect(MORNING_BRIEFING_RULE).toContain("Athena, good morning");
  });
  it("read-only tool, registered", () => {
    expect(morningBriefing.name).toBe("morning_briefing");
    const t = manifest.mcp.tools.find((x) => x.name === "morning_briefing")!;
    expect(t.annotations.readOnlyHint).toBe(true);
    const m = src("./tools/morning-tools.ts");
    expect(m).toContain('"mcp_job_scope"');
    expect(m).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src("./index.ts")).toContain("morningBriefing");
  });
  it("view has all sections in order, email read-only via the host", () => {
    const v = MORNING_BRIEFING_VIEW_SPEC.join("\n");
    const order = ["Today's top 3", "Overdue items and risks", "Overnight emails", "Today on the lookahead", "Inspections and deliveries", "RFIs and submittals", "countdown chip", "field updates"];
    let at = -1;
    for (const o of order) { const i = v.indexOf(o); expect(i).toBeGreaterThan(at); at = i; }
    expect(v).toContain("read-only");
    expect(v).toContain("Never send anything.");
    expect(FIELD_UPDATE_QUESTIONS).toHaveLength(3);
  });
  it("role scope: PMs only their jobs, no dollars outside full scope", () => {
    const jobs = [{ id: "a", pm_user_id: "me" }, { id: "b", pm_user_id: "x" }];
    expect(visibleForRole(jobs, "pm", "me").map((j) => j.id)).toEqual(["a"]);
    expect(visibleForRole(jobs, "owner", "me")).toHaveLength(2);
    expect(visibleForRole(jobs, "pm", null)).toHaveLength(0);
    expect(stripDollars("Pay app $1,400,000.00 due")).toBe("Pay app [amount withheld] due");
  });
  it("today's activities", () => {
    const a = todaysActivities([{ id: "A1", name: "Pour", start: "2026-10-21", finish: "2026-10-23", critical: true }, { id: "A2", name: "Paint", start: "2026-10-01", finish: "2026-10-21", critical: false }, { id: "A3", name: "X", start: "2026-11-01", finish: null, critical: null }], "2026-10-21");
    expect(a).toEqual([{ id: "A1", name: "Pour", event: "starts", critical: true }, { id: "A2", name: "Paint", event: "finishes", critical: false }]);
  });
});

describe("0.8.13 house rules", () => {
  it("palette, wording, no vendor names", () => {
    expect(ALL_TEXT).toContain("fragnet");
    expect(ALL_TEXT).not.toMatch(/orange|Lovable|Supabase/i);
    expect(ALL_TEXT.replace(/Never call Athena's guidance "prompts"/g, "")).not.toMatch(/prompt/i);
    expect(ALL_TEXT).toMatch(/navy/);
    expect(ALL_TEXT).toContain("#2563EB");
  });
});

import { CONNECT_CHECK_RULE, REMINDER_DELIVERY_ASK, REMINDER_DELIVERY_DEFAULT, REMINDER_DELIVERY_OPTIONS, REMINDER_DELIVERY_RULE, REPORT_ATTACHMENT_RULE, REPORT_SEND_GUIDANCE } from "./coach";
import { EMAIL_ATTACHMENT_RULE } from "./visible";

describe("0.8.13 connect check", () => {
  it("covers calendar and email steps, one line, pause and resume, never pretend", () => {
    for (const s of ["cadence reminders", "overnight-email summary", "drafting or sending an email", "sending a report"]) expect(CONNECT_CHECK_RULE).toContain(s);
    expect(CONNECT_CHECK_RULE).toContain("say in one line what's missing");
    expect(CONNECT_CHECK_RULE).toContain("pick up exactly where you left off");
    expect(CONNECT_CHECK_RULE).toContain("Never pretend it was done.");
  });
  it("is in the server instructions, cadence setup, reminders and the briefing", () => {
    expect(src("./index.ts")).toContain("CONNECT_CHECK_RULE");
    expect(CADENCE_SETUP_SPEC).toContain(CONNECT_CHECK_RULE);
    expect(src("./tools/cadence-tools.ts")).toContain("CONNECT_CHECK_RULE");
    expect(src("./tools/morning-tools.ts")).toContain("CONNECT_CHECK_RULE");
    expect(MORNING_BRIEFING_VIEW_SPEC.join("\n")).toContain("connect check");
  });
  it("cadence asks calendar / AI reminders / both, default calendar", () => {
    expect(REMINDER_DELIVERY_ASK).toBe("Calendar events, AI reminders, or both? (Default: calendar.)");
    expect([...REMINDER_DELIVERY_OPTIONS]).toEqual(["calendar", "ai_reminders", "both"]);
    expect(REMINDER_DELIVERY_DEFAULT).toBe("calendar");
    expect(CADENCE_SETUP_SPEC).toContain(REMINDER_DELIVERY_RULE);
    expect(REMINDER_DELIVERY_RULE).toContain("if it has none, say so and use the calendar");
    const t = manifest.mcp.tools.find((x) => x.name === "job_cadence_reminders") as unknown as { inputSchema: { properties: Record<string, { enum?: string[] }> } };
    expect(t.inputSchema.properties.delivery.enum).toEqual(["calendar", "ai_reminders", "both"]);
  });
});

describe("0.8.13 report attachments", () => {
  it("real file, chip, never claims attached, fallback with file + draft + share link, send on yes", () => {
    expect(REPORT_ATTACHMENT_RULE).toContain("real file first, PDF by default");
    expect(REPORT_ATTACHMENT_RULE).toContain('"Attachment: <filename>" chip');
    expect(REPORT_ATTACHMENT_RULE).toContain('never say "attached" unless the file is on the draft');
    expect(REPORT_ATTACHMENT_RULE).toContain("offer the downloadable file plus a draft");
    expect(REPORT_ATTACHMENT_RULE).toContain("file_share link");
    expect(REPORT_ATTACHMENT_RULE).toContain("send only on the member's clear yes");
  });
  it("consistent with the honest-attachment rule", () => {
    expect(EMAIL_ATTACHMENT_RULE).toContain("Only say a file is attached if your email tool actually attached it.");
    expect(EMAIL_ATTACHMENT_RULE).toContain("file_share");
  });
  it("rides in report, SOV and living report results and the server instructions", () => {
    expect(REPORT_SEND_GUIDANCE).toEqual([CONNECT_CHECK_RULE, REPORT_ATTACHMENT_RULE]);
    expect(src("./tools/workflow-tools.ts").match(/REPORT_SEND_GUIDANCE/g)!.length).toBeGreaterThanOrEqual(3);
    expect(src("./tools/living-tools.ts")).toContain("...REPORT_SEND_GUIDANCE");
    expect(src("./index.ts")).toContain("REPORT_ATTACHMENT_RULE");
  });
  it("house rules", () => {
    const t = [CONNECT_CHECK_RULE, REMINDER_DELIVERY_RULE, REPORT_ATTACHMENT_RULE].join("\n");
    expect(t).not.toMatch(/Lovable|Supabase|prompt/i);
  });
});
