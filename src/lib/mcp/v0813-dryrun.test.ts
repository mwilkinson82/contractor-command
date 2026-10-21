// 0.8.13 dry-run fixes (tester shots in coach-dryrun): pay app Next move, literal "Why it matters:",
// morning briefing connect check + RFI/submittal logs, IOR top-3 owner/due, one-question pay app cadence.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CADENCE_ITEMS, CADENCE_SETUP_SPEC, IOR_TOP3_RULE, NEXT_MOVES, NEXT_MOVE_RULE, PAY_APP_CADENCE_ASK, PAY_APP_CADENCE_RULE,
  PAY_APP_NEXT_MOVES, PAY_APP_NEXT_MOVE_RULE, PROPOSED_MARK, WHY_LABEL, nextMoveCardLines, nextMoveData, nextMoveGuidance, withNextMove, type CoachStep,
} from "./coach";
import { MORNING_BRIEFING_VIEW_SPEC, NO_OPEN_RFIS, NO_OPEN_SUBMITTALS, isRfiItem, isSubmittalItem, logSection } from "./morning";
import { IOR_VIEW_SPEC, PAY_APP_VIEW_SPEC } from "./views";
import { guide } from "./visible";
import { text } from "./guard";
import { coachStepFor } from "./tools/living-tools";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
type Out = { content: { type: string; text: string }[]; structuredContent: { next_move: ReturnType<typeof nextMoveData>; assistant_guidance: string[] } };
const STEPS: CoachStep[] = ["setup", "cpm", "sov", "notice", "pay_app", "ior", "tia", "briefing"];

describe("1. pay app / SOV billing replies always end with a Next move card", () => {
  const r = withNextMove(guide({ ...text("Pay app #7 preview, period to 2026-11-30"), structuredContent: {} }), "pay_app", guide) as unknown as Out;
  const visible = r.content[0].text;
  it("billing forecast reports map to the pay_app step", () => expect(coachStepFor("billing_forecast", null)).toBe("pay_app"));
  it("the card is in the visible text, after the body and before the footer", () => {
    const lines = nextMoveCardLines("pay_app");
    expect(lines[0]).toBe("Next move: Update the billing forecast and the schedule to the same data date.");
    const at = visible.indexOf(lines[0]);
    expect(at).toBeGreaterThan(visible.indexOf("Pay app #7 preview"));
    expect(at).toBeLessThan(visible.lastIndexOf("Athena powered by ALP"));
    expect(visible).toContain(`${WHY_LABEL} We should line them up`);
    expect(visible).toContain("Yes, let's do it | Not now");
  });
  it("is not added twice", () => {
    const again = withNextMove(r as never, "pay_app", guide) as unknown as Out;
    expect(again.content[0].text.split(nextMoveCardLines("pay_app")[0]).length).toBe(2);
  });
  it("structured data is required and lists only the two allowed moves", () => {
    expect(r.structuredContent.next_move.required).toBe(true);
    expect(r.structuredContent.next_move.allowed_actions).toEqual([...PAY_APP_NEXT_MOVES]);
    expect(PAY_APP_NEXT_MOVES[0]).toBe(NEXT_MOVES.pay_app.action);
    expect(PAY_APP_NEXT_MOVES[1]).toMatch(/^the next billing step/);
  });
  it("rule bans made-up moves and rides in guidance, the pay app view and the server instructions", () => {
    expect(PAY_APP_NEXT_MOVE_RULE).toContain('not "Confirm October billable work"');
    expect(PAY_APP_NEXT_MOVE_RULE).toContain("every host including Claude");
    expect(r.structuredContent.assistant_guidance).toContain(PAY_APP_NEXT_MOVE_RULE);
    expect(PAY_APP_VIEW_SPEC[PAY_APP_VIEW_SPEC.length - 1]).toMatch(/^6\. REQUIRED, last thing in the reply: the Next move card/);
    expect(NEXT_MOVE_RULE).toContain(PAY_APP_NEXT_MOVE_RULE);
    expect(src("./index.ts")).toContain("NEXT_MOVE_RULE");
    expect(nextMoveGuidance("sov").join("\n")).toContain("If this SOV reply is for billing");
  });
});

describe("2. literal 'Why it matters:' label on every Next move card", () => {
  it("rule requires the label word for word", () => {
    expect(WHY_LABEL).toBe("Why it matters:");
    expect(NEXT_MOVE_RULE).toContain('literal label "Why it matters:"');
    expect(NEXT_MOVE_RULE).toContain("never drop or rename it");
  });
  it("every step's card, guidance and data carry it", () => {
    for (const s of STEPS) {
      expect(nextMoveCardLines(s)[1].startsWith(WHY_LABEL)).toBe(true);
      expect(nextMoveGuidance(s)[1]).toContain(` ${WHY_LABEL} we should`);
      expect(nextMoveData(s).why_label).toBe(WHY_LABEL);
    }
  });
});

describe("3. morning briefing: connect check before email, RFI and submittal logs or a labeled empty state", () => {
  const spec = MORNING_BRIEFING_VIEW_SPEC.join("\n");
  it("connect check comes first in the email card", () => {
    const email = MORNING_BRIEFING_VIEW_SPEC.find((l) => l.startsWith("3. Overnight emails"))!;
    expect(email).toMatch(/^3\. Overnight emails: REQUIRED, run the connect check first, before this card/);
    expect(email).toContain('Never say email is "not available" without running this check.');
    const tool = src("./tools/morning-tools.ts");
    expect(tool).toContain("Before the overnight-email card (item 3), run the connect check");
    expect(tool).toContain("connect_check_first: true");
  });
  it("empty lists get explicit labels, never 'not available'", () => {
    expect(logSection("rfi", [], null)).toEqual({ label: NO_OPEN_RFIS, count: 0, items: [], log_text: null });
    expect(logSection("submittal", [], "  ").label).toBe(NO_OPEN_SUBMITTALS);
    expect(spec).toContain('"No open RFIs" / "No open submittals"');
    expect(spec).toContain('Never say RFIs or submittals are "not available".');
  });
  it("returns the logs when there are items or a lookahead log", () => {
    const it1 = { ref: "AB12C", subject: "RFI 14 slab edge", due: "2026-10-22", days_open: 6, ball_in_court: "Architect", source: "open_item" as const };
    expect(logSection("rfi", [it1], null)).toMatchObject({ label: "1 open RFI", count: 1 });
    expect(logSection("submittal", [], "S-03 rebar shop dwgs, open").label).toBe("Open submittals from the lookahead log");
    expect(isRfiItem("Answer RFI 14")).toBe(true);
    expect(isSubmittalItem("Submittal 03 rebar")).toBe(true);
    expect(isSubmittalItem("RFI 14 on submittal")).toBe(false);
  });
  it("the tool reads open items and the latest lookahead logs and shows both lines", () => {
    const tool = src("./tools/morning-tools.ts");
    expect(tool).toContain('from("mcp_open_items")');
    expect(tool).toContain("RFIs: ${b.rfis.label}");
    expect(tool).toContain("Submittals: ${b.submittals.label}");
  });
});

describe("4. IOR top 3 carry an owner and a due date", () => {
  it("unknowns are proposed and marked", () => {
    expect(PROPOSED_MARK).toBe("(proposed)");
    expect(IOR_TOP3_RULE).toContain("shows an owner and a due date");
    expect(IOR_TOP3_RULE).toContain('mark it "(proposed)"');
    expect(IOR_TOP3_RULE).toContain("never present a proposed one as confirmed");
  });
  it("is in the IOR view, the IOR card guidance and the server rule", () => {
    expect(IOR_VIEW_SPEC.join("\n")).toContain(IOR_TOP3_RULE);
    expect(nextMoveGuidance("ior")).toContain(IOR_TOP3_RULE);
    expect(NEXT_MOVE_RULE).toContain(IOR_TOP3_RULE);
    expect(MORNING_BRIEFING_VIEW_SPEC[1]).toContain('"(proposed)"');
  });
});

describe("5. pay app cadence is one question with defaults", () => {
  it("one sentence with defaults, never split", () => {
    expect(PAY_APP_CADENCE_ASK).toBe("Pay apps due the 25th, billing period ends the last day of the month, OK?");
    const e = CADENCE_ITEMS.find((i) => i.key === "pay_app_dates")!;
    expect(e.ask).toBe(PAY_APP_CADENCE_ASK);
    expect(CADENCE_SETUP_SPEC).toContain(PAY_APP_CADENCE_RULE);
    expect(PAY_APP_CADENCE_RULE).toContain("Never split it into separate questions");
    expect(CADENCE_SETUP_SPEC.join("\n")).not.toMatch(/pencil draft day, cutoff and submission day\?/);
  });
});

describe("house rules on the new text", () => {
  const all = [NEXT_MOVE_RULE, PAY_APP_NEXT_MOVE_RULE, IOR_TOP3_RULE, PAY_APP_CADENCE_RULE, ...PAY_APP_VIEW_SPEC, ...MORNING_BRIEFING_VIEW_SPEC, ...PAY_APP_NEXT_MOVES].join("\n");
  it("no 'fragment', no 'prompts', no vendor names, no orange; red only via the alert color", () => {
    expect(all).not.toMatch(/fragment/i);
    expect(all).not.toMatch(/prompt/i);
    expect(all).not.toMatch(/Lovable|Supabase/i);
    expect(all.replace(/no orange/gi, "")).not.toMatch(/orange/i);
    expect(all).not.toMatch(/rose|pink/i);
    for (const f of ["./coach.ts", "./morning.ts", "./views.ts", "./tools/morning-tools.ts"]) expect(src(f)).not.toMatch(/#DC2626/i);
    expect(NEXT_MOVE_RULE).toContain("Athena directs; your AI does the work.");
  });
});
