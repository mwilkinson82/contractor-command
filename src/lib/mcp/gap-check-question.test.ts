import { describe, expect, it } from "vitest";
import { defaultQuestion, titleInSentence } from "./gap-check";

describe("gap question wording", () => {
  it("drops the list code and keeps sheet names, types and acronyms in their case", () => {
    expect(defaultQuestion({ title: "G02 Type E quantity mismatch" })).toBe(
      "Are you carrying type E quantity mismatch, or is it covered somewhere else?",
    );
    expect(titleInSentence("G05 RTU landlord/tenant overlap")).toBe("RTU landlord/tenant overlap");
    expect(titleInSentence("G-12: E1 note conflict")).toBe("E1 note conflict");
    expect(titleInSentence("Temporary power")).toBe("temporary power");
  });

  it("words the owner-capacity question the same way", () => {
    expect(defaultQuestion({ title: "G07 Owner panel capacity", conditional: true })).toBe(
      "If the owner says no, are you carrying owner panel capacity for the whole job, delays included?",
    );
  });
});
