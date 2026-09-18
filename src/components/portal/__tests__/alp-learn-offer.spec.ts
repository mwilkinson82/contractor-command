import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlpLearnOffer, ALP_LEARN_URL } from "../alp-learn-offer";

describe("ALP Learn Hub surface", () => {
  it("sends members to the Learn library from the featured card", () => {
    const html = renderToStaticMarkup(createElement(AlpLearnOffer));
    expect(ALP_LEARN_URL).toBe("https://learn.alpcontractorcircle.com");
    expect(html).toContain(`href="${ALP_LEARN_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain("IOR and AOS live in ALP Learn");
    expect(html).toContain("Open ALP Learn");
  });

  it("adds an external Circle Library nav item to the same URL", () => {
    const source = readFileSync(new URL("../app-sidebar.tsx", import.meta.url), "utf8");
    expect(source).toContain("ALP_LEARN_URL");
    expect(source).toContain('label: "ALP Learn"');
    expect(source).toContain("external: true");
    expect(source).toContain('minTier: "circle"');
  });
});
