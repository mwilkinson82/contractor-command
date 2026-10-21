import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ALERT_COLOR, ALERT_HEX, ALERT_PALETTE_RULE } from "./alert-color";
import { CPM_GANTT_SPEC, DELAY_CALLOUT_COLOR } from "./living";
import { IOR_VIEW_SPEC, PORTFOLIO_VIEW_SPEC, EMAIL_VIEW_SPEC, LOOKAHEAD_VIEW_SPEC, PAY_APP_VIEW_SPEC, REMINDERS_VIEW_SPEC, highlightLine, lookaheadHighlight, reminderSource } from "./views";
import { CHART_PALETTE_RULE, HOST_DISPLAY_BLOCK } from "./visible";
import { ATHENA_VERSION } from "./server-info-branding";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ALL_VIEWS = [LOOKAHEAD_VIEW_SPEC, PAY_APP_VIEW_SPEC, REMINDERS_VIEW_SPEC, EMAIL_VIEW_SPEC, IOR_VIEW_SPEC, PORTFOLIO_VIEW_SPEC];

describe("0.8.12 alert color", () => {
  it("version is 0.8.12 or later", () => expect(ATHENA_VERSION).toBe("0.8.13"));
  it("one constant, defaulting to red #DC2626, drives the delay callout", () => {
    expect(ALERT_COLOR).toBe("red #DC2626");
    expect(ALERT_HEX).toBe("#DC2626");
    expect(DELAY_CALLOUT_COLOR).toBe(ALERT_COLOR);
    expect(CPM_GANTT_SPEC.join("\n")).toContain(`${ALERT_COLOR} callout reading "Delay: +X WD (Y CD)", always both units`);
  });
  it("switching is one line: alert-color.ts holds the only literal", () => {
    const lit = /"red #DC2626"|"charcoal #374151"/;
    expect(src("./alert-color.ts").match(/^export const ALERT_COLOR = "[^"]+";$/gm)).toHaveLength(1);
    for (const f of ["./living.ts", "./views.ts", "./visible.ts", "./index.ts", "./sov.ts"]) expect(src(f), f).not.toMatch(lit);
  });
  it("server instructions and house style allow the alert color only for delays, risks and overdue items; never 'never red'", () => {
    expect(ALERT_PALETTE_RULE).toBe("Colors: navy, blue #2563EB and gray only, except red #DC2626 (the alert color), used only for delays, risks and overdue items.");
    const idx = src("./index.ts");
    expect(idx).toContain("ALERT_PALETTE_RULE");
    expect(idx).not.toMatch(/never red|no red/i);
    expect(HOST_DISPLAY_BLOCK).toContain(ALERT_PALETTE_RULE);
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/never red|no red/i);
    expect(CHART_PALETTE_RULE).toContain(ALERT_COLOR);
  });
});

describe("0.8.12 required views", () => {
  it("each spec starts with REQUIRED VIEW and uses the alert color only for risk/overdue", () => {
    for (const v of ALL_VIEWS) {
      expect(v[0]).toMatch(/^REQUIRED VIEW – /);
      const all = v.join("\n");
      expect(all).toContain("#2563EB");
      expect(all).not.toMatch(/lovable|supabase|fragment|orange #/i);
    }
    expect(LOOKAHEAD_VIEW_SPEC.join("\n")).toContain(`${ALERT_COLOR} flag on the bar or day for any risk`);
    expect(REMINDERS_VIEW_SPEC.join("\n")).toContain(`Overdue (${ALERT_COLOR} flag)`);
    expect(EMAIL_VIEW_SPEC.join("\n")).toContain("Ready for your review");
    expect(PAY_APP_VIEW_SPEC.join("\n")).toContain("Forecast total $X = contract $X");
  });
  it("wired into the matching tool results", () => {
    const w = src("./tools/workflow-tools.ts");
    expect(w).toContain('${highlightLine(hl)}\\n${LOOKAHEAD_VIEW_SPEC.join("\\n")}');
    expect(w).toContain('${REMINDERS_VIEW_SPEC.join("\\n")}\\n\\n${ec.text}\\n${EMAIL_VIEW_SPEC.join("\\n")}');
    expect(w).toContain("...EMAIL_VIEW_SPEC,");
    expect(w).toContain('${ec.text}\\n${EMAIL_VIEW_SPEC.join("\\n")}');
    expect(src("./guard.ts")).toContain('text: `${REMINDERS_VIEW_SPEC.join("\\n")}\\n${sweepText}');
    expect(src("./tools/living-tools.ts")).toContain('type === "billing_forecast" && job.scope === "full" ? PAY_APP_VIEW_SPEC');
  });
});

describe("0.8.12 lookahead highlight", () => {
  it("today, or the data date when later", () => {
    expect(lookaheadHighlight("2026-10-20", null)).toEqual({ date: "2026-10-20", basis: "today" });
    expect(lookaheadHighlight("2026-10-20", "2026-10-15")).toEqual({ date: "2026-10-20", basis: "today" });
    expect(lookaheadHighlight("2026-10-20", "2026-10-26")).toEqual({ date: "2026-10-26", basis: "data date" });
    expect(lookaheadHighlight("2026-10-20", "garbage")).toEqual({ date: "2026-10-20", basis: "today" });
    expect(highlightLine({ date: "2026-10-26", basis: "data date" })).toBe("Highlight: 2026-10-26 (data date)");
  });
});

describe("0.8.12 reminder source", () => {
  it("contract section from clause_source beats 'manual'", () => {
    expect(reminderSource({ source: "member_answer", clause_source: "§6.2 (contract)" })).toBe("Contract §6.2");
  });
  it("RFI number from the action", () => {
    expect(reminderSource({ source: "member_answer", action: "Answer RFI #021 before pour" })).toBe("RFI 021");
  });
  it("section in the action text", () => {
    expect(reminderSource({ source: "setup_check", action: "Send written delay notice (§ 6.2) for: rain" })).toBe("Contract § 6.2");
  });
  it("document and delay keys", () => {
    expect(reminderSource({ source: "setup_check", waiting_on_document: "insurance certificate" })).toBe("Waiting on insurance certificate");
    expect(reminderSource({ source: "member_answer", check_key: "delay_notice:abc" })).toBe("Delay notice");
  });
  it("generic sources fall back to null (caller keeps the old wording)", () => {
    expect(reminderSource({ source: "member_answer" })).toBeNull();
    expect(reminderSource({ source: "setup_check", clause_source: "due date set by member" })).toBeNull();
    expect(reminderSource({ source: "schedule_import" })).toBe("schedule import");
  });
  it("wired into item lines and the date sweep", () => {
    expect(src("./jobs.ts")).toContain("Source: ${reminderSource(it) ?? it.source");
    expect(src("./sweep.ts")).toContain("srcNote(it, client)");
  });
});

describe("0.8.12 date sweep: grouped reminders only", () => {
  it("old card-with-table instruction is gone", () => {
    const g = src("./guard.ts");
    expect(g).not.toContain("SWEEP_CARD_REQUIRED");
    expect(g).not.toContain("card_table");
    expect(src("./visible.ts")).not.toMatch(/SWEEP_CARD_REQUIRED|card with a table/);
    expect(g).toContain('render: "grouped_cards", groups: ["Overdue", "Due this week", "Later"], countdown_chips: true');
    const r = REMINDERS_VIEW_SPEC.join("\n");
    expect(r).toContain("Due this week, Later");
    expect(r).toContain("countdown chip");
  });
});

describe("0.8.12 IOR and portfolio views", () => {
  it("IOR spec: tie line, waterfall, red flags on top-3 risks via the shared constant", () => {
    const s = IOR_VIEW_SPEC.join("\n");
    expect(IOR_VIEW_SPEC[0]).toMatch(/^REQUIRED VIEW – IOR DASHBOARD/);
    expect(s).toContain("Forecast total $X = contract $X");
    expect(s).toContain("Waterfall chart");
    expect(s).toContain(`${ALERT_COLOR} flags on the top 3 by weighted $`);
    expect(s).toContain("never recompute");
  });
  it("portfolio spec: access line, job cards, alert color only for down/delayed/at risk", () => {
    const s = PORTFOLIO_VIEW_SPEC.join("\n");
    expect(PORTFOLIO_VIEW_SPEC[0]).toMatch(/^REQUIRED VIEW – COMPANY PORTFOLIO DASHBOARD/);
    expect(s).toContain("only for owner/leadership roles. A PM sees only their own jobs");
    expect(s).toContain(`${ALERT_COLOR} only when delayed or at risk`);
    expect(s).toContain("budgeted in gray #9CA3AF, indicated in blue #2563EB");
  });
  it("no color literal in the specs besides the shared constant", () => {
    const raw = src("./views.ts");
    expect(raw).not.toMatch(/#DC2626|red #/);
  });
  it("wired into living_report_get for full-access users only", () => {
    const l = src("./tools/living-tools.ts");
    expect(l).toContain('type === "ior" && job.scope === "full" ? IOR_VIEW_SPEC');
    expect(l).toContain('type === "dashboard" && job.scope === "full" ? PORTFOLIO_VIEW_SPEC');
    expect(l).toContain('if (job.scope === "super" && type !== "cpm") throw');
    expect(l).toContain('if (job.scope === "contract") throw');
  });
});

import { CPM_REQUIRED_TOP, LIVING_REQUIRED_TOP, LIVING_VIEW_RULE } from "./living";
describe("0.8.12 view-only asks never touch the shared master", () => {
  it("living_report_get text, description and guidance", () => {
    expect(LIVING_REQUIRED_TOP.split("\n")[0]).toBe(LIVING_VIEW_RULE);
    expect(LIVING_VIEW_RULE).toContain("build a NEW private view or artifact");
    expect(LIVING_VIEW_RULE).toContain("unless the user explicitly asks to update or save it, and confirm with them first");
    expect(LIVING_REQUIRED_TOP).not.toMatch(/^REQUIRED: This is the saved master copy\. Update it in place/m);
    const l = src("./tools/living-tools.ts");
    expect(l).toContain("Viewing: build a new private view from it and never change the saved master.");
    expect(l).toContain("For a view-only ask, build a NEW private view or artifact from structuredContent.data");
    expect(l).not.toContain("Redraw the same layout");
  });
  it("cpm_activities text and guidance", () => {
    expect(CPM_REQUIRED_TOP.split("\n")[0]).toContain('"pull up the schedule"');
    expect(CPM_REQUIRED_TOP).toContain("build a NEW private view or artifact");
    expect(src("./tools/living-tools.ts")).toContain('"View-only asks (e.g. \\"pull up the schedule\\"): build a NEW private view or artifact;');
  });
});

import { delayCallout, inclusiveCalendarDays } from "./living";
describe("0.8.12 delay callout: WD and CD", () => {
  it("D1060: 15 WD Nov 27 to Dec 17 = 21 CD inclusive", () => {
    expect(inclusiveCalendarDays("2026-11-27", "2026-12-17")).toBe(21);
    expect(delayCallout(15, "2026-11-27", "2026-12-17")).toBe("Delay: +15 WD (21 CD)");
  });
  it("specs never show the CD-only callout", () => {
    for (const f of ["./living.ts", "./views.ts"]) expect(src(f), f).not.toMatch(/\+X CD/);
    expect(CPM_GANTT_SPEC.join("\n")).toContain('15 WD Nov 27 to Dec 17 = "Delay: +15 WD (21 CD)"');
    expect(PORTFOLIO_VIEW_SPEC.join("\n")).toContain("Delayed +X WD (Y CD), always both units");
  });
});

import { completionDelayLine, jobWorkingDays, tiaResult } from "./living";
import { GREETING_RULE } from "./greeting";
describe("0.8.12 completion delay: WD and CD", () => {
  it("tiaResult states \"Completion delay: +X WD (Y CD)\" from the helpers", () => {
    const t = tiaResult({ fragnet: "FRAG-01", prior_completion: "2027-06-04", updated_completion: "2027-06-19" })!;
    // Jun 5–Jun 19 inclusive = 15 CD; Mon–Fri less Juneteenth (observed Fri Jun 18) = 9 WD.
    expect(t.impact_cd).toBe(15);
    expect(t.impact_wd).toBe(9);
    expect(t.completion_delay).toBe("Completion delay: +9 WD (15 CD)");
    expect(t.statement).toBe("Completion delay: +9 WD (15 CD).");
    expect(completionDelayLine(9, "2027-06-05", "2027-06-19")).toBe(delayCallout(9, "2027-06-05", "2027-06-19").replace("Delay:", "Completion delay:"));
  });
  it("uses the job calendar's holidays when saved", () => {
    expect(jobWorkingDays("2027-06-05", "2027-06-19", [])).toBe(10);
    const t = tiaResult({ prior_completion: "2027-06-04", updated_completion: "2027-06-19", holidays: [] })!;
    expect(t.completion_delay).toBe("Completion delay: +10 WD (15 CD)");
  });
  it("D1060 window: 15 WD Nov 27 to Dec 17 (Thanksgiving excluded) = 21 CD", () => {
    expect(jobWorkingDays("2026-11-27", "2026-12-17")).toBe(15);
    expect(delayCallout(jobWorkingDays("2026-11-27", "2026-12-17"), "2026-11-27", "2026-12-17")).toBe("Delay: +15 WD (21 CD)");
  });
  it("no old CD-only completion wording", () => {
    expect(src("./living.ts")).not.toContain("Impact pushes completion out");
  });
});

describe("0.8.12 greeting", () => {
  it("answers as Athena with a short ready message, never as the host", () => {
    expect(GREETING_RULE).toContain('"Hi Athena"');
    expect(GREETING_RULE).toContain("Welcome back. Athena is ready.");
    expect(GREETING_RULE).toContain("Never introduce yourself as Claude, ChatGPT, Grok or any other assistant");
    expect(GREETING_RULE).toContain("Athena directs; your AI does the work.");
    expect(GREETING_RULE.replace('Never call Athena\'s guidance "prompts"', "")).not.toMatch(/prompt/i);
    expect(src("./index.ts")).toContain('"Athena powered by ALP, construction agents. " + GREETING_RULE + " " + NEXT_MOVE_RULE + " " + CONNECT_CHECK_RULE + " " + REPORT_ATTACHMENT_RULE + " REQUIRED');
  });
});
