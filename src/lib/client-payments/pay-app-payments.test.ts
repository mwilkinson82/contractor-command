import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import { PayAppPaymentsPanel, type PayAppPaymentsData } from "@/components/athena/PayAppPayments";

const base: PayAppPaymentsData = {
  status: "ok",
  number: "7",
  state: "submitted",
  can_record: true,
  net_due_cents: 1_350_000,
  credits_cents: 0,
  applied_cents: 0,
  pending_cents: 0,
  remaining_cents: 1_350_000,
  recorded: [],
  online: [],
};
const render = (data: PayAppPaymentsData, initialForm = false) =>
  renderToStaticMarkup(
    h(PayAppPaymentsPanel, {
      data,
      busy: false,
      error: "",
      onRecord: async () => true,
      onVoid: async () => true,
      initialForm,
    }),
  );

describe("payments received on a pay application", () => {
  it("offers to record a wire or check while money is still due", () => {
    const html = render(base);
    expect(html).toContain("Payments received");
    expect(html).toContain("Not paid yet");
    expect(html).toContain("$13,500.00");
    expect(html).toContain(">Record a wire or check</button>");
    const form = render(base, true);
    expect(form).toContain("Record a wire or check</h3>");
    expect(form).toContain('value="13500.00"');
    expect(form).toContain("Wire reference");
    expect(form).toContain("$13,500.00 left. A partial payment is fine.");
    expect(form).toContain("Athena charges no fee on wires and checks.");
    expect(form).toContain(">Save payment</button>");
  });

  it("lists what came in, by wire, check and the client page, with what's left", () => {
    const html = render({
      ...base,
      applied_cents: 500_000,
      pending_cents: 250_000,
      remaining_cents: 600_000,
      recorded: [
        {
          id: "r1",
          method: "check",
          amount_cents: 500_000,
          received_on: "2026-11-03",
          reference: "1042",
          note: null,
          recorded_by: "Pat Lee",
          voided: false,
          void_reason: null,
        },
        {
          id: "r2",
          method: "wire",
          amount_cents: 90_000,
          received_on: "2026-11-02",
          reference: "FW-1",
          note: null,
          recorded_by: "Pat Lee",
          voided: true,
          void_reason: "Entered twice",
        },
      ],
      online: [
        {
          status: "processing",
          method: "us_bank_account",
          amount_cents: 250_000,
          updated_at: "2026-11-04T15:00:00Z",
          test: true,
        },
      ],
    });
    expect(html).toContain("Partly paid");
    expect(html).toContain("Check 1042");
    expect(html).toContain("Received Nov 3, 2026 · recorded by Pat Lee");
    expect(html).toContain('class="is-void"');
    expect(html).toContain("Removed: Entered twice");
    expect(html).toContain("Client page by bank (test)");
    expect(html).toContain("clearing");
    expect(html).toContain("$7,500.00");
    expect(html).toContain("$6,000.00");
    expect(html.match(/>Remove<\/button>/g)?.length).toBe(1);
  });

  it("shows paid in full with nothing to record, and waits for a submitted application", () => {
    const paid = render({ ...base, applied_cents: 1_350_000, remaining_cents: 0 });
    expect(paid).toContain("Paid in full");
    expect(paid).not.toContain("Record a wire or check");
    const draft = render({ ...base, can_record: false, state: "draft" });
    expect(draft).toContain("once this application is submitted or certified");
    expect(draft).not.toContain(">Record a wire or check</button>");
    expect(render({ status: "not_found" })).toBe("");
  });
});
