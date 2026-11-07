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
.gbb .gbb-hero{text-align:center;padding:40px var(--pad) 22px}
.gbb .lead{font-size:15px;color:var(--ink-2);max-width:60ch;margin:10px auto 0;line-height:1.45}
.gbb .about{margin:48px var(--pad) 0;padding:28px 0 8px;border-top:1px solid var(--rule)}
.gbb .about h2{font-size:17px;font-weight:600;letter-spacing:-.02em;margin:0 0 8px}
.gbb .about .intro,.gbb .about .how{font-size:15px;line-height:1.55;color:var(--ink-2);max-width:72ch;margin:0 0 10px;letter-spacing:-.01em}
.gbb .eyebrow{font-size:13px;color:var(--ink-2);margin:0 0 10px;font-weight:500;letter-spacing:0;text-transform:none}
.gbb h1{font:600 clamp(32px,5vw,52px)/1.06 inherit;font-family:inherit;letter-spacing:-.035em;margin:0;text-wrap:balance}
.gbb .chosen-note{display:inline-block;margin-top:18px;font-weight:600;font-size:14px;color:var(--ink);background:var(--canvas);border-radius:999px;padding:6px 14px}
.gbb .pair{display:none;justify-content:center;padding:0 16px 16px}
.gbb .seg{display:inline-flex;background:var(--canvas);border-radius:999px;padding:3px}
.gbb .seg label{font-size:13px;padding:7px 13px;border-radius:999px;color:var(--ink-2);cursor:pointer;font-weight:500}
.gbb #pr-gb:checked~.pair label[for=pr-gb],.gbb #pr-bB:checked~.pair label[for=pr-bB],.gbb #pr-gB:checked~.pair label[for=pr-gB]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.gbb .pin{scroll-margin-top:var(--pin-top);position:sticky;top:var(--pin-top);z-index:4;background:rgba(255,255,255,.88);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);border-bottom:1px solid var(--rule);padding-top:16px;padding-bottom:16px}
.gbb .th{display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px;min-width:0}
.gbb .th .tag{font-size:12px;font-weight:600;color:var(--ink-3);min-height:16px}
.gbb .th .tag.rec{color:var(--gold)}
.gbb .th .nm{font-size:24px;font-weight:600;line-height:1.15;letter-spacing:-.025em}
.gbb .th .tot{font-size:15px;font-weight:500;font-variant-numeric:tabular-nums}
.gbb .th .dl{font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.gbb .th .tm{font-size:12px;color:var(--ink-2)}
.gbb .th .gbb-act{margin-top:auto;padding-top:10px}
.gbb .pin .th{padding:10px 6px 12px;border-radius:18px 18px 0 0}
.gbb .line .cols>.col{padding:12px 6px 18px;border-radius:18px}
.gbb .th.chosen .nm::after{content:"  ✓";color:var(--gold)}
.gbb.pick-t1 .t1,.gbb.pick-t2 .t2,.gbb.pick-t3 .t3{background:#eef4ff}
.gbb.pick-t1 .th.t1,.gbb.pick-t2 .th.t2,.gbb.pick-t3 .th.t3{box-shadow:inset 0 3px 0 #2563eb}
.gbb .th .tag.pk{color:#2563eb}
.gbb .btn.on{background:#2563eb;color:#fff;cursor:default}
.gbb .pk-in{position:fixed;top:50%;left:0;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}
.gbb .btn.pk-sel{display:none}
.gbb a.pk-sel{cursor:pointer;box-shadow:0 6px 16px rgba(37,99,235,.28)}
.gbb label.col{display:block;cursor:pointer}
.gbb .cmp{position:relative;isolation:isolate}
.gbb .colbg,.gbb .colring{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));column-gap:32px;padding:0 var(--pad);pointer-events:none}
.gbb .colbg{z-index:-1}.gbb .colring{z-index:6}
.gbb .colbg>div,.gbb .colring>div{margin:-10px -16px -24px;border-radius:26px;opacity:0;transform:scale(.97);transition:opacity .35s ease,transform .35s cubic-bezier(.2,.8,.2,1)}
.gbb .colbg>div{background:#fff;box-shadow:0 22px 44px -26px rgba(15,40,100,.35),0 2px 8px rgba(13,21,38,.05)}
.gbb .colring>div{box-shadow:inset 0 0 0 2px #2563eb}
.gbb #pk-t1:checked~.cmp .t1.cc,.gbb #pk-t2:checked~.cmp .t2.cc,.gbb #pk-t3:checked~.cmp .t3.cc{opacity:1;transform:none}
.gbb .cmp .th,.gbb .cmp .line .cols>.col,.gbb .cmp .row .v{transition:opacity .35s ease,transform .35s cubic-bezier(.2,.8,.2,1)}
.gbb .pk-in:checked~.cmp .th,.gbb .pk-in:checked~.cmp .line .cols>.col,.gbb .pk-in:checked~.cmp .row .v{opacity:.45;transform:scale(.96)}
.gbb #pk-t1:checked~.cmp .t1:is(.th,.col,.v),.gbb #pk-t2:checked~.cmp .t2:is(.th,.col,.v),.gbb #pk-t3:checked~.cmp .t3:is(.th,.col,.v){opacity:1;transform:none}
.gbb .pk-in:checked~.cmp .line-h,.gbb .pk-in:checked~.cmp .row,.gbb .pk-in:checked~.cmp .pin{border-color:transparent}
.gbb .pk-in:checked~.cmp .th .tag.pk{color:#2563eb}
.gbb #pk-t1:checked~.cmp .pin .t1 .pk-go,.gbb #pk-t2:checked~.cmp .pin .t2 .pk-go,.gbb #pk-t3:checked~.cmp .pin .t3 .pk-go{display:none}
.gbb #pk-t1:checked~.cmp .pin .t1 .pk-sel,.gbb #pk-t2:checked~.cmp .pin .t2 .pk-sel,.gbb #pk-t3:checked~.cmp .pin .t3 .pk-sel{display:inline-block;animation:gbb-pk .3s ease-out}
.gbb .pk-in:focus-visible~.cmp .pk-go{outline:2px solid #2563eb;outline-offset:2px}
@keyframes gbb-pk{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
.gbb .btn.on:hover{opacity:1;transform:none}
.gbb .btn{display:inline-block;border:0;cursor:pointer;background:var(--brand);color:var(--brand-ink);text-decoration:none;font:500 14px/1.2 inherit;font-family:inherit;padding:8px 18px;border-radius:999px;transition:transform .2s ease,opacity .2s}
.gbb .btn:hover{opacity:.86;transform:translateY(-1px)}
.gbb .btn.ghost{background:transparent;color:var(--brand);box-shadow:inset 0 0 0 1px var(--rule-2)}
.gbb .line{padding:44px 0 8px}
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
  .gbb .gbb-hero{padding:28px 18px 16px}.gbb .about{margin:36px 18px 0}
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
  /** The package the customer is looking at before they confirm: its column is highlighted. */
  picked?: OptionName | null;
  /**
   * Tap to highlight, then select: tapping a package (its button or its product cards) highlights that column in
   * place, with no reload and no script, and only the highlighted column shows its Select button, which opens the
   * review at this address. Used instead of action while nothing has been chosen.
   */
  pickable?: { select: (tier: OptionName) => string } | null;
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

const tierTag = (
  v: CustomerProposal,
  tier: OptionName,
  chosen: OptionName | null,
  picked: OptionName | null = null,
) =>
  chosen === tier
    ? "Your choice"
    : picked === tier
      ? "Your pick"
      : tier === v.base_tier
        ? "Included"
        : "";

/** The comparison body. The caller supplies the page shell and the footer. */
export function renderCompare(v: CustomerProposal, o: CompareOpts): string {
  const chosen = v.accepted?.tier ?? null;
  const picked = chosen ? null : (o.picked ?? null);
  const price = (c: number) => displayPrice(c, v.currency);
  const plus = (c: number) => (c > 0 ? `+${price(c)}` : price(c));
  const pick = chosen ? null : (o.pickable ?? null);
  const tierN = (t: OptionName) => optionNames.indexOf(t) + 1;
  const pickAct = (t: OptionName) =>
    `<label class="btn ghost pk-go" for="pk-t${tierN(t)}">Choose ${TIER_LABEL[t]}</label>${
      picked === t
        ? `<span class="btn on pk-sel" aria-current="true">Selected</span>`
        : `<a class="btn on pk-sel" href="${esc(pick!.select(t))}">Select ${TIER_LABEL[t]}</a>`
    }`;
  const pin = v.packages
    .map((k, i) => {
      const base = k.tier === v.base_tier;
      const act = pick ? pickAct(k.tier) : (o.action?.(k.tier) ?? null);
      return `<div class="th t${i + 1}${chosen === k.tier ? " chosen" : ""}"><span class="tag${chosen === k.tier ? " rec" : picked === k.tier ? " pk" : ""}">${tierTag(v, k.tier, chosen, picked)}</span><span class="nm">${TIER_LABEL[k.tier]}</span><span class="tot">${esc(price(k.total_cents))}</span><span class="dl">${base ? "Your base price" : `${esc(plus(k.difference_cents))} ${k.difference_cents >= 0 ? "upgrade" : "change"}`}</span>${base ? "" : `<span class="tm">${esc(packageExtras(k, price))}</span>`}${act ? `<div class="gbb-act">${act}</div>` : ""}</div>`;
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
          const tag = pick ? `label for="pk-t${i + 1}"` : "div";
          return `<${tag} class="col t${i + 1}">${photo ? `<span class="ph"><img src="${esc(photo)}" alt="${esc(name)}" loading="lazy" referrerpolicy="no-referrer"></span>` : ""}<div class="mfr">${esc(op.manufacturer || TIER_LABEL[tier])}</div><h3 class="model">${esc(op.model || op.description)}</h3>${num}</${pick ? "label" : "div"}>`;
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
  const lead = chosen
    ? `<p class="chosen-note">You chose ${TIER_LABEL[chosen]}</p>`
    : o.note
      ? `<p class="lead">${esc(o.note)}</p>`
      : "";
  const hero = `<section class="gbb-hero">${o.eyebrow ? `<p class="eyebrow">${esc(o.eyebrow)}</p>` : ""}<h1>${esc(v.title)}</h1>${lead}</section>`;
  const about = `<section class="about"><h2>About this selection</h2>${v.intro ? `<p class="intro">${esc(v.intro)}</p>` : ""}<p class="how">${esc(howUpgradesWork(v, o.underContract))}</p></section>`;
  const pickClass = picked && !pick ? ` pick-t${optionNames.indexOf(picked) + 1}` : "";
  // One continuous card behind the highlighted column, from the package row to the last spec, and its ring on top.
  const cells = optionNames.map((_, i) => `<div class="cc t${i + 1}"></div>`).join("");
  const cardLayers = `<div class="colbg" aria-hidden="true">${cells}</div><div class="colring" aria-hidden="true">${cells}</div>`;
  const pickIn = pick
    ? optionNames
        .map(
          (t, i) =>
            `<input class="pk-in" type="radio" name="gbb-pk" id="pk-t${i + 1}" aria-label="Highlight ${TIER_LABEL[t]}"${picked === t ? " checked" : ""}>`,
        )
        .join("")
    : "";
  return `<div class="gbb${pickClass}"><input class="pr-in" type="radio" name="gbb-pair" id="pr-gb" checked><input class="pr-in" type="radio" name="gbb-pair" id="pr-bB"><input class="pr-in" type="radio" name="gbb-pair" id="pr-gB">${pickIn}${hero}<div class="pair"><div class="seg" role="radiogroup" aria-label="Packages to compare"><label for="pr-gb">Good · Better</label><label for="pr-bB">Better · Best</label><label for="pr-gB">Good · Best</label></div></div><div class="cmp">${pick ? cardLayers : ""}<div class="pin cols" id="gbb-pick">${pin}</div><div>${lines}</div></div>${about}</div>`;
}

/** The contractor's own header: their monogram and name lead; Athena stays in the footer corner. */
export function contractorBar(company: string, sub: string | null, meta: string | null): string {
  return `<header class="gbb-bar"><div class="co"><span class="logo" aria-hidden="true">${esc(monogram(company))}</span><div><div class="co-name">${esc(company)}</div>${sub ? `<div class="co-sub">${esc(sub)}</div>` : ""}</div></div>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}</header>`;
}
