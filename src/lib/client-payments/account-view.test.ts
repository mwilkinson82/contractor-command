import { describe, expect, it } from "vitest";
import {
  dollarsToCents,
  feeText,
  headline,
  modeAction,
  type ClientPaymentsState,
} from "./account-view";

const state = (over: Partial<ClientPaymentsState> = {}): ClientPaymentsState => ({
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

describe("client payments on the account page", () => {
  it("offers the one next step for each mode", () => {
    expect(modeAction("not_connected", true, "test")).toEqual({
      kind: "connect",
      label: "Set up test payments",
    });
    expect(modeAction("not_connected", true, "live").label).toBe("Set up live payments");
    expect(modeAction("action_required", true, "live").kind).toBe("continue");
    expect(modeAction("restricted", true, "test").kind).toBe("continue");
    expect(modeAction("under_review", true, "test").kind).toBe("check");
    expect(modeAction("ready", true, "test").kind).toBe("none");
    expect(modeAction("not_connected", false, "live")).toEqual({
      kind: "closed",
      label: "Live payments open soon",
    });
  });

  it("says where payments stand", () => {
    expect(headline(null).text).toBe("Not set up yet");
    expect(headline(state()).text).toBe("Test mode: no real money moves");
    expect(headline(state({ mode: "live", live: { connected: true, status: "ready" } })).text).toBe(
      "Live: clients can pay",
    );
    expect(
      headline(state({ ready: false, test: { connected: true, status: "action_required" } })).text,
    ).toBe("Stripe needs more from you");
  });

  it("explains Athena's fee", () => {
    expect(feeText({ bps: 0, capCents: 0 })).toMatch(/^Athena takes no fee/);
    expect(feeText({ bps: 50, capCents: 2_500 })).toBe(
      "Athena's fee is 0.5% of each payment, at most $25.00. It comes out of the payment along with Stripe's own processing fee.",
    );
    expect(feeText({ bps: 25, capCents: 0 })).toMatch(/^Athena's fee is 0.25% of each payment\./);
  });

  it("reads a card limit typed in dollars", () => {
    expect(dollarsToCents("25,000")).toBe(2_500_000);
    expect(dollarsToCents("$1,000.50")).toBe(100_050);
    expect(dollarsToCents("0.5")).toBeNull();
    expect(dollarsToCents("2000000")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
  });
});
