// Customer page HTML. Server-rendered, no scripts: every button is a plain form post, so it works on any phone
// and nothing on the page can run code. Look: an Athena blue hero over white cards, Inter type, blue actions
// (client page redesign approved by Marshall, Nov 5).
import { optionNames } from "../selections/model";
import { displayPrice } from "../selections/format";
import { COMPARE_CSS, renderCompare } from "../selections/compare-page";
import { ATHENA_SUPPORT_MAILTO } from "../login-copy";
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
.btn:hover{background:var(--accent-deep);border-color:var(--accent-deep);transform:translateY(-1px);box-shadow:0 6px 16px rgba(37,99,235,.28)}
.btn.secondary{background:var(--white);color:var(--ink);border-color:var(--field)}
.btn.secondary:hover{background:var(--soft);border-color:var(--underline);box-shadow:none}
.btn.block{width:100%}
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
.statement{margin-top:14px;padding:12px 14px;border-left:3px solid var(--accent);border-radius:0 10px 10px 0;background:var(--soft);font-size:13.5px}
@media (max-width:1000px){.grid-home,.co-cols{grid-template-columns:minmax(0,1fr)}.rail{grid-template-columns:repeat(2,minmax(0,1fr))}.photos{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:640px){
.who-name span:not(.avatar),.co-sub{display:none}
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
.hero{position:relative;color:#f4f7fd;overflow:hidden;isolation:isolate;background:#1a47c7}
.hero::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(900px 420px at 85% 0%,rgba(140,190,255,.55),transparent 60%),repeating-linear-gradient(0deg,rgba(255,255,255,.075) 0 1px,transparent 1px 32px),repeating-linear-gradient(90deg,rgba(255,255,255,.075) 0 1px,transparent 1px 32px),linear-gradient(160deg,#2f6cf2,#1a47c7)}
.hero a,.hero .linkbtn{color:#fff;text-decoration-color:rgba(255,255,255,.45)}
.brandbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:18px;padding-bottom:18px}
.co{display:flex;align-items:center;gap:12px;min-width:0}
.co-logo{width:40px;height:40px;border-radius:11px;background:#fff;color:#1a47c7;display:grid;place-items:center;font-weight:700;font-size:13px;letter-spacing:.02em;flex:none}
.co-img{display:block;height:44px;width:auto;max-width:min(200px,44vw);object-fit:contain;padding:6px 10px;border-radius:11px;background:#fff;flex:none}
.co-word{display:grid;line-height:1.2;min-width:0}
.co-word b{font-size:16px;font-weight:600;letter-spacing:-.015em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-sub{font-size:12px;color:#dbe6ff}
.who{display:flex;align-items:center;gap:12px;font-size:13.5px;color:#dbe6ff}
.who-name{display:flex;align-items:center;gap:8px}
.who .avatar{background:rgba(255,255,255,.16);color:#fff}
.hero-in{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:40px;align-items:center;padding-top:22px;padding-bottom:44px}
.h-eyebrow{margin:0;font:600 10.5px/1.3 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#e4edff}
.hero h1{font-size:46px;line-height:1.04;font-weight:650;letter-spacing:-.035em;margin:10px 0 12px;color:#fff;text-wrap:balance}
.lede{margin:0 0 18px;font-size:16px;color:#dbe6ff;max-width:46ch}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.12);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);color:#fff}
.chip i{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.22)}
.chip.attn i{background:#fbbf24;box-shadow:0 0 0 3px rgba(251,191,36,.25)}
.snap{display:grid;grid-template-columns:auto minmax(0,1fr);gap:22px;align-items:center;background:rgba(255,255,255,.12);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 20px 50px rgba(8,25,80,.18);border-radius:20px;padding:20px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.snap.no-ring{grid-template-columns:minmax(0,1fr)}
.ring{--p:0;position:relative;width:132px;height:132px;border-radius:50%;display:grid;place-items:center;animation:ringin 1.2s cubic-bezier(.2,.7,.2,1) both}
.ring::before{content:"";position:absolute;inset:0;border-radius:50%;background:conic-gradient(#fff calc(var(--p)*1%),rgba(255,255,255,.22) 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 12px),#000 calc(100% - 11px));mask:radial-gradient(farthest-side,transparent calc(100% - 12px),#000 calc(100% - 11px))}
.ring div{position:relative;text-align:center;font-size:11.5px;color:#dbe6ff;line-height:1.3;max-width:96px}
.ring b{display:block;font-size:30px;font-weight:650;letter-spacing:-.03em;line-height:1;color:#fff;margin-bottom:3px}
@property --p{syntax:"<number>";inherits:true;initial-value:0}
@keyframes ringin{from{--p:0}}
.snap-rows{display:grid;gap:10px;min-width:0}
.snap-row{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#dbe6ff;border-bottom:1px solid rgba(255,255,255,.22);padding-bottom:8px}
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
.acts{display:grid;gap:10px}
.act{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px;border-radius:14px;background:var(--soft);border:1px solid var(--line);transition:border-color .2s,transform .2s}
.act:hover{border-color:var(--accent);transform:translateY(-1px)}
.ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-ink)}
.ico svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.act h3{margin:0;font-size:15px;font-weight:600;letter-spacing:-.015em;line-height:1.35}
.act .meta{display:block;font-size:13px;color:var(--body);margin-top:1px}
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
.team .avatar{width:46px;height:46px;font-size:14px}
.team b{display:block;font-weight:600}
.team span{font-size:13px;color:var(--body)}
.photos.thumbs{grid-template-columns:repeat(2,minmax(0,1fr))}
.foot{padding-top:24px;padding-bottom:26px;margin-top:8px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 18px}
.athena{display:inline-flex;align-items:center;gap:6px}
.athena svg{width:16px;height:12px;flex:none}
@media (max-width:1000px){.hero-in{grid-template-columns:minmax(0,1fr);gap:24px}.hero h1{font-size:38px}}
@media (max-width:640px){.hero-in{padding-top:8px;padding-bottom:24px}.hero h1{font-size:30px}.lede{font-size:14.5px}.brandbar{padding-top:14px;padding-bottom:14px}.snap{grid-template-columns:minmax(0,1fr);justify-items:center;padding:16px}.snap-rows{width:100%}.act{grid-template-columns:auto minmax(0,1fr);padding:12px}.act .btn{grid-column:1/-1;width:100%}.phases{grid-template-columns:minmax(0,1fr);gap:12px}.phases li{padding:0 0 0 18px}.phases li::before{top:3px;bottom:3px;left:0;right:auto;width:6px;height:auto}.photos.thumbs{gap:10px}.foot{flex-direction:column;align-items:flex-start}.tabs .wrap{padding-top:8px;padding-bottom:8px}}
@media (prefers-reduced-motion:reduce){.ring,.panel,.act,.btn,.photo img,.peek img{animation:none!important;transition:none!important}}
`;

// Sign-in, code and notice screens match Athena's own sign-in card (src/components/auth/auth-card.tsx, brand
// "athena"): pale blue ground, white card, short blue rule, serif title, mono labels, blue button. The contractor's
// name sits beside the small Athena mark up top; the signed-in page keeps its own quieter look.
const SIGNIN_CSS = `
.as{min-height:100vh;background:#DBEAFE;color:#1F2329;padding:40px max(16px,env(safe-area-inset-left)) 48px max(16px,env(safe-area-inset-right));font-family:"Archivo","Helvetica Neue",Arial,sans-serif;font-size:14px}
.as-wrap{width:100%;max-width:32rem;margin:0 auto}
.as-brand{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;text-align:center}
.as-logo{display:block;max-width:220px;max-height:56px;width:auto;height:auto}
.as-co{display:grid;justify-items:center;line-height:1.15;min-width:0;max-width:100%}
.as-co b{font-family:"Inter","Segoe UI",system-ui,-apple-system,sans-serif;font-weight:600;font-size:22px;letter-spacing:-.011em;max-width:100%;color:#1F2329;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-co span{margin-top:5px;font:600 9px/1.3 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:#1D4ED8}
.as-card{margin-top:36px;background:#fff;border:1px solid #2563EB33;border-radius:16px;box-shadow:0 1px 2px #0F1E3D0F;padding:24px}
.as-rule{width:40px;height:4px;background:#2563EB;margin-bottom:24px}
.as-hi{margin:0 0 8px;font-size:14px;line-height:1.5;color:#5B5F68}
.as h1{margin:0;font-family:"Source Serif 4",Georgia,serif;font-weight:400;font-size:27px;line-height:1.15;letter-spacing:-.01em;color:#1F2329;text-wrap:balance}
.as-sub{margin:12px 0 0;font-size:14px;line-height:1.6;color:#5B5F68}
.as-job{margin-top:22px;padding:14px 16px;border:1px solid #E4E1D6;border-radius:12px;background:#F8FAFF;display:grid;gap:4px}
.as-label{display:block;font:600 9px/1.3 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:#76736B}
.as-job b{font-size:15px;font-weight:600;color:#1F2329}
.as-form{margin-top:26px;display:grid;gap:18px}
.as-field{display:grid;gap:8px}
.as-input{width:100%;height:56px;padding:0 14px;border:1px solid #E4E1D6;border-radius:8px;background:#fff;color:#1F2329;outline:none;font:600 26px/1 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.5em;text-align:center;padding-left:calc(14px + .5em);font-variant-numeric:tabular-nums}
.as-input:focus{border-color:#1D4ED8;box-shadow:0 0 0 3px #2563EB26}
.as-check{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;color:#3F434B;cursor:pointer}
.as-check input{width:17px;height:17px;margin:1px 0 0;accent-color:#2563EB;flex:none}
.as-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:44px;padding:0 20px;border:0;border-radius:8px;background:#2563EB;color:#fff;font:600 13px/1 "Archivo","Helvetica Neue",Arial,sans-serif;cursor:pointer;text-decoration:none}
.as-btn:hover{background:#1D4ED8}
.as-btn:focus-visible,.as-link:focus-visible,.as-input:focus-visible{outline:3px solid #1D4ED8;outline-offset:2px}
.as-note{margin:0;font-size:12px;line-height:1.55;color:#76736B}
.as-link{border:0;background:none;padding:0;font:inherit;font-weight:600;color:#1D4ED8;text-decoration:underline;text-underline-offset:4px;cursor:pointer}
.as-err{margin:20px 0 0;padding:11px 14px;border:1px solid #F3C8D0;border-radius:10px;background:#FFF3F5;color:#B91C1C;font-size:13px;font-weight:600}
.as-foot{margin-top:28px;padding-top:18px;border-top:1px solid #E4E1D6;display:flex;align-items:center;gap:8px;font-size:12px;color:#76736B}
.as-foot svg{width:22px;height:16px;flex:none;overflow:visible}
.as-help{margin:22px 0 0;text-align:center;font-size:12px;line-height:1.7;color:#3F434B}.as-help a{color:#1D4ED8;text-decoration:underline;text-underline-offset:3px}
@media (min-width:640px){.as{padding-top:64px;padding-bottom:64px}.as-card{padding:36px}.as h1{font-size:29px}}
@media (max-width:380px){.as-co b{font-size:19px}.as h1{font-size:24px}}
`;

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
function signinShell(company: string | null, inner: string, logo: string | null = null): string {
  const src = safeLogo(logo);
  const brand = company
    ? `<div class="as-brand">${src ? `<img class="as-logo" src="${esc(src)}" alt="${esc(company)}">` : `<span class="as-co"><b>${esc(company)}</b></span>`}<span class="as-co"><span>Client page</span></span></div>`
    : `<div class="as-brand"><span class="as-co"><span>Client page</span></span></div>`;
  const support = `Trouble signing in? <a href="${esc(ATHENA_SUPPORT_MAILTO)}">Email Athena support</a>.`;
  const help = company
    ? `<p class="as-help">Questions about your project? Contact ${esc(company)}.<br>${support}</p>`
    : `<p class="as-help">${support}</p>`;
  return `<main class="as"><div class="as-wrap">${brand}<section class="as-card"><div class="as-rule" aria-hidden="true"></div>${inner}<div class="as-foot">${ATHENA_A}<span>Powered by Athena</span></div></section>${help}</div></main>`;
}

const FONTS_PORTAL = "family=Inter:wght@400;500;600;700";
const FONTS_SIGNIN =
  "family=Archivo:wght@400;500;600;700&family=Inter:wght@600&family=JetBrains+Mono:wght@600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500";

function doc(title: string, body: string, kind: "portal" | "signin" = "portal"): string {
  const fonts = kind === "signin" ? FONTS_SIGNIN : FONTS_PORTAL;
  const css = kind === "signin" ? `${CSS}${SIGNIN_CSS}` : `${CSS}${PORTAL_CSS}${COMPARE_CSS}`;
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
    signinShell(info.company, inner, opts.logo ?? null),
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
  step?: "confirm" | "decline" | null;
  choice?: string | null;
  flash?: string | null;
  error?: string | null;
  /** The contractor's saved logo, an https URL. Their initials and name show when there is none. */
  logo?: string | null;
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

const ICON = {
  change_order: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>`,
  selection: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>`,
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
  const waiting = p.items.filter(open);
  if (!waiting.length)
    return `<section class="panel decide"><div class="panel-head"><h2>Needs your attention</h2></div><div class="done-box">You're all caught up. Nothing needs your decision right now.</div></section>`;
  const rows = waiting
    .map((i) => {
      const section: PortalSection = i.kind === "change_order" ? "changes" : "selections";
      const what =
        i.kind === "change_order"
          ? `Change order · ${usd(i.view.price_cents)} · ${days(i.view.schedule_days)}`
          : `Choose a package · from ${usd(Math.min(...i.view.proposal.packages.map((k) => k.total_cents)))}`;
      const verb = i.kind === "change_order" ? "Reply" : "Choose";
      return `<div class="act"><span class="ico">${ICON[i.kind]}</span><div><h3>${esc(itemLabel(i))}</h3><span class="meta">${esc(what)}</span>${dueChip(p, i.due_on, verb)}</div><a class="btn" href="${esc(href(p, section, { i: i.id }))}">Review</a></div>`;
    })
    .join("");
  return `<section class="panel decide"><div class="panel-head"><h2>Needs your attention</h2><span class="meta">${waiting.length} ${waiting.length === 1 ? "item" : "items"}</span></div><div class="acts">${rows}</div></section>`;
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
  return `<section class="panel"><div class="panel-head"><h2>Your team</h2></div><div class="team"><span class="avatar" aria-hidden="true">${esc(initials(c.pm_name || c.name))}</span><div><b>${esc(c.pm_name || c.name)}</b><span>${esc([c.pm_title || "Project manager", c.name].filter(Boolean).join(" · "))}</span></div></div>${c.pm_email ? `<p class="sub" style="margin-top:14px"><a class="btn secondary" href="mailto:${esc(c.pm_email)}">Email ${esc((c.pm_name || c.name).split(/\s+/)[0]!)}</a></p>` : ""}</section>`;
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

function home(p: PortalPage): string {
  const latest = p.updates[0];
  const pm = p.contractor.pm_name;
  const update = latest
    ? `<section class="panel"><div class="panel-head"><h2>${esc(latest.title)}</h2><a class="meta" href="${esc(href(p, "updates"))}">All updates</a></div><div class="prose">${paras(latest.body)}</div><div class="byline"><span class="avatar" aria-hidden="true">${esc(initials(pm || p.contractor.name))}</span>${esc([pm ? `${pm}, ${p.contractor.pm_title || "project manager"}` : p.contractor.name, `week of ${longDate(latest.week_of)}`].join(" · "))}</div></section>`
    : `<section class="panel"><div class="panel-head"><h2>This week on your project</h2></div><p class="empty">${esc(p.contractor.name)} hasn't posted an update yet.</p></section>`;
  const shown = p.photos.filter((ph) => ph.url);
  const photos = shown.length
    ? `<section class="panel"><div class="panel-head"><h2>Latest photos</h2><a class="meta" href="${esc(href(p, "photos"))}">See all ${shown.length}</a></div>${photoGrid(shown.slice(0, 2), "thumbs")}</section>`
    : "";
  const coming = `<section class="panel"><div class="panel-head"><h2>Coming up</h2><a class="meta" href="${esc(href(p, "schedule"))}">Schedule</a></div>${milestoneList(p, 4)}</section>`;
  return `<div class="grid-home"><div class="stack">${decideBox(p)}${update}${phases(p)}</div><aside class="rail">${contactPanel(p)}${photos}${coming}</aside></div>`;
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
    o.step === "confirm" && optionNames.includes(o.choice as never)
      ? (o.choice as (typeof optionNames)[number])
      : null;
  if (!i.decision && pickedTier) {
    const pk = v.packages.find((k) => k.tier === pickedTier)!;
    const base = pickedTier === v.base_tier;
    const statement = approvalStatement({
      kind: "selection",
      company: p.contractor.name,
      label: v.title,
      price: cur(pk.total_cents),
      choice: TIER_NAME[pickedTier],
    });
    const lines = v.selections
      .map((s) => {
        const op = s.options[pickedTier];
        return `<div><span>${esc(s.title)}</span><b>${esc([op.manufacturer, op.model].filter(Boolean).join(" ") || op.description)}</b></div>`;
      })
      .join("");
    const form = `<form method="post" class="panel"><h2>Sign your choice</h2><p class="sub">We emailed a 6-digit code to ${esc(maskEmail(p.customer.email))}.</p>${hidden(p, { action: "decide", item: i.id, decision: "chosen", choice: pickedTier, fingerprint: i.fingerprint })}<div class="field"><label for="code">Code from your email</label><input class="input code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="typed_name">Type your full name</label><input class="input" id="typed_name" name="typed_name" autocomplete="name" minlength="2" maxlength="120" required></div><p class="statement">${esc(statement)}</p><label class="check"><input type="checkbox" name="agree" value="1" required> I agree</label><div class="form-actions"><a class="btn secondary" href="${esc(href(p, "selections", { i: i.id }))}">Back to compare</a><button class="btn" type="submit">Confirm my choice</button></div></form>`;
    const review = `<section class="panel"><p class="eyebrow">You're choosing</p><h2>${esc(v.title)}: ${TIER_NAME[pickedTier]}</h2><div class="sum"><div><span>Package total</span><b>${esc(cur(pk.total_cents))}</b></div><div><span>${base ? "Change from base" : "Difference from base"}</span><b>${base ? "Included" : esc(`${pk.difference_cents > 0 ? "+" : ""}${cur(pk.difference_cents)}`)}</b></div>${lines}</div></section>`;
    return `${back}<div class="co-cols"><div class="stack">${review}${choiceNext(p, v, pickedTier, false)}</div><aside class="stack">${form}</aside></div>`;
  }
  const shown = chosen
    ? { ...v, accepted: { tier: chosen, recorded_on: i.decision!.decided_at.slice(0, 10) } }
    : v;
  const compare = renderCompare(shown, {
    company: p.contractor.name,
    underContract: p.job.under_contract ?? null,
    eyebrow: `Selections · shared ${longDate(i.shared_on)}`,
    action: i.decision
      ? undefined
      : (tier) =>
          `<form method="post">${hidden(p, { action: "start", item: i.id, choice: tier })}<button class="btn${tier === v.base_tier ? "" : " ghost"}" type="submit">Choose ${TIER_NAME[tier]}</button></form>`,
    note: i.decision
      ? null
      : "Choosing asks for a code we email you and your typed name. Nothing is final until you confirm.",
  });
  const foot = [v.valid_until ? `Prices valid until ${longDate(v.valid_until)}.` : "", v.terms]
    .filter(Boolean)
    .join("\n\n");
  const done = chosen
    ? `<div class="co-cols"><div class="stack">${choiceNext(p, v, chosen, true)}</div><aside class="stack">${receipt(i)}</aside></div>`
    : "";
  return `${back}<div class="stack">${done}<section class="panel gbb-panel">${compare}${foot ? `<div class="close-fine">${paras(foot)}</div>` : ""}</section></div>`;
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

/** The blue top of every signed-in page: contractor, job, where it stands, and the two latest photos. */
function hero(p: PortalPage, waiting: number, logo: string | null = null): string {
  const c = p.contractor;
  // The contractor leads: their saved logo on a white tile when they have one, else initials and their name.
  const src = safeLogo(logo);
  const mark = src
    ? `<img class="co-img" src="${esc(src)}" alt="${esc(c.name)}"><span class="co-word"><span class="co-sub">Client page</span></span>`
    : `<span class="co-logo" aria-hidden="true">${esc(initials(c.name))}</span><span class="co-word"><b>${esc(c.name)}</b><span class="co-sub">Client page</span></span>`;
  const brand = `<div class="wrap brandbar"><div class="co">${mark}</div><div class="who"><span class="who-name"><span class="avatar" aria-hidden="true">${esc(initials(p.customer.name))}</span><span>${esc(p.customer.name)}</span></span><form method="post">${hidden(p, { action: "sign_out" })}<button class="linkbtn" type="submit">Sign out</button></form></div></div>`;
  const latest = p.updates[0];
  const next = nextMilestone(p);
  const lede = latest
    ? latest.title
    : next
      ? `Next up: ${next.name}, ${longDate(next.date)}.`
      : `Your private project page from ${c.name}.`;
  const chips = [
    waiting
      ? `<span class="chip attn"><i></i>${waiting} ${waiting === 1 ? "decision" : "decisions"} waiting</span>`
      : `<span class="chip"><i></i>Up to date</span>`,
    latest ? `<span class="chip">Update posted ${esc(shortDate(latest.week_of))}</span>` : "",
  ].join("");
  const total = p.milestones.length;
  const done = p.milestones.filter((m) => m.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const ring = total
    ? `<div class="ring" style="--p:${pct}" role="img" aria-label="${done} of ${total} milestones done"><div><b>${done}/${total}</b>milestones done</div></div>`
    : "";
  const rows = [
    next ? `<div class="snap-row"><span>Next milestone</span><b>${esc(next.name)}</b></div>` : "",
    next
      ? `<div class="snap-row"><span>Next date</span><b>${esc(longDate(next.date))}</b></div>`
      : "",
    `<div class="snap-row"><span>Planned finish</span><b>${esc(longDate(p.job.completion_date) || "Not set")}</b></div>`,
  ].join("");
  const pics = p.photos.filter((ph) => ph.url).slice(0, 2);
  const peek = pics.length
    ? `<div class="peek">${pics.map((ph) => `<figure><img src="${esc(ph.url)}" alt="${esc(ph.work || ph.area || "Progress photo")}" referrerpolicy="no-referrer"><figcaption>${esc(shortDate(ph.taken_on))}</figcaption></figure>`).join("")}</div>`
    : "";
  return `<section class="hero">${brand}<div class="wrap hero-in"><div><p class="h-eyebrow">Job ${esc(p.job.number)}</p><h1>${esc(p.job.name)}</h1><p class="lede">${esc(lede)}</p><div class="chips">${chips}</div></div><div class="snap${ring ? "" : " no-ring"}">${ring}<div class="snap-rows">${rows}</div>${peek}</div></div></section>`;
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
  const flash = o.error
    ? `<p class="flash err" role="alert">${esc(o.error)}</p>`
    : o.flash
      ? `<p class="flash" role="status">${esc(o.flash)}</p>`
      : "";
  return doc(
    `${p.job.name} · ${SECTION_LABEL[o.section]}`,
    `<div class="pt">${hero(p, waiting, o.logo ?? null)}<nav class="tabs" aria-label="Project sections"><div class="wrap">${tabs}</div></nav><main class="wrap main">${flash}${body(p, o)}</main><footer class="wrap foot"><span>Shared with ${esc(p.customer.name)} by ${esc(p.contractor.name)}. Only you can see this page.</span><span class="athena">${ATHENA_A}Powered by Athena</span></footer></div>`,
  );
}

export { itemLabel };
