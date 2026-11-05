// The email a supplier or sub gets asking them to confirm a look-ahead date. It goes out through sendPortalEmail,
// so it is off unless ATHENA_PORTAL_EMAIL_ENABLED is true. The contractor leads up top; Athena is the small A and
// "Powered by Athena" under the card. No cost, no other trades, no team addresses.
import { emailShell, esc } from "../email/athena-shell";
import { customerFromName, type PortalEmail } from "../customer-portal/email";
import { ASK_NOUN, dateSpan, fullDate, type AskKind, type PartyKind } from "./model";

export const CONFIRM_BUTTON = "Confirm the date";
const LEGAL = "Powered by Athena";

export type ConfirmRequestEmail = {
  to: string;
  partyName: string;
  partyKind: PartyKind;
  askKind: AskKind;
  company: string;
  /** The contractor's saved logo, an https URL; their name shows when there is none. */
  logo?: string | null;
  jobNumber: string;
  jobName: string;
  what: string;
  date: string;
  windowEnd?: string | null;
  /** Who on the team asked, as their name shows in Athena. */
  sender?: string | null;
  link: string;
  /** "Nov 19, 2026" */
  expires: string;
  /** The request id, so a retried send is one email. */
  requestId: string;
};

export function confirmRequestEmail(a: ConfirmRequestEmail): PortalEmail {
  const noun = ASK_NOUN[a.askKind];
  const when =
    a.windowEnd && a.windowEnd !== a.date
      ? `between ${fullDate(a.date)} and ${fullDate(a.windowEnd)}`
      : fullDate(a.date);
  const who = a.sender ? `${a.sender} at ${a.company}` : a.company;
  const job = `${a.jobName} (job ${a.jobNumber})`;
  const intro = `${who} has you on the two-week look-ahead for ${job}: ${a.what}, ${when}.`;
  const ask = `Please confirm the ${noun} date, or tell us another date that works. It takes a few seconds and needs no account.`;
  const subject = `${a.company}: confirm ${noun} ${dateSpan(a.date, a.windowEnd)} for ${a.jobName}`;
  return {
    to: a.to,
    key: `lookahead-confirm:${a.requestId}`,
    fromName: customerFromName(a.company),
    subject: subject.slice(0, 180),
    text: [
      `Hi ${a.partyName},`,
      "",
      intro,
      "",
      ask,
      "",
      `${CONFIRM_BUTTON}: ${a.link}`,
      "",
      `This link works until ${a.expires}. Questions about the date? Contact ${a.company} directly.`,
      "",
      LEGAL,
    ].join("\n"),
    html: emailShell({
      brand: { contractor: a.company, logo: a.logo },
      tagline: a.partyKind === "supplier" ? "Delivery date" : "Schedule date",
      preview: `${a.what}, ${when}. Please confirm the date.`,
      heading: `Confirm your ${noun} date`,
      lines: [`Hi ${esc(a.partyName)},`, esc(intro), esc(ask)],
      button: { label: CONFIRM_BUTTON, href: a.link },
      after: `This link works until ${esc(a.expires)}.`,
      foot: `Questions about the date? Contact ${esc(a.company)} directly. If you weren't expecting this, you can ignore it.`,
      legal: LEGAL,
    }),
  };
}
