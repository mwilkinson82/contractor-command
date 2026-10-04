import { describe, expect, it, vi } from "vitest";
import { circleResendClient, circleSegmentAction } from "./circle-sync";
import { RESEND_SEGMENT_IDS } from "./segments";
const eligible = {
  email: "member@example.test",
  decision: { state: "eligible" as const, hasAccess: true, reason: "paid_period" },
  suppressed: false,
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe("Circle audience is distinct from access", () => {
  it("suppression excludes marketing while membership stays eligible", () => {
    const input = { ...eligible, suppressed: true };
    expect(circleSegmentAction(input)).toBe("remove");
    expect(input.decision.hasAccess).toBe(true);
  });
  it("never auto-revokes a review case", () => {
    expect(
      circleSegmentAction({
        ...eligible,
        decision: { state: "review", hasAccess: true, reason: "unknown_grace" },
      }),
    ).toBe("review");
  });
  it("removes only the Circle segment, with idempotent missing-membership handling", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "contact_member" }))
      .mockResolvedValueOnce(json({}, 404));
    const client = circleResendClient("synthetic", fetchFn);
    await client.apply({
      ...eligible,
      decision: { state: "ineligible", hasAccess: false, reason: "expired" },
    });
    expect(fetchFn.mock.calls[1][0]).toBe(
      `https://api.resend.com/contacts/contact_member/segments/${RESEND_SEGMENT_IDS.circle}`,
    );
    expect(fetchFn.mock.calls[1][1].method).toBe("DELETE");
    expect(fetchFn.mock.calls.every(([, init]) => !init.body)).toBe(true);
  });
  it("does not re-subscribe an unsubscribed contact", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "contact_member", unsubscribed: true }))
      .mockResolvedValueOnce(json({}));
    await circleResendClient("synthetic", fetchFn).apply(eligible);
    expect(fetchFn.mock.calls.map(([, i]) => i.method)).toEqual(["GET", "DELETE"]);
  });
  it("does not create an unknown contact to remove it", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({}, 404));
    await circleResendClient("synthetic", fetchFn).apply({ ...eligible, suppressed: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("adds an eligible contact without changing suppression fields", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ id: "new" }))
      .mockResolvedValueOnce(json({ id: "new", unsubscribed: false }))
      .mockResolvedValueOnce(json({}));
    await circleResendClient("synthetic", fetchFn).apply(eligible);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({ email: eligible.email });
    expect(fetchFn.mock.calls.at(-1)?.[0]).toContain(`/segments/${RESEND_SEGMENT_IDS.circle}`);
  });
  it("fails visibly on provider errors, including rate limits, and missing credentials", async () => {
    expect(() => circleResendClient("")).toThrow("RESEND_API_KEY");
    await expect(
      circleResendClient("synthetic", vi.fn().mockResolvedValue(json({}, 429))).apply(eligible),
    ).rejects.toThrow("429");
  });
  it("paginates the entire segment", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json({ has_more: true, data: [{ id: "one", email: "one@example.test" }] }),
      )
      .mockResolvedValueOnce(
        json({ has_more: false, data: [{ id: "two", email: "two@example.test" }] }),
      );
    expect(await circleResendClient("synthetic", fetchFn).list()).toHaveLength(2);
    expect(fetchFn.mock.calls[1][0]).toContain("after=one");
  });
});
