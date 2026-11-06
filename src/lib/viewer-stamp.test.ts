import { describe, expect, it } from "vitest";
import { viewerStamp } from "./project-record-feed";

describe("viewerStamp", () => {
  it("reads a saved ISO time as a date and clock, never the raw stamp", () => {
    const out = viewerStamp("2026-11-05T19:31:00.000Z");
    expect(out).not.toContain("T19");
    expect(out).toMatch(/^Nov \d, 2026, \d{1,2}:\d{2} [AP]M/);
  });
  it("leaves text that isn't a time as it was", () => {
    expect(viewerStamp("Not saved yet")).toBe("Not saved yet");
  });
});
