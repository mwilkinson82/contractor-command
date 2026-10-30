import { describe, expect, it } from "vitest";
import { jobsResponseText, jobsLegacyHtml } from "./jobs-response";
import { READ_RESPONSE_GUIDANCE, TEXT_READ_TOOLS } from "./read-response";
import { NATIVE_CARD_TOOLS } from "./cards/native";
import { attachAthenaCard, isCardFirstTool } from "./cards/attach";

describe("complete read response and old viewer compatibility", () => {
  it("keeps every source job in text and inert compatibility HTML, including unnamed jobs and empty companies", () => {
    const text = jobsResponseText(
      [
        {
          name: "Northline <script>",
          jobs: [
            { job_number: "2708", name: "Library <img src=x>" },
            { job_number: "2710", name: null },
          ],
        },
        { name: "Westbank", jobs: [] },
      ],
      { jobs: 2, companies: 2 },
      true,
    );
    const html = jobsLegacyHtml(text);
    for (const value of ["2708", "2710", "Westbank", "No jobs on file."]) {
      expect(text).toContain(value);
      expect(html).toContain(value);
    }
    expect(html).not.toMatch(/<script>|<img|<iframe|@import|url\(/i);
    expect(html).toContain("&lt;");
    expect(html).toContain("white-space:pre-wrap");
  });
  it.each([...TEXT_READ_TOOLS])("never requires a fresh widget to display %s", (tool) => {
    const result = {
      content: [{ type: "text", text: "Complete source facts: Unknown" }],
      structuredContent: { source: "fixture" },
    };
    expect(NATIVE_CARD_TOOLS.has(tool)).toBe(false);
    expect(isCardFirstTool(tool, result)).toBe(false);
    expect(attachAthenaCard(tool, result)).toBe(result);
  });
  it("requires complete ordinary Markdown without invented search or metric controls", () => {
    expect(READ_RESPONSE_GUIDANCE).toContain("complete supplied text as ordinary Markdown");
    expect(READ_RESPONSE_GUIDANCE).toContain("Do not replace it");
    expect(READ_RESPONSE_GUIDANCE).toContain("keep every source row");
  });
});
