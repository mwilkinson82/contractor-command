// 0.8.16: team invite email. Sent through Resend from the meetathena.io domain ONLY when ATHENA_INVITE_EMAIL_ENABLED
// is "true" (default OFF: the domain's DNS verification isn't confirmed). With the flag off, no email is sent and the
// owner is told to let the person know to sign in at app.meetathena.io. Tests inject a stub sender; never real addresses.
import { outboundEmailDisabled } from "./email-safety";
export const INVITE_SIGNIN_URL = "https://app.meetathena.io/login";
export const INVITE_FROM_DEFAULT = "Athena <team@meetathena.io>";

export type InviteEmail = { to: string; from: string; subject: string; text: string; html: string };
export type InviteSender = (m: InviteEmail) => Promise<{ id?: string }>;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function inviteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  // P0 kill switch wins over the invite flag.
  return env.ATHENA_INVITE_EMAIL_ENABLED === "true" && !outboundEmailDisabled(env);
}

export function buildInviteEmail(a: { to: string; inviteeName: string; ownerName: string; companyName: string; roleLabel: string }, env: Record<string, string | undefined> = process.env): InviteEmail {
  const from = env.ATHENA_INVITE_FROM || INVITE_FROM_DEFAULT;
  const subject = `${a.ownerName} added you to ${a.companyName} on Athena`;
  const text = [
    `Hi ${a.inviteeName},`,
    "",
    `${a.ownerName} added you to ${a.companyName} on Athena as ${a.roleLabel}.`,
    `Sign in with this email address at ${INVITE_SIGNIN_URL}. We'll email you a sign-in link; no password needed.`,
    "Once you're signed in, connect Athena in your AI assistant and your jobs will be there.",
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;color:#111827;max-width:520px">
<p>Hi ${esc(a.inviteeName)},</p><p>${esc(a.ownerName)} added you to <strong>${esc(a.companyName)}</strong> on Athena as ${esc(a.roleLabel)}.</p>
<p><a href="${INVITE_SIGNIN_URL}" style="background:#2563EB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Sign in to Athena</a></p>
<p style="color:#6B7280">Use this email address. We'll email you a sign-in link; no password needed.</p></div>`;
  return { to: a.to, from, subject, text, html };
}

/** Real sender (Resend REST). Only reachable when the flag is on and a key is set. */
export const resendSender: InviteSender = async (m) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
  });
  if (!r.ok) throw new Error(`invite email failed (${r.status})`);
  return (await r.json()) as { id?: string };
};

export async function sendInvite(m: InviteEmail, opts: { env?: Record<string, string | undefined>; sender?: InviteSender } = {}): Promise<"sent" | "off" | "failed"> {
  if (!inviteEnabled(opts.env)) return "off";
  try {
    await (opts.sender ?? resendSender)(m);
    return "sent";
  } catch {
    return "failed";
  }
}
