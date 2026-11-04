// Customer page email. Sent through Resend only when ATHENA_PORTAL_EMAIL_ENABLED is "true" and the outbound kill
// switch is off. Codes and links go only to the address the contractor invited. Tests inject a stub sender.
import { outboundEmailDisabled } from "../mcp/email-safety";
import { postResendEmail } from "../support/resend-send";
import { esc } from "./render";
import { ATHENA_EMAIL_MARK_URL, poweredByAthenaEmailHtml } from "../client-brand";

export const PORTAL_FROM_DEFAULT = "Athena <team@meetathena.io>";
/**
 * `fromName` is the sender's display name. Customer emails lead with the contractor ("ALP Construction via
 * Athena"); the address stays Athena's sending address. Without it the configured sender is used as is.
 */
export type PortalEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  key: string;
  fromName?: string;
};
export type PortalSender = (m: PortalEmail & { from: string }) => Promise<void>;
type Env = Record<string, string | undefined>;

const runtimeEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

export function portalEmailEnabled(env: Env = runtimeEnv()): boolean {
  return env.ATHENA_PORTAL_EMAIL_ENABLED === "true" && !outboundEmailDisabled(env);
}

/** Display name for a customer email: the contractor first, Athena as the carrier. */
export const customerFromName = (company: string) => `${company} via Athena`;

/**
 * The From header for a display name and the configured sender. Keeps the configured address and drops
 * characters that could break out of a quoted display name or add a header.
 */
export function portalFrom(configured: string, fromName?: string): string {
  if (!fromName) return configured;
  const address = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(configured)?.[1] ?? configured.trim();
  const name = fromName
    .replace(/[\r\n]/g, " ")
    .replace(/["\\<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return name ? `"${name}" <${address}>` : configured;
}

const INK = "#18314f";
const MUTED = "#65788e";
const WHITE = "#ffffff";
const PAGE = "#f3f6fa";
/**
 * Keeps a color when a mail app forces dark mode. Gmail's phone app repaints plain backgrounds; it leaves a
 * gradient image alone. Same light-only approach as the support emails (color-scheme light, bgcolor tables).
 */
const keep = (c: string) => `background-color:${c};background-image:linear-gradient(${c},${c})`;

function frame(
  company: string,
  lines: string[],
  button?: { label: string; href: string },
  foot?: string,
  powered = true,
): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light;supported-color-schemes:light}</style></head>
<body style="margin:0;padding:0;${keep(PAGE)}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE}" style="${keep(PAGE)}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="${WHITE}" style="width:100%;max-width:560px;${keep(WHITE)};border:1px solid #dfe7f0;border-radius:12px"><tr><td style="padding:26px 28px;font-family:Arial,Helvetica,sans-serif;color:${INK};line-height:1.55;font-size:15px">
<p style="font-size:17px;font-weight:700;color:#111827;margin:0 0 16px">${esc(company)}</p>
${lines.map((l) => `<p style="margin:0 0 12px;color:${INK}">${l}</p>`).join("\n")}
${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td bgcolor="${INK}" style="${keep(INK)};border-radius:8px"><a href="${esc(button.href)}" style="display:inline-block;padding:11px 18px;color:${WHITE};text-decoration:none;font-weight:600">${esc(button.label)}</a></td></tr></table>` : ""}
${foot ? `<p style="color:${MUTED};font-size:12px;margin:18px 0 0">${foot}</p>` : ""}
${powered ? poweredByAthenaEmailHtml(ATHENA_EMAIL_MARK_URL) : ""}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

export function inviteEmail(a: {
  to: string;
  name: string;
  company: string;
  jobName: string;
  pmName: string | null;
  link: string;
  expires: string;
  nonce: string;
}): PortalEmail {
  const from = a.pmName ? `${a.pmName} at ${a.company}` : a.company;
  return {
    to: a.to,
    key: `portal-invite:${a.nonce}`,
    fromName: customerFromName(a.company),
    subject: `Your project page for ${a.jobName}`,
    text: [
      `Hi ${a.name},`,
      "",
      `${from} set up a private page for ${a.jobName}. You'll find weekly updates, photos, the schedule and anything that needs your decision.`,
      "",
      `Open it here: ${a.link}`,
      "",
      `We'll email you a 6-digit code to sign in. No password needed. This invite link works until ${a.expires}.`,
    ].join("\n"),
    html: frame(
      a.company,
      [
        `Hi ${esc(a.name)},`,
        `${esc(from)} set up a private page for <b>${esc(a.jobName)}</b>. You'll find weekly updates, photos, the schedule and anything that needs your decision.`,
      ],
      { label: "Open your project page", href: a.link },
      `We'll email you a 6-digit code to sign in. No password needed. This invite link works until ${esc(a.expires)}. If you weren't expecting this, you can ignore it.`,
    ),
  };
}

export function codeEmail(a: {
  to: string;
  name: string;
  company: string;
  jobName: string;
  code: string;
  purpose: "sign_in" | "decide";
  what?: string;
  nonce: string;
}): PortalEmail {
  const why =
    a.purpose === "sign_in"
      ? `sign in to your ${a.jobName} project page`
      : `confirm your decision on ${a.what ?? "your project"}`;
  return {
    to: a.to,
    key: `portal-code:${a.nonce}`,
    fromName: customerFromName(a.company),
    subject:
      a.purpose === "sign_in"
        ? `${a.code} is your sign-in code`
        : `${a.code} is your confirmation code`,
    text: [
      `Hi ${a.name},`,
      "",
      `Use ${a.code} to ${why}. It works for 10 minutes.`,
      "",
      "If you didn't ask for this, ignore this email. No one can use the code without your link.",
    ].join("\n"),
    html: frame(
      a.company,
      [
        `Hi ${esc(a.name)},`,
        `Use this code to ${esc(why)}:`,
        `<span style="font-size:28px;font-weight:700;letter-spacing:.3em;font-family:Menlo,monospace">${esc(a.code)}</span>`,
        "It works for 10 minutes.",
      ],
      undefined,
      "If you didn't ask for this, ignore this email.",
    ),
  };
}

export function noticeEmail(a: {
  to: string;
  name: string;
  company: string;
  jobName: string;
  link: string;
  kind: "update" | "decision";
  label?: string;
  nonce: string;
}): PortalEmail {
  const line =
    a.kind === "update"
      ? `${a.company} posted a new update on ${a.jobName}.`
      : `${a.company} shared ${a.label ?? "something"} on ${a.jobName}. It needs your decision.`;
  return {
    to: a.to,
    key: `portal-notice:${a.nonce}`,
    fromName: customerFromName(a.company),
    subject:
      a.kind === "update"
        ? `New update on ${a.jobName}`
        : `Needs your decision: ${a.label ?? a.jobName}`,
    text: [`Hi ${a.name},`, "", line, "", `Open your project page: ${a.link}`].join("\n"),
    html: frame(a.company, [`Hi ${esc(a.name)},`, esc(line)], {
      label: "Open your project page",
      href: a.link,
    }),
  };
}

/** Tells the job's PM what the customer decided. Holds no price; the record is in Athena. */
export function decisionEmail(a: {
  to: string;
  customer: string;
  jobName: string;
  jobNumber: string;
  label: string;
  decision: string;
  choice: string | null;
  note: string | null;
  reference: string;
}): PortalEmail {
  const what =
    a.decision === "approved"
      ? "approved"
      : a.decision === "declined"
        ? "declined"
        : `chose ${a.choice ?? "a package"} on`;
  const line = `${a.customer} ${what} ${a.label} on the customer page for ${a.jobNumber} ${a.jobName}.`;
  return {
    to: a.to,
    key: `portal-decision:${a.reference}`,
    subject: `Customer ${a.decision === "chosen" ? "choice" : a.decision}: ${a.label}`,
    text: [
      line,
      ...(a.note ? ["", `Their note: ${a.note}`] : []),
      "",
      `Reference: ${a.reference}. Ask Athena for the customer page list on this job to see the record.`,
    ].join("\n"),
    html: frame(
      "Athena",
      [
        esc(line),
        ...(a.note ? [`Their note: ${esc(a.note)}`] : []),
        `Reference: ${esc(a.reference)}. Ask Athena for the customer page list on this job to see the record.`,
      ],
      undefined,
      undefined,
      false,
    ),
  };
}

export const resendPortalSender: PortalSender = async (m) => {
  const key = runtimeEnv().RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  await postResendEmail(
    key,
    fetch,
    { from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html },
    m.key.slice(0, 256),
  );
};

export async function sendPortalEmail(
  m: PortalEmail,
  opts: { env?: Env; sender?: PortalSender } = {},
): Promise<"sent" | "off" | "failed"> {
  const env = opts.env ?? runtimeEnv();
  if (!portalEmailEnabled(env)) return "off";
  try {
    const { fromName, ...email } = m;
    await (opts.sender ?? resendPortalSender)({
      ...email,
      from: portalFrom(env.ATHENA_PORTAL_FROM || PORTAL_FROM_DEFAULT, fromName),
    });
    return "sent";
  } catch {
    return "failed";
  }
}
