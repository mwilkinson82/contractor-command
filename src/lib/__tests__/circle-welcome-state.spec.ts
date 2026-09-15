import { describe, expect, it } from "vitest";
import {
  CIRCLE_WELCOME_TEMPLATE,
  circleWelcomeIdempotencyKey,
  emailSendLogMetadata,
  isUniqueViolation,
  stripeSubscriptionIdFromCircleWelcomeKey,
} from "@/lib/email/circle-welcome-state";

describe("circle welcome send-state helpers", () => {
  it("builds and parses the Stripe subscription idempotency key", () => {
    expect(circleWelcomeIdempotencyKey("sub_1UFu4NJdDAUSVXbNypl54dXg")).toBe(
      "circle-welcome-sub_1UFu4NJdDAUSVXbNypl54dXg",
    );
    expect(
      stripeSubscriptionIdFromCircleWelcomeKey("circle-welcome-sub_1UFu4NJdDAUSVXbNypl54dXg"),
    ).toBe("sub_1UFu4NJdDAUSVXbNypl54dXg");
  });

  it("does not treat admin/backfill keys as Stripe subscription ids", () => {
    expect(
      stripeSubscriptionIdFromCircleWelcomeKey("circle-welcome-backfill-dalton@wtcelectric.com"),
    ).toBeNull();
    expect(
      stripeSubscriptionIdFromCircleWelcomeKey("circle-welcome-admin-dalton@wtcelectric.com-1"),
    ).toBeNull();
    expect(stripeSubscriptionIdFromCircleWelcomeKey("magic-link-sub_x")).toBeNull();
  });

  it("copies idempotency_key onto the sent log metadata", () => {
    expect(
      emailSendLogMetadata({
        idempotencyKey: "circle-welcome-sub_1",
        queue: "transactional_emails",
      }),
    ).toEqual({
      idempotency_key: "circle-welcome-sub_1",
      queue: "transactional_emails",
    });
    expect(emailSendLogMetadata({})).toBeNull();
  });

  it("detects unique-constraint races as duplicates", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ message: "duplicate key value violates unique constraint" })).toBe(
      true,
    );
    expect(isUniqueViolation({ code: "42501", message: "permission denied" })).toBe(false);
  });

  it("keeps the hub mailer template name stable", () => {
    expect(CIRCLE_WELCOME_TEMPLATE).toBe("circle-welcome");
  });
});
