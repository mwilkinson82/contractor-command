import { optionNames } from "./model";
import { TIER_LABEL, type CustomerProposal } from "./proposal";
import { displayPrice } from "./format";

/** Proposal pages may show product photos from https hosts; nothing else loads. */
export const PROPOSAL_PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};

export type ProposalPagePayload = {
  company: string | null;
  job_name: string | null;
  expires_at: string | null;
  proposal: CustomerProposal;
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const safeUrl = (u: string | null) => {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};
const longDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const CSS = `
:root{color-scheme:light dark;--bg:#fbfbfd;--card:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--accent:#0071e3;--chip:#f5f5f7;--ok:#1a7f37}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#161617;--text:#f5f5f7;--muted:#a1a1a6;--line:#424245;--accent:#2997ff;--chip:#1d1d1f;--ok:#3fb950}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.47 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1080px;margin:0 auto;padding:48px 16px 64px}
.eyebrow{color:var(--muted);font-size:14px;letter-spacing:.01em;margin:0 0 8px;text-align:center}
h1{font-size:clamp(32px,5vw,48px);line-height:1.08;letter-spacing:-.015em;font-weight:700;text-align:center;margin:0 auto 12px;max-width:820px}
.intro{color:var(--muted);text-align:center;max-width:680px;margin:0 auto 40px;font-size:19px}
.compare{overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;margin:0 -16px;padding:0 16px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(260px,1fr));gap:20px;min-width:820px}
@media (max-width:860px){.grid{min-width:0;grid-template-columns:repeat(3,82vw)}}
.col{scroll-snap-align:start}
.pkg{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;text-align:center}
.pkg.chosen{border:2px solid var(--accent)}
.tier{font-size:28px;font-weight:700;letter-spacing:-.01em;margin:0}
.badge{display:inline-block;margin-top:8px;font-size:12px;font-weight:600;color:var(--accent);background:var(--chip);border-radius:980px;padding:3px 10px}
.price{font-size:32px;font-weight:600;margin:14px 0 2px;letter-spacing:-.01em}
.diff{color:var(--muted);font-size:15px;margin:0}
.section{margin-top:48px}
.section h2{font-size:24px;font-weight:600;letter-spacing:-.01em;margin:0 0 4px;text-align:center}
.qty{color:var(--muted);text-align:center;margin:0 0 20px;font-size:15px}
.item{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;height:100%;display:flex;flex-direction:column}
.photo{aspect-ratio:4/3;border-radius:12px;background:var(--chip);display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:16px}
.photo img{width:100%;height:100%;object-fit:contain}
.photo span{color:var(--muted);font-size:13px}
.label{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:0}
.name{font-size:19px;font-weight:600;margin:4px 0 2px}
.model{color:var(--muted);font-size:14px;margin:0 0 10px}
.desc{margin:0 0 10px;font-size:15px}
.specs{color:var(--muted);font-size:14px;margin:0 0 12px;white-space:pre-line}
ul{list-style:none;padding:0;margin:0 0 12px;font-size:15px}
li{padding:6px 0 6px 24px;position:relative;border-top:1px solid var(--line)}
li:first-child{border-top:0}
li::before{content:"✓";position:absolute;left:0;color:var(--ok);font-weight:700}
.more{margin-top:auto;font-size:15px;color:var(--accent);text-decoration:none}
.more:hover{text-decoration:underline}
.terms{margin-top:56px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:20px;white-space:pre-line}
.chosen-note{text-align:center;font-weight:600;color:var(--ok);margin:-24px 0 32px}
`;

/** The customer's side-by-side Good, Better, Best page. Holds no cost, margin or notes. */
export function renderProposalDocument(p: ProposalPagePayload): string {
  const v = p.proposal;
  const chosen = v.accepted?.tier ?? null;
  const pkg = v.packages
    .map((k) => {
      const base = k.tier === v.base_tier;
      return `<div class="col"><div class="pkg${chosen === k.tier ? " chosen" : ""}"><p class="tier">${TIER_LABEL[k.tier]}</p>${chosen === k.tier ? '<span class="badge">Your selection</span>' : ""}<p class="price">${esc(displayPrice(k.total_cents, v.currency))}</p><p class="diff">${base ? "Base proposal" : `${k.difference_cents >= 0 ? "+" : ""}${esc(displayPrice(k.difference_cents, v.currency))} vs. base`}</p></div></div>`;
    })
    .join("");
  const sections = v.selections
    .map((s) => {
      const cells = optionNames
        .map((tier) => {
          const o = s.options[tier];
          const photo = safeUrl(o.photo_url);
          const link = safeUrl(o.product_url);
          const name = o.manufacturer || o.description;
          return `<div class="col"><div class="item"><div class="photo">${photo ? `<img src="${esc(photo)}" alt="${esc([o.manufacturer, o.model].filter(Boolean).join(" ") || o.description)}" loading="lazy" referrerpolicy="no-referrer">` : "<span>Photo not available</span>"}</div><p class="label">${TIER_LABEL[tier]}</p><p class="name">${esc(name)}</p>${o.model ? `<p class="model">${esc(o.model)}</p>` : ""}${o.manufacturer && o.description ? `<p class="desc">${esc(o.description)}</p>` : ""}${o.specifications ? `<p class="specs">${esc(o.specifications)}</p>` : ""}${o.included.length ? `<ul>${o.included.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}${link ? `<a class="more" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Product details ›</a>` : ""}</div></div>`;
        })
        .join("");
      return `<section class="section"><h2>${esc(s.title)}</h2><p class="qty">${esc(String(s.quantity))} ${esc(s.unit)} in every package</p><div class="compare"><div class="grid">${cells}</div></div></section>`;
    })
    .join("");
  const foot = [
    v.valid_until ? `Prices valid until ${longDate(v.valid_until)}.` : "",
    v.terms,
    p.expires_at ? `This link expires ${longDate(p.expires_at)}.` : "",
  ]
    .filter(Boolean)
    .map(esc)
    .join("\n\n");
  const eyebrow = [p.company, p.job_name]
    .filter(Boolean)
    .map((x) => esc(x!))
    .join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(v.title)}</title><style>${CSS}</style></head><body><main>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h1>${esc(v.title)}</h1>${v.intro ? `<p class="intro">${esc(v.intro)}</p>` : ""}${chosen ? `<p class="chosen-note">You selected ${TIER_LABEL[chosen]} on ${esc(longDate(v.accepted!.recorded_on))}.</p>` : ""}<div class="compare"><div class="grid">${pkg}</div></div>${sections}${foot ? `<p class="terms">${foot}</p>` : ""}</main></body></html>`;
}

export function proposalGoneHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Proposal not available</title><style>${CSS}</style></head><body><main><h1>This proposal link is no longer available.</h1><p class="intro">Ask your contractor for a new link.</p></main></body></html>`;
}
