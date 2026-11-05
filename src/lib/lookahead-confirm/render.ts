// The page a supplier or sub opens from the confirmation email (/l/<token>). Client facing, so the contractor leads
// up top and Athena is only the small A and "Powered by Athena" at the bottom of the card. It shows the job's name
// and number, what is being confirmed and the date; never cost or anyone else's work. No script: each choice is
// its own plain form, so it works on any phone.
import { esc, PORTAL_HEADERS, safeLogo } from "../customer-portal/render";
import { ASK_NOUN, dateSpan, fullDate, shortDate, type PublicView } from "./model";

export { PORTAL_HEADERS as CONFIRM_HEADERS };

export type ConfirmStep = "main" | "propose" | "decline";

const ATHENA_A = `<svg viewBox="100 132 630 458" aria-hidden="true" focusable="false"><path fill="#2563EB" d="M395 140H540L260 582H108Z"/><path fill="#2563EB" d="M459 288H562L721 582H586Z"/><path fill="#2563EB" d="M393 404H499L517 443L337 493Z"/></svg>`;

const CSS = `
:root{color-scheme:light;--ink:#1F2329;--body:#4B5260;--muted:#6B6F78;--line:#E4E1D6;--soft:#F8FAFF;--blue:#2563EB;--blue-deep:#1D4ED8;--ground:#DBEAFE;--ok:#2C6A4B;--ok-soft:#EAF4EE;--ok-line:#C9E3D3;--wait:#7A5310;--wait-soft:#FBF3E4;--wait-line:#EFDCB5;--alert:#B91C1C;--alert-soft:#FFF3F5;--alert-line:#F3C8D0;--font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.55 var(--font);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
button,input,textarea{font:inherit;color:inherit}
.lc{min-height:100vh;padding:28px max(16px,env(safe-area-inset-left)) 40px max(16px,env(safe-area-inset-right))}
.lc-wrap{width:100%;max-width:34rem;margin:0 auto}
.lc-brand{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;min-width:0}
.lc-logo{display:block;max-width:220px;max-height:56px;width:auto;height:auto}
.lc-co{font-weight:700;font-size:21px;letter-spacing:-.01em;line-height:1.2;max-width:100%;overflow-wrap:anywhere}
.lc-tag{font:600 10px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--blue-deep)}
.lc-card{margin-top:24px;background:#fff;border:1px solid #2563EB33;border-radius:16px;box-shadow:0 1px 2px #0F1E3D0F;padding:22px 20px}
.lc-rule{width:40px;height:4px;background:var(--blue);margin-bottom:20px}
.lc-hi{margin:0 0 6px;color:var(--body)}
.lc h1{margin:0;font-size:25px;line-height:1.2;letter-spacing:-.015em;font-weight:700;text-wrap:balance}
.lc-sub{margin:10px 0 0;color:var(--body)}
.lc-ask{margin-top:20px;display:flex;gap:14px;align-items:stretch;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}
.lc-cal{flex:none;width:68px;border-radius:10px;background:#fff;border:1px solid #2563EB40;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 0;text-align:center}
.lc-cal span{font:600 10px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--blue-deep)}
.lc-cal b{font-size:28px;line-height:1.1;font-weight:700}
.lc-what{display:grid;gap:3px;min-width:0;align-content:center}
.lc-label{font:600 10px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);overflow-wrap:anywhere}
.lc-what b{font-size:16px;font-weight:600;overflow-wrap:anywhere}
.lc-what span.lc-when{color:var(--body)}
.lc-form{margin-top:22px;display:grid;gap:16px}
.lc-field{display:grid;gap:7px}
.lc-field label{font-weight:600;font-size:14px}
.lc-hint{font-size:13px;color:var(--muted);margin:0}
.lc-input,.lc-text{width:100%;border:1px solid #CFCBC0;border-radius:8px;background:#fff;padding:0 12px;outline:none}
.lc-input{height:48px;font-size:16px}
.lc-text{min-height:96px;padding:10px 12px;font-size:16px;resize:vertical}
.lc-input:focus,.lc-text:focus{border-color:var(--blue-deep);box-shadow:0 0 0 3px #2563EB26}
.lc-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:48px;padding:0 20px;border:0;border-radius:8px;background:var(--blue);color:#fff;font-weight:600;font-size:15px;cursor:pointer;text-decoration:none}
.lc-btn:hover{background:var(--blue-deep)}
.lc-alt{margin-top:12px;display:grid;gap:10px}
.lc-btn2{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 16px;border:1px solid #2563EB55;border-radius:8px;background:#fff;color:var(--blue-deep);font-weight:600;font-size:14px;text-decoration:none;text-align:center}
.lc-btn2:hover{background:var(--soft)}
.lc-back{justify-self:start;font-size:14px;font-weight:600;color:var(--blue-deep);text-decoration:underline;text-underline-offset:3px}
.lc-err{margin:18px 0 0;padding:11px 14px;border:1px solid var(--alert-line);border-radius:10px;background:var(--alert-soft);color:var(--alert);font-size:14px;font-weight:600}
.lc-done{margin-top:20px;padding:14px 16px;border-radius:12px;border:1px solid var(--ok-line);background:var(--ok-soft);color:var(--ok);display:grid;gap:4px}
.lc-done.wait{border-color:var(--wait-line);background:var(--wait-soft);color:var(--wait)}
.lc-done b{font-size:16px}
.lc-note{margin:10px 0 0;color:var(--body);font-size:14px;overflow-wrap:anywhere}
.lc-foot{margin-top:24px;padding-top:16px;border-top:1px solid var(--line);display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.lc-foot svg{width:22px;height:16px;flex:none;overflow:visible}
.lc-help{margin:18px 0 0;text-align:center;font-size:13px;color:var(--body)}
:is(a,button,input,textarea):focus-visible{outline:3px solid var(--blue-deep);outline-offset:2px}
@media (min-width:480px){.lc-alt{grid-template-columns:1fr 1fr}}
@media (min-width:640px){.lc{padding-top:56px}.lc-card{padding:34px}.lc h1{font-size:28px}.lc-cal{width:78px}.lc-cal b{font-size:32px}}
@media (min-width:1024px){.lc-wrap{max-width:38rem}.lc{padding-top:72px}}
@media (max-width:360px){.lc-ask{flex-direction:column}.lc-cal{width:100%;flex-direction:row;gap:8px;padding:8px}.lc h1{font-size:22px}}
`;

function doc(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="same-origin"><title>${esc(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"><style>${CSS}</style></head><body>${body}</body></html>`;
}

function shell(company: string | null, logo: string | null, inner: string): string {
  const src = safeLogo(logo);
  const brand = `<header class="lc-brand">${company ? (src ? `<img class="lc-logo" src="${esc(src)}" alt="${esc(company)}">` : `<span class="lc-co">${esc(company)}</span>`) : ""}<span class="lc-tag">Schedule confirmation</span></header>`;
  const help = company
    ? `<p class="lc-help">Questions about the date? Contact ${esc(company)}.</p>`
    : "";
  return `<main class="lc"><div class="lc-wrap">${brand}<section class="lc-card"><div class="lc-rule" aria-hidden="true"></div>${inner}<div class="lc-foot">${ATHENA_A}<span>Powered by Athena</span></div></section>${help}</div></main>`;
}

function askPanel(v: PublicView): string {
  const d = new Date(`${v.asked_date.slice(0, 10)}T12:00:00Z`);
  const mon = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const when =
    v.window_end && v.window_end.slice(0, 10) !== v.asked_date.slice(0, 10)
      ? `${fullDate(v.asked_date)} to ${fullDate(v.window_end)}`
      : fullDate(v.asked_date);
  return `<div class="lc-ask"><div class="lc-cal" aria-hidden="true"><span>${esc(mon)}</span><b>${d.getUTCDate()}</b><span>${esc(wd)}</span></div><div class="lc-what"><span class="lc-label">Job ${esc(v.job_number)} · ${esc(v.job_name)}</span><b>${esc(v.what)}</b><span class="lc-when">${esc(when)}</span></div></div>`;
}

const nameField = (value: string) =>
  `<div class="lc-field"><label for="name">Your name</label><input class="lc-input" id="name" name="name" autocomplete="name" required minlength="2" maxlength="120" value="${esc(value)}"></div>`;

export type AskOpts = {
  step: ConfirmStep;
  csrf: string;
  error?: string | null;
  logo?: string | null;
  /** The date a new date may start from, for the date picker. */
  today: string;
  values?: { name?: string; date?: string; note?: string };
};

export function renderAsk(v: PublicView, o: AskOpts): string {
  const noun = ASK_NOUN[v.ask_kind];
  const who = v.pm_name ? `${v.pm_name} at ${v.company}` : v.company;
  const err = o.error ? `<p class="lc-err" role="alert">${esc(o.error)}</p>` : "";
  const csrf = `<input type="hidden" name="csrf" value="${esc(o.csrf)}">`;
  const vals = o.values ?? {};
  const head = `<p class="lc-hi">Hi ${esc(v.party_name)},</p>`;
  let inner: string;
  if (o.step === "propose") {
    inner = `${head}<h1>Propose another date</h1><p class="lc-sub">${esc(v.company)} asked for ${esc(dateSpan(v.asked_date, v.window_end))}. Tell them the date that works for you. Nothing changes on the schedule until they confirm it with you.</p>${askPanel(v)}${err}<form method="post" class="lc-form"><input type="hidden" name="answer" value="proposed_new_date">${csrf}<div class="lc-field"><label for="date">Date that works</label><input class="lc-input" id="date" name="date" type="date" required min="${esc(o.today)}" value="${esc(vals.date ?? "")}"></div><div class="lc-field"><label for="note">Note (optional)</label><textarea class="lc-text" id="note" name="note" maxlength="2000" placeholder="Anything they should know">${esc(vals.note ?? "")}</textarea></div>${nameField(vals.name ?? "")}<button class="lc-btn" type="submit">Send the new date</button><a class="lc-back" href="?">Back</a></form>`;
  } else if (o.step === "decline") {
    inner = `${head}<h1>Can't make it</h1><p class="lc-sub">Let ${esc(v.company)} know what's in the way so they can plan around it.</p>${askPanel(v)}${err}<form method="post" class="lc-form"><input type="hidden" name="answer" value="declined">${csrf}<div class="lc-field"><label for="note">What's the problem?</label><textarea class="lc-text" id="note" name="note" required minlength="2" maxlength="2000" placeholder="For example, material is back ordered until Dec 2">${esc(vals.note ?? "")}</textarea></div>${nameField(vals.name ?? "")}<button class="lc-btn" type="submit">Send</button><a class="lc-back" href="?">Back</a></form>`;
  } else {
    inner = `${head}<h1>Confirm your ${esc(noun)} date</h1><p class="lc-sub">${esc(who)} has you on the two-week look-ahead. Please lock in the date below.</p>${askPanel(v)}${err}<form method="post" class="lc-form"><input type="hidden" name="answer" value="confirmed">${csrf}${nameField(vals.name ?? "")}<button class="lc-btn" type="submit">Confirm this date</button></form><div class="lc-alt"><a class="lc-btn2" href="?step=propose">Propose another date</a><a class="lc-btn2" href="?step=decline">Can't make it</a></div>`;
  }
  return doc(
    `${v.company} · Confirm ${noun} ${shortDate(v.asked_date)}`,
    shell(v.company, o.logo ?? null, inner),
  );
}

/** The thank-you state, also shown when the link is opened again after an answer. */
export function renderDone(v: PublicView, logo: string | null = null): string {
  const first = (v.responder_name ?? "").split(/\s+/)[0] || null;
  const noun = ASK_NOUN[v.ask_kind];
  const asked = dateSpan(v.asked_date, v.window_end);
  const [cls, line, after] =
    v.answer === "proposed_new_date"
      ? [
          "lc-done wait",
          `You proposed ${fullDate(v.response_date)} instead of ${asked}.`,
          `${v.company} will confirm the new date with you. Until then the schedule still shows ${asked}.`,
        ]
      : v.answer === "declined"
        ? [
            "lc-done wait",
            `You told ${v.company} you can't make ${noun} ${asked}.`,
            `${v.company} will follow up with you.`,
          ]
        : [
            "lc-done",
            `You confirmed ${noun} on ${fullDate(v.response_date ?? v.asked_date)}.`,
            `If anything changes, contact ${v.company} right away.`,
          ];
  const note = v.response_note ? `<p class="lc-note">Your note: ${esc(v.response_note)}</p>` : "";
  const inner = `<h1>${first ? `Thanks, ${esc(first)}` : "Thanks"}</h1><p class="lc-sub">${esc(v.company)} has your answer.</p>${askPanel(v)}<div class="${cls}" role="status"><b>${esc(line)}</b><span>${esc(after)}</span></div>${note}`;
  return doc(`${v.company} · Thanks`, shell(v.company, logo, inner));
}

const GONE: Record<string, [string, string]> = {
  unknown: [
    "This link isn't valid",
    "Check that you opened the whole link from your email, or ask your contractor to send a new one.",
  ],
  expired: ["This link has expired", "Contact your contractor to confirm the date."],
  cancelled: [
    "This request was taken back",
    "Your contractor no longer needs this date confirmed here. Contact them if you have questions.",
  ],
  slow_down: [
    "Too many tries",
    "This link has taken too many answers. Contact your contractor to confirm the date.",
  ],
  error: ["Something went wrong", "Try again in a moment. Nothing was recorded."],
};

export function renderConfirmGone(
  kind: string,
  company: string | null = null,
  logo: string | null = null,
): string {
  const [h, raw] = GONE[kind] ?? GONE.unknown!;
  const p = company
    ? raw
        .replace(/\b([Yy])our contractor\b/g, company)
        .replace(/\bContact them\b/g, `Contact ${company}`)
    : raw;
  return doc(h, shell(company, logo, `<h1>${esc(h)}</h1><p class="lc-sub">${esc(p)}</p>`));
}
