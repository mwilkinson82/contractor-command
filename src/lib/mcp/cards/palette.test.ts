import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALERT, BLUE, GRAY, NAVY, WHITE, cssColor, emptyCssValues, paletteViolations } from "./palette";
import { renderHtml } from "./html";
import { renderMarkdown } from "./markdown";
import { cardWidgetHtml } from "./widget";
import type { CardModel } from "./model";
import { lookaheadView } from "../styled-views";

const quiet: CardModel = {
  state: "progress",
  title: "What I have so far",
  job: "2701 – Harbor Point",
  progress: { done: 2, total: 4 },
  kpis: [{ label: "Known", value: "Pay terms" }],
  sections: [{ heading: "Known", kind: "chips", rows: [{ cells: ["Pay terms"], tone: "known" }, { cells: ["Owner"], tone: "unknown" }] }],
  next_move: "Answer the next question.",
};

const loud: CardModel = {
  state: "result",
  title: "Contract terms",
  alerts: [{ level: "risk", text: "Liquidated damages are on" }],
  sections: [{ heading: "Flags", kind: "table", columns: ["Flag", "Value"], rows: [{ cells: ["Liquidated damages", "ON"], flag: "risk" }] }],
};

describe("palette", () => {
  it("fails when a CSS declaration has an empty value", () => {
    expect(emptyCssValues("body{background: ;color: ;}")).toEqual(["background", "color"]);
    expect(cssColor("", NAVY)).toBe(NAVY);
    expect(cssColor(undefined, BLUE)).toBe(BLUE);
    expect(cssColor("  ", GRAY)).toBe(GRAY);
    const html = renderHtml(quiet);
    const widget = cardWidgetHtml();
    expect(emptyCssValues(html)).toEqual([]);
    expect(emptyCssValues(widget)).toEqual([]);
    expect(html).not.toMatch(/:\s*;/);
    expect(widget).not.toMatch(/:\s*;/);
  });

  it("is navy, brand blue, one gray, white, and alert red", () => {
    expect(NAVY).toBe("#1E3A5F");
    expect(BLUE).toBe("#1E5FED");
    expect(GRAY).toBe("#6B7280");
    expect(GRAY).not.toBe("#9CA3AF");
    expect(WHITE).toBe("#FFFFFF");
    expect(ALERT).toBe("#DC2626");
  });

  it("fails on amber, the retired gray, the old blue, and red outside an alert", () => {
    expect(paletteViolations("#F59E0B", false).length).toBeGreaterThan(0);
    expect(paletteViolations("#9CA3AF", false).length).toBeGreaterThan(0);
    expect(paletteViolations("#2563EB", false).length).toBeGreaterThan(0);
    expect(paletteViolations("⚠ amber", false).length).toBeGreaterThan(0);
    expect(paletteViolations("#DC2626", false).length).toBeGreaterThan(0);
    expect(paletteViolations("🔴 overdue", false).length).toBeGreaterThan(0);
    expect(paletteViolations("#DC2626", true)).toEqual([]);
  });

  it("renders a quiet card with no red and no second gray", () => {
    for (const out of [renderMarkdown(quiet), renderHtml(quiet)]) {
      expect(paletteViolations(out, false)).toEqual([]);
      expect(out).not.toMatch(/#9CA3AF|#2563EB|#F59E0B|⚠|🚚|📋|🚩/);
    }
    expect(renderHtml(quiet)).toContain('data-state="progress"');
    expect(renderMarkdown(quiet)).toContain("What I have so far");
  });

  it("puts red only on delay, risk, or overdue", () => {
    const html = renderHtml(loud);
    const md = renderMarkdown(loud);
    expect(paletteViolations(html, true)).toEqual([]);
    expect(paletteViolations(md, true)).toEqual([]);
    expect(html).toContain('data-alert="risk"');
    expect(html).toContain(ALERT);
    expect(md).toContain("🔴");
  });

  it("keeps the card sources on the palette", () => {
    const files = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const src = files.map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
    expect(src).not.toMatch(/#9CA3AF|#2563EB|#F59E0B|#FBBF24|#D97706|⚠|🚚|📋|🚩/);
  });

  it("the widget gates red and the lookahead markdown drops amber and extra icons", () => {
    const widget = cardWidgetHtml();
    expect(widget).toContain('level==="risk"||level==="delay"||level==="overdue"');
    expect(paletteViolations(widget, true)).toEqual([]);
    const view = lookaheadView({
      title: "2701 – Harbor Point",
      ref: "LA-31BE8",
      start: "2026-10-26",
      end: "2026-11-06",
      dataDate: "2026-10-19",
      acts: [{ id: "A1020", name: "Submit long-lead gear", start: "2026-10-26", finish: "2026-10-28", duration: 3, total_float: 0 }],
      items: [{ action: "Storm delay", owner: "Elena", due: "2026-10-06" }],
      today: "2026-10-21",
    });
    expect(view).not.toMatch(/⚠|🚚|📋|🚩|#9CA3AF|#2563EB|#F59E0B/);
    expect(paletteViolations(view, true)).toEqual([]);
  });
});
