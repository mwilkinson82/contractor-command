// The reviewer's return page. Outside the company, so the contractor's brand leads and Athena is only the small
// "Powered by Athena" line at the bottom. It shows the submittal's number, revision, title and spec section, never
// cost, the package file or anything of the team's.
import { REPLY_ACTIONS, REPLY_ACTION_LABEL, type ReplyAction } from "./reply-link";

export const RETURN_HEADERS: Record<string, string> = {
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

export type ReturnInfo = {
  company: string;
  job_name: string;
  job_number: string;
  number: string;
  revision: number;
  title: string;
  spec_section: string;
  transmittal_number?: number | null;
};

export type ReturnForm = {
  action?: string;
  reviewer_name?: string;
  reviewer_email?: string;
  comments?: string;
};

const ATHENA_A = `<svg viewBox="100 132 630 458" aria-hidden="true" focusable="false"><path fill="#2563EB" d="M395 140H540L260 582H108Z"/><path fill="#2563EB" d="M459 288H562L721 582H586Z"/><path fill="#2563EB" d="M393 404H499L517 443L337 493Z"/></svg>`;

const CSS = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:#DBEAFE;color:#1F2329;font-family:"Archivo","Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.5}
.sr{min-height:100vh;padding:32px max(16px,env(safe-area-inset-left)) 40px max(16px,env(safe-area-inset-right))}
.sr-wrap{width:100%;max-width:40rem;margin:0 auto}
.sr-brand{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;min-width:0}
.sr-logo{display:block;max-width:220px;max-height:56px;width:auto;height:auto}
.sr-co{font-family:"Inter","Segoe UI",system-ui,-apple-system,sans-serif;font-weight:600;font-size:22px;letter-spacing:-.011em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-kicker{font:600 10px/1.3 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:#1D4ED8}
.sr-card{margin-top:28px;background:#fff;border:1px solid #2563EB33;border-radius:16px;box-shadow:0 1px 2px #0F1E3D0F;padding:22px}
.sr-rule{width:40px;height:4px;background:#2563EB;margin-bottom:20px}
.sr h1{margin:0;font-family:"Source Serif 4",Georgia,serif;font-weight:400;font-size:26px;line-height:1.2;letter-spacing:-.01em;text-wrap:balance}
.sr-sub{margin:10px 0 0;color:#5B5F68;font-size:14px}
.sr-facts{margin:20px 0 0;padding:14px 16px;border:1px solid #E4E1D6;border-radius:12px;background:#F8FAFF;display:grid;grid-template-columns:1fr;gap:10px}
.sr-facts div{display:grid;gap:2px;min-width:0}
.sr-label{display:block;font:600 10px/1.3 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#76736B}
.sr-facts b{font-size:15px;font-weight:600;overflow-wrap:anywhere}
.sr-form{margin-top:24px;display:grid;gap:20px}
fieldset{border:0;margin:0;padding:0;min-width:0}
legend{padding:0;margin-bottom:10px}
.sr-choices{display:grid;grid-template-columns:1fr;gap:8px}
.sr-choice{position:relative;display:flex;align-items:center;gap:10px;min-height:48px;padding:10px 14px;border:1px solid #E4E1D6;border-radius:10px;background:#fff;cursor:pointer;font-weight:600}
.sr-choice input{width:18px;height:18px;margin:0;accent-color:#2563EB;flex:none}
.sr-choice:has(input:checked){border-color:#2563EB;background:#EFF5FF;box-shadow:0 0 0 2px #2563EB26}
.sr-field{display:grid;gap:8px;min-width:0}
.sr-input,.sr-text,.sr-file{width:100%;border:1px solid #E4E1D6;border-radius:8px;background:#fff;color:#1F2329;font:inherit;font-size:16px}
.sr-input{height:46px;padding:0 12px}
.sr-text{min-height:120px;padding:10px 12px;resize:vertical}
.sr-file{padding:10px 12px}
.sr-input:focus,.sr-text:focus,.sr-file:focus{outline:none;border-color:#1D4ED8;box-shadow:0 0 0 3px #2563EB26}
.sr-two{display:grid;grid-template-columns:1fr;gap:16px}
.sr-note{margin:0;font-size:12.5px;color:#76736B}
.sr-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:48px;padding:0 20px;border:0;border-radius:8px;background:#2563EB;color:#fff;font:600 15px/1 "Archivo","Helvetica Neue",Arial,sans-serif;cursor:pointer}
.sr-btn:hover{background:#1D4ED8}
.sr-btn:focus-visible,.sr-choice:focus-within{outline:3px solid #1D4ED8;outline-offset:2px}
.sr-err{margin:18px 0 0;padding:11px 14px;border:1px solid #F3C8D0;border-radius:10px;background:#FFF3F5;color:#B91C1C;font-size:14px;font-weight:600}
.sr-done{margin:18px 0 0;padding:14px 16px;border:1px solid #BBE5C8;border-radius:12px;background:#F0FBF3;font-size:15px}
.sr-foot{margin-top:26px;padding-top:16px;border-top:1px solid #E4E1D6;display:flex;align-items:center;gap:8px;font-size:12px;color:#76736B}
.sr-foot svg{width:22px;height:16px;flex:none;overflow:visible}
.sr-help{margin:20px 0 0;text-align:center;font-size:12.5px;color:#3F434B}
@media (min-width:600px){.sr{padding-top:56px;padding-bottom:56px}.sr-card{padding:32px}.sr h1{font-size:29px}.sr-choices{grid-template-columns:1fr 1fr}.sr-two{grid-template-columns:1fr 1fr}.sr-facts{grid-template-columns:1fr 1fr}.sr-btn{width:auto;justify-self:start;min-width:220px}}
@media (min-width:1024px){.sr-wrap{max-width:44rem}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const FONTS =
  "family=Archivo:wght@400;500;600;700&family=Inter:wght@600&family=JetBrains+Mono:wght@600&family=Source+Serif+4:opsz,wght@8..60,400";

/** Only an https image may stand in for the contractor's name. */
const safeLogo = (url: string | null | undefined): string | null =>
  url && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;

function doc(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${FONTS}&display=swap"><style>${CSS}</style></head><body>${body}</body></html>`;
}

function shell(company: string | null, logo: string | null, inner: string): string {
  const src = safeLogo(logo);
  const brand = `<header class="sr-brand">${
    company
      ? src
        ? `<img class="sr-logo" src="${esc(src)}" alt="${esc(company)}">`
        : `<span class="sr-co">${esc(company)}</span>`
      : ""
  }<span class="sr-kicker">Submittal review</span></header>`;
  const help = company
    ? `<p class="sr-help">Questions about this submittal? Contact ${esc(company)}.</p>`
    : "";
  return `<main class="sr"><div class="sr-wrap">${brand}<section class="sr-card"><div class="sr-rule" aria-hidden="true"></div>${inner}<div class="sr-foot">${ATHENA_A}<span>Powered by Athena</span></div></section>${help}</div></main>`;
}

function facts(info: ReturnInfo): string {
  const rows: [string, string][] = [
    ["Submittal", `${info.number} revision ${info.revision}`],
    ["Spec section", info.spec_section],
    ["Job", `${info.job_number} ${info.job_name}`.trim()],
    ...(info.transmittal_number
      ? ([["Transmittal", `T-${info.transmittal_number}`]] as [string, string][])
      : []),
  ];
  return `<div class="sr-facts">${rows.map(([k, v]) => `<div><span class="sr-label">${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>`;
}

export function renderReturnForm(
  info: ReturnInfo,
  o: { csrf: string; logo?: string | null; error?: string | null; values?: ReturnForm },
): string {
  const v = o.values ?? {};
  const err = o.error ? `<p class="sr-err" role="alert">${esc(o.error)}</p>` : "";
  const choices = REPLY_ACTIONS.map(
    (a: ReplyAction) =>
      `<label class="sr-choice"><input type="radio" name="action" value="${a}" required${v.action === a ? " checked" : ""}><span>${esc(REPLY_ACTION_LABEL[a])}</span></label>`,
  ).join("");
  const inner = `<h1>Return submittal ${esc(info.number)}</h1><p class="sr-sub">${esc(info.title)}. ${esc(info.company)} sent this for your review.</p>${facts(info)}${err}<form class="sr-form" method="post" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${esc(o.csrf)}"><fieldset><legend class="sr-label">Your action</legend><div class="sr-choices">${choices}</div></fieldset><div class="sr-field"><label class="sr-label" for="file">Stamped or marked up copy</label><input class="sr-file" id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"><p class="sr-note">Optional. One PDF, PNG or JPEG up to 25 MB.</p></div><div class="sr-two"><div class="sr-field"><label class="sr-label" for="reviewer_name">Your name</label><input class="sr-input" id="reviewer_name" name="reviewer_name" autocomplete="name" minlength="2" maxlength="120" required value="${esc(v.reviewer_name)}"></div><div class="sr-field"><label class="sr-label" for="reviewer_email">Your email</label><input class="sr-input" id="reviewer_email" name="reviewer_email" type="email" autocomplete="email" maxlength="320" value="${esc(v.reviewer_email)}"></div></div><div class="sr-field"><label class="sr-label" for="comments">Comments</label><textarea class="sr-text" id="comments" name="comments" maxlength="4000">${esc(v.comments)}</textarea></div><p class="sr-note">Sending this records your action on ${esc(info.company)}'s submittal log with your name and the time.</p><button class="sr-btn" type="submit">Send my review</button></form>`;
  return doc(`Return submittal ${info.number}`, shell(info.company, o.logo ?? null, inner));
}

export function renderThanks(
  info: ReturnInfo,
  returned: {
    action_label: string;
    reviewer_name: string | null;
    created_at: string;
    file_count?: number;
  },
  logo: string | null = null,
): string {
  const first = (returned.reviewer_name ?? "").trim().split(/\s+/)[0];
  const when = new Date(returned.created_at);
  const date = Number.isNaN(when.getTime())
    ? ""
    : ` on ${when.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  const file = returned.file_count ? " Your file is attached to it." : "";
  const inner = `<h1>Thank you${first ? `, ${esc(first)}` : ""}</h1><p class="sr-sub">${esc(info.company)} has your review of submittal ${esc(info.number)}, ${esc(info.title)}.</p><p class="sr-done"><b>${esc(returned.action_label)}</b> was recorded${esc(date)}.${file}</p><p class="sr-sub">To change it, contact ${esc(info.company)}. You can close this page.</p>`;
  return doc(`Submittal ${info.number} returned`, shell(info.company, logo, inner));
}

const GONE: Record<string, [string, string]> = {
  unknown: [
    "This link isn't valid",
    "Check that you opened the whole link from the email, or ask the contractor to send it again.",
  ],
  expired: [
    "This review link has expired",
    "Reply to the submittal email instead, or ask the contractor for a new link.",
  ],
  revoked: [
    "This submittal was withdrawn",
    "The contractor turned off this package. Contact them for the current one.",
  ],
  void: [
    "This submittal was withdrawn",
    "The contractor voided this submittal. Contact them if you have questions.",
  ],
  replaced: [
    "A newer revision was sent",
    "This link is for an earlier revision. Use the link in the newest submittal email.",
  ],
  slow_down: ["Too many tries", "Wait a few minutes and try again."],
  error: ["Something went wrong", "Try again in a moment. Nothing was recorded."],
};

export function renderGone(
  kind: string,
  company: string | null = null,
  logo: string | null = null,
): string {
  const [h, raw] = GONE[kind] ?? GONE.unknown!;
  const p = company ? raw.replace(/\bthe contractor\b/gi, company) : raw;
  return doc(h, shell(company, logo, `<h1>${esc(h)}</h1><p class="sr-sub">${esc(p)}</p>`));
}
