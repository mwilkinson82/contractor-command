import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSov, sovLineRows } from "./sov";
import { SOV_DELIVERY_ASK, SOV_DELIVERY_STRUCTURED, visibleProblems } from "./visible";
import { ATHENA_VERSION } from "./server-info-branding";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("0.8.4 fixes", () => {
  it("a. use the defaults names every unconfirmed scoping field and moves on to question 2", () => {
    const w = src("./tools/workflow-tools.ts");
    expect(w).toContain('["pricing_model", "pricing model"]');
    expect(w).toContain("Unconfirmed (saved as unknown, not asked again now)");
    expect(w).toContain("Next: next_question (setup question 2, project software)");
  });
  it("a. next_question asks step 0 scoping as question 1 until scope is saved", () => {
    const w = src("./tools/workflow-tools.ts");
    expect(w).toContain("Setup question 1 (Job scoping)");
    expect(w.indexOf("SCOPE_Q1_KEY);")).toBeLessThan(w.indexOf("// Project software is a real setup step"));
  });
  it("b. delivery step is in the report text and structuredContent", () => {
    const w = src("./tools/workflow-tools.ts");
    expect(w).toContain("\\n\\n${sovDeliveryAsk(audience)}\\nFor option 2 or 3:\\n${EMAIL_TO_LABEL_REQUIRED}\\n${ec.text}\\n${EMAIL_VIEW_SPEC.join(\"\\n\")}`");
    expect(w).toContain("delivery: sovDeliveryStructured(audience)");
    expect(SOV_DELIVERY_STRUCTURED.required_next_step).toBe(true);
    expect(SOV_DELIVERY_STRUCTURED.ask).toBe(SOV_DELIVERY_ASK);
    expect(SOV_DELIVERY_STRUCTURED.link_rule).toContain("any audience");
    expect(visibleProblems(SOV_DELIVERY_ASK)).toEqual([]);
  });
  it("c. cost_code is in structuredContent line_items", () => {
    const sov = buildSov([{ item_no: "26.01", description: "Mobilization", scheduled_value: 1000, cost_codes: ["26-010"] }], 0, null);
    expect(sovLineRows(sov)[0].cost_code).toBe("26-010");
  });
  it("version is 0.8.6", () => expect(ATHENA_VERSION).toBe("0.8.20"));
});

