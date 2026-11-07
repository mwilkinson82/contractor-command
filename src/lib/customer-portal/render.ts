// Customer page HTML. Server-rendered, no scripts: every button is a plain form post, so it works on any phone
// and nothing on the page can run code. Look: an Athena blue hero over white cards, Inter type, blue actions
// (client page redesign approved by Marshall, Nov 5).
import { optionNames } from "../selections/model";
import { displayPrice } from "../selections/format";
import { COMPARE_CSS, renderCompare } from "../selections/compare-page";
import { timeLabel, timeSentence } from "../selections/change-terms";
import { ATHENA_SUPPORT_MAILTO } from "../login-copy";
import {
  approvalStatement,
  choiceTerms,
  maskEmail,
  payAppLabel,
  preconConsent,
  preconDueLabel,
  preconStatement,
  preconTerms,
  TIER_NAME,
  wholePrice,
  workOrderPrice,
  type ChangeOrderView,
  type InviteOpen,
  type PortalCheck,
  type PayAppView,
  type ServiceInvoiceView,
  type WorkOrderView,
  type PortalItem,
  type PortalPage,
} from "./model";

export const PORTAL_SECTIONS = [
  "home",
  "agreement",
  "updates",
  "photos",
  "schedule",
  "changes",
  "work",
  "selections",
  "billing",
  "messages",
] as const;
export type PortalSection = (typeof PORTAL_SECTIONS)[number];
const SECTION_LABEL: Record<PortalSection, string> = {
  home: "Home",
  agreement: "Agreement",
  updates: "Updates",
  photos: "Photos",
  schedule: "Schedule",
  changes: "Change orders",
  work: "Work orders",
  selections: "Selections",
  billing: "Billing",
  messages: "Messages",
};

export const PORTAL_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://checkout.stripe.com",
  "referrer-policy": "same-origin",
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
/** "Nov 18" for chips and timelines. */
function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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
:root{color-scheme:light;--ink:#0d1526;--ink-strong:#0d1526;--body:#4b5871;--muted:#66728a;--line:#e3e8f0;--rule:#edf1f6;--soft:#f7f9fc;--head:#e9f0fe;--ground:#f3f5f9;--white:#fff;--underline:#a9b6cc;--field:#d3dae6;--accent:#2563eb;--accent-deep:#1d4ed8;--accent-soft:#e9f0fe;--accent-ink:#1e48c4;--ok-ink:#2c6a4b;--ok-soft:#eaf4ee;--ok-line:#c9e3d3;--wait-ink:#7a5310;--wait-soft:#fbf3e4;--wait-line:#efdcb5;--alert-ink:#9f243a;--alert-soft:#fff3f5;--alert-line:#f3c8d0;--font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;background:var(--ground);color:var(--ink);font:14.5px/1.55 var(--font);letter-spacing:-.011em;font-feature-settings:"cv11","ss01";-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
button,input,textarea{font:inherit;color:inherit}
:is(a,button,input,textarea,label):focus-visible{outline:3px solid var(--accent);outline-offset:2px}
a{color:var(--accent-ink);font-weight:600;text-decoration:underline;text-decoration-color:var(--underline);text-underline-offset:3px}
.pt{min-height:100vh;display:flex;flex-direction:column}
.avatar{width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent-ink);display:grid;place-items:center;font-size:11px;font-weight:700;flex:none}
.linkbtn{border:0;background:none;padding:0;color:inherit;font-weight:600;text-decoration:underline;text-decoration-color:var(--underline);text-underline-offset:3px;cursor:pointer}
.wrap{width:100%;max-width:1240px;margin:0 auto;padding:0 max(16px,min(40px,3vw))}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
h1{margin:0;font-size:clamp(24px,3.2vw,32px);line-height:1.15;font-weight:700;letter-spacing:-.025em;text-wrap:balance}
.sub{margin:6px 0 0;color:var(--body)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--white);white-space:nowrap}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.ok{color:var(--ok-ink);background:var(--ok-soft);border-color:var(--ok-line)}
.pill.wait{color:var(--wait-ink);background:var(--wait-soft);border-color:var(--wait-line)}
.pill.neutral{color:var(--body);background:var(--soft)}
.main{flex:1;padding-top:28px;padding-bottom:40px}
.stack{display:grid;gap:20px;min-width:0}
.grid-home{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);gap:20px;align-items:start}
.rail{display:grid;gap:20px}
.panel{background:var(--white);border:1px solid var(--line);border-radius:18px;padding:22px 24px;min-width:0;transition:box-shadow .25s}
.panel:hover{box-shadow:0 10px 30px rgba(15,30,60,.07)}
.panel h2{margin:0;font-size:18px;line-height:1.35;font-weight:650;letter-spacing:-.02em;color:var(--ink)}
.panel-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px;margin-bottom:14px}
.meta{font-size:12.5px;color:var(--muted)}
.panel p{margin:0}.panel p+p{margin-top:10px}
.prose{color:var(--body);max-width:68ch}
.empty{color:var(--muted)}
.flash{padding:12px 16px;border-radius:10px;font-weight:600;margin-bottom:18px;border:1px solid var(--ok-line);background:var(--ok-soft);color:var(--ok-ink)}
.flash.err{border-color:var(--alert-line);background:var(--alert-soft);color:var(--alert-ink)}
.rec h3{margin:0;font-size:15px;font-weight:600;line-height:1.35}
.rec .meta{font-size:13px;color:var(--body);margin-top:2px}
.done-box{display:flex;gap:10px;align-items:center;padding:14px 16px;border-radius:10px;background:var(--ok-soft);border:1px solid var(--ok-line);color:var(--ok-ink);font-weight:600}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:9px 18px;border-radius:999px;border:1px solid var(--accent);background:var(--accent);color:var(--white);font-weight:600;font-size:14px;cursor:pointer;white-space:nowrap;text-decoration:none;transition:background .2s,transform .2s,box-shadow .2s}
.btn:not(.gbb *):hover{background:var(--accent-deep);border-color:var(--accent-deep);transform:translateY(-1px);box-shadow:0 6px 16px rgba(37,99,235,.28)}
.btn.secondary{background:var(--white);color:var(--ink);border-color:var(--field)}
.btn.secondary:hover{background:var(--soft);border-color:var(--underline);box-shadow:none}
.btn.block{width:100%}
.resend{margin:0;padding:0 4px}
.linkish{background:none;border:0;padding:0;font:inherit;color:var(--accent);text-decoration:underline;cursor:pointer}
.miles{list-style:none;margin:0;padding:0;display:grid}
.miles li{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:12px;align-items:start;padding:10px 0;border-top:1px solid var(--rule);font-size:13.5px}
.miles li:first-child{border-top:0;padding-top:0}
.dot{width:12px;height:12px;margin-top:4px;border-radius:50%;border:2px solid var(--underline);background:var(--white)}
.miles .done .dot{background:var(--ok-ink);border-color:var(--ok-ink)}
.miles .next .dot{border-color:var(--accent);background:var(--accent-soft)}
.miles .when{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.miles .done .what{color:var(--body)}
.contact{display:flex;gap:12px;align-items:center}
.contact .avatar{width:42px;height:42px;font-size:13px}
.contact b{display:block;font-weight:600}
.contact span{font-size:13px;color:var(--body)}
.photos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.photos.home{grid-template-columns:repeat(3,minmax(0,1fr))}
.photo{margin:0;min-width:0}
.photo .img{aspect-ratio:4/3;border-radius:12px;overflow:hidden;background:var(--head)}
.photo img{display:block;width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.2,.7,.2,1)}
.photo:hover img{transform:scale(1.05)}
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
.gbb-panel{padding:0;overflow:clip}
.gbb-panel .gbb{--pin-top:var(--tabs-h);--brand:var(--ink-strong);border-radius:14px}
.gbb-panel .gbb .btn{min-height:0;border:0;font-weight:500}
.gbb-panel .gbb .btn.ghost{background:transparent;color:var(--ink-strong)}
.gbb-panel .gbb h1{font-size:clamp(28px,4vw,44px)}
.gbb-panel .close-fine{margin:0 var(--gbb-pad,48px);padding:20px 0 28px;border-top:1px solid var(--line);font-size:13px;color:var(--body)}
.gbb-panel .close-fine p{margin:0 0 8px}
@media (max-width:560px){.gbb-panel .close-fine{margin:0 18px}}
.next-steps ol{margin:10px 0 0;padding-left:20px;display:grid;gap:8px;color:var(--body)}
.next-steps li::marker{color:var(--accent);font-weight:700}
.field{display:grid;gap:6px;margin-top:14px}
.field label{font-size:13px;font-weight:600}
.hint{font-size:12px;color:var(--muted)}
.input{width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--field);border-radius:12px;font-size:16px;background:var(--white)}
.input:focus,.textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.input.code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-weight:600;font-size:24px;letter-spacing:.5em;text-align:center;font-variant-numeric:tabular-nums;padding-left:calc(12px + .5em)}
.textarea{width:100%;min-height:96px;padding:10px 12px;border:1px solid var(--field);border-radius:12px;font-size:15px;resize:vertical}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:13.5px;cursor:pointer}
.check input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--accent);flex:none}
.sum{margin:16px 0 4px;padding:12px 14px;border-radius:12px;background:var(--soft);border:1px solid var(--line);display:grid;gap:4px;font-size:13.5px}
.sum div{display:flex;justify-content:space-between;gap:12px}
.sum span{color:var(--body)}
.sum b{font-variant-numeric:tabular-nums;font-weight:650}
.form-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap}
.time-note{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:var(--soft);font-weight:600}
.statement{margin-top:14px;padding:12px 14px;border-left:3px solid var(--accent);border-radius:0 10px 10px 0;background:var(--soft);font-size:13.5px}
@media (max-width:1000px){.grid-home,.co-cols{grid-template-columns:minmax(0,1fr)}.rail{grid-template-columns:repeat(2,minmax(0,1fr))}.photos{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:640px){
.who-name span:not(.avatar),.cp-co-sub{display:none}
.main{padding-top:18px}
.stack{gap:16px}
.rail{grid-template-columns:minmax(0,1fr);gap:16px}
.panel{padding:18px 16px;border-radius:12px}
.panel h2{font-size:17px}
.rec{grid-template-columns:minmax(0,1fr)}
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
}
`;

const PORTAL_CSS = `
/* Client page shell: Athena blue hero with a blueprint grid, pinned glass tabs, white cards. */
.pt{--tabs-h:57px}
.cp-hero{position:relative;color:#fff;overflow:hidden;isolation:isolate;background:#2563eb}
.cp-hero::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(1000px 480px at 88% -10%,rgba(190,220,255,.7),transparent 62%),radial-gradient(700px 360px at 0% 110%,rgba(30,80,220,.35),transparent 60%),repeating-linear-gradient(0deg,rgba(255,255,255,.09) 0 1px,transparent 1px 32px),repeating-linear-gradient(90deg,rgba(255,255,255,.09) 0 1px,transparent 1px 32px),linear-gradient(200deg,#5c9bff 0%,#3b7df6 42%,#2563eb 100%)}
.cp-hero a,.cp-hero .linkbtn{color:#fff;text-decoration-color:rgba(255,255,255,.45)}
.brandbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:18px;padding-bottom:18px}
.cp-co{display:flex;align-items:center;gap:12px;min-width:0}
.cp-co-logo{width:40px;height:40px;border-radius:11px;background:#fff;color:#2563eb;display:grid;place-items:center;font-weight:700;font-size:13px;letter-spacing:.02em;flex:none}
.cp-co-img{display:block;height:44px;width:auto;max-width:min(200px,44vw);object-fit:contain;padding:6px 10px;border-radius:11px;background:#fff;flex:none}
.cp-co-word{display:grid;line-height:1.2;min-width:0}
.cp-co-word b{font-size:16px;font-weight:600;letter-spacing:-.015em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-co-sub{font-size:12px;color:#eef4ff}
.who{display:flex;align-items:center;gap:12px;font-size:13.5px;color:#eef4ff}
.who-name{display:flex;align-items:center;gap:8px}
.who .avatar{background:rgba(255,255,255,.16);color:#fff}
.hero-in{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:40px;align-items:center;padding-top:22px;padding-bottom:44px}
.h-eyebrow{margin:0;font:600 10.5px/1.3 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#f2f6ff}
.cp-hero h1{font-size:46px;line-height:1.04;font-weight:650;letter-spacing:-.035em;margin:10px 0 12px;color:#fff;text-wrap:balance}
.lede{margin:0 0 18px;font-size:16px;color:#f2f6ff;max-width:48ch}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3);color:#fff}
.chip i{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.22)}
.chip.attn i{background:#fbbf24;box-shadow:0 0 0 3px rgba(251,191,36,.25)}
.snap{display:grid;grid-template-columns:auto minmax(0,1fr);gap:22px;align-items:center;background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3),0 20px 50px rgba(8,25,80,.16);border-radius:20px;padding:20px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.snap.no-ring{grid-template-columns:minmax(0,1fr)}
.ring{--p:0;position:relative;width:132px;height:132px;border-radius:50%;display:grid;place-items:center;animation:ringin 1.2s cubic-bezier(.2,.7,.2,1) both}
.ring::before{content:"";position:absolute;inset:0;border-radius:50%;background:conic-gradient(#fff calc(var(--p)*1%),rgba(255,255,255,.26) 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 12px),#000 calc(100% - 11px));mask:radial-gradient(farthest-side,transparent calc(100% - 12px),#000 calc(100% - 11px))}
.ring div{position:relative;text-align:center;font-size:11.5px;color:#f2f6ff;line-height:1.3;max-width:96px}
.ring b{display:block;font-size:30px;font-weight:650;letter-spacing:-.03em;line-height:1;color:#fff;margin-bottom:3px}
@property --p{syntax:"<number>";inherits:true;initial-value:0}
@keyframes ringin{from{--p:0}}
.snap-rows{display:grid;gap:10px;min-width:0}
.snap-row{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#f2f6ff;border-bottom:1px solid rgba(255,255,255,.28);padding-bottom:8px}
.snap-row:last-child{border:0;padding:0}
.snap-row b{color:#fff;font-weight:600;text-align:right}
.peek{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}
.peek figure{margin:0;overflow:hidden;border-radius:12px;position:relative;aspect-ratio:4/3;background:rgba(255,255,255,.1)}
.peek img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s cubic-bezier(.2,.7,.2,1)}
.peek figure:hover img{transform:scale(1.05)}
.peek figcaption{position:absolute;left:8px;bottom:8px;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:rgba(10,23,51,.72);color:#fff}
.tabs{position:sticky;top:0;z-index:6;background:rgba(255,255,255,.84);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);border-bottom:1px solid var(--line)}
.tabs .wrap{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding-top:10px;padding-bottom:10px}
.tabs .wrap::-webkit-scrollbar{display:none}
.tab{flex:none;display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;font-size:14px;font-weight:500;color:var(--body);text-decoration:none;transition:background .2s,color .2s}
.tab:hover{background:var(--soft);color:var(--ink)}
.tab[aria-current=page]{background:var(--ink);color:#fff}
.count{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:inline-grid;place-items:center}
.cp-acts{display:grid;gap:10px}
.cp-act{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px;border-radius:14px;background:var(--soft);border:1px solid var(--line);transition:border-color .2s,transform .2s}
.cp-act:hover{border-color:var(--accent);transform:translateY(-1px)}
.ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-ink)}
.ico svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.cp-act h3{margin:0;font-size:15px;font-weight:600;letter-spacing:-.015em;line-height:1.35}
.cp-act .meta{display:block;font-size:13px;color:var(--body);margin-top:1px}
.due{display:inline-flex;align-items:center;font-size:12px;font-weight:600;color:var(--wait-ink);background:var(--wait-soft);padding:2px 8px;border-radius:999px;margin-top:5px}
.week{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.byline{display:flex;align-items:center;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--rule);font-size:13px;color:var(--body)}
.phases{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--n,5),minmax(0,1fr));gap:6px}
.phases li{position:relative;padding-top:18px;min-width:0}
.phases li::before{content:"";position:absolute;top:0;left:0;right:0;height:6px;border-radius:999px;background:var(--line)}
.phases li.done::before{background:var(--ok-ink)}
.phases li.next::before{background:var(--accent)}
.phases b{display:block;font-size:13.5px;font-weight:600;letter-spacing:-.01em}
.phases span{display:block;font-size:12px;color:var(--muted)}
.phases li.next b{color:var(--accent-ink)}
.team{display:flex;align-items:center;gap:14px}
.team .avatar{width:56px;height:56px;font-size:16px;box-shadow:0 0 0 3px var(--white),0 0 0 4px var(--line)}
.team img.avatar{object-fit:cover;background:var(--head)}
.team img.avatar.logo{object-fit:contain;background:#fff;padding:7px}
.cp-team-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px!important}
.cp-stand{display:grid;gap:14px}
.cp-stand-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.cp-stand-top b{font-size:34px;font-weight:650;letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums}
.cp-stand-top span{font-size:13px;color:var(--body)}
.cp-stand-bar{height:12px;border-radius:999px;background:var(--line);overflow:hidden}
.cp-stand-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#5c9bff,var(--accent));animation:grow 1.1s cubic-bezier(.2,.7,.2,1) both}
@keyframes grow{from{width:0}}
.cp-field{list-style:none;margin:0;padding:0;display:grid}
.cp-field>li{display:grid;grid-template-columns:96px minmax(0,1fr);gap:4px 16px;padding:12px 0;border-top:1px solid var(--rule)}
.cp-field>li:first-child{border-top:0;padding-top:0}
.cp-field .d{font-weight:600;font-size:13.5px}
.cp-field .d span{display:block;font-weight:400;font-size:12px;color:var(--muted)}
.cp-field ul{margin:0;padding-left:16px;color:var(--body);font-size:13.5px}
.cp-field ul li+li{margin-top:4px}
.cp-field .cp-crew{margin:6px 0 0;font-size:12px;color:var(--muted)}
@media (max-width:640px){.cp-field>li{grid-template-columns:minmax(0,1fr)}.cp-stand-top b{font-size:28px}}
.team b{display:block;font-weight:600}
.team span{font-size:13px;color:var(--body)}
.photos.thumbs{grid-template-columns:repeat(2,minmax(0,1fr))}
.foot{padding-top:24px;padding-bottom:26px;margin-top:8px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 18px}
.athena{display:inline-flex;align-items:center;gap:6px}
.athena svg{width:16px;height:12px;flex:none}
@media (max-width:1000px){.hero-in{grid-template-columns:minmax(0,1fr);gap:24px}.cp-hero h1{font-size:38px}}
@media (max-width:640px){.hero-in{padding-top:8px;padding-bottom:24px}.cp-hero h1{font-size:30px}.lede{font-size:14.5px}.brandbar{padding-top:14px;padding-bottom:14px}.snap{grid-template-columns:minmax(0,1fr);justify-items:center;padding:16px}.snap-rows{width:100%}.cp-act{grid-template-columns:auto minmax(0,1fr);padding:12px}.cp-act .btn{grid-column:1/-1;width:100%}.phases{grid-template-columns:minmax(0,1fr);gap:12px}.phases li{padding:0 0 0 18px}.phases li::before{top:3px;bottom:3px;left:0;right:auto;width:6px;height:auto}.photos.thumbs{gap:10px}.foot{flex-direction:column;align-items:flex-start}.tabs .wrap{padding-top:8px;padding-bottom:8px}}
.photo .img{display:block;cursor:zoom-in}
.photo .img:focus-visible,.peek a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.peek a{display:block;width:100%;height:100%;cursor:zoom-in}
.lb{position:fixed;inset:0;z-index:100;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;overscroll-behavior:contain;scrollbar-width:none;background:rgba(6,12,28,.94);visibility:hidden;opacity:0;pointer-events:none;transition:opacity .2s ease,visibility 0s .2s}
.lb::-webkit-scrollbar{display:none}
.lb:has(.lb-slide:target){visibility:visible;opacity:1;pointer-events:auto;transition:opacity .2s ease}
body:has(.lb-slide:target){overflow:hidden}
.lb-slide{position:relative;flex:0 0 100%;width:100%;height:100%;scroll-snap-align:center;scroll-snap-stop:always;display:grid;place-items:center;padding:56px 64px 24px}
.lb-bg{position:absolute;inset:0}
.lb-slide figure{position:relative;margin:0;display:grid;justify-items:center;gap:12px;max-width:100%;max-height:100%;pointer-events:none}
.lb-slide img{display:block;max-width:min(1400px,100%);max-height:calc(100vh - 160px);max-height:calc(100dvh - 160px);width:auto;height:auto;object-fit:contain;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.45);pointer-events:auto}
.lb-slide figcaption{color:#e8eefc;text-align:center;font-size:14px;line-height:1.45;max-width:720px;pointer-events:auto}
.lb-slide figcaption b{display:block;font-weight:600}
.lb-slide figcaption span{display:block;color:#a9b8d8;font-size:12.5px;margin-top:2px}
.lb-nav,.lb-x{position:absolute;display:grid;place-items:center;width:44px;height:44px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;text-decoration:none;font-size:30px;line-height:1;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:background .15s ease}
.lb-nav:hover,.lb-x:hover{background:rgba(255,255,255,.24)}
.lb-nav:focus-visible,.lb-x:focus-visible{outline:2px solid #fff;outline-offset:2px}
.lb-prev{left:12px;top:50%;transform:translateY(-50%)}
.lb-next{right:12px;top:50%;transform:translateY(-50%)}
.lb-x{top:12px;right:12px;font-size:28px}
@media (max-width:640px){.lb-slide{padding:56px 10px 20px}.lb-slide img{max-height:calc(100dvh - 190px);border-radius:8px}.lb-nav{display:none}.lb-slide figcaption{font-size:13px;padding:0 6px}}
@media (prefers-reduced-motion:reduce){.ring,.cp-stand-bar i,.panel,.cp-act,.btn,.photo img,.peek img,.lb{animation:none!important;transition:none!important}}
`;

// Sign-in, code and notice screens wear meetathena.io's web look: white with the site's faint blue fade at the top,
// the Athena lockup, Inter Tight headings, blue mono labels and a blue pill button. The contractor and the job sit
// under the lockup so a client knows who sent them; the signed-in page keeps its own quieter look.
const SIGNIN_CSS = `
.as{min-height:100vh;background:#fff linear-gradient(#F5F8FF 0,#fff 420px) no-repeat;color:#1F2329;padding:40px max(16px,env(safe-area-inset-left)) 48px max(16px,env(safe-area-inset-right));font-family:"Inter","Segoe UI",system-ui,-apple-system,sans-serif;font-size:14px}
.as-wrap{width:100%;max-width:32rem;margin:0 auto}
.as-brand{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;text-align:center}
.as-lockup{display:block;height:30px;width:auto;margin-bottom:22px}
.as-proj{margin-top:4px;font-size:14px;line-height:1.35;color:#4B5563;max-width:100%;overflow-wrap:anywhere}
.as-logo{display:block;max-width:220px;max-height:56px;width:auto;height:auto}
.as-co{display:grid;justify-items:center;line-height:1.15;min-width:0;max-width:100%}
.as-co b{font-family:"Inter Tight","Inter",system-ui,sans-serif;font-weight:700;font-size:24px;letter-spacing:-.02em;max-width:100%;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-co span{margin-top:8px;font:400 11px/1.3 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#2563EB}
.as-card{margin-top:36px;background:#fff;border:1px solid #E5E7EB;border-radius:20px;box-shadow:0 24px 60px rgba(30,95,237,.08),0 2px 6px rgba(17,24,39,.04);padding:24px}
.as-hi{margin:0 0 8px;font-size:15px;line-height:1.5;color:#4B5563}
.as h1{margin:0;font-family:"Inter Tight","Inter",system-ui,sans-serif;font-weight:700;font-size:28px;line-height:1.15;letter-spacing:-.03em;color:#111827;text-wrap:balance}
.as-sub{margin:12px 0 0;font-size:15px;line-height:1.6;color:#4B5563}
.as-job{margin-top:22px;padding:14px 16px;border:1px solid #E5E7EB;border-radius:12px;background:#F5F8FF;display:grid;gap:4px}
.as-label{display:block;font:400 11px/1.3 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#2563EB}
.as-job b{font-size:15px;font-weight:600;color:#111827}
.as-form{margin-top:26px;display:grid;gap:18px}
.as-field{display:grid;gap:8px}
.as-input{width:100%;height:56px;padding:0 14px;border:1px solid #E5E7EB;border-radius:12px;background:#fff;color:#111827;outline:none;font:600 26px/1 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.5em;text-align:center;padding-left:calc(14px + .5em);font-variant-numeric:tabular-nums}
.as-input.email{height:52px;font:400 16px/1.4 "Inter","Segoe UI",system-ui,sans-serif;letter-spacing:normal;text-align:left;padding-left:14px;font-variant-numeric:normal}
.as-input:focus{border-color:#2563EB;box-shadow:0 0 0 3px #2563EB26}
.as-check{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;color:#4B5563;cursor:pointer}
.as-check input{width:17px;height:17px;margin:1px 0 0;accent-color:#2563EB;flex:none}
.as-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:48px;padding:0 22px;border:0;border-radius:999px;background:#2563EB;color:#fff;font:600 14px/1 "Inter","Segoe UI",system-ui,sans-serif;cursor:pointer;text-decoration:none}
.as-btn:hover{background:#1D4ED8}
.as-btn:focus-visible,.as-link:focus-visible,.as-input:focus-visible{outline:3px solid #1D4ED8;outline-offset:2px}
.as-note{margin:0;font-size:12px;line-height:1.55;color:#6B7280}
.as-link{border:0;background:none;padding:0;font:inherit;font-weight:600;color:#2563EB;text-decoration:underline;text-underline-offset:4px;cursor:pointer}
.as-err{margin:20px 0 0;padding:11px 14px;border:1px solid #F3C8D0;border-radius:12px;background:#FFF3F5;color:#B91C1C;font-size:13px;font-weight:600}
.as-foot{margin-top:28px;padding-top:18px;border-top:1px solid #E5E7EB;display:flex;align-items:center;gap:8px;font-size:12px;color:#6B7280}
.as-foot svg{width:22px;height:16px;flex:none;overflow:visible}
.as-help{margin:22px 0 0;text-align:center;font-size:12px;line-height:1.7;color:#4B5563}.as-help a{color:#2563EB;text-decoration:underline;text-underline-offset:3px}
@media (min-width:640px){.as{padding-top:64px;padding-bottom:64px}.as-card{padding:36px}.as h1{font-size:30px}}
@media (max-width:380px){.as-co b{font-size:20px}.as h1{font-size:25px}}
`;

// Athena's own lockup, the same file the Athena sign-in and account pages show, served from this app.
const ATHENA_LOCKUP = "/brand/athena/athena-lockup-blue.svg";

// The Athena A for the "Powered by Athena" corner line, inlined so the page needs no image request. Solid Athena
// blue so the A reads whole at footer size (the lockup's pale crossbar disappears on white).
const ATHENA_A = `<svg viewBox="100 132 630 458" aria-hidden="true" focusable="false"><path fill="#2563EB" d="M395 140H540L260 582H108Z"/><path fill="#2563EB" d="M459 288H562L721 582H586Z"/><path fill="#2563EB" d="M393 404H499L517 443L337 493Z"/></svg>`;

/** Only an https image may stand in for the contractor's name. */
export const safeLogo = (url: string | null | undefined): string | null =>
  url && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;

/**
 * The Athena-styled shell for sign-in and notice screens. Client-facing, so the contractor leads up top (their saved
 * logo, or their name in type) and Athena is the small A and "Powered by Athena" in the card's footer.
 */
function signinShell(
  company: string | null,
  inner: string,
  logo: string | null = null,
  job: { number: string | null; name: string | null } | null = null,
): string {
  const src = safeLogo(logo);
  const jobLine = job?.name
    ? `<span class="as-proj">${job.number ? `Job ${esc(job.number)} · ` : ""}${esc(job.name)}</span>`
    : "";
  const athena = `<img class="as-lockup" src="${ATHENA_LOCKUP}" alt="Athena" width="109" height="30">`;
  const brand = company
    ? `<div class="as-brand">${athena}${src ? `<img class="as-logo" src="${esc(src)}" alt="${esc(company)}">` : ""}<span class="as-co"><b>${esc(company)}</b><span>Client page</span></span>${jobLine}</div>`
    : `<div class="as-brand">${athena}<span class="as-co"><span>Client page</span></span>${jobLine}</div>`;
  const support = `Trouble signing in? <a href="${esc(ATHENA_SUPPORT_MAILTO)}">Email Athena support</a>.`;
  const help = company
    ? `<p class="as-help">Questions about your project? Contact ${esc(company)}.<br>${support}</p>`
    : `<p class="as-help">${support}</p>`;
  return `<main class="as"><div class="as-wrap">${brand}<section class="as-card">${inner}<div class="as-foot">${ATHENA_A}<span>Powered by Athena</span></div></section>${help}</div></main>`;
}

const FONTS_PORTAL = "family=Inter:wght@400;500;600;700";
const FONTS_SIGNIN =
  "family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@600;700&family=JetBrains+Mono:wght@400;600";

function doc(title: string, body: string, kind: "portal" | "signin" = "portal"): string {
  const fonts = kind === "signin" ? FONTS_SIGNIN : FONTS_PORTAL;
  const css =
    kind === "signin"
      ? `${CSS}${SIGNIN_CSS}`
      : `${CSS}${PORTAL_CSS}${BILLING_CSS}${SERVICE_CSS}${MESSAGES_CSS}${COMPARE_CSS}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="same-origin"><title>${esc(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap"><style>${css}</style></head><body>${body}</body></html>`;
}

// ---------- sign-in ----------

export type InviteStep = "start" | "code";
export function renderInvite(
  info: Extract<InviteOpen, { status: "ok" }>,
  step: InviteStep,
  opts: { error?: string | null; sent?: boolean; logo?: string | null } = {},
): string {
  const err = opts.error ? `<p class="as-err" role="alert">${esc(opts.error)}</p>` : "";
  const job = `<div class="as-job"><span class="as-label">Job ${esc(info.job_number)}</span><b>${esc(info.job_name)}</b></div>`;
  const masked = esc(maskEmail(info.email));
  const inner =
    step === "start"
      ? `<p class="as-hi">Hi ${esc(info.name.split(/\s+/)[0])},</p><h1>${esc(info.company)} invites you to your ${esc(info.job_name)} project page</h1><p class="as-sub">It's private to you. You'll find weekly updates, photos, the schedule and anything that needs your decision.</p>${job}${err}<form method="post" class="as-form"><input type="hidden" name="action" value="send_code"><button class="as-btn" type="submit">Email me a sign-in code&nbsp;&rarr;</button><p class="as-note">We'll send a 6-digit code to ${masked}. No password needed.</p></form>`
      : `<h1>Check your email</h1><p class="as-sub">${opts.sent ? "We sent" : "Enter"} a 6-digit code to ${masked}. It works for 10 minutes.</p>${job}${err}<form method="post" class="as-form"><input type="hidden" name="action" value="verify"><div class="as-field"><label class="as-label" for="code">6-digit code</label><input class="as-input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></div><label class="as-check"><input type="checkbox" name="remember" value="1"> Keep me signed in on this device for 30 days</label><button class="as-btn" type="submit">Sign in&nbsp;&rarr;</button></form><form method="post" class="as-form"><input type="hidden" name="action" value="send_code"><p class="as-note">No code? Check your spam folder, or <button class="as-link" type="submit">send a new one</button>.</p></form>`;
  return doc(
    `${info.job_name} · Sign in`,
    signinShell(info.company, inner, opts.logo ?? null, null),
    "signin",
  );
}

/**
 * Sign in on the customer page itself, when a customer opens any link from their emails while signed out. They give
 * their email, get a 6-digit code, and land on what they opened. `back` is the page's own query (section and item),
 * carried through so they come back to it.
 */
export function renderPageSignIn(
  step: "email" | "code",
  opts: {
    back: string;
    error?: string | null;
    sent?: boolean;
    company?: string | null;
    logo?: string | null;
    job_number?: string | null;
    job_name?: string | null;
  } = {
    back: "",
  },
): string {
  const err = opts.error ? `<p class="as-err" role="alert">${esc(opts.error)}</p>` : "";
  const back = `<input type="hidden" name="back" value="${esc(opts.back)}">`;
  const inner =
    step === "email"
      ? `<h1>Sign in to your project page</h1><p class="as-sub">Enter the email address this page was shared with. We'll email you a 6-digit code. No password needed.</p>${err}<form method="post" class="as-form"><input type="hidden" name="action" value="page_send_code">${back}<div class="as-field"><label class="as-label" for="email">Email</label><input class="as-input email" id="email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="320" required autofocus></div><button class="as-btn" type="submit">Email me a sign-in code&nbsp;&rarr;</button></form>`
      : `<h1>Check your email</h1><p class="as-sub">${opts.sent ? "We sent a 6-digit code to your email." : "Enter the 6-digit code from your email."} It works for 10 minutes.</p>${err}<form method="post" class="as-form"><input type="hidden" name="action" value="page_verify">${back}<div class="as-field"><label class="as-label" for="code">6-digit code</label><input class="as-input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></div><label class="as-check"><input type="checkbox" name="remember" value="1"> Keep me signed in on this device for 30 days</label><button class="as-btn" type="submit">Sign in&nbsp;&rarr;</button></form><p class="as-note">No code? Check your spam folder, or <a class="as-link" href="?${esc(opts.back ? `${opts.back}&` : "")}step=signin">send a new one</a>.</p>`;
  return doc(
    opts.job_name ? `${opts.job_name} · Sign in` : "Sign in",
    signinShell(opts.company ?? null, inner, opts.logo ?? null, {
      number: opts.job_number ?? null,
      name: opts.job_name ?? null,
    }),
    "signin",
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
export function renderGone(
  kind: keyof typeof GONE | string,
  company: string | null = null,
  logo: string | null = null,
): string {
  const [h, raw] = GONE[kind] ?? GONE.unknown!;
  // Name the contractor when we know them, so the client knows exactly who to call.
  const p = company
    ? raw
        .replace(/\b([Yy])our contractor\b/g, company)
        .replace(/\bContact them\b/g, `Contact ${company}`)
    : raw;
  return doc(
    h,
    signinShell(company, `<h1>${esc(h)}</h1><p class="as-sub">${esc(p)}</p>`, logo),
    "signin",
  );
}

// ---------- portal ----------

export type PortalOpts = {
  section: PortalSection;
  item?: string | null;
  /** review: a picked package, highlighted, before any code; confirm: approve or sign with the emailed code; decline; check: tell the contractor you're paying by check. */
  step?: "confirm" | "decline" | "check" | "review" | null;
  choice?: string | null;
  flash?: string | null;
  error?: string | null;
  /** The contractor's saved logo, an https URL. Their initials and name show when there is none. */
  logo?: string | null;
  /** Messages: the shared item a new message is about, from an "Ask a question about this" link. */
  about?: string | null;
};

/** Waiting on the customer: a decision not yet made, or a service bill not yet paid. */
const open = (p: PortalPage, i: PortalItem) =>
  i.kind === "service_invoice" ? billOpen(p, i) : i.decision === null;
const itemLabel = (i: PortalItem) =>
  i.kind === "change_order" || i.kind === "work_order"
    ? `${i.view.number} · ${i.view.title}`
    : i.kind === "pay_app"
      ? payAppLabel(i.view.number)
      : i.kind === "service_invoice" || i.kind === "precon_agreement"
        ? i.view.title
        : i.view.proposal.title;
const SECTION_OF: Record<PortalItem["kind"], PortalSection> = {
  change_order: "changes",
  selection: "selections",
  pay_app: "billing",
  work_order: "work",
  service_invoice: "billing",
  precon_agreement: "agreement",
};
/** A service call's page: work orders and their bills, no schedule, change orders or selections. */
const isService = (p: PortalPage) => p.job.kind === "service";
/** The work order's price in a few words: the fixed total, the limit, or the estimate. */
const woShort = (v: WorkOrderView) =>
  v.basis === "unit_price"
    ? usd(v.totals.estimate_cents)
    : v.totals.cap_cents !== null
      ? `up to ${usd(v.totals.cap_cents)}`
      : `about ${usd(v.totals.estimate_cents)}`;
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

const ICON = {
  change_order: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>`,
  selection: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>`,
  pay_app: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M14 11.2c-.4-.6-1.1-.9-2-.9-1.1 0-2 .6-2 1.4s.9 1.2 2 1.4 2 .6 2 1.4-.9 1.4-2 1.4c-.9 0-1.6-.4-2-.9M12 9.3v1M12 15.9v1"/></svg>`,
  work_order: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>`,
  service_invoice: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M14 11.2c-.4-.6-1.1-.9-2-.9-1.1 0-2 .6-2 1.4s.9 1.2 2 1.4 2 .6 2 1.4-.9 1.4-2 1.4c-.9 0-1.6-.4-2-.9M12 9.3v1M12 15.9v1"/></svg>`,
  precon_agreement: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 15.5h3"/><path d="M13.5 19.5l5.8-5.8a1.4 1.4 0 0 1 2 2l-5.8 5.8-2.6.6z"/></svg>`,
} as const;

/** Whole days from today to a due date, for the "Reply by" chip. */
function daysLeft(p: PortalPage, due: string): number {
  return Math.round(
    (Date.parse(due.slice(0, 10)) - Date.parse(p.job.today.slice(0, 10))) / 86_400_000,
  );
}
function dueChip(p: PortalPage, due: string | null, verb: string): string {
  if (!due) return "";
  const n = daysLeft(p, due);
  const left = n < 0 ? "past due" : n === 0 ? "today" : `${n} ${n === 1 ? "day" : "days"}`;
  return `<span class="due">${esc(`${verb} by ${shortDate(due)} · ${left}`)}</span>`;
}

function decideBox(p: PortalPage): string {
  const waiting = p.items.filter((i) => open(p, i));
  if (!waiting.length)
    return `<section class="panel decide"><div class="panel-head"><h2>Needs your attention</h2></div><div class="done-box">You're all caught up. Nothing needs your decision right now.</div></section>`;
  const rows = waiting
    .map((i) => {
      const section = SECTION_OF[i.kind];
      const what =
        i.kind === "change_order"
          ? `Change order · ${usd(i.view.price_cents)} · ${days(i.view.schedule_days)}`
          : i.kind === "pay_app"
            ? `Pay application · ${usd(i.view.totals.current_due_cents)} due`
            : i.kind === "work_order"
              ? `Work order · ${i.view.basis_label} · ${woShort(i.view)}`
              : i.kind === "service_invoice"
                ? `Bill · ${usd(billDue(p, i))} due`
                : i.kind === "precon_agreement"
                  ? `Design and pre-construction · ${wholePrice(i.view.price_cents)}`
                  : `Choose a package · from ${usd(Math.min(...i.view.proposal.packages.map((k) => k.total_cents)))}`;
      const verb =
        i.kind === "change_order" || i.kind === "work_order"
          ? "Reply"
          : i.kind === "pay_app"
            ? "Approve"
            : i.kind === "service_invoice"
              ? "Pay"
              : i.kind === "precon_agreement"
                ? "Sign"
                : "Choose";
      const title = i.kind === "precon_agreement" ? "Pre-construction agreement" : itemLabel(i);
      const go = i.kind === "precon_agreement" ? "Review and sign" : "Review";
      return `<div class="cp-act"><span class="ico">${ICON[i.kind]}</span><div><h3>${esc(title)}</h3><span class="meta">${esc(what)}</span>${dueChip(p, i.due_on, verb)}</div><a class="btn" href="${esc(href(p, section, { i: i.id }))}">${go}</a></div>`;
    })
    .join("");
  return `<section class="panel decide"><div class="panel-head"><h2>Needs your attention</h2><span class="meta">${waiting.length} ${waiting.length === 1 ? "item" : "items"}</span></div><div class="cp-acts">${rows}</div></section>`;
}

/**
 * The caption a client reads. A photo's note is written for the contractor's record and can carry clauses like
 * "documentation only, not evidence of duct-bank quantity"; those stay off the client page. Keeps the plain
 * description, drops a leading "Progress photo of/showing", and falls back to the area when nothing is left.
 */
const INTERNAL_NOTE =
  /\b(documentation only|for (the )?record|internal|not (evidence|proof)|evidence of|quantit(y|ies)|not verified|unverified|do not (bill|use)|billing|pay ?app(lication)?|sov|schedule of values|backup|claim)\b/i;
export function customerCaption(work: string | null | undefined, area?: string | null): string {
  const clauses = (work ?? "")
    .split(/(?<=[.;!?])\s+|;\s*/)
    .map((c) => c.replace(/[.;]+$/, "").trim())
    .filter((c) => c && !INTERNAL_NOTE.test(c));
  let text = (clauses.join(". ") + (clauses.length > 1 ? "." : ""))
    .replace(/^(a\s+)?(progress\s+)?photo\s+(of|showing)\s+/i, "")
    .trim();
  if (text) text = text[0].toUpperCase() + text.slice(1);
  return text || (area ?? "").trim() || "Progress photo";
}

const photoId = (id: string) => `ph-${id}`;
const captionFor = (ph: PortalPage["photos"][number]) => customerCaption(ph.work, ph.area);
/** Place and date under a caption; the place is left off when the caption already is the place. */
const photoMeta = (ph: PortalPage["photos"][number]) =>
  [captionFor(ph) === (ph.area ?? "").trim() ? null : ph.area, longDate(ph.taken_on)]
    .filter(Boolean)
    .join(" · ");

function photoGrid(photos: PortalPage["photos"], cls = ""): string {
  const shown = photos.filter((ph) => ph.url);
  if (!shown.length) return `<p class="empty">No photos shared yet.</p>`;
  return `<div class="photos ${cls}">${shown
    .map(
      (ph) =>
        `<figure class="photo"><a class="img" href="#${photoId(ph.id)}" aria-label="Open photo: ${esc(captionFor(ph))}"><img src="${esc(ph.url)}" alt="${esc(captionFor(ph))}" loading="lazy" referrerpolicy="no-referrer"></a><figcaption>${esc(captionFor(ph))}<span>${esc(photoMeta(ph))}</span></figcaption></figure>`,
    )
    .join("")}</div>`;
}

/**
 * Full-size photo viewer with no scripts (the page allows none): each photo links to its slide by #id, the slide
 * shows while it is the URL's target, and the slides sit in a sideways scroll-snap track so a phone swipes between
 * them. Arrows link to the neighbours, the dark backdrop and the close button link to "#_", and the browser's back
 * button closes it too.
 */
function lightbox(p: PortalPage): string {
  const shown = p.photos.filter((ph) => ph.url);
  if (!shown.length) return "";
  const n = shown.length;
  const slides = shown
    .map((ph, i) => {
      const prev =
        i > 0
          ? `<a class="lb-nav lb-prev" href="#${photoId(shown[i - 1].id)}" aria-label="Previous photo">&lsaquo;</a>`
          : "";
      const next =
        i < n - 1
          ? `<a class="lb-nav lb-next" href="#${photoId(shown[i + 1].id)}" aria-label="Next photo">&rsaquo;</a>`
          : "";
      return `<section class="lb-slide" id="${photoId(ph.id)}" role="dialog" aria-label="Photo ${i + 1} of ${n}"><a class="lb-bg" href="#_" aria-label="Close photo" tabindex="-1"></a><figure><img src="${esc(ph.url)}" alt="${esc(captionFor(ph))}" loading="lazy" referrerpolicy="no-referrer"><figcaption><b>${esc(captionFor(ph))}</b><span>${esc(photoMeta(ph))}${n > 1 ? ` · ${i + 1} of ${n}` : ""}</span></figcaption></figure>${prev}${next}<a class="lb-x" href="#_" aria-label="Close photo">&times;</a></section>`;
    })
    .join("");
  return `<div class="lb">${slides}</div>`;
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

/** Only an https link reaches an img tag. */
const safePhoto = (u: string | null | undefined): boolean =>
  !!u && /^https:\/\/[^\s"'<>]+$/.test(u);

/** Share of the contract the owner has approved, 0 to 100, from certified bills only. */
function approvedPct(p: PortalPage): number | null {
  const g = p.progress;
  if (!g || g.contract_cents <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((g.approved_cents / g.contract_cents) * 100)));
}

function contactPanel(p: PortalPage): string {
  const c = p.contractor;
  if (!c.pm_name && !c.pm_email) return "";
  const who = c.pm_name || c.name;
  // The PM's own photo; without one, the company's logo; initials only when there is neither (Marshall, Nov 6).
  const logo = safeLogo(c.logo_url);
  const face = safePhoto(c.pm_photo_url)
    ? `<img class="avatar" src="${esc(c.pm_photo_url!)}" alt="${esc(who)}" referrerpolicy="no-referrer">`
    : logo
      ? `<img class="avatar logo" src="${esc(logo)}" alt="${esc(c.name)}" referrerpolicy="no-referrer">`
      : `<span class="avatar" aria-hidden="true">${esc(initials(who))}</span>`;
  return `<section class="panel"><div class="panel-head"><h2>Your team</h2></div><div class="team">${face}<div><b>${esc(c.pm_name || c.name)}</b><span>${esc([c.pm_title || "Project manager", c.name].filter(Boolean).join(" · "))}</span></div></div><p class="sub cp-team-acts"><a class="btn" href="${esc(href(p, "messages"))}">Send a message</a>${c.pm_email ? `<a class="btn secondary" href="mailto:${esc(c.pm_email)}">Email ${esc((c.pm_name || c.name).split(/\s+/)[0]!)}</a>` : ""}</p></section>`;
}

/** "Ask a question about this": opens Messages with the item already linked. Never inside a signing form. */
function askLink(p: PortalPage, i: PortalItem, cls = "btn secondary block"): string {
  return `<a class="${cls}" href="${esc(href(p, "messages", { about: i.id }))}#write">Ask a question about this</a>`;
}

const stamp = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
};

/** The customer's conversation with the team: the thread, then a box to write. */
function messages(p: PortalPage, o: PortalOpts): string {
  const m = p.messages;
  const about = o.about ? (p.items.find((i) => i.id === o.about) ?? null) : null;
  const list = m?.list ?? [];
  const thread = !m
    ? `<p class="empty">Messages can't be shown right now. Try again in a moment, or email your project team.</p>`
    : list.length
      ? `<ol class="cp-msgs">${list
          .map((x, n) => {
            const mine = x.author_kind === "client";
            return `<li class="cp-msg${mine ? " cp-msg-mine" : ""}"${n === list.length - 1 ? ' id="latest"' : ""}><div class="cp-msg-who"><span class="avatar" aria-hidden="true">${esc(initials(x.author_name))}</span><b>${esc(mine ? "You" : x.author_name)}</b><span>${esc(stamp(x.created_at))}</span></div>${x.about_label ? `<p class="cp-msg-about">About ${esc(x.about_label)}</p>` : ""}<div class="cp-msg-body">${paras(x.body)}</div></li>`;
          })
          .join("")}</ol>`
      : `<p class="empty">No messages yet. Ask ${esc(p.contractor.name)} anything about your project, and the reply shows here.</p>`;
  const aboutRow = about
    ? `<div class="cp-msg-link"><span>About <b>${esc(itemLabel(about))}</b></span><a href="${esc(href(p, "messages"))}#write">Remove</a></div>`
    : "";
  const compose = `<form method="post" class="panel" id="write"><div class="panel-head"><h2>Write to your team</h2></div>${aboutRow}${hidden(p, { action: "message", ...(about ? { about: about.id } : {}) })}<div class="field"><label for="body">Your message</label><textarea class="textarea" id="body" name="body" maxlength="4000" required placeholder="Ask a question or tell your team something about the job."></textarea><span class="hint">Up to 4,000 characters. ${esc(p.contractor.name)} gets it right away.</span></div><div class="form-actions"><button class="btn" type="submit">Send message</button></div></form>`;
  const shared = p.items.length
    ? `<section class="panel"><div class="panel-head"><h2>Ask about something shared</h2></div>${p.items
        .map(
          (i) =>
            `<div class="rec"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">${esc(`Shared ${longDate(i.shared_on)}`)}</div></div><div class="right"><a class="btn secondary" href="${esc(href(p, "messages", { about: i.id }))}#write">Ask</a></div></div>`,
        )
        .join("")}</section>`
    : "";
  return `<div class="grid-home"><div class="stack"><section class="panel"><div class="panel-head"><h2>Messages</h2><span class="meta">${esc(`Between you and ${p.contractor.name}`)}</span></div>${thread}</section>${compose}</div><aside class="rail">${contactPanel(p)}${shared}</aside></div>`;
}

/** Up to five milestones around where the job is: the last one done, then what's next. */
function phases(p: PortalPage): string {
  if (!p.milestones.length) return "";
  const firstOpen = p.milestones.findIndex((m) => !m.done);
  const at = firstOpen < 0 ? p.milestones.length : firstOpen;
  const start = Math.max(0, Math.min(at - 1, p.milestones.length - 5));
  const shown = p.milestones.slice(start, start + 5);
  const next = nextMilestone(p);
  const items = shown
    .map((m) => {
      const cls = m.done ? "done" : m === next ? "next" : "";
      const when = m.done
        ? `Done ${shortDate(m.date)}`
        : m === next
          ? `Next · ${shortDate(m.date)}`
          : shortDate(m.date);
      return `<li class="${cls}"><b>${esc(m.name)}</b><span>${esc(when)}</span></li>`;
    })
    .join("");
  return `<section class="panel"><div class="panel-head"><h2>Where the job stands</h2><a class="meta" href="${esc(href(p, "schedule"))}">Full schedule</a></div><ol class="phases" style="--n:${shown.length}">${items}</ol></section>`;
}

/** No weekly update yet: the last few days from the field (date, weather, crew, work done), as the Updates tab shows them. */
function fieldPanel(p: PortalPage): string {
  const days = p.dailies.filter((d) => d.work.some((w) => !!w && !!w.trim())).slice(0, 3);
  const head = `<div class="panel-head"><h2>This week on your project</h2>${days.length ? `<a class="meta" href="${esc(href(p, "updates"))}">All updates</a>` : ""}</div>`;
  if (!days.length)
    return `<section class="panel">${head}<p class="empty">${esc(`${p.contractor.name} posts a short update here each week, with what got done and what's next.`)}</p></section>`;
  const rows = days
    .map((d) => {
      const work = d.work.filter((w): w is string => !!w && !!w.trim()).slice(0, 4);
      // A head count reads "Crew of 6" by the date; a written crew breakdown goes under the work, in full.
      const m = d.manpower?.trim() ?? "";
      const count = /^\d{1,4}$/.test(m);
      const crew = count ? `Crew of ${m}` : "";
      const crewNote = m && !count ? `<p class="cp-crew">${esc(`Crew: ${m}`)}</p>` : "";
      return `<li><div class="d">${esc(shortDate(d.date))}<span>${esc([dayName(d.date), crew].filter(Boolean).join(" · "))}</span></div><div><ul>${work.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>${crewNote}</div></li>`;
    })
    .join("");
  return `<section class="panel">${head}<ul class="cp-field">${rows}</ul></section>`;
}

/** No schedule shared: where the job stands by the work the owner has approved, or a plain note. */
function standPanel(p: PortalPage): string {
  const pct = approvedPct(p);
  const head = `<div class="panel-head"><h2>Where the job stands</h2><a class="meta" href="${esc(href(p, "schedule"))}">Schedule</a></div>`;
  const note = `<p class="fine">${esc(`Schedule milestones show here once ${p.contractor.name} shares the schedule.`)}</p>`;
  if (pct === null) return `<section class="panel">${head}${note}</section>`;
  const g = p.progress!;
  return `<section class="panel">${head}<div class="cp-stand"><div class="cp-stand-top"><b>${pct}%</b><span>${esc(`${usd(g.approved_cents)} of ${usd(g.contract_cents)} approved`)}</span></div><div class="cp-stand-bar" role="img" aria-label="${esc(`${pct} percent of the contract approved`)}"><i style="width:${pct}%"></i></div>${note}</div></section>`;
}

function home(p: PortalPage): string {
  const latest = p.updates[0];
  const pm = p.contractor.pm_name;
  const update = latest
    ? `<section class="panel"><div class="panel-head"><h2>${esc(latest.title)}</h2><a class="meta" href="${esc(href(p, "updates"))}">All updates</a></div><div class="prose">${paras(latest.body)}</div><div class="byline"><span class="avatar" aria-hidden="true">${esc(initials(pm || p.contractor.name))}</span>${esc([pm ? `${pm}, ${p.contractor.pm_title || "project manager"}` : p.contractor.name, `week of ${longDate(latest.week_of)}`].join(" · "))}</div></section>`
    : fieldPanel(p);
  const shown = p.photos.filter((ph) => ph.url);
  const photos = shown.length
    ? `<section class="panel"><div class="panel-head"><h2>Latest photos</h2><a class="meta" href="${esc(href(p, "photos"))}">See all ${shown.length}</a></div>${photoGrid(shown.slice(0, 2), "thumbs")}</section>`
    : "";
  const coming = `<section class="panel"><div class="panel-head"><h2>Coming up</h2><a class="meta" href="${esc(href(p, "schedule"))}">Schedule</a></div>${milestoneList(p, 4)}</section>`;
  return `<div class="grid-home"><div class="stack">${decideBox(p)}${update}${phases(p) || standPanel(p)}</div><aside class="rail">${moneyPanel(p)}${contactPanel(p)}${photos}${coming}</aside></div>`;
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
      : d.decision === "signed"
        ? "Signed"
        : d.decision === "declined"
          ? "Declined"
          : `Chose ${TIER_NAME[d.choice ?? "good"]}`;
  return `<div class="receipt"><div class="receipt-top${d.decision === "declined" ? " declined" : ""}">${esc(what)}</div><dl><div><dt>By</dt><dd>${esc(d.typed_name)}</dd></div><div><dt>When</dt><dd>${esc(new Date(d.decided_at).toUTCString().replace("GMT", "UTC"))}</dd></div>${d.code_verified ? `<div><dt>Confirmed</dt><dd>With a code emailed to you</dd></div>` : ""}${d.decision === "signed" ? `<div><dt>Electronic signing</dt><dd>You agreed to do this electronically</dd></div>` : ""}${d.note ? `<div><dt>Your note</dt><dd>${esc(d.note)}</dd></div>` : ""}<div><dt>Document fingerprint</dt><dd class="mono">${esc(i.fingerprint)}</dd></div></dl></div>`;
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
  if (i.decision)
    side = `${receipt(i)}<section class="panel actions"><h2>Questions?</h2>${askLink(p, i)}</section>`;
  else if (o.step === "confirm")
    side = `<form method="post" class="panel"><h2>Approve ${esc(v.number)}</h2><p class="sub">We emailed a 6-digit code to ${esc(maskEmail(p.customer.email))}.</p><div class="sum"><div><span>Price</span><b>${esc(usd(v.price_cents))}</b></div><div><span>Schedule</span><b>${esc(days(v.schedule_days))}</b></div></div>${hidden(p, { action: "decide", item: i.id, decision: "approved", fingerprint: i.fingerprint })}<div class="field"><label for="code">Code from your email</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><p class="statement">${esc(statement)}</p><label class="check"><input type="checkbox" name="agree" value="1" required> I agree</label><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "changes", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Approve change order</button></div></form>`;
  else if (o.step === "decline")
    side = `<form method="post" class="panel"><h2>Decline ${esc(v.number)}</h2><p class="sub">${esc(p.contractor.name)} will see your note and follow up.</p>${hidden(p, { action: "decide", item: i.id, decision: "declined", fingerprint: i.fingerprint })}<div class="field"><label for="note">What would you like changed? (optional)</label><textarea class="textarea" id="note" name="note" maxlength="2000"></textarea></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "changes", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Decline change order</button></div></form>`;
  else
    side = `<section class="panel actions"><h2>Your decision</h2><form method="post">${hidden(p, { action: "start", item: i.id })}<button class="btn block" type="submit">Approve</button></form><a class="btn secondary block" href="${esc(href(p, "changes", { i: i.id, step: "decline" }))}">Decline</a>${askLink(p, i)}<p class="fine">Approving asks for a code we email you and your typed name. Your decision is recorded with the date and time.</p></section>`;
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

/** What the customer's choice does next, in the job's own terms: a change order exists only under contract. */
function choiceNext(
  p: PortalPage,
  v: Extract<PortalItem, { kind: "selection" }>["view"]["proposal"],
  tier: (typeof optionNames)[number],
  done: boolean,
): string {
  const pk = v.packages.find((k) => k.tier === tier)!;
  const cur = (c: number) => displayPrice(c, v.currency);
  const co = p.contractor.name;
  const pm = p.contractor.pm_name ? `${p.contractor.pm_name} at ${co}` : co;
  const terms = choiceTerms(p.job.under_contract, pk, v.currency);
  if (terms.changeOrder)
    return `<section class="panel next-steps"><h2>${done ? "What happens next" : "What happens when you confirm"}</h2><ol>${[
      done
        ? `${pm} has your signed change order.`
        : "You confirm with the code we email you and your typed name.",
      `${done ? "You approved" : "Confirming approves"} a change order to your contract for ${terms.changeOrder.difference}. ${timeSentence(terms.days)}`,
      `${co} orders ${TIER_NAME[tier]} and adds the change order to your contract.`,
    ]
      .map((x) => `<li>${esc(x)}</li>`)
      .join("")}</ol></section>`;
  const steps: string[] = done
    ? [`${pm} has your signed choice.`]
    : [`You confirm with the code we email you and your typed name.`];
  if (tier === v.base_tier || pk.difference_cents === 0)
    steps.push(
      p.job.under_contract
        ? `${TIER_NAME[tier]} is what your contract already includes, so nothing about your price changes.`
        : `${TIER_NAME[tier]} is what your proposal price already includes: ${cur(pk.total_cents)}.`,
    );
  else if (p.job.under_contract)
    steps.push(
      `${co} prepares a change order for the ${cur(pk.difference_cents)} difference and sends it here for your approval. Your contract price changes only when you approve that change order.`,
    );
  else
    steps.push(
      `Your proposal price becomes the ${TIER_NAME[tier]} total of ${cur(pk.total_cents)}, and ${co} carries it into your contract.`,
    );
  return `<section class="panel next-steps"><h2>${done ? "What happens next" : "What happens when you confirm"}</h2><ol>${steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></section>`;
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
    (o.step === "confirm" || o.step === "review") && optionNames.includes(o.choice as never)
      ? (o.choice as (typeof optionNames)[number])
      : null;
  const pickSummary = (
    tier: (typeof optionNames)[number],
    eyebrow: "Your pick" | "You're choosing",
  ) => {
    const pk = v.packages.find((k) => k.tier === tier)!;
    const base = tier === v.base_tier;
    const terms = choiceTerms(p.job.under_contract, pk, v.currency);
    const lines = v.selections
      .map((s) => {
        const op = s.options[tier];
        return `<div><span>${esc(s.title)}</span><b>${esc([op.manufacturer, op.model].filter(Boolean).join(" ") || op.description)}</b></div>`;
      })
      .join("");
    return `<section class="panel"><p class="eyebrow">${eyebrow}</p><h2>${esc(v.title)}: ${TIER_NAME[tier]}</h2><div class="sum"><div><span>Package total</span><b>${esc(cur(pk.total_cents))}</b></div><div><span>${base ? "Change from base" : terms.changeOrder ? "Change order" : "Difference from base"}</span><b>${base ? "Included" : esc(`${pk.difference_cents > 0 ? "+" : ""}${cur(pk.difference_cents)}`)}</b></div>${base ? "" : `<div><span>Time</span><b>${esc(timeLabel(terms.days))}</b></div>`}${!base && pk.added_cents ? `<div><span>${esc(pk.added_note || "Added cost")}</span><b>${esc(cur(pk.added_cents))}</b></div>` : ""}${lines}</div></section>`;
  };
  if (!i.decision && pickedTier && o.step === "confirm") {
    const pk = v.packages.find((k) => k.tier === pickedTier)!;
    const terms = choiceTerms(p.job.under_contract, pk, v.currency);
    const statement = approvalStatement({
      kind: "selection",
      company: p.contractor.name,
      label: v.title,
      price: cur(pk.total_cents),
      choice: TIER_NAME[pickedTier],
      scheduleDays: terms.days,
      changeOrder: terms.changeOrder,
    });
    // Right before the code: the time this change needs, stated plainly.
    const timeNote =
      terms.changeOrder || terms.days > 0
        ? `<p class="time-note">${esc(timeSentence(terms.days))}</p>`
        : "";
    const form = `<form method="post" class="panel"><h2>${terms.changeOrder ? "Approve your change order" : "Sign your choice"}</h2><p class="sub">We emailed a 6-digit code to ${esc(maskEmail(p.customer.email))}. It works for any package on this page.</p>${timeNote}${hidden(p, { action: "decide", item: i.id, decision: "chosen", choice: pickedTier, fingerprint: i.fingerprint })}<div class="field"><label for="code">Code from your email</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><p class="statement">${esc(statement)}</p><label class="check"><input type="checkbox" name="agree" value="1" required> I agree</label><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "selections", { i: i.id, step: "review", choice: pickedTier }))}">Change my pick</a><button class="btn" type="submit">${terms.changeOrder ? "Approve change order" : "Confirm my choice"}</button></div></form>`;
    const resend = `<form method="post" class="resend">${hidden(p, { action: "start", item: i.id, choice: pickedTier, fresh: "1" })}<p class="fine">No email? <button class="linkish" type="submit">Email me a new code</button></p></form>`;
    return `${back}<div class="co-cols"><div class="stack">${pickSummary(pickedTier, "You're choosing")}${choiceNext(p, v, pickedTier, false)}</div><aside class="stack">${form}${resend}</aside></div>`;
  }
  const picked = !i.decision && pickedTier && o.step === "review" ? pickedTier : null;
  const shown = chosen
    ? { ...v, accepted: { tier: chosen, recorded_on: i.decision!.decided_at.slice(0, 10) } }
    : v;
  const compare = renderCompare(shown, {
    company: p.contractor.name,
    underContract: p.job.under_contract ?? null,
    eyebrow: `Selections · shared ${longDate(i.shared_on)}`,
    picked,
    // Tap a package to highlight it in place, then Select opens its review. No code is sent until the customer asks for one.
    pickable: i.decision
      ? null
      : { select: (tier) => href(p, "selections", { i: i.id, step: "review", choice: tier }) },
    note: i.decision
      ? null
      : `${p.job.under_contract ? "Your contract includes" : "Your price includes"} ${TIER_NAME[v.base_tier]}. Tap a package to compare it, then Select to review. Nothing is final until you confirm.`,
  });
  if (picked) {
    const confirm = `<section class="panel actions"><h2>Confirm ${TIER_NAME[picked]}</h2><p class="sub">Nothing is final yet. Next we email a 6-digit code to ${esc(maskEmail(p.customer.email))}, and you sign with it and your typed name.</p><form method="post">${hidden(p, { action: "start", item: i.id, choice: picked })}<button class="btn block" type="submit">Email me a code to confirm</button></form><a class="btn secondary block" href="${esc(href(p, "selections", { i: i.id }))}">Change my pick</a>${askLink(p, i)}</section>`;
    const backAsk = `<p class="cp-backrow"><a href="${esc(href(p, "selections"))}">All selections</a></p>`;
    return `${backAsk}<div class="stack"><div class="co-cols"><div class="stack">${pickSummary(picked, "Your pick")}${choiceNext(p, v, picked, false)}</div><aside class="stack">${confirm}</aside></div><section class="panel gbb-panel">${compare}</section></div>`;
  }
  const foot = [v.valid_until ? `Prices valid until ${longDate(v.valid_until)}.` : "", v.terms]
    .filter(Boolean)
    .join("\n\n");
  const done = chosen
    ? `<div class="co-cols"><div class="stack">${choiceNext(p, v, chosen, true)}</div><aside class="stack">${receipt(i)}</aside></div>`
    : "";
  // The question link sits beside the way back, outside the compare and its choose buttons.
  const backAsk = `<p class="cp-backrow"><a href="${esc(href(p, "selections"))}">All selections</a>${askLink(p, i, "btn secondary")}</p>`;
  return `${backAsk}<div class="stack">${done}<section class="panel gbb-panel">${compare}${foot ? `<div class="close-fine">${paras(foot)}</div>` : ""}</section></div>`;
}

// ---------- pre-construction agreement: the owner reads it, signs it or declines it ----------

type Precon = Extract<PortalItem, { kind: "precon_agreement" }>;
const precons = (p: PortalPage): Precon[] =>
  p.items
    .filter((i): i is Precon => i.kind === "precon_agreement")
    .sort((a, b) => b.shared_on.localeCompare(a.shared_on));
/** The pre-con agreement's own bills on this page, first payment first. */
const preconBills = (p: PortalPage): ServiceBill[] =>
  serviceBills(p)
    .filter((b) => b.view.work_order === "Pre-construction agreement")
    .reverse();

function preconPill(i: Precon): string {
  const d = i.decision;
  if (!d) return `<span class="pill wait">Needs your signature</span>`;
  return d.decision === "signed"
    ? `<span class="pill ok">${esc(`Signed ${longDate(d.decided_at)}`)}</span>`
    : `<span class="pill neutral">${esc(`Declined ${longDate(d.decided_at)}`)}</span>`;
}

/** The agreement as the owner reads it: what they get, who draws it, how they pay, and the terms they sign. */
function preconMain(p: PortalPage, i: Precon): string {
  const v = i.view;
  const d = i.decision;
  const third = d
    ? [d.decision === "signed" ? "Signed" : "Declined", longDate(d.decided_at)]
    : ["Sign by", i.due_on ? longDate(i.due_on) : "No date"];
  const sum = `<dl class="co-sum"><div><dt>Price</dt><dd>${esc(wholePrice(v.price_cents))}</dd></div><div><dt>Design time</dt><dd>${esc(v.design_days ? `About ${v.design_days} days` : "As agreed")}</dd></div><div><dt>${esc(third[0])}</dt><dd>${esc(third[1])}</dd></div></dl>`;
  const inc = v.includes.length
    ? `<div style="margin-top:18px"><h4>What you get</h4><ul class="inc">${v.includes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
    : "";
  const who = v.design_partner
    ? `<div style="margin-top:18px"><h4>Who draws it</h4><div class="prose"><p>${esc(`${v.design_partner}${v.design_role ? `, ${v.design_role}` : ""}, working with ${p.contractor.name}.`)}</p></div></div>`
    : "";
  const n = v.payments.length;
  const pays = serviceLines(
    v.payments.map((x) => ({
      description: n === 1 ? "Payment" : `Payment ${x.index}`,
      detail: preconDueLabel(x),
      amount_cents: x.amount_cents,
    })),
    [["Agreement total", usd(v.price_cents), "cp-total"]],
  );
  const terms = preconTerms(v, p.contractor.name, p.job.name);
  return `<section class="panel"><div class="co-head"><div><p class="eyebrow">${esc(`Pre-construction agreement · sent ${longDate(i.shared_on)}`)}</p><h2>${esc(itemLabel(i))}</h2></div>${preconPill(i)}</div>${sum}${inc}${who}</section><section class="panel"><div class="panel-head"><h2>How you pay</h2><span class="meta">${esc(n === 1 ? "1 payment" : `${n} payments`)}</span></div>${pays}<p class="fine sv-terms">Each payment shows on this page when it's due.</p></section><section class="panel"><div class="panel-head"><h2>The terms</h2><span class="meta">What you sign</span></div><ol class="terms">${terms.map((t) => `<li><b>${esc(t.heading)}.</b> ${esc(t.text)}</li>`).join("")}</ol></section>`;
}

/** After signing: the first bill to pay, or where things stand. */
function preconNext(p: PortalPage, i: Precon): string {
  const bills = preconBills(p);
  const due = bills.find((b) => billOpen(p, b));
  const partner = i.view.design_partner ?? p.contractor.name;
  const copy = `<p class="fine">${esc(`We emailed a copy of what you signed to ${p.customer.email}.`)}</p>`;
  if (due) {
    const idx = bills.indexOf(due) + 1;
    const amt = wholePrice(billDue(p, due));
    const line =
      idx === 1
        ? `Payment 1 for ${amt} is ready. Once it's paid, ${partner} starts the design.`
        : `Payment ${idx} for ${amt} is ready to pay.`;
    return `<section class="panel actions"><h2>What happens next</h2><p class="sub">${esc(line)}</p><a class="btn block" href="${esc(href(p, "billing", { i: due.id }))}">${esc(`Pay ${amt}`)}</a>${askLink(p, i)}${copy}</section>`;
  }
  const line = bills.length
    ? "You're paid up for now. The next payment shows here when it's due."
    : `${p.contractor.name} will put your first payment on this page.`;
  return `<section class="panel actions"><h2>What happens next</h2><p class="sub">${esc(line)}</p>${askLink(p, i)}${copy}</section>`;
}

function preconDetail(p: PortalPage, i: Precon, o: PortalOpts): string {
  const v = i.view;
  const co = p.contractor.name;
  const price = wholePrice(v.price_cents);
  const first = v.payments[0]!;
  let side: string;
  if (i.decision?.decision === "signed") side = `${receipt(i)}${preconNext(p, i)}`;
  else if (i.decision)
    side = `${receipt(i)}<section class="panel actions"><h2>Questions?</h2>${askLink(p, i)}</section>`;
  else if (o.step === "confirm")
    side = `<form method="post" class="panel"><h2>Sign the agreement</h2><p class="sub">We emailed a 6-digit code to ${esc(maskEmail(p.customer.email))}.</p><div class="sum"><div><span>Price</span><b>${esc(usd(v.price_cents))}</b></div><div><span>${esc(`Due ${first.due === "signing" ? "when you sign" : "first"}`)}</span><b>${esc(usd(first.amount_cents))}</b></div></div>${hidden(p, { action: "decide", item: i.id, decision: "signed", fingerprint: i.fingerprint })}<p class="statement" style="margin-top:22px">${esc(preconConsent(co, p.customer.email))}</p><label class="check"><input type="checkbox" name="consent" value="1" required> I agree to do this electronically</label><div class="field"><label for="code">Code from your email</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><p class="statement" style="margin-top:22px">${esc(preconStatement(co, p.job.name, price))}</p><label class="check"><input type="checkbox" name="agree" value="1" required> I agree</label><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "agreement", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Sign agreement</button></div></form>`;
  else if (o.step === "decline")
    side = `<form method="post" class="panel"><h2>Decline the agreement</h2><p class="sub">${esc(`${co} will see your note and follow up.`)}</p>${hidden(p, { action: "decide", item: i.id, decision: "declined", fingerprint: i.fingerprint })}<div class="field"><label for="note">What would you like changed? (optional)</label><textarea class="textarea" id="note" name="note" maxlength="2000"></textarea></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "agreement", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Decline agreement</button></div></form>`;
  else
    side = `<section class="panel actions"><h2>Your decision</h2><form method="post">${hidden(p, { action: "start", item: i.id })}<button class="btn block" type="submit">Sign the agreement</button></form><a class="btn secondary block" href="${esc(href(p, "agreement", { i: i.id, step: "decline" }))}">Decline</a>${askLink(p, i)}<p class="fine">Signing asks for a code we email you and your typed name. Your signature is recorded with the date and time.</p></section>`;
  const others = precons(p).filter((x) => x.id !== i.id);
  const earlier = others.length
    ? `<section class="panel"><div class="panel-head"><h2>${others.length === 1 ? "Other version" : "Other versions"}</h2></div>${others
        .map(
          (x) =>
            `<div class="rec"><div><h3>${esc(`Sent ${longDate(x.shared_on)}`)}</h3><div class="meta">${esc(wholePrice(x.view.price_cents))}</div></div><div class="right">${preconPill(x)}<a class="btn secondary" href="${esc(href(p, "agreement", { i: x.id }))}">View</a></div></div>`,
        )
        .join("")}</section>`
    : "";
  const back = `<p><a href="${esc(href(p, "home"))}">Back to home</a></p>`;
  return `${back}<div class="co-cols"><div class="stack">${preconMain(p, i)}</div><aside class="stack">${side}${earlier}</aside></div>`;
}

/** The Agreement tab: the agreement asked for (by link), else the one waiting to be signed, else the latest. */
function agreement(p: PortalPage, o: PortalOpts): string {
  const all = precons(p);
  const it =
    (o.item ? all.find((x) => x.id === o.item) : null) ??
    all.find((x) => !x.decision) ??
    all.find((x) => x.decision?.decision === "signed") ??
    all[0];
  if (!it)
    return `<section class="panel"><div class="panel-head"><h2>Agreement</h2></div><p class="empty">No agreement shared with you yet.</p></section>`;
  return preconDetail(p, it, o);
}

// ---------- billing: shared pay applications ----------

type PayApp = Extract<PortalItem, { kind: "pay_app" }>;
type ServiceBill = Extract<PortalItem, { kind: "service_invoice" }>;
/** What the customer can pay on this page: an approved pay application, or a service bill. */
type Payable = PayApp | ServiceBill;

/** Shared pay applications, newest period first. Only what was shared reaches the page. */
const payApps = (p: PortalPage): PayApp[] =>
  p.items
    .filter((i): i is PayApp => i.kind === "pay_app")
    .sort(
      (a, b) =>
        b.view.period_end.localeCompare(a.view.period_end) ||
        b.shared_on.localeCompare(a.shared_on),
    );
const less = (c: number) => (c < 0 ? `+${usd(-c)}` : `−${usd(c)}`);
const pctText = (n: number) => `${Number(n.toFixed(2))}%`;
/** Share of a whole as a CSS width, kept between 0 and 100. */
const width = (part: number, whole: number) =>
  whole > 0 ? `${Math.max(0, Math.min(100, (part / whole) * 100)).toFixed(2)}%` : "0%";
const period = (v: PayAppView) => `${longDate(v.period_start)} to ${longDate(v.period_end)}`;

function payPill(i: PayApp, dated = false): string {
  const d = i.decision;
  if (!d) return `<span class="pill wait">Needs you</span>`;
  const when = dated ? ` ${longDate(d.decided_at)}` : "";
  return d.decision === "approved"
    ? `<span class="pill ok">${esc(`Approved${when}`)}</span>`
    : `<span class="pill neutral">${esc(`Declined${when}`)}</span>`;
}

// ---------- paying an approved pay application online ----------

type PortalPayment = NonNullable<PortalPage["payments"]>["payments"][number];
type RecordedPayment = NonNullable<PortalPage["payments"]>["recorded"][number];
const SETTLED = ["processing", "paid", "partially_refunded", "refunded"];
/** The online payment that settles this pay application, if one is paid or on its way. */
const settledPayment = (p: PortalPage, i: Payable): PortalPayment | null =>
  p.payments?.payments.find((x) => x.item_id === i.id && SETTLED.includes(x.status)) ?? null;
/** Wire and check payments the contractor recorded on this pay application, if any. */
const recordedFor = (p: PortalPage, i: Payable): RecordedPayment | null =>
  p.payments?.recorded?.find((x) => x.item_id === i.id && x.amount_cents > 0) ?? null;
const byWord = (m: string | null) => (m === "bank" ? " by bank" : m === "card" ? " by card" : "");
const recordedWord = (m: RecordedPayment["method"]) =>
  m === "wire" ? "by wire" : m === "check" ? "by check" : "by wire and check";

type PayState =
  | { kind: "online"; x: PortalPayment }
  | { kind: "recorded"; r: RecordedPayment; left: number };
/** How this pay application stands on payment: paid in full by wire or check wins, then a payment made here,
 * then a part paid by wire or check, then a refund made here. */
function payState(p: PortalPage, i: Payable): PayState | null {
  const online = settledPayment(p, i);
  const r = recordedFor(p, i);
  const left = r ? Math.max(i.view.totals.current_due_cents - r.amount_cents, 0) : 0;
  if (r && left === 0) return { kind: "recorded", r, left };
  if (online && online.status !== "refunded") return { kind: "online", x: online };
  if (r) return { kind: "recorded", r, left };
  return online ? { kind: "online", x: online } : null;
}

/** The pill a pay application shows once paid, or null to show its decision. */
function paidPill(p: PortalPage, i: Payable): string | null {
  const s = payState(p, i);
  if (!s) return null;
  if (s.kind === "recorded")
    return s.left === 0
      ? `<span class="pill ok">Paid</span>`
      : `<span class="pill wait">Partly paid</span>`;
  if (s.x.status === "processing") return `<span class="pill wait">Payment on its way</span>`;
  if (s.x.status === "refunded") return `<span class="pill neutral">Refunded</span>`;
  return `<span class="pill ok">Paid</span>`;
}

/** The word under the amount due on the billing card. */
function paidWord(p: PortalPage, i: Payable): string | null {
  const s = payState(p, i);
  if (!s) return null;
  if (s.kind === "recorded") return s.left === 0 ? "paid" : `${usd(s.left)} still due`;
  return s.x.status === "processing"
    ? "payment on its way"
    : s.x.status === "refunded"
      ? "refunded"
      : "paid";
}

const recordedLine = (r: RecordedPayment) =>
  `Received ${usd(r.amount_cents)} ${recordedWord(r.method)}${r.received_on ? ` on ${longDate(r.received_on)}` : ""}.`;

/** A wire or check payment the contractor recorded: paid in full, or a part with the rest still due. */
function recordedBox(p: PortalPage, r: RecordedPayment, left: number): string {
  const fine = `<p class="fine">${esc(`${p.contractor.name} recorded this payment. Questions about it go to your project team.`)}</p>`;
  if (left === 0)
    return `<section class="panel pp"><div class="pp-done"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><div><b>Paid</b><span>${esc(recordedLine(r))}</span></div></div>${fine}</section>`;
  return `<section class="panel pp"><div class="panel-head"><h2>Partly paid</h2><span class="pill wait">${esc(`${usd(left)} still due`)}</span></div><p class="pp-line">${esc(recordedLine(r))}</p>${fine}</section>`;
}

/** Where the customer's online payment stands, once there is one. */
function paidBox(x: PortalPayment): string {
  const amt = usd(x.amount_cents);
  const test = x.test ? `<p class="pp-test">Test payment. No real money moved.</p>` : "";
  if (x.status === "processing")
    return `<section class="panel pp"><div class="panel-head"><h2>Payment on its way</h2><span class="pill wait">Clearing</span></div>${test}<p class="pp-line">${esc(`Your ${amt} bank payment started ${longDate(x.updated_at)}.`)}</p><p class="fine">Banks take a few business days to clear it. This page shows it as paid once it does.</p></section>`;
  const refunded = x.refunded_cents ?? 0;
  const line =
    x.status === "refunded"
      ? `Paid ${amt}${byWord(x.method)} on ${longDate(x.paid_at)}, then refunded in full.`
      : x.status === "partially_refunded"
        ? `Paid ${amt}${byWord(x.method)} on ${longDate(x.paid_at)}. ${usd(refunded)} was refunded.`
        : `Paid ${amt}${byWord(x.method)} on ${longDate(x.paid_at)}.`;
  return `<section class="panel pp"><div class="pp-done"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><div><b>${x.status === "refunded" ? "Refunded" : "Paid"}</b><span>${esc(line)}</span></div></div>${test}<p class="fine">Stripe emailed your receipt. Questions about it go to your project team.</p></section>`;
}

/** The Pay by bank and Pay by card buttons, when the contractor's own Stripe is set up and takes this amount. */
function onlineButtons(p: PortalPage, i: Payable, due = i.view.totals.current_due_cents): string {
  const pay = p.payments;
  if (!pay?.accepting || due <= 0) return "";
  const cardOk = pay.card && due <= pay.card_max_cents;
  const btn = (method: "bank" | "card", label: string, primary: boolean) =>
    `<form method="post">${hidden(p, { action: "pay", item: i.id, method })}<button class="btn${primary ? "" : " secondary"} block" type="submit">${label}</button></form>`;
  return [
    pay.bank ? btn("bank", "Pay by bank", true) : "",
    cardOk ? btn("card", "Pay by card", !pay.bank) : "",
  ].join("");
}

/** Bills the owner can pay by check from this page (pre-construction bills for now). */
const checkable = (p: PortalPage, i: ServiceBill) => (p.check_items ?? []).includes(i.id);
const checkFor = (p: PortalPage, i: ServiceBill): PortalCheck | null =>
  p.checks?.find((c) => c.item_id === i.id) ?? null;

/** No online payments here: tell the contractor you're paying by check. */
function checkOnlyBox(p: PortalPage, i: ServiceBill): string {
  const co = p.contractor.name;
  return `<section class="panel pp"><div class="panel-head"><h2>${esc(`Pay ${usd(billDue(p, i))}`)}</h2></div><p class="sub">${esc(`${co} takes checks for this bill. Tell them you're paying by check and they'll set a time to collect it.`)}</p><div class="pp-btns"><a class="btn block" href="${esc(href(p, "billing", { i: i.id, step: "check" }))}">Pay by check</a></div><p class="fine">${esc(`Make the check out to ${co}.`)}</p></section>`;
}

/** The owner said they're paying by check: waiting on a date, or the pickup the contractor set. */
function checkBox(p: PortalPage, i: ServiceBill, c: PortalCheck): string {
  const co = p.contractor.name;
  const amount = `<div><span>Amount</span><b>${esc(usd(billDue(p, i)))}</b></div>`;
  if (!c.pickup_on)
    return `<section class="panel pp"><div class="panel-head"><h2>Paying by check</h2><span class="pill wait">Waiting on a date</span></div><div class="sum">${amount}</div><p class="ck-note">${esc(`You told ${co} you're paying by check. They'll set a date to collect it, and you'll see it here and by email.`)}</p>${c.note ? `<p class="fine">${esc(`Your note: ${c.note}`)}</p>` : ""}${askLink(p, i)}</section>`;
  const who = c.pickup_by ? `<b>${esc(c.pickup_by)}</b> from ${esc(co)}` : esc(co);
  const where = c.pickup_place ? ` at ${esc(c.pickup_place)}` : "";
  return `<section class="panel pp"><div class="panel-head"><h2>Paying by check</h2><span class="pill neutral">Pickup set</span></div><div class="sum">${amount}<div><span>Collected on</span><b>${esc(dayName(c.pickup_on))}, ${esc(longDate(c.pickup_on))}</b></div>${c.pickup_window ? `<div><span>Time</span><b>${esc(c.pickup_window)}</b></div>` : ""}</div><p class="ck-note">${who} will collect it${where}. This bill shows paid once they record the check.</p><a class="btn secondary block" href="${esc(href(p, "messages", { about: i.id }))}#write">Ask about the pickup</a></section>`;
}

/** The form that tells the contractor you're paying by check. */
function checkForm(p: PortalPage, i: ServiceBill): string {
  const co = p.contractor.name;
  return `<form method="post" class="panel"><h2>Pay by check</h2><p class="sub">${esc(`${co} gets a note that you're paying by check, then sets a date to collect it. You'll see the date here and by email.`)}</p><div class="sum"><div><span>Amount</span><b>${esc(usd(billDue(p, i)))}</b></div><div><span>Bill</span><b>${esc(i.view.number)}</b></div></div>${hidden(p, { action: "check_request", item: i.id })}<div class="field"><label for="note">Good days and times to collect it (optional)</label><textarea class="textarea" id="note" name="note" maxlength="1000"></textarea></div><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "billing", { i: i.id }))}">Cancel</a><button class="btn" type="submit">${esc(`Send to ${co}`)}</button></div></form>`;
}

/** Pay an approved pay application by bank or card, on a Stripe page for the contractor's own account. */
function payBox(p: PortalPage, i: Payable): string {
  const pay = p.payments;
  // A bill the owner can pay by check: once they've said so, the check panel takes over; with no online
  // payments set up, paying by check is the way to pay.
  if (i.kind === "service_invoice" && checkable(p, i) && billOpen(p, i)) {
    const chk = checkFor(p, i);
    if (chk?.requested_at || chk?.pickup_on) return checkBox(p, i, chk);
    const online = pay ? onlineButtons(p, i) : "";
    if (!online) return checkOnlyBox(p, i);
  }
  if (!pay || (i.kind === "pay_app" && i.decision?.decision !== "approved")) return "";
  const state = payState(p, i);
  if (state?.kind === "online" && state.x.status !== "refunded") return paidBox(state.x);
  if (state?.kind === "recorded" && state.left === 0) return recordedBox(p, state.r, 0);
  const part = state?.kind === "recorded" ? state.r : null;
  const due = state?.kind === "recorded" ? state.left : i.view.totals.current_due_cents;
  if (!pay.accepting || due <= 0)
    return part ? recordedBox(p, part, due) : state?.kind === "online" ? paidBox(state.x) : "";
  const cardOk = pay.card && due <= pay.card_max_cents;
  const online = onlineButtons(p, i, due);
  const byCheck = i.kind === "service_invoice" && checkable(p, i);
  const buttons = byCheck
    ? `${online}<a class="btn secondary block" href="${esc(href(p, "billing", { i: i.id, step: "check" }))}">Pay by check</a>`
    : online;
  if (!online) return part ? recordedBox(p, part, due) : "";
  const last = p.payments?.payments.find((x) => x.item_id === i.id);
  const failed =
    last?.status === "failed"
      ? `<p class="pp-warn">Your last payment didn't go through, so nothing was charged. You can try again.</p>`
      : "";
  const test = pay.test
    ? `<p class="pp-test">Test mode. No real money moves, and only Stripe's test bank and card details work.</p>`
    : "";
  const cardNote =
    pay.card && !cardOk
      ? `<p class="fine">${esc(`Card payments are open up to ${usd(pay.card_max_cents)}, so pay this one by bank.`)}</p>`
      : "";
  const how = `${
    pay.bank
      ? "You'll finish on a secure Stripe page. Bank payments take a few business days to clear."
      : "You'll finish on a secure Stripe page."
  }${byCheck ? " Paying by check? Tell us here and we'll set a time to collect it." : ""}`;
  const received = part
    ? `<p class="pp-line">${esc(`${recordedLine(part)} ${usd(due)} is left to pay.`)}</p>`
    : "";
  return `<section class="panel pp"><div class="panel-head"><h2>${esc(`Pay ${usd(due)}`)}</h2></div><p class="sub">${esc(i.kind === "pay_app" ? `You approved ${itemLabel(i)}. Pay it here and ${p.contractor.name} gets it directly.` : `Pay ${itemLabel(i)} here and ${p.contractor.name} gets it directly.`)}</p>${received}${test}${failed}<div class="pp-btns">${buttons}</div>${cardNote}<p class="fine">${esc(how)}</p></section>`;
}

/** The plain-words math: work done and stored, less what you hold back, less what you already approved. */
function payMath(v: PayAppView): string {
  const t = v.totals;
  const held =
    t.retainage_percent === null
      ? "Held back (retainage)"
      : `Held back, ${pctText(t.retainage_percent)} (retainage)`;
  return `<dl class="pay-math"><div><dt>Work done and materials stored</dt><dd>${esc(usd(t.completed_and_stored_cents))}</dd></div><div class="cp-less"><dt>${esc(held)}<span>You keep it until the job is finished and accepted.</span></dt><dd>${esc(less(t.retainage_cents))}</dd></div><div class="cp-less"><dt>Already approved</dt><dd>${esc(less(t.previous_certified_cents))}</dd></div><div class="cp-total"><dt>Due now</dt><dd>${esc(usd(t.current_due_cents))}</dd></div></dl>`;
}

const LINE_LEGEND = `<ul class="cp-legend cp-inline" aria-hidden="true"><li><i class="cp-prev"></i>Before this bill</li><li><i class="cp-now"></i>This bill</li><li><i class="cp-stored"></i>Materials stored</li></ul>`;

/** Each SOV line with a bar of what was billed before and what this bill adds. */
function payLines(v: PayAppView): string {
  const rows = v.lines
    .map((l) => {
      const pct = l.percent_complete === null ? null : pctText(l.percent_complete);
      const bar =
        l.scheduled_cents > 0
          ? `<div class="cp-bar" role="img" aria-label="${esc(`${pct ?? "Not measured"} complete: ${usd(l.previous_cents)} before this bill, ${usd(l.this_period_cents)} this bill, ${usd(l.stored_cents)} materials stored`)}"><span class="cp-seg cp-prev" style="width:${width(l.previous_cents, l.scheduled_cents)}"></span><span class="cp-seg cp-now" style="width:${width(l.this_period_cents, l.scheduled_cents)}"></span><span class="cp-seg cp-stored" style="width:${width(l.stored_cents, l.scheduled_cents)}"></span></div>`
          : "";
      const meta = [
        pct ? `${pct} complete` : null,
        `this bill ${usd(l.this_period_cents)}`,
        l.stored_cents ? `${usd(l.stored_cents)} materials stored` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div class="cp-wl"><div class="cp-wl-top"><b>${esc(l.description || l.item)}</b><span class="cp-money">${esc(`${usd(l.completed_to_date_cents)} of ${usd(l.scheduled_cents)}`)}</span></div>${bar}<div class="cp-wl-meta">${esc(meta)}</div></div>`;
    })
    .join("");
  return `${LINE_LEGEND}<div class="cp-wls">${rows}</div>`;
}

function contractCard(i: PayApp): string {
  const v = i.view;
  const rows = [
    v.original_contract_cents !== null
      ? `<div><dt>Original contract</dt><dd>${esc(usd(v.original_contract_cents))}</dd></div>`
      : "",
    v.approved_changes_cents !== null
      ? `<div><dt>Approved change orders</dt><dd>${esc(signedUsd(v.approved_changes_cents))}</dd></div>`
      : "",
    `<div class="cp-total"><dt>Contract total</dt><dd>${esc(usd(v.contract_total_cents))}</dd></div>`,
    `<div><dt>Work done and stored to date</dt><dd>${esc(usd(v.totals.completed_and_stored_cents))}</dd></div>`,
    `<div><dt>Left to finish</dt><dd>${esc(usd(Math.max(0, v.contract_total_cents - v.totals.completed_and_stored_cents)))}</dd></div>`,
  ].join("");
  return `<section class="panel cp-contract"><div class="panel-head"><h2>Your contract</h2><span class="meta">${esc(`As of ${itemLabel(i)}`)}</span></div><dl class="cp-kv">${rows}</dl></section>`;
}

/** Home rail without a shared pay application: the contract and what the owner has approved so far. */
function progressMoney(p: PortalPage): string {
  const g = p.progress;
  if (!g) return "";
  const rest = Math.max(0, g.contract_cents - g.approved_cents);
  return `<section class="panel cp-money"><div class="panel-head"><h2>Money at a glance</h2><a class="meta" href="${esc(href(p, "billing"))}">Billing</a></div><p class="cp-big">${esc(usd(g.contract_cents))}<span>Contract total</span></p><div class="cp-bar cp-tall" role="img" aria-label="${esc(`Approved ${usd(g.approved_cents)}, remaining ${usd(rest)}, of ${usd(g.contract_cents)}`)}"><span class="cp-seg cp-prev" style="width:${width(g.approved_cents, g.contract_cents)}"></span><span class="cp-seg cp-rest" style="width:${width(rest, g.contract_cents)}"></span></div><ul class="cp-legend"><li><i class="cp-prev"></i><span>Approved so far</span><b>${esc(usd(g.approved_cents))}</b></li><li><i class="cp-rest"></i><span>Remaining</span><b>${esc(usd(rest))}</b></li></ul></section>`;
}

/** Home rail: the contract total and where the money stands, from shared pay applications only. */
function moneyPanel(p: PortalPage): string {
  const latest = payApps(p)[0];
  if (!latest) return progressMoney(p);
  const v = latest.view;
  const t = v.totals;
  const total = v.contract_total_cents;
  const settled = latest.decision?.decision === "approved";
  const approved = Math.max(0, t.previous_certified_cents + (settled ? t.current_due_cents : 0));
  const bill = settled ? 0 : Math.max(0, t.current_due_cents);
  const rest = Math.max(0, total - approved - bill);
  const label = settled
    ? "No bill waiting"
    : latest.decision
      ? "This bill (declined)"
      : "This bill";
  return `<section class="panel cp-money"><div class="panel-head"><h2>Money at a glance</h2><a class="meta" href="${esc(href(p, "billing"))}">Billing</a></div><p class="cp-big">${esc(usd(total))}<span>Contract total</span></p><div class="cp-bar cp-tall" role="img" aria-label="${esc(`Approved ${usd(approved)}, ${label.toLowerCase()} ${usd(bill)}, remaining ${usd(rest)}, of ${usd(total)}`)}"><span class="cp-seg cp-prev" style="width:${width(approved, total)}"></span><span class="cp-seg cp-now" style="width:${width(bill, total)}"></span><span class="cp-seg cp-rest" style="width:${width(rest, total)}"></span></div><ul class="cp-legend"><li><i class="cp-prev"></i><span>Approved</span><b>${esc(usd(approved))}</b></li><li><i class="cp-now"></i><span>${esc(label)}</span><b>${esc(usd(bill))}</b></li><li><i class="cp-rest"></i><span>Remaining</span><b>${esc(usd(rest))}</b></li></ul>${t.retainage_cents > 0 ? `<p class="fine cp-money-fine">${esc(`Remaining includes ${usd(t.retainage_cents)} held back (retainage) until the job is finished and accepted.`)}</p>` : ""}</section>`;
}

function billing(p: PortalPage): string {
  const apps = payApps(p);
  if (!apps.length)
    return `<section class="panel"><div class="panel-head"><h2>Billing</h2></div><p class="empty">No pay applications shared with you yet.</p></section>`;
  const latest = apps[0]!;
  const v = latest.view;
  const dueWord =
    paidWord(p, latest) ??
    (latest.decision
      ? latest.decision.decision === "approved"
        ? "approved"
        : "declined"
      : "due now");
  const head = `<section class="panel pay-card"><div class="pay-head"><div><p class="eyebrow">${esc(`Latest pay application · ${period(v)}`)}</p><h2>${esc(itemLabel(latest))}</h2></div>${paidPill(p, latest) ?? payPill(latest)}</div><p class="pay-due">${esc(usd(v.totals.current_due_cents))}<span>${esc(dueWord)}</span></p>${latest.decision ? "" : dueChip(p, latest.due_on, "Approve")}${payMath(v)}<div class="form-actions"><a class="btn${latest.decision ? " secondary" : ""}" href="${esc(href(p, "billing", { i: latest.id }))}">${latest.decision ? "View" : "Review and approve"}</a></div></section>`;
  const lines = `<section class="panel"><div class="panel-head"><h2>Work by line</h2><span class="meta">${esc(`Work through ${longDate(v.period_end)}`)}</span></div>${payLines(v)}</section>`;
  const history = `<section class="panel"><div class="panel-head"><h2>Billing history</h2><span class="meta">${apps.length} ${apps.length === 1 ? "pay application" : "pay applications"}</span></div>${apps
    .map(
      (i) =>
        `<div class="rec"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">${esc(`Work through ${longDate(i.view.period_end)} · shared ${longDate(i.shared_on)}`)}</div></div><div class="right"><span class="cp-money">${esc(usd(i.view.totals.current_due_cents))}</span>${paidPill(p, i) ?? payPill(i, true)}<a class="btn secondary" href="${esc(href(p, "billing", { i: i.id }))}">${i.decision ? "View" : "Review"}</a></div></div>`,
    )
    .join("")}</section>`;
  return `<div class="grid-home"><div class="stack">${head}${payBox(p, latest)}${lines}${history}</div><aside class="rail">${contractCard(latest)}${contactPanel(p)}</aside></div>`;
}

function payAppDetail(p: PortalPage, i: PayApp, o: PortalOpts): string {
  const v = i.view;
  const t = v.totals;
  const label = itemLabel(i);
  const back = `<p><a href="${esc(href(p, "billing"))}">All billing</a></p>`;
  const statement = approvalStatement({
    kind: "pay_app",
    company: p.contractor.name,
    label,
    price: usd(t.current_due_cents),
    periodEnd: longDate(v.period_end),
  });
  let side: string;
  if (i.decision)
    side = `${payBox(p, i)}${receipt(i)}<section class="panel actions"><h2>Questions?</h2>${askLink(p, i)}</section>`;
  else if (o.step === "confirm")
    side = `<form method="post" class="panel"><h2>${esc(`Approve ${label}`)}</h2><p class="sub">We emailed a 6-digit code to ${esc(maskEmail(p.customer.email))}.</p><div class="sum"><div><span>Due now</span><b>${esc(usd(t.current_due_cents))}</b></div><div><span>Work through</span><b>${esc(longDate(v.period_end))}</b></div></div>${hidden(p, { action: "decide", item: i.id, decision: "approved", fingerprint: i.fingerprint })}<div class="field"><label for="code">Code from your email</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><p class="statement">${esc(statement)}</p><label class="check"><input type="checkbox" name="agree" value="1" required> I agree</label><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "billing", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Approve pay application</button></div></form>`;
  else if (o.step === "decline")
    side = `<form method="post" class="panel"><h2>${esc(`Decline ${label}`)}</h2><p class="sub">${esc(p.contractor.name)} will see your note and follow up.</p>${hidden(p, { action: "decide", item: i.id, decision: "declined", fingerprint: i.fingerprint })}<div class="field"><label for="note">What doesn't look right? (optional)</label><textarea class="textarea" id="note" name="note" maxlength="2000"></textarea></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "billing", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Decline pay application</button></div></form>`;
  else
    side = `<section class="panel actions"><h2>Your decision</h2><form method="post">${hidden(p, { action: "start", item: i.id })}<button class="btn block" type="submit">Approve</button></form><a class="btn secondary block" href="${esc(href(p, "billing", { i: i.id, step: "decline" }))}">Decline</a>${askLink(p, i)}<p class="fine">Approving asks for a code we email you and your typed name. Your decision is recorded with the date and time.</p></section>`;
  const sum = `<dl class="co-sum"><div><dt>Due now</dt><dd>${esc(usd(t.current_due_cents))}</dd></div><div><dt>Work through</dt><dd>${esc(longDate(v.period_end))}</dd></div><div><dt>Approve by</dt><dd>${esc(i.due_on ? longDate(i.due_on) : "No date")}</dd></div></dl>`;
  const main = `<section class="panel"><div class="co-head"><div><p class="eyebrow">${esc(`Pay application · shared ${longDate(i.shared_on)} · ${period(v)}`)}</p><h2>${esc(label)}</h2></div>${paidPill(p, i) ?? payPill(i)}</div>${sum}<h4 class="pay-h">How this amount adds up</h4>${payMath(v)}</section><section class="panel"><div class="panel-head"><h2>Work by line</h2></div>${payLines(v)}</section>`;
  return `${back}<div class="co-cols"><div class="stack">${main}</div><aside class="stack">${side}${contractCard(i)}</aside></div>`;
}

// ---------- service calls: work orders and their bills ----------

type WorkOrder = Extract<PortalItem, { kind: "work_order" }>;

/** The tabs a page shows: a service call shows only what a service customer uses. */
function sectionsFor(p: PortalPage): readonly PortalSection[] {
  // The Agreement tab shows once a pre-construction agreement has been shared.
  if (!isService(p))
    return p.items.some((i) => i.kind === "precon_agreement")
      ? PORTAL_SECTIONS
      : PORTAL_SECTIONS.filter((s) => s !== "agreement");
  return p.photos.some((ph) => ph.url)
    ? ["home", "work", "billing", "photos", "messages"]
    : ["home", "work", "billing", "messages"];
}

const workOrders = (p: PortalPage): WorkOrder[] =>
  p.items.filter((i): i is WorkOrder => i.kind === "work_order");
/** Service bills, newest first. */
const serviceBills = (p: PortalPage): ServiceBill[] =>
  p.items
    .filter((i): i is ServiceBill => i.kind === "service_invoice")
    .sort((a, b) => b.shared_on.localeCompare(a.shared_on));

/** What's still owed on a service bill after payments made here or recorded by the contractor. */
function billDue(p: PortalPage, i: ServiceBill): number {
  const s = payState(p, i);
  if (!s) return i.view.totals.current_due_cents;
  if (s.kind === "recorded") return s.left;
  return 0;
}
function billOpen(p: PortalPage, i: ServiceBill): boolean {
  return billDue(p, i) > 0;
}
function billPill(p: PortalPage, i: ServiceBill): string {
  const chk = billOpen(p, i) ? checkFor(p, i) : null;
  if (chk?.pickup_on)
    return `<span class="pill neutral">${esc(`Check pickup ${shortDate(chk.pickup_on)}`)}</span>`;
  if (chk?.requested_at) return `<span class="pill neutral">Paying by check</span>`;
  return (
    paidPill(p, i) ??
    (billOpen(p, i) ? `<span class="pill wait">Due</span>` : `<span class="pill ok">Paid</span>`)
  );
}

function woPill(i: WorkOrder): string {
  if (!i.decision) return `<span class="pill wait">Needs your decision</span>`;
  return i.decision.decision === "approved"
    ? `<span class="pill ok">Approved ${esc(longDate(i.decision.decided_at))}</span>`
    : `<span class="pill neutral">Declined ${esc(longDate(i.decision.decided_at))}</span>`;
}

/** The blue top of a service call's page: who's coming, where, and what's owed. */
function serviceHero(p: PortalPage): string {
  const c = p.contractor;
  const wo = workOrders(p)[0];
  const bill = serviceBills(p)[0];
  const address = wo?.view.site_address ?? bill?.view.site_address ?? null;
  const owed = serviceBills(p).reduce((s, b) => s + billDue(p, b), 0);
  const waiting = p.items.filter((i) => open(p, i)).length;
  const lede =
    wo && !wo.decision
      ? `${wo.view.number} is ready for your approval.`
      : owed > 0
        ? `${usd(owed)} is due on your service call.`
        : `Your service call with ${c.name}.`;
  const chips = waiting
    ? `<span class="chip attn"><i></i>${waiting} ${waiting === 1 ? "item needs you" : "items need you"}</span>`
    : `<span class="chip"><i></i>Up to date</span>`;
  const rows = [
    address ? `<div class="snap-row"><span>Service address</span><b>${esc(address)}</b></div>` : "",
    wo
      ? `<div class="snap-row"><span>Work order</span><b>${esc(`${wo.view.number} · ${wo.view.basis_label}`)}</b></div>`
      : "",
    `<div class="snap-row"><span>Balance due</span><b>${esc(usd(owed))}</b></div>`,
  ].join("");
  return `<div class="wrap hero-in"><div><p class="h-eyebrow">Service call ${esc(p.job.number)}</p><h1>${esc(p.job.name)}</h1><p class="lede">${esc(lede)}</p><div class="chips">${chips}</div></div><div class="snap no-ring"><div class="snap-rows">${rows}</div></div></div>`;
}

/** A service call's home: what needs the customer, the work orders and bills, and the team. */
function serviceHome(p: PortalPage): string {
  const wos = workOrders(p);
  const bills = serviceBills(p);
  const rows = [
    ...wos.map(
      (i) =>
        `<div class="rec"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">${esc(`${i.view.basis_label} · ${woShort(i.view)}`)}</div></div><div class="right">${woPill(i)}<a class="btn secondary" href="${esc(href(p, "work", { i: i.id }))}">${i.decision ? "View" : "Review"}</a></div></div>`,
    ),
    ...bills.map(
      (i) =>
        `<div class="rec"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">${esc(`Sent ${longDate(i.shared_on)}`)}</div></div><div class="right"><span class="cp-money">${esc(usd(i.view.totals.current_due_cents))}</span>${billPill(p, i)}<a class="btn secondary" href="${esc(href(p, "billing", { i: i.id }))}">${billOpen(p, i) ? "Pay" : "View"}</a></div></div>`,
    ),
  ].join("");
  const list = `<section class="panel"><div class="panel-head"><h2>Your service call</h2></div>${rows || `<p class="empty">${esc(p.contractor.name)} hasn't shared anything yet. Work orders and bills show here.</p>`}</section>`;
  const shown = p.photos.filter((ph) => ph.url);
  const photos = shown.length
    ? `<section class="panel"><div class="panel-head"><h2>Photos</h2><a class="meta" href="${esc(href(p, "photos"))}">See all ${shown.length}</a></div>${photoGrid(shown.slice(0, 2), "thumbs")}</section>`
    : "";
  return `<div class="grid-home"><div class="stack">${decideBox(p)}${list}</div><aside class="rail">${contactPanel(p)}${photos}</aside></div>`;
}

function workOrderList(p: PortalPage): string {
  const wos = workOrders(p);
  if (!wos.length)
    return `<section class="panel"><div class="panel-head"><h2>Work orders</h2></div><p class="empty">No work orders shared with you.</p></section>`;
  const rows = wos
    .map(
      (i) =>
        `<div class="rec"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">${esc(`Shared ${longDate(i.shared_on)} · ${i.view.basis_label}`)}</div></div><div class="right"><span class="money">${esc(woShort(i.view))}</span>${woPill(i)}<a class="btn secondary" href="${esc(href(p, "work", { i: i.id }))}">${i.decision ? "View" : "Review"}</a></div></div>`,
    )
    .join("");
  return `<section class="panel"><div class="panel-head"><h2>Work orders</h2></div>${rows}</section>`;
}

/** The priced lines of a work order or a bill, then its totals. */
function serviceLines(
  lines: { description: string; detail: string | null; amount_cents: number }[],
  totals: [string, string, string?][],
): string {
  const ls = lines
    .map(
      (l) =>
        `<div class="sv-line"><div><b>${esc(l.description)}</b>${l.detail ? `<span>${esc(l.detail)}</span>` : ""}</div><span class="cp-money">${esc(usd(l.amount_cents))}</span></div>`,
    )
    .join("");
  const ts = totals
    .map(
      ([k, v, cls]) =>
        `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`,
    )
    .join("");
  return `<div class="sv-lines">${ls}</div><dl class="pay-math">${ts}</dl>`;
}

function woTotals(v: WorkOrderView): [string, string, string?][] {
  const t = v.totals;
  const out: [string, string, string?][] = [];
  if (t.items_cents) out.push(["Items", usd(t.items_cents)]);
  if (t.labor_cents) out.push(["Labor", usd(t.labor_cents)]);
  if (t.material_cents) out.push(["Materials", usd(t.material_cents)]);
  if (t.markup_cents) out.push(["Markup on materials", usd(t.markup_cents)]);
  out.push([v.basis === "unit_price" ? "Total" : "Estimate", usd(t.estimate_cents), "cp-total"]);
  if (t.cap_cents !== null) out.push(["Won't go over without your approval", usd(t.cap_cents)]);
  if (t.fee_credit_cents)
    out.push(["Service call fee credited on the bill", less(t.fee_credit_cents), "cp-less"]);
  return out;
}

function workOrderDetail(p: PortalPage, i: WorkOrder, o: PortalOpts): string {
  const v = i.view;
  const label = itemLabel(i);
  const back = `<p><a href="${esc(href(p, "work"))}">All work orders</a></p>`;
  const statement = approvalStatement({
    kind: "work_order",
    company: p.contractor.name,
    label,
    price: workOrderPrice(v),
  });
  const priceWord =
    v.basis === "unit_price" ? "Total" : v.totals.cap_cents !== null ? "Up to" : "Estimate";
  const priceVal = usd(
    v.basis !== "unit_price" && v.totals.cap_cents !== null
      ? v.totals.cap_cents
      : v.totals.estimate_cents,
  );
  let side: string;
  if (i.decision)
    side = `${receipt(i)}<section class="panel actions"><h2>${i.decision.decision === "approved" ? "What happens next" : "Questions?"}</h2>${i.decision.decision === "approved" ? `<p class="sub">${esc(`${p.contractor.name} starts the work. Your bill shows here once it's done.`)}</p>` : ""}${askLink(p, i)}</section>`;
  else if (o.step === "confirm")
    side = `<form method="post" class="panel"><h2>${esc(`Approve ${v.number}`)}</h2><p class="sub">We emailed a 6-digit code to ${esc(maskEmail(p.customer.email))}.</p><div class="sum"><div><span>${esc(priceWord)}</span><b>${esc(priceVal)}</b></div><div><span>Billed by</span><b>${esc(v.basis_label)}</b></div></div>${hidden(p, { action: "decide", item: i.id, decision: "approved", fingerprint: i.fingerprint })}<div class="field"><label for="code">Code from your email</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><p class="statement">${esc(statement)}</p><label class="check"><input type="checkbox" name="agree" value="1" required> I agree</label><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "work", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Approve work order</button></div></form>`;
  else if (o.step === "decline")
    side = `<form method="post" class="panel"><h2>${esc(`Decline ${v.number}`)}</h2><p class="sub">${esc(p.contractor.name)} will see your note and follow up.</p>${hidden(p, { action: "decide", item: i.id, decision: "declined", fingerprint: i.fingerprint })}<div class="field"><label for="note">What would you like changed? (optional)</label><textarea class="textarea" id="note" name="note" maxlength="2000"></textarea></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "work", { i: i.id }))}">Cancel</a><button class="btn" type="submit">Decline work order</button></div></form>`;
  else
    side = `<section class="panel actions"><h2>Your decision</h2><form method="post">${hidden(p, { action: "start", item: i.id })}<button class="btn block" type="submit">Approve</button></form><a class="btn secondary block" href="${esc(href(p, "work", { i: i.id, step: "decline" }))}">Decline</a>${askLink(p, i)}<p class="fine">Approving asks for a code we email you and your typed name. Your decision is recorded with the date and time.</p></section>`;
  const sum = `<dl class="co-sum"><div><dt>${esc(priceWord)}</dt><dd>${esc(priceVal)}</dd></div><div><dt>Billed by</dt><dd>${esc(v.basis_label)}</dd></div><div><dt>Reply by</dt><dd>${esc(i.due_on ? longDate(i.due_on) : "No date")}</dd></div></dl>`;
  const words = `${v.findings ? `<h4>What we found</h4><div class="prose">${paras(v.findings)}</div>` : ""}${v.scope ? `<h4>What we'll do</h4><div class="prose">${paras(v.scope)}</div>` : ""}`;
  const main = `<section class="panel"><div class="co-head"><div><p class="eyebrow">${esc(`Work order · shared ${longDate(i.shared_on)}${v.site_address ? ` · ${v.site_address}` : ""}`)}</p><h2>${esc(label)}</h2></div>${i.decision ? woPill(i) : `<span class="pill wait">Needs your decision</span>`}</div>${sum}${words ? `<div style="margin-top:18px">${words}</div>` : ""}</section><section class="panel"><div class="panel-head"><h2>How it's priced</h2><span class="meta">${esc(v.basis_label)}</span></div>${serviceLines(v.lines, woTotals(v))}<p class="fine sv-terms">${esc(v.terms)}</p></section>`;
  return `${back}<div class="co-cols"><div class="stack">${main}</div><aside class="stack">${side}</aside></div>`;
}

function billTotals(v: ServiceInvoiceView): [string, string, string?][] {
  const t = v.totals;
  const out: [string, string, string?][] = [];
  if (t.credit_cents) {
    out.push(["Work", usd(t.subtotal_cents)]);
    out.push(["Service call fee you paid", less(t.credit_cents), "cp-less"]);
  }
  out.push(["Due", usd(t.current_due_cents), "cp-total"]);
  return out;
}

/** A service call's billing: each bill, what's due, and the way to pay it. */
function serviceBilling(p: PortalPage): string {
  const bills = serviceBills(p);
  if (!bills.length)
    return `<section class="panel"><div class="panel-head"><h2>Billing</h2></div><p class="empty">No bills shared with you yet.</p></section>`;
  const due = bills.find((b) => billOpen(p, b)) ?? bills[0]!;
  const v = due.view;
  const head = `<section class="panel pay-card"><div class="pay-head"><div><p class="eyebrow">${esc(v.stage === "fee" ? "Service call fee" : `Bill for ${v.work_order ?? "the work"}`)}</p><h2>${esc(itemLabel(due))}</h2></div>${billPill(p, due)}</div><p class="pay-due">${esc(usd(billOpen(p, due) ? billDue(p, due) : v.totals.current_due_cents))}<span>${esc(paidWord(p, due) ?? "due now")}</span></p>${billOpen(p, due) ? dueChip(p, due.due_on, "Pay") : ""}<div class="form-actions"><a class="btn secondary" href="${esc(href(p, "billing", { i: due.id }))}">See the bill</a></div></section>`;
  const history = `<section class="panel"><div class="panel-head"><h2>All bills</h2><span class="meta">${bills.length} ${bills.length === 1 ? "bill" : "bills"}</span></div>${bills
    .map(
      (i) =>
        `<div class="rec"><div><h3>${esc(itemLabel(i))}</h3><div class="meta">${esc(`Sent ${longDate(i.shared_on)}`)}</div></div><div class="right"><span class="cp-money">${esc(usd(i.view.totals.current_due_cents))}</span>${billPill(p, i)}<a class="btn secondary" href="${esc(href(p, "billing", { i: i.id }))}">View</a></div></div>`,
    )
    .join("")}</section>`;
  return `<div class="grid-home"><div class="stack">${head}${payBox(p, due)}${history}</div><aside class="rail">${contactPanel(p)}</aside></div>`;
}

function serviceBillDetail(p: PortalPage, i: ServiceBill, o: PortalOpts): string {
  const v = i.view;
  const back = `<p><a href="${esc(href(p, "billing"))}">All billing</a></p>`;
  const signed = v.signoff
    ? `<p class="sv-sign"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${esc(`Work signed off by ${v.signoff.name} on ${longDate(v.signoff.date)}.`)}</p>`
    : "";
  const sum = `<dl class="co-sum"><div><dt>Due</dt><dd>${esc(usd(v.totals.current_due_cents))}</dd></div><div><dt>${esc(v.work_order ? "Work order" : "For")}</dt><dd>${esc(v.work_order ?? "Service call")}</dd></div><div><dt>Pay by</dt><dd>${esc(i.due_on ? longDate(i.due_on) : "On receipt")}</dd></div></dl>`;
  const main = `<section class="panel"><div class="co-head"><div><p class="eyebrow">${esc(`${v.stage === "fee" ? "Service call fee" : "Bill"} · sent ${longDate(i.shared_on)}${v.site_address ? ` · ${v.site_address}` : ""}`)}</p><h2>${esc(itemLabel(i))}</h2></div>${billPill(p, i)}</div>${sum}${v.issue ? `<div style="margin-top:18px"><h4>${esc(v.stage === "fee" ? "What you called about" : "The work")}</h4><div class="prose">${paras(v.issue)}</div></div>` : ""}</section><section class="panel"><div class="panel-head"><h2>What you're paying for</h2></div>${serviceLines(v.lines, billTotals(v))}${v.note ? `<p class="fine sv-terms">${esc(v.note)}</p>` : ""}${signed}</section>`;
  const asking =
    o.step === "check" && checkable(p, i) && billOpen(p, i) && !checkFor(p, i)?.requested_at;
  const side = asking
    ? checkForm(p, i)
    : `${payBox(p, i)}<section class="panel actions"><h2>Questions?</h2>${askLink(p, i)}</section>`;
  return `${back}<div class="co-cols"><div class="stack">${main}</div><aside class="stack">${side}</aside></div>`;
}

const SERVICE_CSS = `
/* Service calls: work order and bill lines. */
.sv-lines{border:1px solid var(--line);border-radius:12px;overflow:hidden}
.sv-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;align-items:baseline;padding:12px 16px;border-top:1px solid var(--rule);transition:background .15s ease}
.sv-line:first-child{border-top:0}
.sv-line:hover{background:var(--soft)}
.sv-line b{display:block;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.sv-line span:not(.cp-money){display:block;margin-top:2px;font-size:12.5px;color:var(--muted)}
.sv-line .cp-money{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.sv-terms{margin-top:14px!important}
/* Pre-construction agreement: what you get and the terms you sign. */
.inc{margin:0;padding-left:18px;display:grid;gap:4px;color:var(--body);overflow-wrap:anywhere}
.terms{margin:0;padding-left:20px;display:grid;gap:10px;color:var(--body);max-width:70ch;overflow-wrap:anywhere}
.terms b{color:var(--ink)}
.ck-note{margin:12px 0 0;font-size:13.5px;color:var(--body)}
.ck-note b{color:var(--ink)}
.sv-sign{display:flex;gap:8px;align-items:center;margin:14px 0 0;font-size:13.5px;color:var(--ok-ink)}
.sv-sign svg{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
@media (max-width:640px){.sv-line{padding:11px 13px}}
`;

const BILLING_CSS = `
/* Billing: pay applications in plain words. */
.pay-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 24px;align-items:start}
.pay-card h2{font-size:22px;letter-spacing:-.025em}
.pay-due{margin:16px 0 0;font-size:42px;line-height:1.05;font-weight:650;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.pay-due span{display:block;margin-top:6px;font-size:13px;font-weight:500;letter-spacing:0;color:var(--muted)}
.pay-card .due{margin-top:10px}
.pay-h{margin-top:20px}
.pay-math{margin:14px 0 0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.pay-math div{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:12px 16px;border-top:1px solid var(--rule)}
.pay-math div:first-child{border-top:0}
.pay-math dt{color:var(--body);min-width:0}
.pay-math dt span{display:block;margin-top:2px;font-size:12px;color:var(--muted)}
.pay-math dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.pay-math .cp-total{background:var(--accent-soft)}
.pay-math .cp-total dt,.pay-math .cp-total dd{color:var(--accent-ink);font-weight:700}
.cp-legend{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px;font-size:13px}
.cp-legend li{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:10px;align-items:center}
.cp-legend span{color:var(--body)}
.cp-legend b{font-weight:600;font-variant-numeric:tabular-nums}
.cp-legend i{width:10px;height:10px;border-radius:3px;background:var(--line)}
.cp-legend.cp-inline{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 10px;font-size:12px;color:var(--muted)}
.cp-legend.cp-inline li{display:inline-flex;gap:6px}
.cp-legend .cp-prev,.cp-bar .cp-prev{background:var(--ok-ink)}
.cp-legend .cp-now,.cp-bar .cp-now{background:var(--accent)}
.cp-legend .cp-stored,.cp-bar .cp-stored{background:#93b4f5}
.cp-legend .cp-rest,.cp-bar .cp-rest{background:var(--line)}
.cp-bar{display:flex;height:10px;margin-top:8px;border-radius:999px;background:var(--rule);overflow:hidden}
.cp-bar.cp-tall{height:14px;margin-top:14px}
.cp-bar .cp-seg{display:block;height:100%}
.cp-wl{padding:12px 0;border-top:1px solid var(--rule)}
.cp-wl:first-child{border-top:0;padding-top:0}
.cp-wl-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.cp-wl-top b{font-weight:600;min-width:0;overflow-wrap:anywhere}
.cp-wl-meta{margin-top:6px;font-size:12.5px;color:var(--muted)}
.cp-big{margin:0;font-size:30px;line-height:1.1;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.cp-big span{display:block;margin-top:4px;font-size:12.5px;font-weight:500;letter-spacing:0;color:var(--muted)}
.cp-money-fine{margin-top:12px!important}
.cp-kv{margin:0;display:grid}
.cp-kv div{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--rule);font-size:13.5px}
.cp-kv div:first-child{border-top:0;padding-top:0}
.cp-kv dt{color:var(--body)}
.cp-kv dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.cp-kv .cp-total dt,.cp-kv .cp-total dd{color:var(--ink);font-weight:700}
/* Paying online. */
.pp .sub{margin-top:6px}
.pp-btns{display:grid;gap:10px;margin-top:16px}
.pp-btns form{margin:0}
.pp .btn{transition:transform .15s ease,box-shadow .15s ease,background-color .15s ease}
.pp .btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(37,99,235,.18)}
.pp .fine{margin-top:12px}
.pp-line{margin:10px 0 0;color:var(--body)}
.pp-test{margin:12px 0 0;padding:9px 12px;border-radius:10px;font-size:13px;font-weight:600;color:var(--wait-ink);background:var(--wait-soft);border:1px solid var(--wait-line)}
.pp-warn{margin:12px 0 0;padding:9px 12px;border-radius:10px;font-size:13px;font-weight:600;color:var(--alert-ink);background:var(--alert-soft);border:1px solid var(--alert-line)}
.pp-done{display:flex;gap:12px;align-items:flex-start}
.pp-done svg{flex:none;width:30px;height:30px;padding:6px;border-radius:999px;background:var(--ok-soft);border:1px solid var(--ok-line);fill:none;stroke:var(--ok-ink);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.pp-done b{display:block;font-size:17px;color:var(--ok-ink)}
.pp-done span{display:block;margin-top:2px;color:var(--body)}
@media (min-width:641px) and (max-width:1000px){.pay-card+.pp .pp-btns{grid-template-columns:1fr 1fr}}
@media (max-width:1000px){.pay-due{font-size:36px}.pay-card h2{font-size:20px}.cp-big{font-size:27px}.pay-math div{padding:11px 14px}.cp-wl-top{gap:10px}.cp-legend{gap:7px}.cp-kv div{font-size:13px}}
@media (max-width:640px){.pay-head{grid-template-columns:minmax(0,1fr)}.pay-head .pill{justify-self:start}.pay-due{font-size:30px}.pay-card h2{font-size:18px}.cp-big{font-size:24px}.pay-math div{padding:10px 12px;gap:10px}.pay-math dt span{font-size:11.5px}.cp-wl-top{flex-direction:column;gap:2px}.cp-wl-meta{font-size:12px}.cp-legend.cp-inline{gap:4px 12px}.cp-bar.cp-tall{height:12px}.cp-kv div{gap:8px}}
`;

const MESSAGES_CSS = `
/* Messages: the customer's conversation with the team. Theirs on the right in pale blue, the team's on white. */
.cp-msgs{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.cp-msg{max-width:min(620px,88%);justify-self:start;padding:12px 16px;border-radius:16px 16px 16px 6px;background:var(--white);border:1px solid var(--line);scroll-margin-top:calc(var(--tabs-h) + 16px)}
.cp-msg-mine{justify-self:end;border-radius:16px 16px 6px 16px;background:var(--accent-soft);border-color:#cfdcfb}
.cp-msg-who{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:12.5px;color:var(--muted)}
.cp-msg-who b{color:var(--ink);font-weight:600;font-size:13.5px}
.cp-msg-who .avatar{width:24px;height:24px;font-size:10px}
.cp-msg-mine .cp-msg-who .avatar{background:var(--white)}
.cp-msg-about{margin:8px 0 0!important;display:inline-block;font-size:12px;font-weight:600;color:var(--accent-ink);background:var(--white);border:1px solid #cfdcfb;padding:2px 9px;border-radius:999px}
.cp-msg-body{margin-top:8px;color:var(--ink);overflow-wrap:anywhere}
.cp-msg-body p+p{margin-top:8px}
.cp-msg-link{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;background:var(--accent-soft);color:var(--accent-ink);font-size:13.5px}
.cp-msg-link b{font-weight:650}
#write{scroll-margin-top:calc(var(--tabs-h) + 16px)}
.cp-team-acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px!important}
.cp-backrow{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 16px}
@media (max-width:1000px){.cp-msg{max-width:92%}}
@media (max-width:640px){.cp-msg{max-width:100%;padding:11px 13px}.cp-msg-link{flex-direction:column;align-items:flex-start;gap:4px}.cp-team-acts .btn{flex:1 1 auto}.cp-backrow .btn{width:100%}}
`;

function body(p: PortalPage, o: PortalOpts): string {
  const it = o.item ? p.items.find((x) => x.id === o.item) : null;
  switch (o.section) {
    case "updates":
      return updates(p);
    case "photos":
      return `<section class="panel"><div class="panel-head"><h2>Photos</h2><span class="meta">${p.photos.length} shared</span></div>${photoGrid(p.photos)}</section>`;
    case "schedule":
      return `<div class="grid-home"><section class="panel"><div class="panel-head"><h2>Milestones</h2>${p.job.completion_date ? `<span class="meta">Planned finish ${esc(longDate(p.job.completion_date))}</span>` : ""}</div>${milestoneList(p)}</section><aside class="rail">${contactPanel(p)}</aside></div>`;
    case "agreement":
      return agreement(p, o);
    case "changes":
      return it?.kind === "change_order" ? changeOrderDetail(p, it, o) : changeOrderList(p);
    case "work":
      return it?.kind === "work_order" ? workOrderDetail(p, it, o) : workOrderList(p);
    case "selections":
      return it?.kind === "selection" ? selectionDetail(p, it, o) : selectionsList(p);
    case "billing":
      return it?.kind === "pay_app"
        ? payAppDetail(p, it, o)
        : it?.kind === "service_invoice"
          ? serviceBillDetail(p, it, o)
          : isService(p) || (serviceBills(p).length > 0 && !payApps(p).length)
            ? serviceBilling(p)
            : billing(p);
    case "messages":
      return messages(p, o);
    default:
      return isService(p) ? serviceHome(p) : home(p);
  }
}

/** The blue top of every signed-in page: contractor, job, where it stands, and the two latest photos. */
function hero(p: PortalPage, waiting: number, logo: string | null = null): string {
  const c = p.contractor;
  // The contractor leads: their saved logo on a white tile when they have one, else initials and their name.
  const src = safeLogo(logo);
  const mark = src
    ? `<img class="cp-co-img" src="${esc(src)}" alt="${esc(c.name)}"><span class="cp-co-word"><span class="cp-co-sub">Client page</span></span>`
    : `<span class="cp-co-logo" aria-hidden="true">${esc(initials(c.name))}</span><span class="cp-co-word"><b>${esc(c.name)}</b><span class="cp-co-sub">Client page</span></span>`;
  const brand = `<div class="wrap brandbar"><div class="cp-co">${mark}</div><div class="who"><span class="who-name"><span class="avatar" aria-hidden="true">${esc(initials(p.customer.name))}</span><span>${esc(p.customer.name)}</span></span><form method="post">${hidden(p, { action: "sign_out" })}<button class="linkbtn" type="submit">Sign out</button></form></div></div>`;
  if (isService(p)) return `<section class="cp-hero">${brand}${serviceHero(p)}</section>`;
  const latest = p.updates[0];
  const next = nextMilestone(p);
  const lede = latest
    ? latest.title
    : next
      ? `Next up: ${next.name}, ${longDate(next.date)}.`
      : `${c.name} keeps this page current: weekly updates, photos, the schedule, billing and anything that needs your decision.`;
  const chips = [
    waiting
      ? `<span class="chip attn"><i></i>${waiting} ${waiting === 1 ? "decision" : "decisions"} waiting</span>`
      : `<span class="chip"><i></i>Up to date</span>`,
    latest ? `<span class="chip">Update posted ${esc(shortDate(latest.week_of))}</span>` : "",
    p.photos.some((ph) => ph.url)
      ? `<span class="chip">${(() => {
          const n = p.photos.filter((ph) => ph.url).length;
          return `${n} site ${n === 1 ? "photo" : "photos"}`;
        })()}</span>`
      : "",
  ].join("");
  const total = p.milestones.length;
  const done = p.milestones.filter((m) => m.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const approved = approvedPct(p);
  const ring = total
    ? `<div class="ring" style="--p:${pct}" role="img" aria-label="${done} of ${total} milestones done"><div><b>${done}/${total}</b>milestones done</div></div>`
    : approved !== null
      ? `<div class="ring" style="--p:${approved}" role="img" aria-label="${approved} percent of the contract approved"><div><b>${approved}%</b>of the work approved</div></div>`
      : "";
  const g = p.progress;
  const rows = [
    g
      ? `<div class="snap-row"><span>Work approved</span><b>${esc(usd(g.approved_cents))}</b></div>`
      : "",
    g
      ? `<div class="snap-row"><span>Contract</span><b>${esc(usd(g.contract_cents))}</b></div>`
      : "",
    next ? `<div class="snap-row"><span>Next milestone</span><b>${esc(next.name)}</b></div>` : "",
    next
      ? `<div class="snap-row"><span>Next date</span><b>${esc(longDate(next.date))}</b></div>`
      : "",
    p.job.completion_date || (!g && !next)
      ? `<div class="snap-row"><span>Planned finish</span><b>${esc(longDate(p.job.completion_date) || "Being scheduled")}</b></div>`
      : "",
  ].join("");
  const pics = p.photos.filter((ph) => ph.url).slice(0, 2);
  const peek = pics.length
    ? `<div class="peek">${pics.map((ph) => `<figure><a href="#${photoId(ph.id)}" aria-label="Open photo: ${esc(captionFor(ph))}"><img src="${esc(ph.url)}" alt="${esc(captionFor(ph))}" referrerpolicy="no-referrer"></a><figcaption>${esc(shortDate(ph.taken_on))}</figcaption></figure>`).join("")}</div>`
    : "";
  return `<section class="cp-hero">${brand}<div class="wrap hero-in"><div><p class="h-eyebrow">Job ${esc(p.job.number)}</p><h1>${esc(p.job.name)}</h1><p class="lede">${esc(lede)}</p><div class="chips">${chips}</div></div><div class="snap${ring ? "" : " no-ring"}">${ring}<div class="snap-rows">${rows}</div>${peek}</div></div></section>`;
}

export function renderPortal(p: PortalPage, o: PortalOpts): string {
  p = { ...p, contractor: { ...p.contractor, logo_url: safeLogo(o.logo) } };
  // A tab this page doesn't show (the Agreement tab before anything is shared) opens Home.
  if (!sectionsFor(p).includes(o.section)) o = { ...o, section: "home" };
  const waitingBy = (...kinds: PortalItem["kind"][]) =>
    p.items.filter((i) => kinds.includes(i.kind) && open(p, i)).length;
  const count: Partial<Record<PortalSection, number>> = {
    changes: waitingBy("change_order"),
    work: waitingBy("work_order"),
    selections: waitingBy("selection"),
    billing: waitingBy("pay_app", "service_invoice"),
    agreement: waitingBy("precon_agreement"),
    messages: o.section === "messages" ? 0 : (p.messages?.unread ?? 0),
  };
  const tabs = sectionsFor(p)
    .map(
      (s) =>
        `<a class="tab" href="${esc(href(p, s))}"${s === o.section ? ' aria-current="page"' : ""}>${SECTION_LABEL[s]}${count[s] ? `<span class="count" aria-label="${count[s]} ${s === "messages" ? "new" : "waiting"}">${count[s]}</span>` : ""}</a>`,
    )
    .join("");
  const waiting = p.items.filter((i) => open(p, i)).length;
  const flash = o.error
    ? `<p class="flash err" role="alert">${esc(o.error)}</p>`
    : o.flash
      ? `<p class="flash" role="status">${esc(o.flash)}</p>`
      : "";
  return doc(
    `${p.job.name} · ${SECTION_LABEL[o.section]}`,
    `<div class="pt">${hero(p, waiting, o.logo ?? null)}<nav class="tabs" aria-label="${isService(p) ? "Service call sections" : "Project sections"}"><div class="wrap">${tabs}</div></nav><main class="wrap main">${flash}${body(p, o)}</main><footer class="wrap foot"><span>Shared with ${esc(p.customer.name)} by ${esc(p.contractor.name)}. Only you can see this page.</span><span class="athena">${ATHENA_A}Powered by Athena</span></footer></div>${lightbox(p)}`,
  );
}

export { itemLabel };
