import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AthenaAccountLayout, type AthenaAccountLayoutProps } from "./athena-account-layout";

const fixture: AthenaAccountLayoutProps = {
  name: "Synthetic Owner", email: "owner@example.com", companyName: "Synthetic Company",
  plan: "Athena", seats: "1", teamLoading: false, teamError: false, canViewSupport: false,
  onSignOut: async () => {}, profile: null, company: null, team: null, billing: null,
  projects: null, briefing: null, guide: null,
};
describe("support dashboard navigation", () => {
  it("offers the stable dashboard bookmark to confirmed administrators", () => {
    const html = renderToStaticMarkup(createElement(AthenaAccountLayout, { ...fixture, canViewSupport: true }));
    expect(html).toContain('href="/admin/support"');
    expect(html).toContain("Support");
  });
  it("does not offer the link before administrator access is confirmed", () => {
    const html = renderToStaticMarkup(createElement(AthenaAccountLayout, fixture));
    expect(html).not.toContain('href="/admin/support"');
  });
});