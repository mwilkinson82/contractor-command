import { describe, it, expect } from "vitest";
import { onboarding, intake, nextQuestion, answer, report, carryForward, listOpenItems, resolveItem } from "./tools/workflow-tools";

// ChatGPT treats any tool without readOnlyHint: true as a write action and asks for confirmation.
const ann = (t: unknown) => (t as { annotations?: Record<string, unknown> }).annotations ?? (t as { config?: { annotations?: Record<string, unknown> } }).config?.annotations;
describe("tool annotations", () => {
  it.each([["onboarding", onboarding], ["intake", intake], ["next_question", nextQuestion], ["answer", answer], ["carry_forward", carryForward], ["resolve_item", resolveItem]])("%s is a write tool", (_n, t) => {
    expect(ann(t)).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  });
  it.each([["report", report], ["list_open_items", listOpenItems]])("%s is read-only", (_n, t) => {
    expect(ann(t)).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });
});
