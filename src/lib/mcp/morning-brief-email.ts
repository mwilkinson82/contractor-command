// The morning brief as a daily email (Nov 5). Same brief as the chat card and /today, in Athena's one email shell:
// white card, navy and slate text, one blue button. Red is only for late, overdue and risk lines.
// Chat buttons can't work in an inbox, so each section ends with the words to say in the member's AI chat.
// Off unless ATHENA_BRIEF_EMAIL_ENABLED is "true", and always off under ATHENA_OUTBOUND_EMAIL_DISABLED.
// Each member also turns it on for themselves. One email per member per local day.
import { EMAIL_LINE, EMAIL_MUTED, EMAIL_NAVY, EMAIL_SLATE, emailShell, esc } from "../email/athena-shell";
import { outboundEmailDisabled } from "./email-safety";
import { parseSendTime, zonedClock } from "./field-reminder";
import type { BriefBlock, BriefButton, BriefDoc, BriefRow, BriefSectionDoc, BriefTone } from "./morning-brief-pm";

type Env = Record<string, string | undefined>;
const runtimeEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

export const BRIEF_EMAIL_FROM_DEFAULT = "Athena <brief@meetathena.io>";
export const BRIEF_EMAIL_REPLY_TO = "support@meetathena.io";
export const BRIEF_EMAIL_PAGE = "https://app.meetathena.io/today";
/** A member who turns email on at 9 PM doesn't get "Good morning" that night. */
export const BRIEF_EMAIL_WINDOW_MINUTES = 180;

export const BRIEF_RED = "#9F243A";
const SOFT = "#F7F9FD";
const MAX_ROWS = 6;

export function briefEmailEnabled(env: Env = runtimeEnv()): boolean {
  return env.ATHENA_BRIEF_EMAIL_ENABLED === "true" && !outboundEmailDisabled(env) && !!env.RESEND_API_KEY;
}

function color(tone: BriefTone | undefined): string {
  return tone === "bad" ? BRIEF_RED : EMAIL_NAVY;
}

function line(title: string, detail: string | null | undefined, tone?: BriefTone): string {
  const mark = tone === "bad" ? `<span style="color:${BRIEF_RED};font-weight:700">&#9679;</span>&nbsp;` : "";
  const sub = detail ? `<br><span style="color:${EMAIL_SLATE};font-size:13px;line-height:20px">${esc(detail)}</span>` : "";
  return `<tr><td style="padding:6px 0;border-bottom:1px solid ${EMAIL_LINE};color:${color(tone)};font-size:14px;line-height:21px">${mark}<strong>${esc(title)}</strong>${sub}</td></tr>`;
}

function list(rows: string[], more = 0): string {
  if (!rows.length) return "";
  const extra = more > 0 ? `<tr><td style="padding:6px 0;color:${EMAIL_MUTED};font-size:13px;line-height:20px">${more} more on today's brief</td></tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${rows.join("")}${extra}</table>`;
}

function rows(items: BriefRow[]): string {
  return list(
    items.slice(0, MAX_ROWS).map((r) => line(r.title, r.detail, r.tone)),
    items.length - MAX_ROWS,
  );
}

function kpis(items: Extract<BriefBlock, { type: "kpis" }>["items"]): string {
  const cells = items.slice(0, 4).map(
    (k) =>
      `<td valign="top" width="50%" style="padding:8px 10px;border:1px solid ${EMAIL_LINE};border-radius:8px;background-color:${SOFT}"><span style="display:block;color:${EMAIL_MUTED};font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.6px">${esc(k.label)}</span><strong style="display:block;color:${k.unknown ? EMAIL_MUTED : EMAIL_NAVY};font-size:16px;line-height:22px">${esc(k.value)}</strong>${k.note ? `<span style="display:block;color:${EMAIL_SLATE};font-size:12px;line-height:17px">${esc(k.note)}</span>` : ""}</td>`,
  );
  // Two to a row, so four figures still read on a phone.
  const trs: string[] = [];
  for (let i = 0; i < cells.length; i += 2) trs.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td width="50%"></td>'}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="4" border="0" style="border-collapse:separate;margin:0 0 6px">${trs.join("")}</table>`;
}

/** Drops chat-only sentences ("Tap each check...") that can't work in an inbox. */
export function inboxText(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\b(tap|click)\b/i.test(sentence))
    .join(" ")
    .trim();
}

function block(b: BriefBlock): string {
  switch (b.type) {
    case "rows":
      return rows(b.rows);
    case "table":
      return list(
        b.rows.slice(0, MAX_ROWS).map((r) => {
          const [first, ...rest] = r.cells.filter(Boolean);
          const detail = [...rest, r.pill && !r.cells.includes(r.pill.text) ? r.pill.text : ""].filter(Boolean).join(" · ");
          return line(first ?? "", detail, r.tone ?? r.pill?.tone ?? null);
        }),
        b.rows.length - MAX_ROWS,
      );
    case "kpis":
      return kpis(b.items);
    case "bars":
      return list(b.items.slice(0, MAX_ROWS).map((x) => line(x.label, `${Math.round(x.pct)}% complete`)));
    case "gantt":
      // The crew rows above it already list these activities; the chart itself lives on today's brief.
      return "";
    case "callouts":
      return list(b.items.slice(0, MAX_ROWS).map((c) => line(c.title, c.text, c.tone)));
    case "text": {
      const text = inboxText(b.text);
      return text ? `<p style="margin:0 0 8px;color:${b.strong ? EMAIL_NAVY : EMAIL_SLATE};font-size:14px;line-height:21px${b.strong ? ";font-weight:700" : ""}">${esc(text)}</p>` : "";
    }
    case "jobs":
      return list(
        b.rows.slice(0, MAX_ROWS).map((r) => line(r.title, [r.sub, r.pill].filter(Boolean).join(" · "), r.tone)),
        b.rows.length - MAX_ROWS,
      );
    case "tell":
      return `<p style="margin:0;color:${EMAIL_SLATE};font-size:14px;line-height:21px">${esc(b.text)}</p>`;
    case "inbox":
    case "actions":
      return "";
  }
}

/** The one thing to say in chat for this section: its first primary button, or its first button. */
export function sectionPrompt(s: BriefSectionDoc): BriefButton | null {
  const all: BriefButton[] = [];
  for (const b of s.blocks) {
    if (b.type === "actions") all.push(...b.buttons);
    if (b.type === "callouts") for (const c of b.items) all.push(...c.buttons);
    if (b.type === "rows") for (const r of b.rows) all.push(...(r.buttons ?? []));
  }
  return all.find((x) => x.kind === "primary") ?? all[0] ?? null;
}

function say(prompt: string): string {
  return `<p style="margin:10px 0 0;color:${EMAIL_SLATE};font-size:13px;line-height:20px">In your AI chat, say: <strong style="color:${EMAIL_NAVY}">&ldquo;${esc(prompt.slice(0, 200))}&rdquo;</strong></p>`;
}

function section(s: BriefSectionDoc): string {
  const isTell = s.blocks.some((b) => b.type === "tell");
  const prompt = isTell ? null : sectionPrompt(s);
  const body = s.blocks.map(block).filter(Boolean).join("");
  if (!body && !prompt) return "";
  const step = s.step ? `<span style="display:inline-block;min-width:20px;height:20px;margin-right:8px;border:1px solid ${EMAIL_LINE};border-radius:10px;color:${EMAIL_NAVY};font-size:12px;line-height:20px;text-align:center;font-weight:700">${s.step}</span>` : "";
  const meta = s.meta ? `<span style="color:${EMAIL_MUTED};font-size:12px;font-weight:400"> &middot; ${esc(s.meta)}</span>` : "";
  const tellTail = isTell ? say("Good morning, Athena") : "";
  return `<tr><td style="padding:18px 0 16px;border-top:1px solid ${EMAIL_LINE}"><h2 style="margin:0 0 8px;color:${EMAIL_NAVY};font-size:16px;line-height:22px;font-weight:800">${step}${esc(s.heading)}${meta}</h2>${body}${prompt ? say(prompt.prompt) : ""}${tellTail}</td></tr>`;
}

function finishStrip(f: NonNullable<BriefDoc["finish"]>): string {
  const cell = (label: string, value: string, bad: boolean) =>
    `<td valign="top" width="33%" style="padding:10px 12px;border:1px solid ${EMAIL_LINE};border-radius:10px;background-color:${SOFT}"><span style="display:block;color:${EMAIL_MUTED};font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.6px">${esc(label)}</span><strong style="display:block;color:${bad ? BRIEF_RED : EMAIL_NAVY};font-size:16px;line-height:22px">${esc(value)}</strong></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;margin:4px -6px 6px"><tr>${cell("Contract finish", f.contract, false)}${cell("Forecast finish", f.forecast, f.late)}${cell("Variance", f.variance, f.late)}</tr></table>`;
}

function moves(m: NonNullable<BriefDoc["moves"]>): string {
  const items = m.items
    .slice(0, 5)
    .map((x, i) => `<tr><td valign="top" width="22" style="padding:4px 0;color:${EMAIL_NAVY};font-size:14px;line-height:21px;font-weight:800">${i + 1}.</td><td style="padding:4px 0;color:${EMAIL_SLATE};font-size:14px;line-height:21px"><strong style="color:${EMAIL_NAVY}">${esc(x.lead)}</strong> ${esc(x.rest)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 14px;border:1px solid ${EMAIL_LINE};border-radius:12px;background-color:${SOFT};border-collapse:separate"><tr><td style="padding:14px 16px"><p style="margin:0 0 6px;color:${EMAIL_NAVY};font-size:15px;line-height:21px;font-weight:800">${esc(m.title)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table></td></tr></table>`;
}

/** The day the email is sent, then when the schedule was last updated, then the rest of the brief's line.
 * The brief itself can read a stale schedule as of an earlier day; an inbox should still show today's date. */
export function briefEmailWhen(doc: BriefDoc): string {
  const [briefDay = "", ...rest] = doc.when.split(" · ");
  const day = doc.sentDay || briefDay;
  return [day, doc.scheduleUpdated ? `Schedule last updated ${doc.scheduleUpdated}` : "", ...rest].filter(Boolean).join(" · ");
}

/** "Good morning, Marshall. 2717 is running 4 work days late" */
export function briefEmailSubject(doc: BriefDoc): string {
  const rest = doc.when.split(" · ").slice(1).filter(Boolean);
  const day = doc.sentDay || (doc.when.split(" · ")[0] ?? "");
  const tail = rest.length ? rest.join(", ") : `Your brief for ${day}`.trim();
  const subject = `${doc.greeting} ${tail.charAt(0).toUpperCase()}${tail.slice(1)}`.replace(/\s+/g, " ").trim();
  return subject.length > 140 ? `${subject.slice(0, 137).trimEnd()}...` : subject;
}

function plain(doc: BriefDoc): string {
  const out: string[] = [doc.greeting, briefEmailWhen(doc), ""];
  if (doc.finish) out.push(`Contract finish ${doc.finish.contract}. Forecast ${doc.finish.forecast}. ${doc.finish.variance}.`, "");
  if (doc.moves) {
    out.push(doc.moves.title);
    doc.moves.items.slice(0, 5).forEach((m, i) => out.push(`${i + 1}. ${m.lead} ${m.rest}`));
    out.push("");
  }
  for (const s of doc.sections) {
    const lines: string[] = [];
    for (const b of s.blocks) {
      if (b.type === "rows") for (const r of b.rows.slice(0, MAX_ROWS)) lines.push(`- ${r.title}${r.detail ? `: ${r.detail}` : ""}`);
      if (b.type === "callouts") for (const c of b.items.slice(0, MAX_ROWS)) lines.push(`- ${c.title}: ${c.text}`);
      if (b.type === "jobs") for (const r of b.rows.slice(0, MAX_ROWS)) lines.push(`- ${r.title}: ${r.pill}`);
      if (b.type === "table") for (const r of b.rows.slice(0, MAX_ROWS)) lines.push(`- ${r.cells.filter(Boolean).join(", ")}`);
      if (b.type === "kpis") lines.push(b.items.map((k) => `${k.label} ${k.value}`).join(". "));
      if (b.type === "text" && inboxText(b.text)) lines.push(inboxText(b.text));
      if (b.type === "tell") lines.push(b.text);
    }
    if (!lines.length) continue;
    out.push(s.heading, ...lines);
    const p = s.blocks.some((b) => b.type === "tell") ? null : sectionPrompt(s);
    if (p) out.push(`In your AI chat, say: "${p.prompt}"`);
    out.push("");
  }
  out.push(`Open today's brief: ${BRIEF_EMAIL_PAGE}`, "", doc.footer, "Turn this email off from your account page in Athena.", "Athena · support@meetathena.io");
  return out.join("\n");
}

export type BriefEmail = { subject: string; html: string; text: string };

export function renderBriefEmail(doc: BriefDoc): BriefEmail {
  const parts: string[] = [];
  // The header line already says when the schedule was last updated.
  if (doc.badge && !doc.scheduleUpdated) parts.push(`<p style="margin:0 0 8px;color:${EMAIL_MUTED};font-size:12px;line-height:18px">${esc(doc.badge)}</p>`);
  if (doc.finish) parts.push(finishStrip(doc.finish));
  if (doc.moves) parts.push(moves(doc.moves));
  const secs = doc.sections.map(section).filter(Boolean).join("");
  if (secs) parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${secs}</table>`);
  const subject = briefEmailSubject(doc);
  const when = briefEmailWhen(doc);
  const html = emailShell({
    brand: "athena",
    tagline: "Morning brief",
    preview: when,
    heading: doc.greeting,
    lines: [esc(when)],
    body: parts.join("\n"),
    width: 600,
    button: { label: "Open today's brief", href: BRIEF_EMAIL_PAGE },
    foot: `${esc(doc.footer)} Turn this email off, or change its time, from your account page in Athena.`,
    legal: "Athena · support@meetathena.io",
  });
  return { subject, html, text: plain(doc) };
}

// ---------- daily dispatch ----------
export type BriefEmailCandidate = {
  userId: string;
  email: string;
  sendLocal: string;
  timeZone: string;
  lastSentOn: string | null;
};

export function briefEmailCandidate(row: Record<string, unknown>): BriefEmailCandidate | null {
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const email = typeof row.email === "string" ? row.email.trim() : "";
  if (!userId || !/^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(email)) return null;
  if (row.email_enabled !== true || row.enabled === false) return null;
  return {
    userId,
    email,
    sendLocal: typeof row.send_local === "string" ? row.send_local.slice(0, 5) : "06:30",
    timeZone: typeof row.time_zone === "string" && row.time_zone ? row.time_zone : "America/New_York",
    lastSentOn: typeof row.last_sent_on === "string" ? row.last_sent_on.slice(0, 10) : null,
  };
}

/** Due once a local day, from the member's time until three hours after it. Returns that local day. */
export function briefEmailDue(c: Pick<BriefEmailCandidate, "sendLocal" | "timeZone" | "lastSentOn">, now: Date): string | null {
  const send = parseSendTime(c.sendLocal);
  if (send == null) return null;
  let clock: { date: string; minutes: number };
  try {
    clock = zonedClock(c.timeZone, now);
  } catch {
    return null;
  }
  if (c.lastSentOn === clock.date) return null;
  if (clock.minutes < send || clock.minutes - send > BRIEF_EMAIL_WINDOW_MINUTES) return null;
  return clock.date;
}

export type BriefEmailDeps = {
  rows: Record<string, unknown>[];
  now?: Date;
  /** Builds the member's brief. Throws when it can't. */
  compose: (userId: string) => Promise<BriefDoc | null>;
  /** Claims the day. false = another run already has it. */
  claim: (userId: string, day: string) => Promise<boolean>;
  /** Gives the day back after a failed send, so the next run tries again. */
  release: (userId: string, day: string) => Promise<void>;
  sent: (userId: string, day: string, messageId: string) => Promise<void>;
  send: (email: BriefEmail & { to: string; key: string }) => Promise<{ id: string }>;
};

export async function dispatchBriefEmails(deps: BriefEmailDeps): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = deps.now ?? new Date();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const raw of deps.rows) {
    const c = briefEmailCandidate(raw);
    const day = c ? briefEmailDue(c, now) : null;
    if (!c || !day) {
      skipped += 1;
      continue;
    }
    if (!(await deps.claim(c.userId, day).catch(() => false))) {
      skipped += 1;
      continue;
    }
    try {
      const doc = await deps.compose(c.userId);
      if (!doc) {
        await deps.release(c.userId, day).catch(() => undefined);
        skipped += 1;
        continue;
      }
      const mail = renderBriefEmail(doc);
      const res = await deps.send({ ...mail, to: c.email, key: `brief-email:${c.userId}:${day}` });
      await deps.sent(c.userId, day, res.id).catch(() => undefined);
      sent += 1;
    } catch {
      await deps.release(c.userId, day).catch(() => undefined);
      failed += 1;
    }
  }
  return { sent, failed, skipped };
}
