import { describe, expect, it } from "vitest";
import {
  CIRCLE_LIVE_MONTHLY_PRICE_ID,
  CIRCLE_LIVE_PRODUCT_ID,
  hubTierForPurchase,
  resendSegmentForPurchase,
} from "@/lib/stripe/paid-product-map";

const emptyEnv = {};

describe("Circle Stripe recognition", () => {
  it("maps the live Lovable monthly price without STRIPE_PRICE_ID_CIRCLE", () => {
    expect(
      hubTierForPurchase({ priceId: CIRCLE_LIVE_MONTHLY_PRICE_ID }, emptyEnv),
    ).toBe("circle");
    expect(
      resendSegmentForPurchase({ priceId: CIRCLE_LIVE_MONTHLY_PRICE_ID }, emptyEnv),
    ).toBe("circle");
  });

  it("maps the live Circle product id", () => {
    expect(hubTierForPurchase({ productId: CIRCLE_LIVE_PRODUCT_ID }, emptyEnv)).toBe("circle");
    expect(resendSegmentForPurchase({ productId: CIRCLE_LIVE_PRODUCT_ID }, emptyEnv)).toBe("circle");
  });

  it("maps the older Circle price and product ids", () => {
    expect(hubTierForPurchase({ priceId: "price_1TiUlGJdDAUSVXbNQRjv1ntA" }, emptyEnv)).toBe("circle");
    expect(hubTierForPurchase({ productId: "prod_UhuaYXyzDSknXg" }, emptyEnv)).toBe("circle");
    expect(hubTierForPurchase({ priceId: "price_1TDR3aJdDAUSVXbNZOY6EXF3" }, emptyEnv)).toBe("circle");
    expect(hubTierForPurchase({ priceId: "price_1TDR3aJdDAUSVXbNWVzFLblo" }, emptyEnv)).toBe("circle");
  });

  it("maps metadata.product/kind circle even when the env price is a different id", () => {
    expect(
      hubTierForPurchase(
        { priceId: CIRCLE_LIVE_MONTHLY_PRICE_ID, metaProduct: "circle" },
        { STRIPE_PRICE_ID_CIRCLE: "price_some_other_env_id" },
      ),
    ).toBe("circle");
    expect(hubTierForPurchase({ metaKind: "circle" }, emptyEnv)).toBe("circle");
  });

  it("does not treat unknown prices as Circle", () => {
    expect(hubTierForPurchase({ priceId: "price_unknown" }, emptyEnv)).toBeNull();
    expect(resendSegmentForPurchase({ priceId: "price_unknown" }, emptyEnv)).toBeNull();
  });
});

describe("handbook / intensive / clinic Resend mapping", () => {
  it("maps book metadata and STRIPE_PRICE_ID_BOOK to the handbook segment", () => {
    expect(resendSegmentForPurchase({ metaProduct: "book_v2" }, emptyEnv)).toBe("handbook");
    expect(
      resendSegmentForPurchase({ priceId: "price_book_env" }, { STRIPE_PRICE_ID_BOOK: "price_book_env" }),
    ).toBe("handbook");
    expect(hubTierForPurchase({ metaProduct: "book" }, emptyEnv)).toBe("book_buyer");
  });

  it("maps intensive metadata and STRIPE_PRICE_ID_INTENSIVE", () => {
    expect(resendSegmentForPurchase({ metaKind: "intensive" }, emptyEnv)).toBe("intensive");
    expect(
      hubTierForPurchase(
        { priceId: "price_intensive_env" },
        { STRIPE_PRICE_ID_INTENSIVE: "price_intensive_env" },
      ),
    ).toBe("intensive");
  });

  it("maps clinic metadata to the clinic segment without creating a hub tier", () => {
    expect(resendSegmentForPurchase({ metaProduct: "clinic" }, emptyEnv)).toBe("clinic");
    expect(hubTierForPurchase({ metaProduct: "clinic" }, emptyEnv)).toBeNull();
  });
});
