import { describe, it, expect } from "vitest";
import { displayRef, matchRef, parseQuestionRef, questionRef } from "./refs";
import { visibleProblems } from "./visible";
import { ATHENA_VERSION } from "./server-info-branding";

const items = [
  { id: "36c31f00-0000-4000-8000-000000000001", action: "Send delay notice", check_key: "delay_notice:x" },
  { id: "abcde100-0000-4000-8000-000000000002", action: "A1 – Specs on file", check_key: "setup:bid_specs" },
  { id: "fedcb200-0000-4000-8000-000000000003", action: "Other", check_key: null },
];

describe("plain-text item refs", () => {
  it("shows Ref + checklist label or 5-char code, never a UUID", () => {
    expect(displayRef(items[0])).toBe("Ref 36C31");
    expect(displayRef(items[1])).toBe("Ref A1");
    expect(visibleProblems(`- [Deadline] Send delay notice | ${displayRef(items[0])}`)).toEqual([]);
  });
  it.each(["Ref 36C31", "ref 36c31", "36C31", "#36c31f", "item 36C31", items[0].id])("matchRef(%s)", (r) => expect(matchRef(r, items)).toEqual({ id: items[0].id }));
  it("labels and all-letter codes match", () => {
    expect(matchRef("Ref A1", items)).toEqual({ id: items[1].id });
    expect(matchRef("FEDCB", items)).toEqual({ id: items[2].id });
    expect(matchRef("Item 3", items)).toEqual({ error: "not_found" });
  });
});

describe("question refs", () => {
  it.each(["gate_role_gc", "warranty:workmanship_warranty", "bss_lookahead", "la_resources"])("round-trips %s", (k) => {
    const shown = questionRef(k);
    expect(visibleProblems(`Question ref: ${shown}`)).toEqual([]);
    expect(parseQuestionRef(shown)).toBe(k);
    expect(parseQuestionRef(`Question ref: ${shown}`)).toBe(k);
    expect(parseQuestionRef(k)).toBe(k);
  });
});

describe("leak checks", () => {
  it("flags a raw UUID in visible text", () => expect(visibleProblems(`Item ${items[0].id}`).length).toBeGreaterThan(0));
  it("allows a uuid inside a hosted page link", () => {
    expect(visibleProblems(`Dashboard: [Open the field board](https://app.meetathena.io/r/job/${items[0].id}/field)`)).toEqual([]);
  });
  it("version is 0.8.6", () => expect(ATHENA_VERSION).toBe("0.8.22"));
});

