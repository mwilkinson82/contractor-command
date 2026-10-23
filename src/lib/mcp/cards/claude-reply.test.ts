import { describe, expect, it } from "vitest";
import { claudeCardText } from "./claude-reply";
import { verbatimBlock } from "./verbatim";
import { VISIBLE_STYLE_LINE } from "../visible";

describe("Claude display cleanup and exact draft data", () => {
  it.each(["\n", "\r\n"])("does not rewrite quoted draft data with %j line endings", (newline) => {
    const body = [
      "Supplier | reviewer",
      "",
      "",
      "<!doctype html><html>literal email content</html>",
      "REQUIRED VIEW: literal email content",
      "Card shown. Do not add text.",
      VISIBLE_STYLE_LINE,
      "````",
      "Keep  spaces.  ",
    ].join(newline);
    const block = verbatimBlock(body);
    const text = claudeCardText(
      "## Athena\n\n" +
        block +
        "\n\n" +
        VISIBLE_STYLE_LINE +
        "\nREQUIRED VIEW: render the card\n<!doctype html><html>outside-card-sentinel</html>",
    );
    expect(text).toContain(block);
    expect(text).toContain(body);
    expect(text).not.toContain("outside-card-sentinel");
    expect(text).not.toContain("REQUIRED VIEW: render the card");
  });
});
