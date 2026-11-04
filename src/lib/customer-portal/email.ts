// Customer page email. Sent through Resend only when ATHENA_PORTAL_EMAIL_ENABLED is "true" and the outbound kill
// switch is off. Codes and links go only to the address the contractor invited. Tests inject a stub sender.
import { outboundEmailDisabled } from "../mcp/email-safety";
import { postResendEmail } from "../support/resend-send";
import { esc } from "./render";

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
export type PortalSender = (m: PortalEmail & { from: string }) => Promise<void>;
type Env = Record<string, string | undefined>;

const runtimeEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

export function portalEmailEnabled(env: Env = runtimeEnv()): boolean {
  return env.ATHENA_PORTAL_EMAIL_ENABLED === "true" && !outboundEmailDisabled(env);
}

// Same look as Athena's own sign-in emails (src/lib/email-templates/athena-auth-email.tsx): white card, blue tagline,
// navy heading, slate text, blue button, boxed code. Customer emails are client-facing, so the contractor leads up top
// (their saved logo, or their name in type) and Athena is the small A and "Powered by Athena" under the card. The
// copy to the PM is Athena's own and keeps the Athena mark.
export const EMAIL_LOGO = "https://app.meetathena.io/brand/athena/email/athena-mark-180.png";
export const EMAIL_BLUE = "#1E5FED";
export const EMAIL_NAVY = "#0F1E3D";
const SLATE = "#3B4A66";
const MUTED = "#6B7488";
const LINE = "#E3E8F2";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Gmail's phone apps repaint emails dark: Android darkens flat light backgrounds and turns white text dark, iOS
// inverts everything. Gmail leaves background images alone, so every fill also carries a one-colour gradient; Gmail
// wraps the message so `u + .body` matches only there, where blend modes put the button's white label back.
const WHITE = "linear-gradient(#FFFFFF,#FFFFFF)";
const BLUE = `linear-gradient(${EMAIL_BLUE},${EMAIL_BLUE})`;
const GMAIL_KEEP_LIGHT =
  ":root{color-scheme:light;supported-color-schemes:light}u + .body .gm-screen{background:#000;mix-blend-mode:screen;display:inline-block}u + .body .gm-diff{background:#000;mix-blend-mode:difference;display:inline-block}";
const BRAND_FONT =
  "Inter,'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";

type Frame = {
  /** Who leads up top: the contractor on customer emails, Athena on the copy to the PM. */
  brand: { contractor: string; logo?: string | null } | "athena";
  /** Blue line under the brand. */
  tagline: string;
  /** Inbox preview line. */
  preview: string;
  heading: string;
  /** Paragraphs, already escaped. */
  lines: string[];
  button?: { label: string; href: string };
  code?: string;
  /** Small print above the rule, already escaped. */
  after?: string;
  /** Muted lines under the rule, already escaped. */
  foot: string;
  legal: string;
};

/** Only an https image may stand in for the contractor's name. */
const safeLogo = (url: string | null | undefined): string | null =>
  url && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;

function top(brand: Frame["brand"]): string {
  if (brand === "athena")
    return `<img src="${EMAIL_LOGO}" width="56" height="56" alt="Athena" style="display:block;width:56px;height:56px;border:0">`;
  const logo = safeLogo(brand.logo);
  return logo
    ? `<img src="${esc(logo)}" height="48" alt="${esc(brand.contractor)}" style="display:block;height:48px;max-width:240px;width:auto;border:0">`
    : `<p style="margin:0;color:#111827;font-family:${BRAND_FONT};font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.2px">${esc(brand.contractor)}</p>`;
}

function frame(f: Frame): string {
  const p = (html: string) =>
    `<p style="margin:0 0 12px;color:${SLATE};font-size:15px;line-height:24px">${html}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(f.heading)}</title><style>${GMAIL_KEEP_LIGHT}</style></head><body class="body" style="margin:0;padding:32px 12px;background:#FFFFFF;background-image:${WHITE};font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(f.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;background-image:${WHITE}"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:520px;border:1px solid ${LINE};border-radius:14px;background:#FFFFFF;background-image:${WHITE};border-collapse:separate">
<tr><td style="padding:32px 36px 0">
${top(f.brand)}
<p style="margin:14px 0 0;color:${EMAIL_BLUE};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${esc(f.tagline)}</p>
</td></tr>
<tr><td style="padding:8px 36px 32px">
<h1 style="margin:18px 0 12px;color:${EMAIL_NAVY};font-size:26px;line-height:32px;font-weight:800">${esc(f.heading)}</h1>
${f.lines.map(p).join("\n")}
${f.button ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px"><tr><td bgcolor="${EMAIL_BLUE}" style="border-radius:10px;background:${EMAIL_BLUE};background-image:${BLUE}"><a href="${esc(f.button.href)}" style="display:inline-block;padding:14px 26px;border-radius:10px;background:${EMAIL_BLUE};background-image:${BLUE};color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none"><span class="gm-screen"><span class="gm-diff">${esc(f.button.label)}</span></span></a></td></tr></table>` : ""}
${f.code ? `<p style="margin:8px 0 4px;padding:14px 18px;border:1px solid ${LINE};border-radius:10px;background:#F2F6FF;background-image:linear-gradient(#F2F6FF,#F2F6FF);color:${EMAIL_NAVY};font-family:Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center">${esc(f.code)}</p>` : ""}
${f.after ? `<p style="margin:16px 0 0;color:${SLATE};font-size:13px;line-height:21px">${f.after}</p>` : ""}
<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:19px">${f.foot}</p>
</td></tr></table>
<p style="margin:18px 0 0;color:${MUTED};font-size:11px;line-height:16px;text-align:center">${f.brand === "athena" ? "" : `<img src="${EMAIL_LOGO}" width="16" height="16" alt="" style="display:inline-block;width:16px;height:16px;border:0;vertical-align:-4px;margin-right:5px">`}${esc(f.legal)}</p>
</td></tr></table></body></html>`;
}

const CUSTOMER_LEGAL = "Powered by Athena";
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

export function inviteEmail(a: {
  to: string;
  name: string;
  company: string;
  jobName: string;
  pmName: string | null;
  link: string;
  expires: string;
  /** The contractor's saved logo, an https URL; their name shows when there is none. */
  logo?: string | null;
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
      "",
      CUSTOMER_LEGAL,
    ].join("\n"),
    html: frame({
      brand: { contractor: a.company, logo: a.logo },
      tagline: "Customer page",
      preview: `${from} set up a private page for ${a.jobName}.`,
      heading: "Your project page is ready",
      lines: [
        `Hi ${esc(firstName(a.name))},`,
        `${esc(from)} set up a private page for <strong style="color:${EMAIL_NAVY}">${esc(a.jobName)}</strong>. You'll find weekly updates, photos, the schedule and anything that needs your decision.`,
      ],
      button: { label: "Open your project page", href: a.link },
      after: `We'll email you a 6-digit code to sign in. No password needed. This invite link works until ${esc(a.expires)}.`,
      foot: "If you weren't expecting this, you can safely ignore this email. Nobody can open the page without this link and a code sent to this address.",
      legal: CUSTOMER_LEGAL,
    }),
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
  /** The contractor's saved logo, an https URL; their name shows when there is none. */
  logo?: string | null;
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
      "",
      CUSTOMER_LEGAL,
    ].join("\n"),
    html: frame({
      brand: { contractor: a.company, logo: a.logo },
      tagline: "Customer page",
      preview: `Use ${a.code} to ${why}.`,
      heading: a.purpose === "sign_in" ? "Your sign-in code" : "Your confirmation code",
      lines: [
        `Hi ${esc(firstName(a.name))},`,
        `Type this code on the ${esc(a.jobName)} page you already have open to ${a.purpose === "sign_in" ? "sign in" : `confirm your decision on ${esc(a.what ?? "your project")}`}. It works for 10 minutes.`,
      ],
      code: a.code,
      foot: "If you didn't ask for this, you can safely ignore this email. Nobody can use the code without your link.",
      legal: CUSTOMER_LEGAL,
    }),
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
  /** The contractor's saved logo, an https URL; their name shows when there is none. */
  logo?: string | null;
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
    text: [
      `Hi ${a.name},`,
      "",
      line,
      "",
      `Open your project page: ${a.link}`,
      "",
      CUSTOMER_LEGAL,
    ].join("\n"),
    html: frame({
      brand: { contractor: a.company, logo: a.logo },
      tagline: "Customer page",
      preview: line,
      heading: a.kind === "update" ? "New update on your project" : "Something needs your decision",
      lines: [`Hi ${esc(firstName(a.name))},`, esc(line)],
      button: { label: "Open your project page", href: a.link },
      foot: "You get these emails because your contractor invited you to this project page.",
      legal: CUSTOMER_LEGAL,
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
    html: frame({
      brand: "athena",
      tagline: "Athena powered by ALP",
      preview: line,
      heading:
        a.decision === "approved"
          ? "Customer approved"
          : a.decision === "declined"
            ? "Customer declined"
            : "Customer made a choice",
      lines: [esc(line), ...(a.note ? [`Their note: ${esc(a.note)}`] : [])],
      foot: `Reference: ${esc(a.reference)}. Ask Athena for the customer page list on this job to see the record.`,
      legal: "Athena powered by ALP · app.meetathena.io",
    }),
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
