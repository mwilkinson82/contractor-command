import { describe, expect, it } from "vitest";
import athena, { ATHENA_TOOLS } from "./index";
import { inferCard } from "./cards/infer";
import { GAP_CHECK_ROUTE_RULE } from "./estimating";
import { SETUP_NOT_GAP_CHECK } from "./tools/workflow-tools";

describe("job setup vs the estimate gap check", () => {
  it("routes 'walk the gap check' to estimate_gap_answer near the top of the server instructions", () => {
    const ins = String(athena.instructions);
    expect(ins).toContain(GAP_CHECK_ROUTE_RULE);
    expect(ins.indexOf(GAP_CHECK_ROUTE_RULE)).toBeLessThan(2000);
    expect(GAP_CHECK_ROUTE_RULE).toMatch(/Walk the gap check.*estimate_gap_answer/);
    expect(GAP_CHECK_ROUTE_RULE).toMatch(/never next_question/);
  });

  it("names the two tools for what they are", () => {
    const by = (n: string) => ATHENA_TOOLS.find((t) => t.name === n) as { title?: string } | undefined;
    expect(by("next_question")?.title).toBe("Next job setup question");
    expect(by("estimate_gap_answer")?.title).toBe("Gap check walk-through");
    expect(SETUP_NOT_GAP_CHECK).toMatch(/not the estimate gap check.*estimate_gap_answer/);
  });

  it("shows the next setup question as the ask when answer brings it back in the same step", () => {
    const raw =
      "2810 – Recorded: Prime trade contractor, self-performing.\n\nNext question:\nSetup question 4 of 37\nQuestion ref: Q-bonded\n\nIs this job bonded?\n\nAnswer with response yes, no or unknown.";
    const card = inferCard("answer", raw);
    expect(card.state).toBe("ask");
    expect(card.ask?.prompt).toBe("Is this job bonded?");
    expect(card.kpis?.[0]).toMatchObject({ label: "Recorded" });
  });

  it("keeps the plain progress card when there's no next question", () => {
    const card = inferCard("answer", "2810 – Recorded yes.\nNext: next_question.");
    expect(card.state).toBe("progress");
  });
});
