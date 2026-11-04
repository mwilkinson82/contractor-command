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

function frame(
  company: string,
  lines: string[],
  button?: { label: string; href: string },
  foot?: string,
): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#18314f;max-width:520px;line-height:1.55">
<p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#65788e;margin:0 0 14px">${esc(company)}</p>
${lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join("\n")}
${button ? `<p style="margin:18px 0"><a href="${esc(button.href)}" style="background:#18314f;color:#ffffff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${esc(button.label)}</a></p>` : ""}
${foot ? `<p style="color:#65788e;font-size:12px;margin:18px 0 0">${foot}</p>` : ""}</div>`;
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
  /** What the choice means for the job: a drafted change order under contract, a proposal approval before. */
  next?: string | null;
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
      ...(a.next ? ["", a.next] : []),
      "",
      `Reference: ${a.reference}. Ask Athena for the customer page list on this job to see the record.`,
    ].join("\n"),
    html: frame("Athena", [
      esc(line),
      ...(a.note ? [`Their note: ${esc(a.note)}`] : []),
      ...(a.next ? [esc(a.next)] : []),
      `Reference: ${esc(a.reference)}. Ask Athena for the customer page list on this job to see the record.`,
    ]),
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
