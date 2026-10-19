import { describe, it, expect } from "vitest";
import { onboarding, intake, nextQuestion, answer, report, carryForward, listOpenItems, resolveItem, contractTerms } from "./tools/workflow-tools";

// OpenAI plugin review requires explicit booleans on every tool; ChatGPT treats readOnlyHint !== true as a write.
const ann = (t: unknown) => (t as { annotations?: Record<string, unknown> }).annotations ?? (t as { config?: { annotations?: Record<string, unknown> } }).config?.annotations;
const ALL = { onboarding, intake, next_question: nextQuestion, answer, report, carry_forward: carryForward, list_open_items: listOpenItems, resolve_item: resolveItem, contract_terms: contractTerms };
const EXPECTED: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; idempotentHint: boolean }> = {
  onboarding: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  intake: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
  next_question: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  answer: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
  report: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  carry_forward: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  list_open_items: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  resolve_item: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
  contract_terms: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
};
describe("tool annotations", () => {
  it("covers all 9 tools", () => expect(Object.keys(ALL).sort()).toEqual(Object.keys(EXPECTED).sort()));
  it.each(Object.keys(EXPECTED))("%s sets all four hints explicitly", (n) => {
    const a = ann(ALL[n as keyof typeof ALL])!;
    for (const k of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"]) expect(typeof a[k]).toBe("boolean");
    expect(a).toMatchObject(EXPECTED[n]);
  });
  it("read-only tools are never destructive", () => {
    for (const t of Object.values(ALL)) { const a = ann(t)!; if (a.readOnlyHint) expect(a.destructiveHint).toBe(false); }
  });
});
