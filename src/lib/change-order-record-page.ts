// The change order record: /r/job/<job>/submittal/<PCO number> when the record is a change order.
// It reads as a change order, not a submittal: what it adds in money and time, who approved it and how, and what the
// contract is now. Proof of a client's approval (decision id, fingerprint) folds under "Approval proof".
// Pure: one HTML string, shared by the signed-in page and the board-token page.
import {
  changeMoney,
  lineRate,
  type ChangeCostLine,
  type ChangeDetails,
} from "./mcp/change-orders";
import { esc } from "./report-pages";
import { jobHeading } from "./mcp/job-label";
import { submittalTimeZone, type SubmittalTimeZones } from "./submittal-build-time";

export type ChangeOrderRecordInput = {
  jobId?: string;
  jobNumber?: string;
  jobName?: string;
  number: string;
  title: string;
  details: ChangeDetails;
  history?: {
    record_version: number;
    action: string;
    created_at: string;
    snapshot: ChangeDetails;
  }[];
  zones: SubmittalTimeZones;
  readOnly?: boolean;
  /** Timeline panel HTML, built by the submittal record page so both pages read events the same way. */
  timeline: string;
  /** Package files panel HTML, when the change order was ever sent as a package. Empty otherwise. */
  files?: string;
};

/** True when the client approved this change order on their client page. */
export function clientApproved(details: ChangeDetails | null | undefined): boolean {
  const d = details as
    | (ChangeDetails & { decision?: { channel?: string } | null })
    | null
    | undefined;
  return d?.decision?.channel === "customer_page" && ["approved", "executed"].includes(d.state);
}

/** A decided change order (approved, on the contract or declined) takes no more package pieces, so its page has no upload panel. */
export function changeOrderDecided(details: ChangeDetails | null | undefined): boolean {
  return !!details && ["approved", "executed", "rejected"].includes(details.state);
}

const CSS = `
.cor{--ink:#1c3654;--ink-2:#5b718c;--ink-3:#8496ad;--rule:#d4dfed;--rule-2:#e6edf5;--wash:#f6f8fb;--accent:#245fbd;--accent-wash:#e5eefb;--good:#1d6b45;--good-wash:#e3f3ea;
  max-width:1440px;margin:0 auto;padding:24px clamp(16px,3vw,40px) 40px;color:var(--ink);font:14px/1.55 "Archivo",Arial,system-ui,sans-serif}
.cor *{box-sizing:border-box;min-width:0}
.cor a{color:var(--accent)}
.cor a:focus-visible,.cor summary:focus-visible{outline:3px solid #377bd2;outline-offset:3px}
.cor-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 18px}
.cor-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:8px 14px;border:1px solid #b8cdeb;border-radius:6px;background:#fff;color:var(--ink)!important;font-weight:700;font-size:13px;text-decoration:none;cursor:pointer}
.cor-btn:hover{background:#edf4ff}
.cor-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px 20px;margin:0 0 20px}
.cor-eyebrow{margin:0 0 4px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);font-weight:800}
.cor h1{margin:0;font-size:clamp(22px,2.6vw,30px);line-height:1.2;font-weight:700;letter-spacing:-.02em}
.cor-sub{margin:6px 0 0;color:var(--ink-2);font-size:13px}
.cor-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:700;background:var(--accent-wash);color:var(--accent);white-space:nowrap}
.cor-badge.is-on{background:var(--good-wash);color:var(--good)}
.cor-badge.is-off{background:#f1f3f6;color:var(--ink-2)}
.cor-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 20px}
.cor-tile{background:#fff;border:1px solid var(--rule);border-radius:10px;padding:16px 18px;container-type:inline-size}
.cor-tile h2{margin:0 0 6px;font-size:13px;font-weight:500;color:var(--ink-2)}
.cor-tile strong{display:block;font-size:clamp(18px,11cqi,28px);line-height:1.2;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
.cor-tile p{margin:6px 0 0;font-size:12px;color:var(--ink-2)}
.cor-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px);gap:20px;align-items:start}
.cor-panel{background:#fff;border:1px solid var(--rule);border-radius:9px;margin:0 0 20px;overflow:hidden}
.cor-panel>h2{margin:0;padding:14px 20px;font-size:16px;border-bottom:1px solid var(--rule)}
.cor-body{padding:16px 20px}
.cor-body>:first-child{margin-top:0}
.cor-body>:last-child{margin-bottom:0}
.cor-label{display:block;margin:0 0 2px;font-size:12px;font-weight:700;color:var(--ink-2)}
.cor-text{margin:0 0 14px;white-space:pre-wrap}
.cor-table{width:100%;border-collapse:collapse;font-size:14px}
.cor-table th{padding:10px 20px;text-align:left;font-size:12px;font-weight:700;color:var(--ink-2);border-bottom:1px solid var(--rule);background:var(--wash);white-space:nowrap}
.cor-table td{padding:12px 20px;border-bottom:1px solid var(--rule-2);vertical-align:top}
.cor-table .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.cor-table tfoot td{border-bottom:0;font-weight:700;background:var(--wash)}
.cor-approval{margin:0 0 10px}
.cor-contract{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 0 14px;padding:12px 14px;border-radius:8px;background:var(--good-wash);color:var(--good);font-weight:600}
.cor-contract.is-off{background:var(--wash);color:var(--ink-2)}
.cor-proof{border-top:1px solid var(--rule-2);padding-top:10px}
.cor-proof summary{cursor:pointer;color:var(--accent);font-weight:700;font-size:13px;list-style:none;display:inline-flex;align-items:center;gap:6px}
.cor-proof summary::-webkit-details-marker{display:none}
.cor-proof summary::before{content:"\\203A";display:inline-block;transition:transform .15s}
.cor-proof[open] summary::before{transform:rotate(90deg)}
.cor-proof dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 14px;margin:10px 0 0;font-size:12px;color:var(--ink-2)}
.cor-proof dt{font-weight:700}
.cor-proof dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.cor-proof dd.plain{font-family:inherit}
.cor-history{list-style:none;margin:0;padding:0}
.cor-history li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;padding:8px 0;border-top:1px solid var(--rule-2);font-size:13px}
.cor-history li:first-child{border-top:0;padding-top:0}
.cor-history span{color:var(--ink-2)}
.cor-foot{margin:8px 0 0;font-size:12px;color:var(--ink-3)}
@media (max-width:1100px){.cor-grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width:860px){.cor-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){
  .cor{padding:16px 16px 32px}
  .cor-tiles{gap:10px}
  .cor-tile{padding:12px 14px}
  .cor-table thead{display:none}
  .cor-table,.cor-table tbody,.cor-table tfoot,.cor-table tr,.cor-table td{display:block;width:100%}
  .cor-table tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 10px;padding:12px 16px;border-bottom:1px solid var(--rule-2)}
  .cor-table td{padding:0;border:0}
  .cor-table td.item{grid-column:1/-1;font-weight:600}
  .cor-table td.num{text-align:left}
  .cor-table td[data-label]::before{content:attr(data-label);display:block;font-size:11px;font-weight:700;color:var(--ink-2)}
  .cor-table tfoot tr{display:flex;justify-content:space-between}
  .cor-table tfoot td[data-label]::before{display:none}
  .cor-body,.cor-panel>h2{padding-left:16px;padding-right:16px}
}`;

function signed(cents: number): string {
  if (cents === 0) return changeMoney(0);
  return `${cents < 0 ? "−" : "+"}${changeMoney(Math.abs(cents))}`;
}

function when(
  value: string | null | undefined,
  zones: SubmittalTimeZones,
  withTime = false,
): string {
  const date = new Date(value ?? "");
  if (!value || !Number.isFinite(date.getTime())) return "";
  const { zone } = submittalTimeZone(zones);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  if (!withTime) return day;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
  return `${day} at ${time}`;
}

/** A record time in the job's own zone, e.g. "Nov 6, 2026 at 7:24 PM EST". */
export const changeOrderWhen = (value: string, zones: SubmittalTimeZones) =>
  when(value, zones, true);

/** "Marshall Wilkinson <m@x.com>" → name and email. */
function person(by: string | null | undefined): { name: string; email: string | null } {
  const raw = (by ?? "").trim();
  const m = /^(.*?)\s*<([^>]+)>$/.exec(raw);
  return m
    ? { name: m[1].trim() || m[2], email: m[2] }
    : { name: raw || "Not recorded", email: null };
}

const proofRef = (citation: string) => /^Customer page decision\b/i.test(citation.trim());

const ACTION_LABEL: Record<string, string> = {
  create: "Started",
  edit: "Scope edited",
  price: "Priced",
  approve: "Approved",
  reject: "Declined",
  execute: "Added to the contract",
  reopen: "Reopened",
};

function stateBadge(d: ChangeDetails): { text: string; tone: "" | "is-on" | "is-off" } {
  switch (d.state) {
    case "executed":
      return { text: "On the contract", tone: "is-on" };
    case "approved":
      return { text: "Approved, not on the contract yet", tone: "" };
    case "rejected":
      return { text: "Declined", tone: "is-off" };
    case "submitted":
      return { text: "Waiting on approval", tone: "" };
    case "priced":
      return { text: "Priced, not sent", tone: "is-off" };
    default:
      return { text: "Draft, not sent", tone: "is-off" };
  }
}

function pricingRow(line: ChangeCostLine): string {
  const markup = line.category === "markup";
  const qty = markup
    ? "Direct costs"
    : line.quantity != null
      ? `${line.quantity} ${line.unit ?? ""}`.trim()
      : "Lump sum";
  const rate = markup ? `${(line.rate_basis_points ?? 0) / 100}%` : lineRate(line);
  return `<tr><td class="item" data-label="Item">${esc(line.description)}</td><td data-label="Qty">${esc(qty)}</td><td class="num" data-label="Rate">${esc(rate)}</td><td class="num" data-label="Total">${esc(changeMoney(line.amount_cents))}</td></tr>`;
}

export function renderChangeOrderRecord(input: ChangeOrderRecordInput): string {
  const d = input.details;
  const zones = input.zones;
  const client = clientApproved(d);
  const decision = d.decision as
    | (NonNullable<ChangeDetails["decision"]> & {
        channel?: string;
        fingerprint?: string;
        email_code_verified?: boolean;
      })
    | null
    | undefined;
  const execution = d.execution ?? null;
  const coNumber = d.co_number?.trim() || null;
  const heading = coNumber ? `${coNumber} · ${input.title}` : `${input.number} · ${input.title}`;
  const job = jobHeading({ job_number: input.jobNumber ?? "", name: input.jobName ?? "" }, " ");
  const badge = stateBadge(d);
  const total = d.total_cents;
  const days = d.schedule_days;

  // Tiles: amount, time, approval, contract.
  const amountTile = `<div class="cor-tile"><h2>Amount</h2><strong>${total == null ? "Not priced" : esc(signed(total))}</strong><p>${d.lines.length ? `${d.lines.length} ${d.lines.length === 1 ? "line" : "lines"}` : "Rates and quantities needed"}</p></div>`;
  const timeTile = `<div class="cor-tile"><h2>Time</h2><strong>${days == null ? "Not set" : `${days > 0 ? "+" : ""}${days} ${Math.abs(days) === 1 ? "day" : "days"}`}</strong><p>${days == null ? "Schedule impact not determined" : days === 0 ? "No added time" : "Added to the schedule"}</p></div>`;
  const decidedTile =
    decision && (d.state === "approved" || d.state === "executed")
      ? `<div class="cor-tile"><h2>Approved</h2><strong>${esc(when(decision.at, zones))}</strong><p>${client ? (decision.email_code_verified ? "By the client · emailed code" : "By the client") : `By ${esc(person(decision.by).name)}`}</p></div>`
      : decision && d.state === "rejected"
        ? `<div class="cor-tile"><h2>Declined</h2><strong>${esc(when(decision.at, zones))}</strong><p>By ${esc(person(decision.by).name)}</p></div>`
        : `<div class="cor-tile"><h2>Approval</h2><strong>Not yet</strong><p>${d.state === "submitted" ? "Sent, waiting on approval" : "Not sent for approval"}</p></div>`;
  const after = execution?.contract_after_cents;
  const before = execution?.contract_before_cents;
  const contractTile =
    d.state === "executed"
      ? `<div class="cor-tile"><h2>New contract value</h2><strong>${after != null ? esc(changeMoney(after)) : "Updated"}</strong><p>${before != null ? `Was ${esc(changeMoney(before))}` : "This change is on the contract"}</p></div>`
      : `<div class="cor-tile"><h2>Contract value</h2><strong>No change yet</strong><p>${d.state === "approved" ? "Joins when executed" : d.state === "rejected" ? "Declined, no change" : "Joins once approved"}</p></div>`;

  // What changed: why, the change, and any drawing or spec references.
  const refs = (d.references ?? []).filter((r) => !proofRef(r.citation));
  const what = `<section class="cor-panel"><h2>What changed</h2><div class="cor-body">${
    d.condition?.trim()
      ? `<span class="cor-label">Why</span><p class="cor-text">${esc(d.condition.trim())}</p>`
      : ""
  }${d.scope?.trim() ? `<span class="cor-label">Change</span><p class="cor-text">${esc(d.scope.trim())}</p>` : ""}${
    refs.length
      ? `<span class="cor-label">References</span><ul style="margin:0;padding-left:18px">${refs.map((r) => `<li>${esc(r.citation)}</li>`).join("")}</ul>`
      : ""
  }</div></section>`;

  const pricing = `<section class="cor-panel"><h2>Pricing</h2>${
    d.lines.length
      ? `<table class="cor-table"><thead><tr><th>Item</th><th>Qty</th><th class="num">Rate</th><th class="num">Total</th></tr></thead><tbody>${d.lines.map(pricingRow).join("")}</tbody>${
          total != null
            ? `<tfoot><tr><td colspan="3">Total</td><td class="num" data-label="Total">${esc(signed(total))}</td></tr></tfoot>`
            : ""
        }</table>`
      : `<div class="cor-body"><p class="cor-text" style="color:var(--ink-2)">Not priced yet. Rates and quantities are needed.</p></div>`
  }</section>`;

  // Approval: who, how, when, and what it did to the contract. The ids sit under Approval proof.
  let approval = "";
  if (decision) {
    const who = person(decision.by);
    const verb = d.state === "rejected" ? "Declined" : "Approved";
    const how = client
      ? ` on the client page${decision.email_code_verified ? " with an emailed code" : ""}, signed with their typed name`
      : "";
    const line = `<p class="cor-approval">${verb} by <strong>${esc(who.name)}</strong>${how}, ${esc(when(decision.at, zones, true))}.</p>`;
    const contract =
      d.state === "executed"
        ? `<p class="cor-contract">${client ? "Added to the contract by the client's approval" : "Added to the contract"}${
            before != null && after != null
              ? `: ${esc(changeMoney(before))} → ${esc(changeMoney(after))}`
              : ""
          }</p>`
        : d.state === "approved"
          ? `<p class="cor-contract is-off">Approved. It joins the contract when it is executed.</p>`
          : "";
    const proof: [string, string, boolean][] = [];
    if (who.email) proof.push(["Signed by", `${who.name} <${who.email}>`, true]);
    if (decision.reference) proof.push(["Decision", decision.reference, false]);
    if (decision.fingerprint) proof.push(["Fingerprint", decision.fingerprint, false]);
    if (client)
      proof.push(["Emailed code", decision.email_code_verified ? "Verified" : "Not used", true]);
    if (execution?.sov_item) proof.push(["SOV line", execution.sov_item, true]);
    for (const r of (d.references ?? []).filter((x) => proofRef(x.citation)))
      proof.push(["Reference", r.citation, false]);
    const proofHtml = proof.length
      ? `<details class="cor-proof"><summary>Approval proof</summary><dl>${proof
          .map(
            ([k, v, plain]) =>
              `<dt>${esc(k)}</dt><dd${plain ? ' class="plain"' : ""}>${esc(v)}</dd>`,
          )
          .join("")}</dl></details>`
      : "";
    approval = `<section class="cor-panel"><h2>${verb === "Declined" ? "Decision" : "Approval"}</h2><div class="cor-body">${line}${contract}${proofHtml}</div></section>`;
  }

  const history = (input.history ?? []).slice().sort((a, b) => a.record_version - b.record_version);
  const historyHtml = history.length
    ? `<section class="cor-panel"><h2>Record history</h2><div class="cor-body"><ul class="cor-history">${history
        .map(
          (h) =>
            `<li><strong>${esc(ACTION_LABEL[h.action] ?? h.action)}</strong><span>${esc(when(h.created_at, zones, true))} · ${
              h.snapshot.total_cents == null ? "Not priced" : esc(signed(h.snapshot.total_cents))
            }</span></li>`,
        )
        .join("")}</ul></div></section>`
    : "";

  const logHref = input.jobId ? `/r/job/${input.jobId}/cos` : null;
  const homeHref = input.jobId ? `/r/job/${input.jobId}/home` : null;
  const top = `<nav class="cor-top" aria-label="Change order">${logHref ? `<a class="cor-btn" href="${esc(logHref)}"><span aria-hidden="true">←</span> Change-order log</a>` : ""}${
    homeHref ? `<a class="cor-btn" href="${esc(homeHref)}">Job board</a>` : ""
  }</nav>`;
  const head = `<header class="cor-head"><div><p class="cor-eyebrow">Change order</p><h1>${esc(heading)}</h1><p class="cor-sub">${esc(job)}${
    coNumber ? ` · ${esc(input.number)}` : ""
  }${input.readOnly ? " · Read only" : ""}</p></div><span class="cor-badge ${badge.tone}">${esc(badge.text)}</span></header>`;
  const tiles = `<div class="cor-tiles">${amountTile}${timeTile}${decidedTile}${contractTile}</div>`;

  return `<style>${CSS}</style><div class="cor" data-change-order="${esc(input.number)}" data-state="${esc(d.state)}">${top}${head}${tiles}<div class="cor-grid"><div>${what}${pricing}${approval}${input.files ?? ""}${historyHtml}</div><div>${input.timeline}</div></div><p class="cor-foot">Private to your company · updates as the record changes</p></div>`;
}
