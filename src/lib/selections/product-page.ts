// Reads a seller's product page for what a Good, Better, Best option needs and the member's AI
// may have left out: the product photo and the listed price, for the option's own finish.
// Shopify stores answer /products/<handle>.json with every variant (finish, SKU, price, photo);
// other pages give their og:image and product price meta. Nothing is guessed: a page that does
// not show this finish's photo or price gives nothing for it.
import { optionNames, type Board, type Option, type OptionName } from "./model";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

let pageFetch: Fetch = (url, init) => fetch(url, init);
/** Tests swap the network for fixtures. */
export const setPageFetch = (f: Fetch | null) => {
  pageFetch = f ?? ((url, init) => fetch(url, init));
};

const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 6_000;
const MAX_PAGES = 12;

const FINISHES: { name: string; words: RegExp; codes: string[] }[] = [
  { name: "brushed nickel", words: /\bbrushed\s+nickel\b/i, codes: ["BN"] },
  { name: "satin nickel", words: /\bsatin\s+nickel\b/i, codes: ["SN"] },
  { name: "dark bronze", words: /\bdark\s+bronze\b/i, codes: ["DB"] },
  { name: "bronze", words: /\bbronze\b/i, codes: ["BZ"] },
  { name: "white", words: /\bwhite\b/i, codes: ["WT", "WH"] },
  { name: "black", words: /\bblack\b/i, codes: ["BK", "BL"] },
  { name: "chrome", words: /\bchrome\b/i, codes: ["CH"] },
];
type Finish = (typeof FINISHES)[number];

/** The finish an option names, from its customer description first. */
export function finishOf(o: Pick<Option, "description" | "specifications">): Finish | null {
  for (const text of [o.description, o.specifications])
    for (const f of FINISHES) if (f.words.test(text)) return f;
  return null;
}

const hasFinish = (text: string, f: Finish) =>
  f.words.test(text) || f.codes.some((c) => new RegExp(`[-_]${c}(?:[-_.]|$)`, "i").test(text));
const otherFinish = (text: string, f: Finish) =>
  FINISHES.some((g) => g.name !== f.name && !f.name.includes(g.name) && hasFinish(text, g));

/** Public https pages only: no IP addresses, no local names, no credentials. */
export function readableUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes(".") || h.endsWith(".local") || h.endsWith(".internal")) return null;
    if (/^[\d.]+$/.test(h) || h.includes(":") || h === "localhost") return null;
    return u;
  } catch {
    return null;
  }
}

async function fetchText(url: string, accept: string): Promise<string | null> {
  try {
    const res = await pageFetch(url, {
      headers: { accept, "user-agent": "Mozilla/5.0 (compatible; AthenaProductReader/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok || !res.body) return null;
    if (res.url && !readableUrl(res.url)) return null;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      parts.push(value);
    }
    const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return new TextDecoder().decode(all);
  } catch {
    return null;
  }
}

const toCents = (v: unknown): number | null => {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1_000_000_000 ? Math.round(n * 100) : null;
};
const httpsImage = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const u = readableUrl(v.startsWith("//") ? `https:${v}` : v);
  return u ? u.href : null;
};

export type PageRead = { photo_url: string | null; price_cents: number | null; seller: string };

type ShopifyProduct = {
  title?: string;
  variants?: { title?: string; sku?: string | null; price?: string; image_id?: number | null }[];
  images?: { id?: number; src?: string; alt?: string | null; variant_ids?: number[] }[];
};

/** Shopify: pick this model's variants in this finish; one price and one photo, or nothing. */
export function fromShopify(
  p: ShopifyProduct,
  hint: { model: string; finish: Finish | null },
): Omit<PageRead, "seller"> {
  let variants = p.variants ?? [];
  const model = hint.model.trim().toUpperCase();
  if (model) {
    const same = variants.filter((v) => (v.sku ?? "").toUpperCase().startsWith(model));
    if (same.length) variants = same;
  }
  if (hint.finish) {
    const f = hint.finish;
    variants = variants.filter((v) => hasFinish(`${v.title ?? ""} ${v.sku ?? ""}`, f));
  }
  const prices = [...new Set(variants.map((v) => toCents(v.price)))];
  const price_cents = variants.length && prices.length === 1 ? prices[0] : null;
  const images = p.images ?? [];
  const ids = new Set(variants.map((v) => v.image_id).filter((x): x is number => !!x));
  let photo =
    images.find((i) => i.id !== undefined && ids.has(i.id)) ??
    (hint.finish
      ? images.find(
          (i) =>
            hasFinish(`${i.alt ?? ""} ${i.src ?? ""}`, hint.finish!) &&
            !otherFinish(i.alt ?? "", hint.finish!),
        )
      : images[0]);
  if (!variants.length) photo = undefined;
  return { photo_url: httpsImage(photo?.src), price_cents };
}

const metaContent = (html: string, keys: string[]) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i
      .exec(tag)?.[1]
      ?.toLowerCase();
    if (key && keys.includes(key)) {
      const c = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
      if (c) return c.replace(/&amp;/g, "&");
    }
  }
  return null;
};

/** Any other page: its share photo and listed price, used only when the page is this finish. */
export function fromHtml(html: string, hint: { finish: Finish | null }): Omit<PageRead, "seller"> {
  const title = `${metaContent(html, ["og:title", "twitter:title"]) ?? ""} ${/<title[^>]*>([^<]*)/i.exec(html)?.[1] ?? ""}`;
  const image = metaContent(html, ["og:image:secure_url", "og:image", "twitter:image"]);
  const price = metaContent(html, ["product:price:amount", "og:price:amount", "price"]);
  const f = hint.finish;
  const thisFinish = !f || (hasFinish(`${title} ${image ?? ""}`, f) && !otherFinish(title, f));
  return thisFinish
    ? { photo_url: httpsImage(image), price_cents: toCents(price) }
    : { photo_url: null, price_cents: null };
}

const sellerName = (u: URL) => u.hostname.replace(/^www\./, "");

/** Reads one product page for this option's model and finish. Null when the page can't be read. */
export async function readProductPage(raw: string, o: Option): Promise<PageRead | null> {
  const u = readableUrl(raw);
  if (!u) return null;
  const hint = { model: o.model, finish: finishOf(o) };
  const handle = /\/products\/([A-Za-z0-9][A-Za-z0-9_-]{0,200})\/?$/.exec(u.pathname)?.[1];
  if (handle) {
    const body = await fetchText(`https://${u.host}/products/${handle}.json`, "application/json");
    if (body) {
      try {
        const product = (JSON.parse(body) as { product?: ShopifyProduct }).product;
        if (product?.variants?.length)
          return { ...fromShopify(product, hint), seller: sellerName(u) };
      } catch {
        // Not a Shopify product; read the page itself.
      }
    }
  }
  const html = await fetchText(u.href, "text/html");
  return html ? { ...fromHtml(html, hint), seller: sellerName(u) } : null;
}

export type Filled = {
  id: string;
  title: string;
  tier: OptionName;
  photo: boolean;
  price: boolean;
};

/**
 * Fills a missing photo or found price on each option from its own seller or product page.
 * Changes the board in place and returns what it filled. Never touches a cost or sell price.
 */
export async function fillFromPages(
  board: Board,
  today: string,
  only?: { id: string; tier: OptionName }[],
): Promise<Filled[]> {
  const jobs: { s: Board["selections"][number]; tier: OptionName; o: Option }[] = [];
  for (const s of board.selections)
    for (const tier of optionNames) {
      const o = s.options[tier];
      if (!o.description) continue;
      if (only && !only.some((x) => x.id.toLowerCase() === s.id.toLowerCase() && x.tier === tier))
        continue;
      if (!o.photo_url?.startsWith("https://") || o.found_price_cents === null)
        jobs.push({ s, tier, o });
    }
  const cache = new Map<string, Promise<PageRead | null>>();
  const read = (url: string, o: Option) => {
    const key = `${url}|${o.model}|${finishOf(o)?.name ?? ""}`;
    if (!cache.has(key)) {
      if (cache.size >= MAX_PAGES) return Promise.resolve(null);
      cache.set(key, readProductPage(url, o));
    }
    return cache.get(key)!;
  };
  const filled: Filled[] = [];
  await Promise.all(
    jobs.map(async ({ s, tier, o }) => {
      let photo = false;
      let price = false;
      for (const url of [
        ...new Set([o.source_url, o.product_url].filter((x): x is string => !!x)),
      ]) {
        const page = await read(url, o);
        if (!page) continue;
        if (!o.photo_url?.startsWith("https://") && page.photo_url) {
          o.photo_url = page.photo_url;
          photo = true;
        }
        if (o.found_price_cents === null && page.price_cents !== null) {
          o.found_price_cents = page.price_cents;
          o.found_at = page.seller;
          o.found_on = today;
          o.source_url = url;
          price = true;
        }
      }
      if (photo || price) filled.push({ id: s.id, title: s.title, tier, photo, price });
    }),
  );
  return filled;
}

/**
 * The one markup the member put on found web prices across this board (apply_markup with
 * cost_basis found), as a whole or decimal percent, or null when the priced options don't share one.
 */
export function boardFoundMarkup(board: Board): number | null {
  const priced: Option[] = [];
  for (const s of board.selections)
    for (const tier of optionNames) {
      const o = s.options[tier];
      if (o.price_cents !== null && o.price_reviewed_on !== null) priced.push(o);
    }
  if (!priced.length) return null;
  if (
    !priced.every(
      (o) =>
        o.cost_cents !== null &&
        o.cost_cents > 0 &&
        o.cost_cents === o.found_price_cents &&
        o.assumptions.startsWith("Cost is the found web price"),
    )
  )
    return null;
  const first = priced[0];
  const pct =
    Math.round(((first.price_cents! - first.cost_cents!) / first.cost_cents!) * 1000) / 10;
  return priced.every((o) => Math.round((o.cost_cents! * (100 + pct)) / 100) === o.price_cents)
    ? pct
    : null;
}
