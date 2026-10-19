import { describe, expect, test } from "vitest";
import { CLAUSE_ABSENT } from "./tools/workflow-tools";

describe("typed clause absence → flag OFF", () => {
  test.each(["No LDs", "None.", "N/A", "no beneficial use clause", "No liquidated damages", "0%", "not in the contract", "There are no LDs", "no"])("%s means absent", (v) => {
    expect(CLAUSE_ABSENT.test(v)).toBe(true);
  });
  test.each(["10%", "7 days written notice", "No later than 7 days after the event", "$1,500/day, §9.4"])("%s is a real term", (v) => {
    expect(CLAUSE_ABSENT.test(v)).toBe(false);
  });
});
