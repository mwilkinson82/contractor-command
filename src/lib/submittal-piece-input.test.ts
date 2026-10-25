import { describe, expect, it } from "vitest";
import { duplicatePieceWarnings } from "./submittal-piece-input";

describe("duplicate filename wording", () => {
  it.each([2, 3, 4])("names all %i copies without assuming equal content", (count) => {
    const warning = duplicatePieceWarnings(
      Array.from({ length: count }, (_, n) => ({ file_ref: `private/piece-${n}/Document.pdf` })),
    )[0];
    expect(warning.pieces).toEqual(Array.from({ length: count }, (_, n) => `P${n + 1}`));
    expect(warning.message).toContain(`All ${count} copies are kept`);
    expect(warning.message).not.toContain("Both copies");
    expect(warning.message).toContain("Matching names do not confirm matching contents");
  });
});
