import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AthenaAccountLayout, type AthenaAccountLayoutProps } from "./athena-account-layout";
import { setupSteps } from "@/lib/account-profile";
import type { ClientPaymentsState } from "@/lib/client-payments/account-view";

const fixture: AthenaAccountLayoutProps = {
  name: "Synthetic Owner",
  email: "owner@example.com",
  companyName: "Synthetic Company",
  plan: "Athena",
  seats: "1",
  teamLoading: false,
  teamError: false,
  canViewSupport: false,
  onSignOut: async () => {},
  profile: null,
  company: null,
  team: null,
  billing: null,
  projects: null,
  briefing: null,
  guide: null,
};
const profile = {
  id: "c1",
  name: "Synthetic Company",
  logo_url: "https://x.example/logo.png",
  license_number: null,
  contact_name: null,
  contact_phone: null,
  website: null,
  address: null,
};
const connected: ClientPaymentsState = {
  can_manage: true,
  mode: "test",
  test: { connected: true, status: "ready" },
  live: { connected: false, status: "not_connected" },
  ready: true,
  card_enabled: true,
  bank_enabled: true,
  card_max_cents: 2_500_000,
};
const render = (payments: ClientPaymentsState | null) =>
  renderToStaticMarkup(
    createElement(AthenaAccountLayout, {
      ...fixture,
      setup: setupSteps({ profile, members: 2, pending: 0, payments }),
    }),
  );

describe("account overview setup checklist", () => {
  it("shows client payments as not set up, with a Set up button to the payments section", () => {
    const html = render(null);
    expect(html).not.toContain("Coming soon");
    expect(html).not.toMatch(/when they open/);
    expect(html).toContain("Not set up. Connect Stripe");
    expect(html).toMatch(/href="#payments"[^>]*>Set up<\/a>/);
    expect(html).toContain("2 of 3 done");
  });
  it("shows client payments as Connected once Stripe is linked, and counts it", () => {
    const html = render(connected);
    expect(html).toContain('<span class="aa-pill aa-pill-ok">Connected</span>');
    expect(html).toContain("Stripe connected in test mode");
    expect(html).not.toContain(">Set up</a>");
    expect(html).toContain("You&#x27;re set up.");
  });
});
