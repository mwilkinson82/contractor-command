// Customer page email. Sent through Resend only when ATHENA_PORTAL_EMAIL_ENABLED is "true" and the outbound kill
// switch is off. Codes and links go only to the address the contractor invited. Tests inject a stub sender.
import { outboundEmailDisabled } from "../mcp/email-safety";
import { postResendEmail } from "../support/resend-send";
import { esc } from "./render";
import { EMAIL_BLUE, EMAIL_LOGO, EMAIL_NAVY, emailShell } from "../email/athena-shell";

export { EMAIL_BLUE, EMAIL_LOGO, EMAIL_NAVY };

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

// Every customer email uses Athena's one email shell (src/lib/email/athena-shell.ts), which also explains how it
// survives the Gmail phone apps' dark mode.
const frame = emailShell;

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
    subject: `${a.company} invites you to your ${a.jobName} project page`,
    text: [
      `Hi ${a.name},`,
      "",
      `${a.company} invites you to your ${a.jobName} project page. ${from} set it up for you. You'll find weekly updates, photos, the schedule and anything that needs your decision.`,
      "",
      `Open it here: ${a.link}`,
      "",
      `We'll email you a 6-digit code to sign in. No password needed. This invite link works until ${a.expires}.`,
      "",
      CUSTOMER_LEGAL,
    ].join("\n"),
    html: frame({
      brand: { contractor: a.company, logo: a.logo },
      tagline: "Client page",
      preview: `${from} set up a private page for you. Sign in with a 6-digit code.`,
      heading: `${a.company} invites you to your ${a.jobName} project page`,
      lines: [
        `Hi ${esc(firstName(a.name))},`,
        `${esc(from)} set up this private page for you. You'll find weekly updates, photos, the schedule and anything that needs your decision.`,
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
        ? `${a.code} is your ${a.company} sign-in code`
        : `${a.code} is your ${a.company} confirmation code`,
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
      tagline: "Client page",
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
        ? `${a.company} posted an update on ${a.jobName}`
        : `${a.company} needs your decision: ${a.label ?? a.jobName}`,
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
      tagline: "Client page",
      preview: line,
      heading: a.kind === "update" ? "New update on your project" : "Something needs your decision",
      lines: [`Hi ${esc(firstName(a.name))},`, esc(line)],
      button: { label: "Open your project page", href: a.link },
      foot: `You get these emails because ${esc(a.company)} invited you to this project page.`,
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
      lines: [
        esc(line),
        ...(a.note ? [`Their note: ${esc(a.note)}`] : []),
        ...(a.next ? [esc(a.next)] : []),
      ],
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
