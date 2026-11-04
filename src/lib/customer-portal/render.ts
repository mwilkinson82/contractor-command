// Customer page HTML. Server-rendered, no scripts: every button is a plain form post, so it works on any phone
// and nothing on the page can run code. Look: the accounting suite's light cards and navy ink (approved Nov 4).
import { optionNames } from "../selections/model";
import { CLIENT_BRAND_FONTS, CLIENT_BRAND_NAME_FONT, poweredByAthenaHtml } from "../client-brand";
import { displayPrice } from "../selections/format";
import {
  approvalStatement,
  maskEmail,
  TIER_NAME,
  type ChangeOrderView,
  type InviteOpen,
  type PortalItem,
  type PortalPage,
} from "./model";

export const PORTAL_SECTIONS = [
  "home",
  "updates",
  "photos",
  "schedule",
  "changes",
  "selections",
] as const;
export type PortalSection = (typeof PORTAL_SECTIONS)[number];
const SECTION_LABEL: Record<PortalSection, string> = {
  home: "Home",
  updates: "Updates",
  photos: "Photos",
  schedule: "Schedule",
  changes: "Change orders",
  selections: "Selections",
};

export const PORTAL_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

export const esc = (s: string | null | undefined) =>
  (s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const paras = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

export function longDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
const dayName = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
};
const usd = (c: number) => displayPrice(c, "USD");
const signedUsd = (c: number) => (c > 0 ? `+${usd(c)}` : usd(c));
const days = (n: number | null) =>
  n === null || n === 0
    ? "No change"
    : `${n > 0 ? "+" : ""}${n} ${Math.abs(n) === 1 ? "day" : "days"}`;
const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "·";

const CSS = `
:root{color-scheme:light;--ink:#18314f;--ink-strong:#183b63;--body:#53677d;--muted:#65788e;--line:#dfe7f0;--rule:#e8edf4;--soft:#f8fafd;--head:#edf3fa;--ground:#f5f8fc;--white:#fff;--underline:#9aabbf;--field:#cbd6e3;--ok-ink:#2c6a4b;--ok-soft:#eaf4ee;--ok-line:#c9e3d3;--wait-ink:#7a5310;--wait-soft:#fbf3e4;--wait-line:#efdcb5;--alert-ink:#9f243a;--alert-soft:#fff3f5;--alert-line:#f3c8d0;--font:"Archivo","Helvetica Neue",Arial,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.55 var(--font);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
button,input,textarea{font:inherit;color:inherit}
:is(a,button,input,textarea):focus-visible{outline:3px solid var(--ink);outline-offset:2px}
a{color:var(--ink);font-weight:600;text-decoration:underline;text-decoration-color:var(--underline);text-underline-offset:3px}
.pt{min-height:100vh;display:flex;flex-direction:column}
.pt-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px max(16px,env(safe-area-inset-left)) 14px max(16px,env(safe-area-inset-right));background:var(--white);border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:10px;min-width:0}
.logo-mark{width:34px;height:34px;border-radius:8px;background:var(--ink);color:var(--white);display:grid;place-items:center;flex:none;font-weight:700;font-size:13px;letter-spacing:.04em}
.logo-word{display:grid;line-height:1.15;min-width:0}
.logo-word b{font-family:${CLIENT_BRAND_NAME_FONT};font-size:15.5px;font-weight:600;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.logo-word span{font-size:11px;color:var(--muted)}
.who{display:flex;align-items:center;gap:14px;font-size:13px;color:var(--body)}
.who-name{display:flex;align-items:center;gap:8px}
.avatar{width:28px;height:28px;border-radius:50%;background:var(--head);color:var(--ink);display:grid;place-items:center;font-size:11px;font-weight:700;flex:none}
.linkbtn{border:0;background:none;padding:0;color:var(--ink);font-weight:600;text-decoration:underline;text-decoration-color:var(--underline);text-underline-offset:3px;cursor:pointer}
.wrap{width:100%;max-width:1240px;margin:0 auto;padding:0 max(16px,min(40px,3vw))}
.pt-job{padding-top:26px;padding-bottom:18px;display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 24px}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
h1{margin:0;font-size:clamp(24px,3.2vw,32px);line-height:1.15;font-weight:700;letter-spacing:-.025em;text-wrap:balance}
.sub{margin:6px 0 0;color:var(--body)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--white);white-space:nowrap}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.ok{color:var(--ok-ink);background:var(--ok-soft);border-color:var(--ok-line)}
.pill.wait{color:var(--wait-ink);background:var(--wait-soft);border-color:var(--wait-line)}
.pill.neutral{color:var(--body);background:var(--soft)}
.tabs{position:sticky;top:0;z-index:5;background:var(--ground);border-bottom:1px solid var(--line)}
.tabs .wrap{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.tabs .wrap::-webkit-scrollbar{display:none}
.tab{position:relative;flex:none;padding:12px 12px 13px;font-size:13.5px;font-weight:600;color:var(--body);display:inline-flex;align-items:center;gap:7px;text-decoration:none}
.tab[aria-current=page]{color:var(--ink)}
.tab[aria-current=page]::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;background:var(--ink);border-radius:2px}
.count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--ink);color:var(--white);font-size:11px;font-weight:700;display:inline-grid;place-items:center}
.main{flex:1;padding-top:24px;padding-bottom:36px}
.foot{padding-top:18px;padding-bottom:26px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 18px}
.stack{display:grid;gap:20px;min-width:0}
.grid-home{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}
.rail{display:grid;gap:20px}
.panel{background:var(--white);border:1px solid var(--line);border-radius:14px;box-shadow:0 3px 12px #18345306;padding:22px;min-width:0}
.panel h2{margin:0;font-size:18px;line-height:1.35;font-weight:650;letter-spacing:-.02em}
.panel-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px;margin-bottom:14px}
.meta{font-size:12.5px;color:var(--muted)}
.panel p{margin:0}.panel p+p{margin-top:10px}
.prose{color:var(--body);max-width:68ch}
.empty{color:var(--muted)}
.flash{padding:12px 16px;border-radius:10px;font-weight:600;margin-bottom:18px;border:1px solid var(--ok-line);background:var(--ok-soft);color:var(--ok-ink)}
.flash.err{border-color:var(--alert-line);background:var(--alert-soft);color:var(--alert-ink)}
.decide{border-color:#c9d5e3}
.decide-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;align-items:center;padding:14px 0;border-top:1px solid var(--rule)}
.decide-row:first-child{border-top:0;padding-top:2px}
.decide-row:last-child{padding-bottom:0}
.decide-row h3,.rec h3{margin:0;font-size:15px;font-weight:600;line-height:1.35}
.decide-row .meta,.rec .meta{font-size:13px;color:var(--body);margin-top:2px}
.done-box{display:flex;gap:10px;align-items:center;padding:14px 16px;border-radius:10px;background:var(--ok-soft);border:1px solid var(--ok-line);color:var(--ok-ink);font-weight:600}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:9px 18px;border-radius:8px;border:1px solid var(--ink);background:var(--ink);color:var(--white);font-weight:600;font-size:14px;cursor:pointer;white-space:nowrap;text-decoration:none}
.btn.secondary{background:var(--white);color:var(--ink);border-color:var(--field)}
.btn.block{width:100%}
.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:0}
.kpi{background:var(--white);border:1px solid var(--line);border-radius:12px;padding:15px 17px;min-width:0}
.kpi dt{font-size:12px;color:var(--muted)}
.kpi dd{margin:3px 0 0;font-size:22px;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:var(--ink-strong)}
.miles{list-style:none;margin:0;padding:0;display:grid}
.miles li{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:12px;align-items:start;padding:10px 0;border-top:1px solid var(--rule);font-size:13.5px}
.miles li:first-child{border-top:0;padding-top:0}
.dot{width:12px;height:12px;margin-top:4px;border-radius:50%;border:2px solid var(--underline);background:var(--white)}
.miles .done .dot{background:var(--ink);border-color:var(--ink)}
.miles .next .dot{border-color:var(--ink)}
.miles .when{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.miles .done .what{color:var(--body)}
.contact{display:flex;gap:12px;align-items:center}
.contact .avatar{width:42px;height:42px;font-size:13px}
.contact b{display:block;font-weight:600}
.contact span{font-size:13px;color:var(--body)}
.photos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.photos.home{grid-template-columns:repeat(3,minmax(0,1fr))}
.photo{margin:0;min-width:0}
.photo .img{aspect-ratio:4/3;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:var(--head)}
.photo img{display:block;width:100%;height:100%;object-fit:cover}
.photo figcaption{margin-top:6px;font-size:12.5px;color:var(--body);line-height:1.4}
.photo figcaption span{display:block;color:var(--muted);font-size:11.5px}
.rec{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:center;padding:14px 0;border-top:1px solid var(--rule)}
.rec:first-child{border-top:0;padding-top:0}
.rec:last-child{padding-bottom:0}
.right{display:flex;gap:12px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.money{font-weight:650;font-variant-numeric:tabular-nums}
.update+.update{margin-top:22px;padding-top:22px;border-top:1px solid var(--rule)}
.update h3{margin:0 0 8px;font-size:15px;font-weight:650}
.daily{padding:16px 0;border-top:1px solid var(--rule);display:grid;grid-template-columns:140px minmax(0,1fr);gap:6px 18px}
.daily:first-child{border-top:0;padding-top:0}
.daily .d{font-weight:600}
.daily .d span{display:block;font-weight:400;font-size:12.5px;color:var(--muted)}
.ul{margin:8px 0 0;padding-left:18px;color:var(--body)}
.ul li+li{margin-top:4px}
.tags{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--muted);margin-top:6px}
.co-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px 24px;align-items:flex-start}
.co-head h2{font-size:22px;letter-spacing:-.025em}
.co-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:18px 0 0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.co-sum div{padding:14px 16px;border-left:1px solid var(--line)}
.co-sum div:first-child{border-left:0}
.co-sum dt{font-size:12px;color:var(--muted)}
.co-sum dd{margin:3px 0 0;font-size:20px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.co-cols{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start;margin-top:20px}
h4{margin:18px 0 0;font-size:13px;font-weight:650}
h4:first-child{margin-top:0}
.actions{display:grid;gap:10px}
.fine{font-size:12.5px;color:var(--muted)}
.receipt{margin:0;border:1px solid var(--ok-line);border-radius:12px;overflow:hidden;background:var(--white)}
.receipt-top{padding:14px 16px;background:var(--ok-soft);color:var(--ok-ink);font-weight:650}
.receipt-top.declined{background:var(--soft);color:var(--ink);border-bottom:1px solid var(--line)}
.receipt dl{margin:0;padding:4px 16px 10px}
.receipt dl div{padding:8px 0;border-top:1px solid var(--rule);display:grid;gap:1px;font-size:13px}
.receipt dl div:first-child{border-top:0}
.receipt dt{color:var(--muted);font-size:12px}
.receipt dd{margin:0;overflow-wrap:anywhere}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12px}
.opts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.opt{position:relative;display:flex;flex-direction:column;background:var(--white);border:1px solid var(--line);border-radius:14px;overflow:hidden;min-width:0}
.opt.chosen{border:2px solid var(--ink)}
.opt-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:10px;flex:1}
.tier{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.opt .price{font-size:22px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.opt .price small{display:block;font-size:12px;font-weight:400;color:var(--body);letter-spacing:0}
.opt .spacer{flex:1}
.tag{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--ink);color:var(--white);font-size:12px;font-weight:600;align-self:flex-start}
.tag.quiet{background:var(--white);border:1px solid var(--line);color:var(--body)}
.sel{margin-top:22px}
.sel h3{margin:0;font-size:16px;font-weight:650}
.sel .meta{margin:2px 0 12px}
.choice{display:grid;gap:4px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--white);font-size:13.5px}
.choice img{width:100%;aspect-ratio:3/2;object-fit:contain;background:var(--head);border-radius:8px;margin-bottom:6px}
.choice b{font-weight:650}
.choice span{color:var(--body)}
.choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.signin{min-height:100vh;display:grid;place-items:center;padding:32px 16px}
.card{width:100%;max-width:440px;background:var(--white);border:1px solid var(--line);border-radius:16px;box-shadow:0 10px 30px #18314f12;padding:30px 28px 26px}
.card .logo{margin-bottom:22px}
.card h1{font-size:22px;line-height:1.25}
.card p{margin:8px 0 0;color:var(--body)}
.jobchip{margin:18px 0 20px;padding:12px 14px;border-radius:10px;background:var(--soft);border:1px solid var(--line);display:grid;gap:1px}
.jobchip b{font-weight:600}
.jobchip span{font-size:13px;color:var(--body)}
.field{display:grid;gap:6px;margin-top:14px}
.field label{font-size:13px;font-weight:600}
.hint{font-size:12px;color:var(--muted)}
.input{width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--field);border-radius:8px;font-size:16px;background:var(--white)}
.input.code{font-size:24px;letter-spacing:.5em;text-align:center;font-variant-numeric:tabular-nums;padding-left:calc(12px + .5em)}
.textarea{width:100%;min-height:96px;padding:10px 12px;border:1px solid var(--field);border-radius:8px;font-size:15px;resize:vertical}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:13.5px;cursor:pointer}
.check input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--ink);flex:none}
.card .btn{margin-top:20px}
.secure{margin-top:18px;font-size:12px;color:var(--muted)}
.sum{margin:16px 0 4px;padding:12px 14px;border-radius:10px;background:var(--soft);border:1px solid var(--line);display:grid;gap:4px;font-size:13.5px}
.sum div{display:flex;justify-content:space-between;gap:12px}
.sum span{color:var(--body)}
.sum b{font-variant-numeric:tabular-nums;font-weight:650}
.form-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap}
.statement{margin-top:14px;padding:12px 14px;border-left:3px solid var(--ink);background:var(--soft);font-size:13.5px}
@media (max-width:1000px){.grid-home,.co-cols{grid-template-columns:minmax(0,1fr)}.rail{grid-template-columns:repeat(2,minmax(0,1fr))}.photos{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:640px){
.who-name span:not(.avatar),.logo-word span{display:none}
.pt-job{padding-top:20px;padding-bottom:14px}
.main{padding-top:18px}
.stack{gap:16px}
.rail{grid-template-columns:minmax(0,1fr);gap:16px}
.panel{padding:18px 16px;border-radius:12px}
.panel h2{font-size:17px}
.kpis{grid-template-columns:minmax(0,1fr)}
.kpi{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.kpi dd{font-size:19px;margin:0}
.decide-row,.rec{grid-template-columns:minmax(0,1fr)}
.decide-row .btn{width:100%}
.right{justify-content:flex-start}
.photos,.photos.home{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.photos.home .photo:nth-child(3){display:none}
.opts,.choices{grid-template-columns:minmax(0,1fr)}
.co-sum{grid-template-columns:minmax(0,1fr)}
.co-sum div{border-left:0;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.co-sum div:first-child{border-top:0}
.co-sum dd{font-size:17px;text-align:right}
.daily{grid-template-columns:minmax(0,1fr)}
.form-actions{flex-direction:column-reverse}
.form-actions .btn{width:100%}
.signin{place-items:start center;padding-top:28px}
.card{padding:24px 20px}
}
`;

function doc(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>${CLIENT_BRAND_FONTS}<style>${CSS}</style></head><body>${body}</body></html>`;
}

const logo = (company: string, sub = "Customer page") =>
  `<div class="logo"><span class="logo-mark" aria-hidden="true">${esc(initials(company))}</span><span class="logo-word"><b>${esc(company)}</b><span>${esc(sub)}</span></span></div>`;

// ---------- sign-in ----------

export type InviteStep = "start" | "code";
export function renderInvite(
  info: Extract<InviteOpen, { status: "ok" }>,
  step: InviteStep,
  opts: { error?: string | null; sent?: boolean } = {},
): string {
  const err = opts.error ? `<p class="flash err" role="alert">${esc(opts.error)}</p>` : "";
  const chip = `<div class="jobchip"><b>${esc(info.job_name)}</b><span>Job ${esc(info.job_number)}</span></div>`;
  const body =
    step === "start"
      ? `<h1>Hi ${esc(info.name.split(/\s+/)[0])}, here's your project page</h1><p>${esc(info.company)} shares updates, photos, the schedule and anything that needs your decision here.</p>${chip}${err}<form method="post"><input type="hidden" name="action" value="send_code"><button class="btn block" type="submit">Email me a sign-in code</button></form><p class="secure">We'll send a 6-digit code to ${esc(maskEmail(info.email))}. No password needed.</p>`
      : `<h1>Check your email</h1><p>${opts.sent ? "We sent" : "Enter"} a 6-digit code to ${esc(maskEmail(info.email))}. It works for 10 minutes.</p>${chip}${err}<form method="post"><input type="hidden" name="action" value="verify"><div class="field"><label for="code">Sign-in code</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></div><label class="check"><input type="checkbox" name="remember" value="1"> Keep me signed in on this device for 30 days</label><button class="btn block" type="submit">Sign in</button></form><form method="post" class="resend"><input type="hidden" name="action" value="send_code"><p class="secure">No code? <button class="linkbtn" type="submit">Send a new one</button></p></form>`;
  return doc(
    `${info.job_name} · Sign in`,
    `<main class="signin"><div class="card">${logo(info.company)}${body}</div></main>`,
  );
}

const GONE: Record<string, [string, string]> = {
  unknown: [
    "This link isn't valid",
    "Check that you opened the whole link from your email, or ask your contractor to send a new one.",
  ],
  expired: ["This invite link has expired", "Ask your contractor to send you a new invite."],
  revoked: [
    "This page is no longer shared with you",
    "Your contractor turned off access. Contact them if you think this is a mistake.",
  ],
  closed: ["This page isn't available right now", "Contact your contractor for a new invite."],
  signed_out: ["You're signed out", "Open the invite link from your email to sign in again."],
  error: ["Something went wrong", "Try again in a moment."],
  email_off: [
    "Sign-in codes can't be sent right now",
    "Contact your contractor. Nothing on your project has changed.",
  ],
};
export function renderGone(kind: keyof typeof GONE | string): string {
  const [h, p] = GONE[kind] ?? GONE.unknown!;
  return doc(
    h,
    `<main class="signin"><div class="card"><h1>${esc(h)}</h1><p>${esc(p)}</p></div></main>`,
  );
}

// ---------- portal ----------

export type PortalOpts = {
  section: PortalSection;
  item?: string | null;
  step?: "confirm" | "decline" | null;
  choice?: string | null;
  flash?: string | null;
  error?: string | null;
};

const open = (i: PortalItem) => i.decision === null;
const itemLabel = (i: PortalItem) =>
  i.kind === "change_order" ? `${i.view.number} · ${i.view.title}` : i.view.proposal.title;
const href = (p: PortalPage, section: PortalSection, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams({ s: section, ...extra }).toString();
  return `/c/${p.access_id}?${q}`;
};
const hidden = (p: PortalPage, fields: Record<string, string>) =>
  [
    `<input type="hidden" name="csrf" value="${esc(p.csrf)}">`,
    ...Object.entries(fields).map(
      ([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`,
    ),
  ].join("");

function nextMilestone(p: PortalPage) {
  return p.milestones.find((m) => !m.done) ?? null;
}

function decideBox(p: PortalPage): string {
  const waiting = p.items.filter(open);
  if (!waiting.length)
    return `<section class="panel decide"><div class="panel-head"><h2>Needs your decision</h2></div><div class="done-box">You're all caught up. Nothing needs your decision right now.</div></section>`;
  const rows = waiting
    .map((i) => {
      const section: PortalSection = i.kind === "change_order" ? "changes" : "selections";
      const what =
        i.kind === "change_order"
          ? `Change order · ${usd(i.view.price_cents)} · ${days(i.view.schedule_days)}`
          : `Choose a package · from ${usd(Math.min(...i.view.proposal.packages.map((k) => k.total_cents)))}`;
      const due = i.due_on ? ` · Reply by ${longDate(i.due_on)}` : "";
      return `<div class="decide-row"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">${esc(what + due)}</div></div><a class="btn" href="${esc(href(p, section, { i: i.id }))}">Review</a></div>`;
    })
    .join("");
  return `<section class="panel decide"><div class="panel-head"><h2>Needs your decision</h2><span class="pill wait">${waiting.length} waiting</span></div><div>${rows}</div></section>`;
}

function photoGrid(photos: PortalPage["photos"], cls = ""): string {
  const shown = photos.filter((ph) => ph.url);
  if (!shown.length) return `<p class="empty">No photos shared yet.</p>`;
  return `<div class="photos ${cls}">${shown
    .map(
      (ph) =>
        `<figure class="photo"><div class="img"><img src="${esc(ph.url)}" alt="${esc(ph.work || ph.area || "Progress photo")}" loading="lazy" referrerpolicy="no-referrer"></div><figcaption>${esc(ph.work || ph.area || "Progress photo")}<span>${esc([ph.area && ph.work ? ph.area : null, longDate(ph.taken_on)].filter(Boolean).join(" · "))}</span></figcaption></figure>`,
    )
    .join("")}</div>`;
}

function milestoneList(p: PortalPage, limit?: number): string {
  if (!p.milestones.length) return `<p class="empty">No schedule milestones shared yet.</p>`;
  const next = nextMilestone(p);
  const list = limit ? p.milestones.filter((m) => !m.done).slice(0, limit) : p.milestones;
  if (!list.length) return `<p class="empty">Every milestone is complete.</p>`;
  return `<ul class="miles">${list
    .map(
      (m) =>
        `<li class="${m.done ? "done" : m === next ? "next" : ""}"><span class="dot" aria-hidden="true"></span><span class="what">${esc(m.name)}${m.done ? ' <span class="meta">Done</span>' : ""}</span><span class="when">${esc(longDate(m.date))}</span></li>`,
    )
    .join("")}</ul>`;
}

function contactPanel(p: PortalPage): string {
  const c = p.contractor;
  if (!c.pm_name && !c.pm_email) return "";
  return `<section class="panel"><div class="panel-head"><h2>Your contact</h2></div><div class="contact"><span class="avatar" aria-hidden="true">${esc(initials(c.pm_name || c.name))}</span><div><b>${esc(c.pm_name || c.name)}</b><span>${esc([c.pm_title, c.name].filter(Boolean).join(" · "))}</span></div></div>${c.pm_email ? `<p class="sub"><a href="mailto:${esc(c.pm_email)}">${esc(c.pm_email)}</a></p>` : ""}</section>`;
}

function home(p: PortalPage): string {
  const latest = p.updates[0];
  const done = p.milestones.filter((m) => m.done).length;
  const next = nextMilestone(p);
  const kpis = `<dl class="kpis"><div class="kpi"><dt>Milestones done</dt><dd>${p.milestones.length ? `${done} of ${p.milestones.length}` : "None yet"}</dd></div><div class="kpi"><dt>Next milestone</dt><dd>${esc(next ? longDate(next.date) : "None")}</dd></div><div class="kpi"><dt>Planned finish</dt><dd>${esc(longDate(p.job.completion_date) || "Not set")}</dd></div></dl>`;
  const update = latest
    ? `<section class="panel"><div class="panel-head"><h2>${esc(latest.title)}</h2><span class="meta">Week of ${esc(longDate(latest.week_of))}</span></div><div class="prose">${paras(latest.body)}</div>${p.photos.length ? `<div style="margin-top:16px">${photoGrid(p.photos.slice(0, 3), "home")}</div>` : ""}<p class="sub"><a href="${esc(href(p, "updates"))}">All updates</a></p></section>`
    : `<section class="panel"><div class="panel-head"><h2>This week on your project</h2></div><p class="empty">Your contractor hasn't posted an update yet.</p>${p.photos.length ? `<div style="margin-top:16px">${photoGrid(p.photos.slice(0, 3), "home")}</div>` : ""}</section>`;
  const coming = `<section class="panel"><div class="panel-head"><h2>Coming up</h2><a class="meta" href="${esc(href(p, "schedule"))}">Schedule</a></div>${milestoneList(p, 4)}</section>`;
  return `<div class="grid-home"><div class="stack">${kpis}${decideBox(p)}${update}</div><aside class="rail">${coming}${contactPanel(p)}</aside></div>`;
}

function updates(p: PortalPage): string {
  const ups = p.updates.length
    ? p.updates
        .map(
          (u) =>
            `<article class="update"><p class="eyebrow">Week of ${esc(longDate(u.week_of))}</p><h3>${esc(u.title)}</h3><div class="prose">${paras(u.body)}</div></article>`,
        )
        .join("")
    : `<p class="empty">No weekly updates yet.</p>`;
  const dailies = p.dailies.length
    ? p.dailies
        .map((d) => {
          const work = d.work.filter((w): w is string => !!w && !!w.trim());
          return `<div class="daily"><div class="d">${esc(longDate(d.date))}<span>${esc(dayName(d.date))}</span></div><div>${work.length ? `<ul class="ul">${work.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<span class="empty">Site day logged.</span>`}<div class="tags">${d.weather ? `<span>Weather: ${esc(d.weather)}</span>` : ""}${d.manpower ? `<span>Crew: ${esc(d.manpower)}</span>` : ""}</div></div></div>`;
        })
        .join("")
    : `<p class="empty">No daily reports yet.</p>`;
  return `<div class="stack"><section class="panel"><div class="panel-head"><h2>Weekly updates</h2></div>${ups}</section><section class="panel"><div class="panel-head"><h2>Daily log</h2><span class="meta">Last ${p.dailies.length} site days</span></div>${dailies}</section></div>`;
}

function changeOrderList(p: PortalPage): string {
  const cos = p.items.filter(
    (i): i is Extract<PortalItem, { kind: "change_order" }> => i.kind === "change_order",
  );
  if (!cos.length)
    return `<section class="panel"><div class="panel-head"><h2>Change orders</h2></div><p class="empty">No change orders shared with you.</p></section>`;
  const rows = cos
    .map((i) => {
      const pill = i.decision
        ? i.decision.decision === "approved"
          ? `<span class="pill ok">Approved ${esc(longDate(i.decision.decided_at))}</span>`
          : `<span class="pill neutral">Declined ${esc(longDate(i.decision.decided_at))}</span>`
        : `<span class="pill wait">Needs your decision</span>`;
      return `<div class="rec"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">Shared ${esc(longDate(i.shared_on))} · ${esc(days(i.view.schedule_days))}</div></div><div class="right"><span class="money">${esc(usd(i.view.price_cents))}</span>${pill}<a class="btn secondary" href="${esc(href(p, "changes", { i: i.id }))}">${i.decision ? "View" : "Review"}</a></div></div>`;
    })
    .join("");
  const approved = cos
    .filter((i) => i.decision?.decision === "approved")
    .reduce((s, i) => s + i.view.price_cents, 0);
  return `<section class="panel"><div class="panel-head"><h2>Change orders</h2><span class="meta">Approved so far ${esc(signedUsd(approved))}</span></div>${rows}</section>`;
}

function receipt(i: PortalItem): string {
  const d = i.decision!;
  const what =
    d.decision === "approved"
      ? "Approved"
      : d.decision === "declined"
        ? "Declined"
        : `Chose ${TIER_NAME[d.choice ?? "good"]}`;
  return `<div class="receipt"><div class="receipt-top${d.decision === "declined" ? " declined" : ""}">${esc(what)}</div><dl><div><dt>By</dt><dd>${esc(d.typed_name)}</dd></div><div><dt>When</dt><dd>${esc(new Date(d.decided_at).toUTCString().replace("GMT", "UTC"))}</dd></div>${d.code_verified ? `<div><dt>Confirmed</dt><dd>With a code emailed to you</dd></div>` : ""}${d.note ? `<div><dt>Your note</dt><dd>${esc(d.note)}</dd></div>` : ""}<div><dt>Document fingerprint</dt><dd class="mono">${esc(i.fingerprint)}</dd></div></dl></div>`;
}

function coSummary(v: ChangeOrderView): string {
  return `<dl class="co-sum"><div><dt>Price</dt><dd>${esc(usd(v.price_cents))}</dd></div><div><dt>Schedule</dt><dd>${esc(days(v.schedule_days))}</dd></div><div><dt>Reply by</dt><dd>${esc(v.due_on ? longDate(v.due_on) : "No date")}</dd></div></dl>`;
}

function changeOrderDetail(
  p: PortalPage,
  i: Extract<PortalItem, { kind: "change_order" }>,
  o: PortalOpts,
): string {
  const v = i.view;
  const back = `<p><a href="${esc(href(p, "changes"))}">All change orders</a></p>`;
  const pill = i.decision
    ? i.decision.decision === "approved"
      ? `<span class="pill ok">Approved</span>`
      : `<span class="pill neutral">Declined</span>`
    : `<span class="pill wait">Needs your decision</span>`;
  const statement = approvalStatement({
    kind: "change_order",
    company: p.contractor.name,
    label: itemLabel(i),
    price: usd(v.price_cents),
    scheduleDays: v.schedule_days,
  });
  let side: string;
  if (i.decision) side = receipt(i);
  else if (o.step === "confirm")
    side = `<form method="post" class="panel"><h2>Approve ${esc(v.number)}</h2><p class="sub">We emailed a 6-digit code to ${esc(maskEmail(p.customer.email))}.</p><div class="sum"><div><span>Price</span><b>${esc(usd(v.price_cents))}</b></div><div><span>Schedule</span><b>${esc(days(v.schedule_days))}</b></div></div>${hidden(p, { action: "decide", item: i.id, decision: "approved", fingerprint: i.fingerprint })}<div class="field"><label for="code">Code from your email</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><p class="statement">${esc(statement)}</p><label class="check"><input type="checkbox" name="agree" value="1" required> I agree</label><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "changes", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Approve change order</button></div></form>`;
  else if (o.step === "decline")
    side = `<form method="post" class="panel"><h2>Decline ${esc(v.number)}</h2><p class="sub">${esc(p.contractor.name)} will see your note and follow up.</p>${hidden(p, { action: "decide", item: i.id, decision: "declined", fingerprint: i.fingerprint })}<div class="field"><label for="note">What would you like changed? (optional)</label><textarea class="textarea" id="note" name="note" maxlength="2000"></textarea></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "changes", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Decline change order</button></div></form>`;
  else
    side = `<section class="panel actions"><h2>Your decision</h2><form method="post">${hidden(p, { action: "start", item: i.id })}<button class="btn block" type="submit">Approve</button></form><a class="btn secondary block" href="${esc(href(p, "changes", { i: i.id, step: "decline" }))}">Decline</a><p class="fine">Approving asks for a code we email you and your typed name. Your decision is recorded with the date and time.</p></section>`;
  const main = `<section class="panel"><div class="co-head"><div><p class="eyebrow">Change order · shared ${esc(longDate(i.shared_on))}</p><h2>${esc(itemLabel(i))}</h2></div>${pill}</div>${coSummary(v)}<div style="margin-top:18px">${v.why ? `<h4>Why this change</h4><div class="prose">${paras(v.why)}</div>` : ""}${v.scope ? `<h4>What's included</h4><div class="prose">${paras(v.scope)}</div>` : ""}</div></section>`;
  return `${back}<div class="co-cols"><div class="stack">${main}</div><aside class="stack">${side}</aside></div>`;
}

function selectionsList(p: PortalPage): string {
  const sels = p.items.filter(
    (i): i is Extract<PortalItem, { kind: "selection" }> => i.kind === "selection",
  );
  if (!sels.length)
    return `<section class="panel"><div class="panel-head"><h2>Selections</h2></div><p class="empty">No selections shared with you.</p></section>`;
  return `<section class="panel"><div class="panel-head"><h2>Selections</h2></div>${sels
    .map((i) => {
      const pill = i.decision
        ? `<span class="pill ok">You chose ${TIER_NAME[i.decision.choice ?? "good"]}</span>`
        : `<span class="pill wait">Needs your decision</span>`;
      return `<div class="rec"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">Shared ${esc(longDate(i.shared_on))}${i.due_on ? ` · Prices valid until ${esc(longDate(i.due_on))}` : ""}</div></div><div class="right">${pill}<a class="btn secondary" href="${esc(href(p, "selections", { i: i.id }))}">${i.decision ? "View" : "Review"}</a></div></div>`;
    })
    .join("")}</section>`;
}

function selectionDetail(
  p: PortalPage,
  i: Extract<PortalItem, { kind: "selection" }>,
  o: PortalOpts,
): string {
  const v = i.view.proposal;
  const cur = (c: number) => displayPrice(c, v.currency);
  const chosen = i.decision?.choice ?? null;
  const back = `<p><a href="${esc(href(p, "selections"))}">All selections</a></p>`;
  const pickedTier =
    o.step === "confirm" && optionNames.includes(o.choice as never)
      ? (o.choice as (typeof optionNames)[number])
      : null;
  if (!i.decision && pickedTier) {
    const pk = v.packages.find((k) => k.tier === pickedTier)!;
    const statement = approvalStatement({
      kind: "selection",
      company: p.contractor.name,
      label: v.title,
      price: cur(pk.total_cents),
      choice: TIER_NAME[pickedTier],
    });
    return `${back}<form method="post" class="panel" style="max-width:560px"><h2>Choose ${TIER_NAME[pickedTier]}</h2><p class="sub">We emailed a 6-digit code to ${esc(maskEmail(p.customer.email))}.</p><div class="sum"><div><span>${esc(v.title)}</span><b>${esc(TIER_NAME[pickedTier])}</b></div><div><span>Package total</span><b>${esc(cur(pk.total_cents))}</b></div></div>${hidden(p, { action: "decide", item: i.id, decision: "chosen", choice: pickedTier, fingerprint: i.fingerprint })}<div class="field"><label for="code">Code from your email</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><p class="statement">${esc(statement)}</p><label class="check"><input type="checkbox" name="agree" value="1" required> I agree</label><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "selections", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Confirm my choice</button></div></form>`;
  }
  const cards = v.packages
    .map((k) => {
      const base = k.tier === v.base_tier;
      const isChosen = chosen === k.tier;
      const action = i.decision
        ? ""
        : `<form method="post">${hidden(p, { action: "start", item: i.id, choice: k.tier })}<button class="btn block${base ? "" : " secondary"}" type="submit">Choose ${TIER_NAME[k.tier]}</button></form>`;
      return `<div class="opt${isChosen ? " chosen" : ""}"><div class="opt-body">${isChosen ? `<span class="tag">Your choice</span>` : base ? `<span class="tag quiet">Base proposal</span>` : ""}<span class="tier">${TIER_NAME[k.tier]}</span><div class="price">${esc(cur(k.total_cents))}<small>${base ? "Included in your proposal" : `${esc(k.difference_cents >= 0 ? "+" : "")}${esc(cur(k.difference_cents))} vs. base`}</small></div><div class="spacer"></div>${action}</div></div>`;
    })
    .join("");
  const items = v.selections
    .map((s) => {
      const cells = optionNames
        .map((t) => {
          const op = s.options[t];
          const photo = op.photo_url && /^https:\/\//.test(op.photo_url) ? op.photo_url : null;
          const link = op.product_url && /^https:\/\//.test(op.product_url) ? op.product_url : null;
          return `<div class="choice">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span class="tier">${TIER_NAME[t]}</span><b>${esc(op.manufacturer || op.description)}</b>${op.model ? `<span>${esc(op.model)}</span>` : ""}${op.manufacturer && op.description ? `<span>${esc(op.description)}</span>` : ""}${op.included.length ? `<span>${op.included.map(esc).join(" · ")}</span>` : ""}${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Product details</a>` : ""}</div>`;
        })
        .join("");
      return `<div class="sel"><h3>${esc(s.title)}</h3><p class="meta">${esc(String(s.quantity))} ${esc(s.unit)} in every package</p><div class="choices">${cells}</div></div>`;
    })
    .join("");
  const foot = [v.valid_until ? `Prices valid until ${longDate(v.valid_until)}.` : "", v.terms]
    .filter(Boolean)
    .join("\n\n");
  return `${back}<div class="stack"><section class="panel"><div class="co-head"><div><p class="eyebrow">Selections · shared ${esc(longDate(i.shared_on))}</p><h2>${esc(v.title)}</h2></div>${i.decision ? `<span class="pill ok">You chose ${TIER_NAME[chosen ?? "good"]}</span>` : `<span class="pill wait">Needs your decision</span>`}</div>${v.intro ? `<div class="prose" style="margin-top:10px">${paras(v.intro)}</div>` : ""}</section>${i.decision ? receipt(i) : ""}<div class="opts">${cards}</div><section class="panel">${items}${foot ? `<div class="fine" style="margin-top:18px">${paras(foot)}</div>` : ""}</section></div>`;
}

function body(p: PortalPage, o: PortalOpts): string {
  const it = o.item ? p.items.find((x) => x.id === o.item) : null;
  switch (o.section) {
    case "updates":
      return updates(p);
    case "photos":
      return `<section class="panel"><div class="panel-head"><h2>Photos</h2><span class="meta">${p.photos.length} shared</span></div>${photoGrid(p.photos)}</section>`;
    case "schedule":
      return `<div class="grid-home"><section class="panel"><div class="panel-head"><h2>Milestones</h2>${p.job.completion_date ? `<span class="meta">Planned finish ${esc(longDate(p.job.completion_date))}</span>` : ""}</div>${milestoneList(p)}</section><aside class="rail">${contactPanel(p)}</aside></div>`;
    case "changes":
      return it?.kind === "change_order" ? changeOrderDetail(p, it, o) : changeOrderList(p);
    case "selections":
      return it?.kind === "selection" ? selectionDetail(p, it, o) : selectionsList(p);
    default:
      return home(p);
  }
}

export function renderPortal(p: PortalPage, o: PortalOpts): string {
  const waitingBy = (kind: PortalItem["kind"]) =>
    p.items.filter((i) => i.kind === kind && open(i)).length;
  const count: Partial<Record<PortalSection, number>> = {
    changes: waitingBy("change_order"),
    selections: waitingBy("selection"),
  };
  const tabs = PORTAL_SECTIONS.map(
    (s) =>
      `<a class="tab" href="${esc(href(p, s))}"${s === o.section ? ' aria-current="page"' : ""}>${SECTION_LABEL[s]}${count[s] ? `<span class="count" aria-label="${count[s]} waiting">${count[s]}</span>` : ""}</a>`,
  ).join("");
  const waiting = p.items.filter(open).length;
  const status = waiting
    ? `<span class="pill wait">${waiting} ${waiting === 1 ? "decision" : "decisions"} waiting</span>`
    : `<span class="pill neutral">Up to date</span>`;
  const flash = o.error
    ? `<p class="flash err" role="alert">${esc(o.error)}</p>`
    : o.flash
      ? `<p class="flash" role="status">${esc(o.flash)}</p>`
      : "";
  const top = `<header class="pt-top">${logo(p.contractor.name)}<div class="who"><span class="who-name"><span class="avatar" aria-hidden="true">${esc(initials(p.customer.name))}</span><span>${esc(p.customer.name)}</span></span><form method="post">${hidden(p, { action: "sign_out" })}<button class="linkbtn" type="submit">Sign out</button></form></div></header>`;
  const job = `<div class="wrap pt-job"><div><p class="eyebrow">Job ${esc(p.job.number)}</p><h1>${esc(p.job.name)}</h1></div>${status}</div>`;
  const foot = `<footer class="wrap foot"><span>Shared with ${esc(p.customer.name)} by ${esc(p.contractor.name)}. Only you can see this page.</span>${poweredByAthenaHtml()}</footer>`;
  return doc(
    `${p.job.name} · ${SECTION_LABEL[o.section]}`,
    `<div class="pt">${top}${job}<nav class="tabs" aria-label="Project sections"><div class="wrap">${tabs}</div></nav><main class="wrap main">${flash}${body(p, o)}</main>${foot}</div>`,
  );
}

export { itemLabel };
