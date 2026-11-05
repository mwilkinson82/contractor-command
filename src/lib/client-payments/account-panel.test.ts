import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => calls }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: calls } }));
vi.mock("@/lib/client-payments.functions", () => ({
  getClientPaymentsSetup: calls,
  connectClientPayments: calls,
  refreshClientPayments: calls,
  setClientPaymentMode: calls,
}));

import {
  ClientPaymentsPanel,
  ClientPaymentsSection,
} from "@/components/account/client-payments-section";
import type { ClientPaymentsState } from "./account-view";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const panelState = (over: Partial<ClientPaymentsState> = {}): ClientPaymentsState => ({
  can_manage: true,
  mode: "test",
  test: { connected: true, status: "ready" },
  live: { connected: false, status: "not_connected" },
  ready: true,
  card_enabled: true,
  bank_enabled: true,
  card_max_cents: 2_500_000,
  ...over,
});
const panel = (
  state: ClientPaymentsState,
  configured = { test: true, live: false },
  fee = { bps: 50, capCents: 2_500 },
) =>
  renderToStaticMarkup(
    h(ClientPaymentsPanel, {
      companyId: COMPANY,
      state,
      setup: { configured, fee },
      busy: null,
      error: null,
      connect: calls,
      check: calls,
      switchMode: calls,
      load: async () => null,
    }),
  );

describe("Client payments on the account page", () => {
  it("starts with an explainer and nothing to press when there's no company", () => {
    const html = renderToStaticMarkup(h(ClientPaymentsSection, { companyId: null }));
    expect(html).toContain("Get paid from the client page");
    expect(html).toContain("disabled");
    expect(html).toContain("Opens soon.");
  });

  it("walks the owner from test setup to live", () => {
    const fresh = panel(
      panelState({ test: { connected: false, status: "not_connected" }, ready: false }),
    );
    expect(fresh).toContain("Not set up yet");
    expect(fresh).toContain("Set up test payments");
    expect(fresh).toContain("Live payments open soon");
    expect(fresh).not.toContain("Ways your clients can pay");
    expect(fresh).not.toContain("Open Stripe");

    const ready = panel(panelState(), { test: true, live: true });
    expect(ready).toContain("Test mode: no real money moves");
    expect(ready).toContain("Set up live payments");
    expect(ready).toContain("Ways your clients can pay");
    expect(ready).toContain('href="https://dashboard.stripe.com/"');
    expect(ready).toContain("Athena&#x27;s fee is 0.5% of each payment, at most $25.00.");
    expect(ready).not.toContain("Turn on live payments");

    const liveReady = panel(panelState({ live: { connected: true, status: "ready" } }), {
      test: true,
      live: true,
    });
    expect(liveReady).toContain("Turn on live payments");

    const live = panel(panelState({ mode: "live", live: { connected: true, status: "ready" } }), {
      test: true,
      live: true,
    });
    expect(live).toContain("Live: clients can pay");
    expect(live).toContain("Switch back to test");
  });

  it("shows members the status with nothing to change", () => {
    const html = panel(panelState({ can_manage: false }), { test: true, live: true });
    expect(html).toContain("Only the company owner can set up payments.");
    expect(html).not.toContain("Set up live payments");
    expect(html).not.toContain(">Save<");
  });
});
