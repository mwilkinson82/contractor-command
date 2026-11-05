import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyBoardLinkCard } from "./company-profile-section";

const id = "11111111-2222-4333-8444-555555555555";
const render = (props: Parameters<typeof CompanyBoardLinkCard>[0]) =>
  renderToStaticMarkup(createElement(CompanyBoardLinkCard, props));

describe("account page Company tab", () => {
  it("shows a loading state, never 'No Athena company yet', while the company is still loading", () => {
    const html = render({ companyId: null, profile: null, loading: true });
    expect(html).toContain("Loading your company");
    expect(html).not.toContain("No Athena company yet");
  });
  it("says there's no company only once loading has finished", () => {
    expect(render({ companyId: null, profile: null, loading: false })).toContain(
      "No Athena company yet",
    );
  });
  it("names the company from the team record before the profile arrives", () => {
    const html = render({ companyId: id, profile: null, companyName: "Synthetic Builders" });
    expect(html).toContain("Synthetic Builders company board");
  });
});
