// The customer's Good, Better, Best comparison: aligned columns, a pinned tier bar, photo first.
// Shared by the public proposal link and the signed-in customer page. Server-rendered HTML with
// inline CSS only: no scripts, and no link to any maker or store (contractors mark up materials).
import { optionNames, type OptionName } from "./model";
import { TIER_LABEL, type CustomerProposal } from "./proposal";
import { displayPrice } from "./format";
import { timeLabel } from "./change-terms";

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const safePhoto = (u: string | null) => {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

/** Inter, the type contractor names use across Athena. Both customer pages allow Google Fonts in their CSP. */
export const COMPARE_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">`;

/** The blue Athena mark (public/brand/athena/athena-mark-blue.svg), inline so it needs no image request. */
export const ATHENA_MARK_SVG = `<svg class="amark" viewBox="100 132 630 458" aria-hidden="true" focusable="false"><path fill="#2563EB" d="M395 140H540L260 582H108Z"/><path fill="#1D4ED8" d="M459 288H562L721 582H586Z"/><path fill="#DBEAFE" d="M393 404H499L517 443L337 493Z"/></svg>`;

/** "Powered by Athena", small and in the corner: the contractor's brand leads. */
export const poweredByAthena = () =>
  `<span class="gbb-athena">${ATHENA_MARK_SVG}Powered by Athena</span>`;

export const monogram = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "·";

export const COMPARE_CSS = `
.gbb{--ink:#1d1d1f;--ink-2:#6e6e73;--ink-3:#86868b;--rule:#e8e8ed;--rule-2:#d2d2d7;--canvas:#f5f5f7;--gold:#a0743c;--brand:#1d1d1f;--brand-ink:#fff;--pin-top:0px;--n:3;--pad:48px;
  font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-feature-settings:"cv11","ss01";font-size:15px;line-height:1.47;color:var(--ink);letter-spacing:-.011em;-webkit-font-smoothing:antialiased;background:#fff}
.gbb *{box-sizing:border-box}
.gbb .pr-in{position:absolute;opacity:0;pointer-events:none}
.gbb .cols{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));column-gap:32px;padding:0 var(--pad)}
.gbb .gbb-hero{text-align:center;padding:64px var(--pad) 36px}
.gbb .eyebrow{font-size:13px;color:var(--ink-2);margin:0 0 10px;font-weight:500;letter-spacing:0;text-transform:none}
.gbb h1{font:600 clamp(32px,5vw,52px)/1.06 inherit;font-family:inherit;letter-spacing:-.035em;margin:0 0 14px;text-wrap:balance}
.gbb .intro{font-size:19px;line-height:1.42;color:var(--ink-2);max-width:38ch;margin:0 auto;letter-spacing:-.015em}
.gbb .how{font-size:15px;color:var(--ink-2);max-width:52ch;margin:16px auto 0}
.gbb .chosen-note{display:inline-block;margin-top:18px;font-weight:600;font-size:14px;color:var(--ink);background:var(--canvas);border-radius:999px;padding:6px 14px}
.gbb .pair{display:none;justify-content:center;padding:0 16px 16px}
.gbb .seg{display:inline-flex;background:var(--canvas);border-radius:999px;padding:3px}
.gbb .seg label{font-size:13px;padding:7px 13px;border-radius:999px;color:var(--ink-2);cursor:pointer;font-weight:500}
.gbb #pr-gb:checked~.pair label[for=pr-gb],.gbb #pr-bB:checked~.pair label[for=pr-bB],.gbb #pr-gB:checked~.pair label[for=pr-gB]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.gbb .pin{position:sticky;top:var(--pin-top);z-index:4;background:rgba(255,255,255,.88);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);border-bottom:1px solid var(--rule);padding-top:16px;padding-bottom:16px}
.gbb .th{display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px;min-width:0}
.gbb .th .tag{font-size:12px;font-weight:600;color:var(--ink-3);min-height:16px}
.gbb .th .tag.rec{color:var(--gold)}
.gbb .th .nm{font-size:24px;font-weight:600;line-height:1.15;letter-spacing:-.025em}
.gbb .th .tot{font-size:15px;font-weight:500;font-variant-numeric:tabular-nums}
.gbb .th .dl{font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.gbb .th .tm{font-size:12px;color:var(--ink-2)}
.gbb .th .gbb-act{margin-top:10px}
.gbb .th.chosen .nm::after{content:"  ✓";color:var(--gold)}
.gbb .btn{display:inline-block;border:0;cursor:pointer;background:var(--brand);color:var(--brand-ink);text-decoration:none;font:500 14px/1.2 inherit;font-family:inherit;padding:8px 18px;border-radius:999px;transition:transform .2s ease,opacity .2s}
.gbb .btn:hover{opacity:.86;transform:translateY(-1px)}
.gbb .btn.ghost{background:transparent;color:var(--brand);box-shadow:inset 0 0 0 1px var(--rule-2)}
.gbb .line{padding:64px 0 8px}
.gbb .line-h{padding:0 var(--pad) 14px;display:flex;align-items:baseline;justify-content:space-between;gap:16px;border-bottom:1px solid var(--rule-2);margin:0 0 28px}
.gbb .line-h h2{font-size:30px;font-weight:600;line-height:1.1;letter-spacing:-.03em;margin:0}
.gbb .line-h span{font-size:14px;color:var(--ink-2);white-space:nowrap}
.gbb .col{text-align:center;min-width:0}
.gbb .ph{display:block;aspect-ratio:4/3;overflow:hidden;margin:0 auto;max-width:300px}
.gbb .ph img{width:100%;height:100%;object-fit:contain;display:block;transition:transform .6s cubic-bezier(.2,.7,.2,1)}
.gbb .col:hover .ph img{transform:scale(1.04)}
.gbb .mfr{font-size:12px;color:var(--ink-3);margin:20px 0 2px;font-weight:500}
.gbb .model{font-size:17px;font-weight:600;line-height:1.25;letter-spacing:-.02em;margin:0 0 16px;min-height:2.5em;overflow-wrap:anywhere}
.gbb .big{font-size:40px;font-weight:600;line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.gbb .big.inc{font-size:28px;line-height:40px;letter-spacing:-.03em}
.gbb .cap{font-size:13px;color:var(--ink-2);margin-top:6px;font-variant-numeric:tabular-nums}
.gbb .row{border-top:1px solid var(--rule);padding-top:14px;padding-bottom:14px;margin-top:0}
.gbb .rows{margin-top:36px}
.gbb .row .k{grid-column:1/-1;font-size:12px;color:var(--ink-3);text-align:center;margin-bottom:4px}
.gbb .row .v{text-align:center;font-size:14.5px;min-width:0;overflow-wrap:anywhere;white-space:pre-line}
.gbb .row .v.dash{color:var(--ink-3)}
.gbb .row ul{list-style:none;margin:0;padding:0}
.gbb .row li{padding:2px 0}
.gbb .close{margin:72px var(--pad) 0;padding:24px 0;border-top:1px solid var(--rule-2);display:flex;gap:12px 40px;justify-content:space-between;flex-wrap:wrap;font-size:13.5px;color:var(--ink-2);line-height:1.55}
.gbb .close strong{color:var(--ink);font-weight:600}
.gbb .close p{margin:0;max-width:62ch;white-space:pre-line}
.gbb-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px var(--pad);border-bottom:1px solid var(--rule)}
.gbb-bar .co{display:flex;align-items:center;gap:12px;min-width:0}
.gbb-bar .logo{width:40px;height:40px;border-radius:10px;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;font-weight:700;font-size:12px;letter-spacing:.04em;flex:none}
.gbb-bar .co-name{font-weight:600;font-size:17px;line-height:1.2;letter-spacing:-.022em;overflow-wrap:anywhere}
.gbb-bar .co-sub{font-size:13px;color:var(--ink-2);margin-top:1px}
.gbb-bar .meta{text-align:right;font-size:12.5px;color:var(--ink-3);line-height:1.5}
@media (max-width:560px){.gbb-bar{padding:14px 18px}.gbb-bar .meta{display:none}}
.gbb-athena{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#86868b;white-space:nowrap}
.gbb-athena .amark{width:16px;height:12px;flex:none}
@media (prefers-reduced-motion:reduce){.gbb *{transition:none!important}.gbb .col:hover .ph img{transform:none}}
@media (max-width:900px){.gbb{--pad:28px}.gbb .cols{column-gap:20px}.gbb .th .nm{font-size:20px}.gbb .big{font-size:32px}.gbb .big.inc{font-size:22px;line-height:32px}.gbb .model{font-size:15.5px}}
@media (max-width:560px){
  .gbb{--n:2;--pad:18px;font-size:14px}.gbb .cols{column-gap:14px}
  .gbb .gbb-hero{padding:40px 20px 24px}.gbb .intro{font-size:16px}
  .gbb .pair{display:flex}
  .gbb .pin{padding-top:12px;padding-bottom:12px}
  .gbb .th .nm{font-size:18px}.gbb .th .tot{font-size:14px}.gbb .th .dl{font-size:12px}
  .gbb .btn{font-size:13px;padding:7px 14px}
  .gbb .line{padding-top:48px}.gbb .line-h{flex-direction:column;gap:4px;align-items:flex-start}.gbb .line-h h2{font-size:24px}
  .gbb .model{font-size:14px;min-height:3.6em}.gbb .big{font-size:26px}.gbb .big.inc{font-size:19px;line-height:26px}.gbb .cap{font-size:12px}
  .gbb .row .v{font-size:13.5px}
  .gbb #pr-gb:checked~* .t3,.gbb #pr-bB:checked~* .t1,.gbb #pr-gB:checked~* .t2{display:none}
}
`;

export type CompareOpts = {
  company: string;
  /** Wording follows the job: a change order only exists once the job is under contract. */
  underContract: boolean | null;
  /** The tier's action (a button or form), or null for a page that only shows the options. */
  action?: (tier: OptionName) => string | null;
  /** Shown under the intro when there is no action, e.g. where to sign. */
  note?: string | null;
  eyebrow?: string | null;
};

/** How a choice becomes part of the price, in the job's own terms. */
export function howUpgradesWork(v: CustomerProposal, underContract: boolean | null): string {
  const base = TIER_LABEL[v.base_tier];
  return underContract
    ? `Your contract includes ${base}. Choosing another package approves the difference as a change order to your contract, and you see any added time before you sign.`
    : `Your proposal price includes ${base}. Choose another package and its total becomes your proposal price.`;
}

/** Under an upgrade's price: its added time, and any added cost beyond the products and what it is for. */
export function packageExtras(
  k: CustomerProposal["packages"][number],
  price: (c: number) => string,
): string {
  const time = timeLabel(k.schedule_days ?? 0);
  return k.added_cents
    ? `${time} · includes ${price(k.added_cents)}${k.added_note ? ` for ${k.added_note.replace(/\.$/, "")}` : " added cost"}`
    : time;
}

const tierTag = (v: CustomerProposal, tier: OptionName, chosen: OptionName | null) =>
  chosen === tier ? "Your choice" : tier === v.base_tier ? "Included" : "";

/** The comparison body. The caller supplies the page shell and the footer. */
export function renderCompare(v: CustomerProposal, o: CompareOpts): string {
  const chosen = v.accepted?.tier ?? null;
  const price = (c: number) => displayPrice(c, v.currency);
  const plus = (c: number) => (c > 0 ? `+${price(c)}` : price(c));
  const pin = v.packages
    .map((k, i) => {
      const base = k.tier === v.base_tier;
      const act = o.action?.(k.tier) ?? null;
      return `<div class="th t${i + 1}${chosen === k.tier ? " chosen" : ""}"><span class="tag${chosen === k.tier ? " rec" : ""}">${tierTag(v, k.tier, chosen)}</span><span class="nm">${TIER_LABEL[k.tier]}</span><span class="tot">${esc(price(k.total_cents))}</span><span class="dl">${base ? "Your base price" : `${esc(plus(k.difference_cents))} ${k.difference_cents >= 0 ? "upgrade" : "change"}`}</span>${base ? "" : `<span class="tm">${esc(packageExtras(k, price))}</span>`}${act ? `<div class="gbb-act">${act}</div>` : ""}</div>`;
    })
    .join("");
  const lines = v.selections
    .map((s) => {
      const qty = `${s.quantity.toLocaleString("en-US")} ${s.unit}`;
      const heads = optionNames
        .map((tier, i) => {
          const op = s.options[tier];
          const photo = safePhoto(op.photo_url);
          const name = [op.manufacturer, op.model].filter(Boolean).join(" ") || op.description;
          const diff = op.difference_cents;
          const num =
            tier === v.base_tier || diff === 0
              ? `<div class="big inc">Included</div><div class="cap">in your base price</div>`
              : diff === undefined
                ? ""
                : `<div class="big">${esc(plus(Math.round(diff / s.quantity)))}</div><div class="cap">per ${esc(s.unit)} · ${esc(plus(diff))} for all ${esc(qty)}</div>`;
          // A proposal cannot be shared without a photo on every option, so no empty box is drawn.
          return `<div class="col t${i + 1}">${photo ? `<span class="ph"><img src="${esc(photo)}" alt="${esc(name)}" loading="lazy" referrerpolicy="no-referrer"></span>` : ""}<div class="mfr">${esc(op.manufacturer || TIER_LABEL[tier])}</div><h3 class="model">${esc(op.model || op.description)}</h3>${num}</div>`;
        })
        .join("");
      const row = (k: string, cell: (tier: OptionName) => string | null) =>
        `<div class="row cols"><div class="k">${esc(k)}</div>${optionNames
          .map((tier, i) => {
            const c = cell(tier);
            return c
              ? `<div class="v t${i + 1}">${c}</div>`
              : `<div class="v dash t${i + 1}">—</div>`;
          })
          .join("")}</div>`;
      const has = (f: (tier: OptionName) => unknown) => optionNames.some((t) => !!f(t));
      const rows = [
        has((t) => s.options[t].manufacturer && s.options[t].description)
          ? row("About", (t) =>
              s.options[t].manufacturer && s.options[t].description
                ? esc(s.options[t].description)
                : null,
            )
          : "",
        has((t) => s.options[t].specifications)
          ? row("Specifications", (t) =>
              s.options[t].specifications ? esc(s.options[t].specifications) : null,
            )
          : "",
        has((t) => s.options[t].included.length)
          ? row("What's included", (t) =>
              s.options[t].included.length
                ? `<ul>${s.options[t].included.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
                : null,
            )
          : "",
      ].join("");
      return `<section class="line"><div class="line-h"><h2>${esc(s.title)}</h2><span>${esc(qty)} in every package</span></div><div class="cols">${heads}</div>${rows ? `<div class="rows">${rows}</div>` : ""}</section>`;
    })
    .join("");
  const hero = `<section class="gbb-hero">${o.eyebrow ? `<p class="eyebrow">${esc(o.eyebrow)}</p>` : ""}<h1>${esc(v.title)}</h1>${v.intro ? `<p class="intro">${esc(v.intro)}</p>` : ""}<p class="how">${esc(howUpgradesWork(v, o.underContract))}</p>${chosen ? `<p class="chosen-note">You chose ${TIER_LABEL[chosen]}</p>` : o.note ? `<p class="how">${esc(o.note)}</p>` : ""}</section>`;
  return `<div class="gbb"><input class="pr-in" type="radio" name="gbb-pair" id="pr-gb" checked><input class="pr-in" type="radio" name="gbb-pair" id="pr-bB"><input class="pr-in" type="radio" name="gbb-pair" id="pr-gB">${hero}<div class="pair"><div class="seg" role="radiogroup" aria-label="Packages to compare"><label for="pr-gb">Good · Better</label><label for="pr-bB">Better · Best</label><label for="pr-gB">Good · Best</label></div></div><div class="pin cols">${pin}</div><div>${lines}</div></div>`;
}

/** The contractor's own header: their monogram and name lead; Athena stays in the footer corner. */
export function contractorBar(company: string, sub: string | null, meta: string | null): string {
  return `<header class="gbb-bar"><div class="co"><span class="logo" aria-hidden="true">${esc(monogram(company))}</span><div><div class="co-name">${esc(company)}</div>${sub ? `<div class="co-sub">${esc(sub)}</div>` : ""}</div></div>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}</header>`;
}
