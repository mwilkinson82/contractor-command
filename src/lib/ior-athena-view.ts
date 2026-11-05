// Athena's IOR page: her read of the job first, then what moved the number, the finish date,
// the money held for risk, and the risks she is tracking with her next move on each.
// Pure HTML with one scoped <style>; no script runs on report pages. Every value is escaped.
import { ALERT_HEX } from "./mcp/alert-color";
import {
  daysBetween,
  heldCents,
  iorFlags,
  isReviewOverdue,
  iorRollup,
  isScheduleLinked,
  type IorCategory,
  type IorExposure,
  type IorModel,
  type IorResponse,
  type IorRollup,
} from "./ior-model";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Whole dollars from cents, with a true minus sign. */
const money = (c: number) => `${Math.round(c / 100) < 0 ? "−" : ""}$${Math.abs(Math.round(c / 100)).toLocaleString("en-US")}`;
const signed = (c: number) => {
  const d = Math.round(c / 100);
  return d === 0 ? "$0" : `${d > 0 ? "+" : "−"}$${Math.abs(d).toLocaleString("en-US")}`;
};
const short = (c: number) => {
  const a = Math.abs(c / 100);
  if (Math.round(a) === 0) return "$0";
  return `${c < 0 ? "−" : ""}$${a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : `${Math.round(a / 1000)}K`}`;
};
const pct = (n: number) => `${n.toFixed(1)}%`;
const pctOf = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const tone = (c: number) => (Math.round(c / 100) < 0 ? "neg" : Math.round(c / 100) > 0 ? "pos" : "zero");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthDay = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const fullDate = (d: string) => `${monthDay(d)}, ${d.slice(0, 4)}`;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

const CATEGORY: Record<IorCategory, string> = {
  owner_decision: "Owner decision",
  design_drift: "Design",
  trade_performance: "Trade",
  procurement: "Procurement",
  schedule_compression: "Schedule",
  allowance_overrun: "Allowance",
  field_change: "Field change",
  closeout_punch: "Closeout",
  other: "General",
};
const RESPONSE: Record<IorResponse, string> = { eliminate: "Eliminate", recover: "Recover", offset: "Offset", accept: "Accept" };

// Athena's mark, outlined paths only (no ids, so it can repeat on a page).
const MARK = `<svg viewBox="54.5 1 720 720" aria-hidden="true" focusable="false"><path fill="#2563EB" d="M395 140H540L260 582H108Z"/><path fill="#2563EB" d="M459 288H562L721 582H586Z"/><path fill="#2563EB" d="M393 404H499L517 443L337 493Z"/></svg>`;

export const ATHENA_IOR_CSS = `
.ath-ior{container:ior/inline-size;--ink:#18314f;--soft:#53677d;--muted:#65788e;--line:#dfe7f0;--line-soft:#edf2f7;--rail:#e6edf5;--blue:#2563eb;--blue-deep:#1d4ed8;--blue-mist:#dbeafe;--blue-wash:#f1f6ff;--alert:${ALERT_HEX};--alert-wash:#fdeeee;--good:#15803d;--amber:#a16207;--amber-wash:#fdf6e7;color:var(--ink);font:14px/1.55 "Archivo",Arial,system-ui,sans-serif;margin-top:16px}
.ath-ior *{box-sizing:border-box;min-width:0}
.ath-ior .wide{font-stretch:110%}
.ath-ior .read{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 6px 24px #18345308}
.ath-ior .voice{padding:24px 26px;display:grid;gap:14px;align-content:start}
.ath-ior .who{display:flex;align-items:center;gap:10px}
.ath-ior .avatar{width:34px;height:34px;border-radius:10px;background:var(--blue-wash);display:grid;place-items:center;flex:none}
.ath-ior .avatar svg{width:26px;height:26px}
.ath-ior .who b{display:block;font-size:13px}
.ath-ior .who span{font-size:12px;color:var(--muted)}
.ath-ior h2{margin:0;font-size:clamp(21px,2.5cqi,29px);line-height:1.22;font-weight:700;letter-spacing:-.02em;font-stretch:112%;text-wrap:balance;color:var(--ink)}
.ath-ior .neg{color:var(--alert)}.ath-ior .pos{color:var(--good)}
.ath-ior .said{margin:0;font-size:15px;line-height:1.6;color:var(--soft);max-width:60ch}
.ath-ior .said b{color:var(--ink);font-weight:650}
.ath-ior .flags{display:grid;gap:8px}
.ath-ior .flag{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;padding:10px 12px;border-radius:11px;background:var(--amber-wash);color:#5c4310}
.ath-ior .flag.high{background:var(--alert-wash);color:#7f1d1d}
.ath-ior .flag i{width:8px;height:8px;border-radius:2px;transform:skewX(-18deg);background:var(--amber);flex:none;margin-top:7px}
.ath-ior .flag.high i{background:var(--alert)}
.ath-ior .flag b{font-weight:650}
.ath-ior .trackside{padding:24px 26px;background:linear-gradient(180deg,#fbfcfe,#f6f9fd);border-left:1px solid var(--line);display:grid;gap:18px;align-content:start}
.ath-ior .trk-title{font-size:13px;font-weight:650;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ath-ior .trk-title span{color:var(--muted);font-weight:500}
.ath-ior .track{position:relative;height:92px;margin-inline:2px}
.ath-ior .track .rail,.ath-ior .track .fill,.ath-ior .track .gap{position:absolute;top:40px;height:14px}
.ath-ior .track .rail{left:0;right:0;border-radius:7px;background:var(--rail)}
.ath-ior .track .fill{left:0;border-radius:7px 0 0 7px;background:var(--blue)}
.ath-ior .track .gap{background:repeating-linear-gradient(135deg,var(--alert) 0 3px,#f7c6c6 3px 7px)}
.ath-ior .track .gap.up{background:repeating-linear-gradient(135deg,var(--good) 0 3px,#bfe5cc 3px 7px)}
.ath-ior .pin{position:absolute;top:0;transform:translateX(-50%);display:grid;justify-items:center;font-size:11.5px;white-space:nowrap}
.ath-ior .pin .tag{color:var(--muted)}
.ath-ior .pin .amt{font-weight:700;font-variant-numeric:tabular-nums;font-size:13px}
.ath-ior .pin .stem{width:2px;height:16px;background:var(--ink);margin-top:2px}
.ath-ior .pin.below{top:56px}
.ath-ior .pin.below .stem{order:-1;margin:0 0 2px;background:var(--blue-deep);height:8px}
.ath-ior .pin.below .amt{color:var(--blue-deep)}
.ath-ior .pin.left{transform:translateX(-8%);justify-items:start}
.ath-ior .pin.right{transform:translateX(-92%);justify-items:end}
.ath-ior .legend{display:flex;gap:8px 16px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
.ath-ior .legend i{display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:6px;vertical-align:1px;background:var(--blue)}
.ath-ior .legend i.gap{background:repeating-linear-gradient(135deg,var(--alert) 0 3px,#f7c6c6 3px 7px)}
.ath-ior .legend i.gap.up{background:repeating-linear-gradient(135deg,var(--good) 0 3px,#bfe5cc 3px 7px)}
.ath-ior .stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.ath-ior .stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.ath-ior .stat .k,.ath-ior .stat .n{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.ath-ior .stat .v{font-size:19px;font-weight:700;font-stretch:112%;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
.ath-ior .block{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px 24px}
.ath-ior .bh{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:4px 16px;margin-bottom:14px}
.ath-ior h3{margin:0;font-size:18px;font-weight:700;letter-spacing:-.015em;color:var(--ink)}
.ath-ior .bh p{margin:2px 0 0;font-size:13px;color:var(--soft);max-width:66ch}
.ath-ior .side{font-size:12.5px;color:var(--muted)}
.ath-ior .drv{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1.6fr) 112px;gap:14px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line-soft)}
.ath-ior .drv:last-child{border-bottom:0}
.ath-ior .drv b{display:block;font-size:14px;font-weight:650}
.ath-ior .drv .what span{font-size:12px;color:var(--muted)}
.ath-ior .bar{position:relative;height:16px}
.ath-ior .bar::before{content:"";position:absolute;left:50%;top:-4px;bottom:-4px;width:1px;background:#c6d3e2}
.ath-ior .bar i{position:absolute;top:3px;height:10px;border-radius:3px}
.ath-ior .bar i.neg{right:50%;background:var(--alert)}
.ath-ior .bar i.pos{left:50%;background:var(--good)}
.ath-ior .drv .amt{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.ath-ior .drv .amt.zero{color:var(--muted);font-weight:500}
.ath-ior .sum{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;padding:12px 14px;border-radius:12px;background:var(--blue-wash);font-size:13.5px}
.ath-ior .sum b{font-variant-numeric:tabular-nums}
.ath-ior details{margin-top:14px;border-top:1px solid var(--line);padding-top:12px}
.ath-ior summary{cursor:pointer;font-weight:650;font-size:13.5px;color:var(--blue-deep);list-style:none;display:inline-flex;gap:6px;align-items:center;min-height:32px}
.ath-ior summary::-webkit-details-marker{display:none}
.ath-ior summary::before{content:"+";display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;background:var(--blue-wash);font-weight:700}
.ath-ior details[open] summary::before{content:"−"}
.ath-ior summary:focus-visible{outline:3px solid #659ff4;outline-offset:2px;border-radius:6px}
.ath-ior .ledgers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:10px}
.ath-ior h4{margin:0 0 4px;font-size:13px;font-weight:700;color:var(--ink)}
.ath-ior .lr{display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:13px;border-bottom:1px dashed var(--line)}
.ath-ior .lr span:first-child{color:var(--soft)}
.ath-ior .lr span:last-child{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.ath-ior .lr.t{border-bottom:0;border-top:1.5px solid var(--ink);margin-top:2px}
.ath-ior .lr.t span{color:var(--ink);font-weight:700}
.ath-ior .note{margin:10px 0 0;font-size:12px;color:var(--muted)}
.ath-ior .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.ath-ior .sched-say{margin:0 0 14px;font-size:17px;font-weight:650}
.ath-ior .tl{position:relative;height:70px;margin:0 6px}
.ath-ior .tl .axis{position:absolute;left:0;right:0;top:30px;height:6px;border-radius:3px;background:var(--rail)}
.ath-ior .tl .slip{position:absolute;top:30px;height:6px;background:repeating-linear-gradient(135deg,var(--alert) 0 3px,#f7c6c6 3px 7px)}
.ath-ior .mk{position:absolute;top:0;transform:translateX(-50%);display:grid;justify-items:center;font-size:11.5px;white-space:nowrap}
.ath-ior .mk .lab{color:var(--muted)}
.ath-ior .mk .shard{width:10px;height:18px;transform:skewX(-20deg);background:var(--ink);border-radius:2px;margin-top:2px}
.ath-ior .mk.fc .shard{background:var(--alert)}
.ath-ior .mk.today .shard{background:var(--blue);height:14px;margin-top:4px}
.ath-ior .mk .d{font-weight:650;margin-top:4px}
.ath-ior .mk.r{transform:translateX(-90%);justify-items:end}
.ath-ior .mk.l{transform:translateX(-10%);justify-items:start}
.ath-ior .facts{display:flex;gap:8px 18px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-top:14px}
.ath-ior .facts b{color:var(--ink);font-weight:650}
.ath-ior .meter+.meter{margin-top:14px}
.ath-ior .m-top{display:flex;justify-content:space-between;gap:10px;font-size:13.5px}
.ath-ior .m-top b{font-variant-numeric:tabular-nums}
.ath-ior .m-sub{font-size:12px;color:var(--muted)}
.ath-ior .m-bar{position:relative;height:12px;border-radius:6px;background:var(--rail);margin-top:8px}
.ath-ior .m-fill{position:absolute;left:0;top:0;bottom:0;border-radius:6px;background:var(--blue)}
.ath-ior .m-fill.short{background:#d18b1f}
.ath-ior .m-target{position:absolute;top:-4px;bottom:-4px;width:3px;border-radius:2px;background:var(--ink)}
.ath-ior .m-say{font-size:12.5px;margin-top:6px;color:var(--soft)}
.ath-ior .risks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.ath-ior .risk{border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:grid;gap:10px;align-content:start;background:#fff}
.ath-ior .chips{display:flex;gap:6px;flex-wrap:wrap}
.ath-ior .c{font-size:11.5px;font-weight:650;padding:3px 8px;border-radius:999px;background:#eef3f9;color:var(--soft);white-space:nowrap}
.ath-ior .c.e{background:var(--blue-mist);color:var(--blue-deep)}
.ath-ior .c.ch{background:#e7ecf3;color:var(--ink)}
.ath-ior .risk h4{font-size:14.5px;line-height:1.35;font-weight:650;margin:0}
.ath-ior .calc{font-size:13px;color:var(--soft);font-variant-numeric:tabular-nums}
.ath-ior .calc b{color:var(--ink);font-size:16px;font-weight:700}
.ath-ior .rev{font-size:12px;color:var(--muted)}
.ath-ior .rev.stale{color:var(--alert);font-weight:650}
.ath-ior .move{border-top:1px dashed var(--line);padding-top:10px;font-size:13px;color:var(--soft)}
.ath-ior .move span{display:block;font-size:11.5px;font-weight:700;color:var(--blue-deep);margin-bottom:2px}
.ath-ior .empty{padding:16px;border:1px dashed #d7e2ef;border-radius:12px;background:#f8fafd;color:var(--muted);font-size:13.5px}
.ath-ior .tally{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px;color:var(--muted);margin-top:12px}
.ath-ior .tally b{color:var(--ink);font-variant-numeric:tabular-nums}
.ath-ior .ask{margin-top:18px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px 18px;align-items:center;padding:18px 24px;border-radius:18px;background:var(--ink);color:#fff}
.ath-ior .ask .avatar{background:#ffffff1a}
.ath-ior .ask p{margin:0 0 8px;font-size:14px;font-weight:650}
.ath-ior .prompts{display:flex;flex-wrap:wrap;gap:8px}
.ath-ior .prompts span{border:1px solid #ffffff38;background:#ffffff10;border-radius:999px;padding:7px 13px;font-size:13px}
@container ior (max-width:980px){
.ath-ior .read{grid-template-columns:minmax(0,1fr)}
.ath-ior .trackside{border-left:0;border-top:1px solid var(--line)}
.ath-ior .stats{grid-template-columns:repeat(4,minmax(0,1fr))}
.ath-ior .ledgers,.ath-ior .risks{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@container ior (max-width:620px){
.ath-ior .read{border-radius:14px}
.ath-ior .voice,.ath-ior .trackside{padding:18px 16px}
.ath-ior .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
.ath-ior .block{padding:16px;border-radius:14px}
.ath-ior .drv{grid-template-columns:minmax(0,1fr) 96px;gap:6px 10px}
.ath-ior .drv .bar{grid-column:1/-1;grid-row:2}
.ath-ior .ledgers,.ath-ior .two,.ath-ior .risks{grid-template-columns:minmax(0,1fr)}
.ath-ior .two{gap:0}
.ath-ior .ask{grid-template-columns:minmax(0,1fr);padding:16px}
.ath-ior .ask .avatar,.ath-ior .pin .tag{display:none}
}
`;

type Driver = { title: string; say: string; detail: string; value: number };

function drivers(m: IorModel, r: IorRollup): Driver[] {
  const eCount = m.exposures.filter((e) => e.hold === "E").length;
  const growth = r.costGrowth;
  return [
    { title: "Cost forecast", say: growth < 0 ? "cost savings" : "cost growth", detail: m.cost_growth_note ?? (growth === 0 ? "On budget so far" : growth < 0 ? "Forecast under budget" : "Forecast over budget"), value: -growth },
    { title: "Pending change orders", say: "pending change orders", detail: r.pendingCount ? `${r.pendingCount} pending, margin weighted by probability` : "None pending", value: r.weightedPendingContract - r.weightedPendingCost },
    { title: "E-holds", say: "money held for specific risks", detail: `${eCount} specific ${eCount === 1 ? "risk" : "risks"} priced now`, value: -r.eHold },
    { title: "C-holds", say: "contingency", detail: "General contingency carried", value: -r.cHold },
  ];
}

function headline(r: IorRollup): string {
  if (!r.costKnown) return "I can't read profit on this job yet.";
  const gap = Math.round(r.gap / 100);
  if (gap < 0) return `Profit is tracking <span class="neg">${money(-r.gap)} under</span> the deal you signed.`;
  if (gap > 0) return `Profit is tracking <span class="pos">${money(r.gap)} over</span> the deal you signed.`;
  return "Profit is holding at the deal you signed.";
}

function said(r: IorRollup, dv: Driver[]): string {
  if (!r.costKnown) return `The contract is <b>${money(r.signedContract)}</b>, but there's no cost budget saved, so I can't tell you the margin yet. Give me the budget and I'll build the full read.`;
  const negs = dv.filter((d) => Math.round(d.value / 100) < 0).sort((a, b) => a.value - b.value);
  const poss = dv.filter((d) => Math.round(d.value / 100) > 0).sort((a, b) => b.value - a.value);
  let out = `Indicated margin is <b>${pct(r.indicatedPct)}</b> against <b>${pct(r.signedPct)}</b> signed. `;
  if (negs.length) out += `The biggest pull is ${negs[0].say} at <b>${money(-negs[0].value)}</b>${negs[1] ? `, then ${negs[1].say} at <b>${money(-negs[1].value)}</b>` : ""}. `;
  if (poss.length) {
    const t = poss.map((p) => `${p.say} add back <b>${money(p.value)}</b>`).join(", and ");
    out += `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
  }
  return out.trim();
}

function track(r: IorRollup): string {
  if (!r.costKnown) return `<div class="empty">The profit track appears once a cost budget is saved.</div>`;
  const max = Math.max(r.signedGP, r.indicatedGP, r.originalGP, 1) * 1.12;
  const p = (v: number) => clamp((v / max) * 100);
  const lo = Math.min(r.signedGP, r.indicatedGP);
  const hi = Math.max(r.signedGP, r.indicatedGP);
  const below = r.indicatedGP < r.signedGP;
  const sp = p(r.signedGP);
  const ip = p(r.indicatedGP);
  const align = (x: number) => (x > 80 ? " right" : x < 20 ? " left" : "");
  const gap = below ? "gap" : "gap up";
  return `<div class="trk-title">Gross profit <span>$0 to ${short(max)}</span></div>
<div class="track" role="img" aria-label="Signed gross profit ${esc(money(r.signedGP))}, indicated today ${esc(money(r.indicatedGP))}"><div class="rail"></div><div class="fill" style="width:${p(lo).toFixed(2)}%"></div><div class="${gap}" style="left:${p(lo).toFixed(2)}%;width:${(p(hi) - p(lo)).toFixed(2)}%"></div><div class="pin${align(sp)}" style="left:${sp.toFixed(2)}%"><span class="tag">Signed</span><span class="amt">${money(r.signedGP)}</span><span class="stem"></span></div><div class="pin below${align(ip)}" style="left:${ip.toFixed(2)}%"><span class="stem"></span><span class="amt">${money(r.indicatedGP)}</span><span class="tag">Indicated today</span></div></div>
<div class="legend"><span><i></i>Indicated</span><span><i class="${gap}"></i>${below ? "Short of signed" : "Above signed"}</span><span>Original plan ${money(r.originalGP)} · ${pct(r.originalPct)}</span></div>`;
}

const stat = (k: string, v: string, n: string, t = "") => `<div class="stat"><div class="k">${k}</div><div class="v ${t}">${v}</div>${n ? `<div class="n">${n}</div>` : ""}</div>`;
const lr = (l: string, v: string, total = false) => `<div class="lr${total ? " t" : ""}"><span>${l}</span><span>${v}</span></div>`;

function timeline(baseline: string, forecast: string, today: string): string {
  const slip = daysBetween(baseline, forecast);
  const first = [today, baseline, forecast].sort()[0];
  const last = [today, baseline, forecast].sort()[2];
  const span = daysBetween(first, last) * 1.08 || 1;
  const p = (d: string) => clamp((daysBetween(first, d) / span) * 100);
  const edge = (x: number) => (x > 85 ? " r" : x < 12 ? " l" : "");
  const bp = p(baseline);
  const fp = p(forecast);
  const tp = p(today);
  const close = Math.abs(bp - fp) < 14;
  const mk = (cls: string, x: number, label: string, d: string) => `<div class="mk${cls}" style="left:${x.toFixed(2)}%"><span class="lab">${label}</span><span class="shard"></span><span class="d">${monthDay(d)}</span></div>`;
  const marks = slip === 0
    ? mk(edge(bp), bp, "Baseline = forecast", baseline)
    : mk(close ? (bp < fp ? " r" : " l") : edge(bp), bp, "Baseline", baseline) + mk(` fc${close ? (fp > bp ? " l" : " r") : edge(fp)}`, fp, "Forecast", forecast);
  return `<div class="tl" role="img" aria-label="Today ${esc(fullDate(today))}, baseline ${esc(fullDate(baseline))}, forecast ${esc(fullDate(forecast))}"><div class="axis"></div>${slip > 0 ? `<div class="slip" style="left:${bp.toFixed(2)}%;width:${(fp - bp).toFixed(2)}%"></div>` : ""}${mk(` today${edge(tp)}`, tp, "Today", today)}${marks}</div>`;
}

function meter(name: string, sub: string, held: number, target: number, guide: number): string {
  const max = Math.max(held, target) * 1.15 || 1;
  const isShort = held < target;
  const say = target === 0 ? "Nothing left to hold against." : isShort ? `${money(target - held)} short of the ${pctOf(guide)} I'd hold this phase.` : `Covers the ${pctOf(guide)} I'd hold this phase.`;
  return `<div class="meter"><div class="m-top"><span>${name}</span><b>${money(held)}</b></div><div class="m-sub">${sub}</div><div class="m-bar"><div class="m-fill${isShort ? " short" : ""}" style="width:${((held / max) * 100).toFixed(1)}%"></div>${target ? `<div class="m-target" style="left:${((target / max) * 100).toFixed(1)}%" title="Guide ${money(target)}"></div>` : ""}</div><div class="m-say">${say}</div></div>`;
}

function riskCard(e: IorExposure, today: string): string {
  const held = heldCents(e);
  const overdue = held > 0 && isReviewOverdue(e, today);
  const review = !e.next_review ? "No review date set" : overdue ? `Review overdue since ${esc(fullDate(e.next_review))}` : `Next review ${esc(fullDate(e.next_review))}`;
  const stale = held > 0 && (!e.next_review || overdue);
  return `<article class="risk"><div class="chips"><span class="c ${e.hold === "E" ? "e" : "ch"}">${e.hold}-hold</span><span class="c">${CATEGORY[e.category]}</span><span class="c">${RESPONSE[e.response]}</span></div><h4>${esc(e.title)}</h4><div class="calc">${money(Math.round(e.dollar_risk * 100))} × ${esc(pctOf(e.probability))} = <b>${money(held)}</b> held</div><div class="rev${stale ? " stale" : ""}">${review}${e.owner ? ` · ${esc(e.owner)}` : ""}</div>${e.next_move ? `<div class="move"><span>Athena's next move</span>${esc(e.next_move)}</div>` : ""}</article>`;
}

/** Athena's IOR view. `today` is the job's calendar day (YYYY-MM-DD). */
export function renderAthenaIor(m: IorModel, opts: { today: string; version?: number | null; dataDate?: string | null }): string {
  const r = iorRollup(m);
  const flags = iorFlags(m, r, opts.today);
  const dv = drivers(m, r);
  const noCost = !r.costKnown;
  const dash = "—";
  const gapTone = noCost ? "" : tone(r.gap);
  const when = [opts.version ? `IOR v${opts.version}` : "", opts.dataDate ? `data date ${fullDate(opts.dataDate)}` : "", `${m.phase} phase, ${pctOf(m.percent_complete)} complete`].filter(Boolean).join(" · ");
  const h: string[] = [];

  h.push(`<section class="read" aria-label="Athena's read"><div class="voice"><div class="who"><span class="avatar">${MARK}</span><div><b>Athena's read</b><span>${esc(when)}</span></div></div><h2>${headline(r)}</h2><p class="said">${said(r, dv)}</p>${
    flags.length ? `<div class="flags">${flags.map((f) => `<div class="flag${f.high ? " high" : ""}"><i></i><span><b>${esc(f.title)}</b> ${esc(f.detail)}</span></div>`).join("")}</div>` : ""
  }</div><div class="trackside">${track(r)}<div class="stats">${
    stat("Signed GP", noCost ? dash : money(r.signedGP), noCost ? "Needs a cost budget" : `${pct(r.signedPct)} of ${short(r.signedContract)}`) +
    stat("Indicated GP", noCost ? dash : money(r.indicatedGP), noCost ? "Needs a cost budget" : `${pct(r.indicatedPct)} after holds`) +
    stat("Gap to signed", noCost ? dash : signed(r.gap), "", gapTone === "zero" ? "" : gapTone) +
    stat("Held for risk", money(r.eHold + r.cHold), `E ${short(r.eHold)} · C ${short(r.cHold)}`)
  }</div></div></section>`);

  const maxAbs = Math.max(...dv.map((d) => Math.abs(d.value)), 1);
  const ranked = [...dv].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  h.push(`<section class="block"><div class="bh"><div><h3 class="wide">What moved the number</h3><p>From the profit you signed to the profit indicated today, biggest first.</p></div></div><div class="drivers">${ranked
    .map((d) => {
      const t = tone(d.value);
      const w = ((Math.abs(d.value) / maxAbs) * 48).toFixed(1);
      return `<div class="drv"><div class="what"><b>${d.title}</b><span>${esc(d.detail)}</span></div><div class="bar">${t === "zero" ? "" : `<i class="${t}" style="width:${w}%"></i>`}</div><div class="amt ${t}">${signed(d.value)}</div></div>`;
    })
    .join("")}</div><div class="sum"><span>Signed <b>${noCost ? dash : money(r.signedGP)}</b> → indicated <b>${noCost ? dash : money(r.indicatedGP)}</b></span><span>Gap <b>${noCost ? dash : signed(r.gap)}</b></span></div>
<details><summary>Show the math</summary><div class="ledgers"><div><h4>Signed profit</h4>${
    lr("Original planned GP", noCost ? "Not saved" : money(r.originalGP)) + lr("Approved change-order margin", signed(r.approvedContract - r.approvedCost)) + lr("Current signed GP", noCost ? dash : money(r.signedGP), true) + lr("Before holds", noCost ? dash : money(r.beforeHolds)) + lr("Less E-holds", signed(-r.eHold)) + lr("Less C-holds", signed(-r.cHold)) + lr("Indicated GP", noCost ? dash : money(r.indicatedGP), true)
  }</div><div><h4>Revenue forecast</h4>${
    lr("Original contract", money(r.originalContract)) + lr("Approved change orders", signed(r.approvedContract)) + lr("Current signed contract", money(r.signedContract), true) + lr("Pending change orders, weighted", signed(r.weightedPendingContract)) + lr("Risk-adjusted contract", money(r.forecastContract), true)
  }</div><div><h4>Cost forecast</h4>${
    lr("Original cost budget", noCost ? "Not saved" : money(r.originalCost)) + lr("Forecast cost growth", signed(r.costGrowth)) + lr("Base projected cost", noCost ? dash : money(r.baseCost), true) + lr("Approved change-order cost", signed(r.approvedCost)) + lr("Pending change-order cost, weighted", signed(r.weightedPendingCost)) + lr("Risk-adjusted cost", noCost ? dash : money(r.forecastCost), true)
  }</div></div><p class="note">Holds are dollar risk times probability. Pending change orders count at their probability.${r.pendingContract ? ` At face value they total ${money(r.pendingContract)}.` : ""}</p></details></section>`);

  const schedule = (() => {
    if (!m.baseline_completion || !m.forecast_completion) {
      return `<section class="block"><div class="bh"><h3 class="wide">Finish date</h3></div><div class="empty">Save a baseline and forecast finish and I'll show how far the date has moved.</div></section>`;
    }
    const slip = daysBetween(m.baseline_completion, m.forecast_completion);
    const moved = m.last_forecast_completion ? daysBetween(m.last_forecast_completion, m.forecast_completion) : null;
    const side = moved == null ? "First reading" : moved === 0 ? "No change since the last IOR" : `${moved > 0 ? "Slipped" : "Gained"} ${Math.abs(moved)} ${Math.abs(moved) === 1 ? "day" : "days"} since the last IOR`;
    const say = slip > 0 ? `Forecasting <span class="neg">${slip} ${slip === 1 ? "day" : "days"} late</span> against baseline.` : slip < 0 ? `Forecasting <span class="pos">${-slip} ${slip === -1 ? "day" : "days"} early</span>.` : "On baseline.";
    return `<section class="block"><div class="bh"><h3 class="wide">Finish date</h3><span class="side">${side}</span></div><p class="sched-say">${say}</p>${timeline(m.baseline_completion, m.forecast_completion, opts.today)}<div class="facts"><span>Forecast <b>${fullDate(m.forecast_completion)}</b></span><span>Baseline <b>${fullDate(m.baseline_completion)}</b></span><span>Schedule-linked risks <b>${m.exposures.filter(isScheduleLinked).length}</b></span></div></section>`;
  })();
  h.push(`<div class="two">${schedule}<section class="block"><div class="bh"><h3 class="wide">Money held for risk</h3><span class="side">${m.phase} phase guide</span></div>${meter("E-holds", "Specific risks priced now", r.eHold, r.eTarget, r.ePct)}${meter("C-holds", "General contingency", r.cHold, r.cTarget, r.cPct)}<p class="note">Guide is ${pctOf(r.ePct)} E and ${pctOf(r.cPct)} C of remaining cost (${money(r.remainingCost)}). The dark tick marks the guide.</p></section></div>`);

  const ordered = [...m.exposures].sort((a, b) => heldCents(b) - heldCents(a));
  const live = m.exposures.reduce((t, e) => t + Math.round(e.dollar_risk * 100), 0);
  h.push(`<section class="block"><div class="bh"><div><h3 class="wide">Risks I'm tracking</h3><p>Each risk in dollars. What's held is dollar risk times probability.</p></div><span class="side">${m.exposures.length} open</span></div>${
    ordered.length ? `<div class="risks">${ordered.map((e) => riskCard(e, opts.today)).join("")}</div>` : `<div class="empty">No risks logged yet. Tell me what could cost this job money and I'll price it as an E-hold or C-hold.</div>`
  }<div class="tally"><span>Live dollar risk <b>${money(live)}</b></span><span>Held <b>${money(r.eHold + r.cHold)}</b></span></div></section>`);

  const asks = noCost
    ? ["Load the cost budget for this job", "What do you need for the full read?", "Log a risk on this job"]
    : ["Why did the cost forecast move?", "Draft the recovery notice for the biggest risk", "What would get us back to signed?", "Make a PDF of this IOR"];
  h.push(`<section class="ask" aria-label="Ask Athena"><span class="avatar">${MARK}</span><div><p>Ask me about this job in your chat</p><div class="prompts">${asks.map((a) => `<span>${esc(a)}</span>`).join("")}</div></div></section>`);

  return `<style>${ATHENA_IOR_CSS}</style><div class="ath-ior">${h.join("")}</div>`;
}
