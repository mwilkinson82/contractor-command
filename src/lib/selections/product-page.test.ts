import { afterEach, describe, expect, it } from "vitest";
import { emptyBoard, type Board, type Option } from "./model";

const blankOption = (): Option => ({
  description: "",
  manufacturer: "",
  model: "",
  specifications: "",
  included: [],
  product_url: null,
  source_url: null,
  photo_url: null,
  found_price_cents: null,
  found_at: "",
  found_on: null,
  cost_cents: null,
  price_cents: null,
  price_reviewed_on: null,
  assumptions: "",
});
import {
  boardFoundMarkup,
  fillFromPages,
  finishOf,
  fromHtml,
  fromShopify,
  readableUrl,
  setPageFetch,
} from "./product-page";

// Shaped like LBC Lighting's WAC H-1023 Exterminator II product JSON (Nov 6, 2026).
const exterminator = {
  title: "WAC H-1023 Exterminator II 22W LED Track Head, H Track",
  variants: [
    { title: "39° / 3000K (90 CRI) / Black", sku: "H-1023F-930-BK", price: "341.95", image_id: 3 },
    {
      title: "39° / 3000K (90 CRI) / Brushed Nickel",
      sku: "H-1023F-930-BN",
      price: "352.95",
      image_id: 1,
    },
    { title: "39° / 3000K (90 CRI) / White", sku: "H-1023F-930-WT", price: "341.95", image_id: 2 },
    { title: "39° / 3000K (85 CRI) / White", sku: "H-1023F-830-WT", price: "330.95", image_id: 2 },
  ],
  images: [
    {
      id: 1,
      src: "https://cdn.shopify.com/s/files/1/0347/products/H-1023N-827-WT_IMRO_1.jpg",
      alt: "WAC H-1023 - Brushed Nickel",
    },
    {
      id: 2,
      src: "https://cdn.shopify.com/s/files/1/0347/products/H-1023N-827-WT_IMRO_2.jpg",
      alt: "WAC H-1023 - White",
    },
    {
      id: 3,
      src: "https://cdn.shopify.com/s/files/1/0347/files/1023bk.jpg",
      alt: "WAC H-1023 - Black",
    },
  ],
};
const option = (o: Partial<Option>): Option => ({ ...blankOption(), ...o });
const white = option({
  description: "WAC Exterminator II 1023, white finish, 24W LED track head",
  manufacturer: "WAC Lighting",
  model: "H-1023F-930",
});

afterEach(() => setPageFetch(null));

describe("reading a seller's product page", () => {
  it("takes the price and photo of the option's own model and finish from a Shopify store", () => {
    expect(fromShopify(exterminator, { model: "H-1023F-930", finish: finishOf(white) })).toEqual({
      photo_url: "https://cdn.shopify.com/s/files/1/0347/products/H-1023N-827-WT_IMRO_2.jpg",
      price_cents: 34195,
    });
    expect(
      fromShopify(exterminator, {
        model: "H-1023F-930",
        finish: finishOf({ description: "black finish", specifications: "" }),
      }),
    ).toEqual({
      photo_url: "https://cdn.shopify.com/s/files/1/0347/files/1023bk.jpg",
      price_cents: 34195,
    });
  });

  it("gives no price when this finish has more than one, and nothing for a finish the store lacks", () => {
    expect(
      fromShopify(exterminator, { model: "H-1023F", finish: finishOf(white) }).price_cents,
    ).toBeNull();
    expect(
      fromShopify(exterminator, {
        model: "H-1023F-930",
        finish: finishOf({ description: "chrome", specifications: "" }),
      }),
    ).toEqual({ photo_url: null, price_cents: null });
  });

  it("matches a photo by its file name when variants carry no image, but never another finish's", () => {
    const noIds = {
      ...exterminator,
      variants: exterminator.variants.map((v) => ({ ...v, image_id: null })),
    };
    expect(fromShopify(noIds, { model: "H-1023F-930", finish: finishOf(white) }).photo_url).toBe(
      "https://cdn.shopify.com/s/files/1/0347/products/H-1023N-827-WT_IMRO_2.jpg",
    );
  });

  it("uses another page's share photo and price only when the page is this finish", () => {
    const page = (title: string) =>
      `<html><head><title>${title}</title><meta property="og:image" content="https://shop.example.com/img/558258.jpg"><meta property="product:price:amount" content="341.95"></head></html>`;
    expect(
      fromHtml(page("Exterminator II Track Head - Black"), { finish: finishOf(white) }),
    ).toEqual({
      photo_url: null,
      price_cents: null,
    });
    expect(
      fromHtml(page("Exterminator II Track Head - White"), { finish: finishOf(white) }),
    ).toEqual({
      photo_url: "https://shop.example.com/img/558258.jpg",
      price_cents: 34195,
    });
  });

  it("reads only public https pages", () => {
    for (const bad of [
      "http://shop.example.com/p",
      "https://127.0.0.1/p",
      "https://localhost/p",
      "https://user:pw@shop.example.com/p",
      "https://shop.example.com:8443/p",
    ])
      expect(readableUrl(bad)).toBeNull();
    expect(readableUrl("https://www.lbclighting.com/products/wac-1023")?.host).toBe(
      "www.lbclighting.com",
    );
  });
});

describe("completing a board from its seller pages", () => {
  const board = (): Board => {
    const b = emptyBoard();
    b.currency = "USD";
    b.selections.push({
      id: "7b849253-57d9-4183-87d0-cf50dc7fd1a8",
      title: "Type A1 white track heads",
      decision_due: null,
      allowance_cents: null,
      quantity: 18,
      unit: "ea",
      estimate_line_ref: "T-4",
      options: {
        good: option({
          description: "WAC Bullet 7010, white finish",
          model: "H-7010-CS",
          photo_url: "https://cdn.shopify.com/7010-WT.png",
          found_price_cents: 3695,
          found_at: "LBC Lighting",
          cost_cents: 3695,
          price_cents: 4065,
          price_reviewed_on: "2026-11-06",
          assumptions: "Cost is the found web price at LBC Lighting; 10% markup.",
        }),
        better: option({
          description: "WAC Charge 8010, white finish",
          model: "H-8010-CS",
          photo_url: "https://cdn.shopify.com/8010-WT.png",
          found_price_cents: 3695,
          found_at: "LBC Lighting",
          cost_cents: 3695,
          price_cents: 4065,
          price_reviewed_on: "2026-11-06",
          assumptions: "Cost is the found web price at LBC Lighting; 10% markup.",
        }),
        best: {
          ...white,
          product_url: "https://www.lbclighting.com/products/wac-1023",
          source_url: "https://www.lightology.com/index.php?module=prod_detail&prod_id=558259",
        },
      },
      selected: null,
      notes: "",
    });
    return b;
  };

  it("finds the member's one markup on found web prices", () => {
    expect(boardFoundMarkup(board())).toBe(10);
    const mixed = board();
    mixed.selections[0].options.better.price_cents = 5000;
    expect(boardFoundMarkup(mixed)).toBeNull();
  });

  it("fills the missing photo and price from the first page that shows them, skipping a blocked one", async () => {
    const seen: string[] = [];
    setPageFetch(async (url) => {
      seen.push(url);
      if (url === "https://www.lbclighting.com/products/wac-1023.json")
        return new Response(JSON.stringify({ product: exterminator }), { status: 200 });
      return new Response("Blocked", { status: 403 });
    });
    const b = board();
    const filled = await fillFromPages(b, "2026-11-06");
    expect(filled).toEqual([
      {
        id: "7b849253-57d9-4183-87d0-cf50dc7fd1a8",
        title: "Type A1 white track heads",
        tier: "best",
        photo: true,
        price: true,
      },
    ]);
    expect(b.selections[0].options.best).toMatchObject({
      photo_url: "https://cdn.shopify.com/s/files/1/0347/products/H-1023N-827-WT_IMRO_2.jpg",
      found_price_cents: 34195,
      found_at: "lbclighting.com",
      found_on: "2026-11-06",
      source_url: "https://www.lbclighting.com/products/wac-1023",
      cost_cents: null,
      price_cents: null,
    });
    // Options that already have both are never fetched.
    expect(seen.every((u) => !u.includes("7010") && !u.includes("8010"))).toBe(true);
  });
});

describe("single-finish Shopify products", () => {
  it("takes the product photo when every variant is the option's finish", () => {
    // Shaped like shopgps.com's Delta 22C351 product JSON (Nov 6, 2026): one Chrome variant, no variant image.
    const p = {
      variants: [{ title: "Chrome", sku: "22C351", price: "229.46", image_id: null }],
      images: [
        {
          id: 9,
          src: "https://cdn.shopify.com/s/files/1/0740/1144/3416/files/22C351-B1.png",
          alt: null,
        },
      ],
    };
    expect(
      fromShopify(p, {
        model: "22C351",
        finish: finishOf({ description: "In chrome.", specifications: "" }),
      }),
    ).toEqual({
      photo_url: "https://cdn.shopify.com/s/files/1/0740/1144/3416/files/22C351-B1.png",
      price_cents: 22946,
    });
  });

  it("still won't guess a photo when the product comes in other finishes", () => {
    const p = {
      variants: [
        { title: "Chrome", sku: "X-CH", price: "100.00", image_id: null },
        { title: "Black", sku: "X-BL", price: "100.00", image_id: null },
      ],
      images: [{ id: 9, src: "https://cdn.example.com/x.png", alt: null }],
    };
    expect(
      fromShopify(p, {
        model: "X",
        finish: finishOf({ description: "Chrome.", specifications: "" }),
      }).photo_url,
    ).toBeNull();
  });
});
