import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancellationActivation,
  cancellationEventMatches,
  cancellationFacts,
  type CancellationSubscription,
} from "./circle-cancellation";
import { renderCancellation } from "./circle-cancellation.server";

const context = {
  periodEnd: "2026-11-01T00:00:00.000Z",
  paidThrough: "2026-11-01T00:00:00.000Z",
  reviewReason: null,
  memberEmail: "synthetic@example.test",
  billingEmail: "synthetic@example.test",
  customerName: "Synthetic Member",
  memberAllowed: true,
  neverEmail: false,
};
const canceledAt = Date.parse("2026-10-04T00:00:00Z") / 1000;
const sub: CancellationSubscription = {
  id: "sub_test",
  status: "active",
  cancel_at_period_end: true,
  canceled_at: canceledAt,
  cancellation_details: { reason: "cancellation_requested" },
};
afterEach(() => vi.unstubAllEnvs());
describe("Circle cancellation lifecycle and copy", () => {
  it("is disabled when missing, malformed, boolean or future activation", () => {
    for (const value of [undefined, "", "true", "2026-10-04", "not-a-date", "2099-01-01T00:00:00Z"])
      expect(cancellationActivation(value)).toBeNull();
  });
  it("uses the same episode for request and paid-period end", () => {
    const request = cancellationFacts(sub, context)!;
    const ended = cancellationFacts(
      { ...sub, status: "canceled", ended_at: canceledAt + 3600 },
      context,
    )!;
    expect(ended.episode).toBe(request.episode);
    expect(request).toMatchObject({ state: "scheduled", effectiveAt: context.periodEnd });
    expect(ended.state).toBe("canceled");
  });
  it("distinguishes a second request after resumption and clears resumed state", () => {
    expect(
      cancellationFacts({ ...sub, cancel_at_period_end: false, canceled_at: null }, context),
    ).toBeNull();
    expect(
      cancellationFacts({ ...sub, canceled_at: canceledAt + 3600 }, context)!.episode,
    ).not.toBe(cancellationFacts(sub, context)!.episode);
  });
  it("does not guess missing anchors or treat dunning as a customer cancellation", () => {
    expect(cancellationFacts({ ...sub, canceled_at: null }, context)).toBeNull();
    for (const reason of ["payment_failed", "payment_disputed"])
      expect(cancellationFacts({ ...sub, cancellation_details: { reason } }, context)).toBeNull();
  });
  it("ignores historical, unrelated and obsolete event snapshots", () => {
    vi.stubEnv("CIRCLE_CANCELLATION_EMAILS_ENABLED_FROM", "2026-10-03T00:00:00Z");
    const facts = cancellationFacts(sub, context)!;
    const event = {
      type: "customer.subscription.updated",
      created: canceledAt,
      data: { object: sub },
    };
    expect(cancellationEventMatches(event, sub, facts)).toBe(true);
    expect(cancellationEventMatches({ ...event, created: canceledAt - 172800 }, sub, facts)).toBe(
      false,
    );
    expect(cancellationEventMatches({ ...event, type: "invoice.paid" }, sub, facts)).toBe(false);
    expect(
      cancellationEventMatches(
        { ...event, data: { object: { ...sub, canceled_at: canceledAt - 100 } } },
        sub,
        facts,
      ),
    ).toBe(false);
  });
  it("renders branded factual member copy with support and Circle options", async () => {
    const rendered = await renderCancellation(cancellationFacts(sub, context)!, false);
    expect(rendered.subject).toBe("Your Contractor Circle cancellation confirmation");
    expect(rendered.html).toContain("contractor-circle-mark.png");
    expect(rendered.html).toContain("/upgrade?tier=circle");
    expect(rendered.text).toContain("UTC");
    expect(rendered.text).toContain("separately granted access");
    expect(rendered.text).toContain("marshall@marshallwilkinson.com");
    expect(rendered.text).not.toMatch(/refund|never showed|no further charges|discount/i);
  });
  it("does not promise immediate loss when immediate cancellation retains verified paid coverage", async () => {
    const facts = cancellationFacts({ ...sub, status: "canceled", ended_at: canceledAt }, context)!;
    const { text } = await renderCancellation(facts, false);
    expect(text).toContain("was canceled");
    expect(text).toContain("Verified paid Circle access");
    expect(text).toContain("November 1, 2026");
  });
  it("does not promise coverage or a refund for disputed/refunded evidence", async () => {
    const facts = cancellationFacts(sub, {
      ...context,
      reviewReason: "paid_invoice_refunded",
      paidThrough: null,
    })!;
    const { text } = await renderCancellation(facts, false);
    expect(text).toContain("paid-access end date is under review");
    expect(text).not.toContain("Verified paid Circle access");
    expect(text).not.toMatch(/refund/i);
  });
  it("owner copy reports supplied reasons safely without inventing participation history", async () => {
    const facts = cancellationFacts(
      { ...sub, cancellation_details: { comment: "<script>bad()</script>" } },
      context,
    )!;
    const rendered = await renderCancellation(facts, true);
    expect(rendered.text).toContain("Synthetic Member");
    expect(rendered.text).toContain("synthetic@example.test");
    expect(rendered.text).toContain("Requested:");
    expect(rendered.text).not.toContain("Reason provided:");
    expect(rendered.html).not.toContain("<script>bad()</script>");
    expect(rendered.text).not.toMatch(/attendance|showed up|missed sessions/i);
  });
});
