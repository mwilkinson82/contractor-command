// Customer page email. Sent through Resend only when ATHENA_PORTAL_EMAIL_ENABLED is "true" and the outbound kill
// switch is off. Codes and links go only to the address the contractor invited. Tests inject a stub sender.
import { outboundEmailDisabled } from "../mcp/email-safety";
import { postResendEmail } from "../support/resend-send";
import { esc } from "./render";

export const PORTAL_FROM_DEFAULT = "Athena <team@meetathena.io>";
export type PortalEmail = { to: string; subject: string; text: string; html: string; key: string };
export type PortalSender = (m: PortalEmail & { from: string }) => Promise<void>;
type Env = Record<string, string | undefined>;

const runtimeEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

export function portalEmailEnabled(env: Env = runtimeEnv()): boolean {
  return env.ATHENA_PORTAL_EMAIL_ENABLED === "true" && !outboundEmailDisabled(env);
}

// Same look as Athena's own sign-in emails (src/lib/email-templates/athena-auth-email.tsx): white card, the Athena
// mark, a blue tagline, navy heading, slate text, blue button, boxed code. Customer emails put the contractor's name
// in the tagline and close with "Powered by Athena"; the copy to the PM is Athena's own.
export const EMAIL_LOGO = "https://app.meetathena.io/brand/athena/email/athena-mark-180.png";
export const EMAIL_BLUE = "#1E5FED";
export const EMAIL_NAVY = "#0F1E3D";
const SLATE = "#3B4A66";
const MUTED = "#6B7488";
const LINE = "#E3E8F2";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

type Frame = {
  /** Blue line under the mark: the contractor's name on customer emails. */
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

function frame(f: Frame): string {
  const p = (html: string) =>
    `<p style="margin:0 0 12px;color:${SLATE};font-size:15px;line-height:24px">${html}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(f.heading)}</title></head><body style="margin:0;padding:32px 12px;background:#FFFFFF;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(f.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;border:1px solid ${LINE};border-radius:14px;background:#FFFFFF;border-collapse:separate">
<tr><td style="padding:32px 36px 0">
<img src="${EMAIL_LOGO}" width="56" height="56" alt="Athena" style="display:block;width:56px;height:56px;border:0">
<p style="margin:14px 0 0;color:${EMAIL_BLUE};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${esc(f.tagline)}</p>
</td></tr>
<tr><td style="padding:8px 36px 32px">
<h1 style="margin:18px 0 12px;color:${EMAIL_NAVY};font-size:26px;line-height:32px;font-weight:800">${esc(f.heading)}</h1>
${f.lines.map(p).join("\n")}
${f.button ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px"><tr><td style="border-radius:10px;background:${EMAIL_BLUE}"><a href="${esc(f.button.href)}" style="display:inline-block;padding:14px 26px;border-radius:10px;background:${EMAIL_BLUE};color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none">${esc(f.button.label)}</a></td></tr></table>` : ""}
${f.code ? `<p style="margin:8px 0 4px;padding:14px 18px;border:1px solid ${LINE};border-radius:10px;background:#F2F6FF;color:${EMAIL_NAVY};font-family:Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center">${esc(f.code)}</p>` : ""}
${f.after ? `<p style="margin:16px 0 0;color:${SLATE};font-size:13px;line-height:21px">${f.after}</p>` : ""}
<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:19px">${f.foot}</p>
</td></tr></table>
<p style="margin:18px 0 0;color:${MUTED};font-size:11px;text-align:center">${esc(f.legal)}</p>
</td></tr></table></body></html>`;
}

const CUSTOMER_LEGAL = "Powered by Athena · app.meetathena.io";
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

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
      tagline: a.company,
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
  nonce: string;
}): PortalEmail {
  const why =
    a.purpose === "sign_in"
      ? `sign in to your ${a.jobName} project page`
      : `confirm your decision on ${a.what ?? "your project"}`;
  return {
    to: a.to,
    key: `portal-code:${a.nonce}`,
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
      tagline: a.company,
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
  nonce: string;
}): PortalEmail {
  const line =
    a.kind === "update"
      ? `${a.company} posted a new update on ${a.jobName}.`
      : `${a.company} shared ${a.label ?? "something"} on ${a.jobName}. It needs your decision.`;
  return {
    to: a.to,
    key: `portal-notice:${a.nonce}`,
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
      tagline: a.company,
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
    await (opts.sender ?? resendPortalSender)({
      ...m,
      from: env.ATHENA_PORTAL_FROM || PORTAL_FROM_DEFAULT,
    });
    return "sent";
  } catch {
    return "failed";
  }
}
