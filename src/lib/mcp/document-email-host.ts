import { reviewEmail, type ReviewedEmail } from "./document-email-delivery";
import type { DocumentEmailArtifact } from "./document-email-artifact";

/** Observations supplied by the host after reading the selected account profile.
 * They are not server-verified OAuth claims, and cannot grant account access. */
type MailboxObservation = {
  provider: string;
  profileAddress: string;
  observedAt: number;
  canSendMime: boolean;
};
export type HostMailbox = MailboxObservation & (
  | { mode?: "pinned"; connectionId: string }
  | { mode: "assistant_current_gmail"; provider: "gmail"; connectionId?: never }
);
export type HostReadiness =
  | { status: "connect_email"; message: string }
  | { status: "unsupported_attachment"; message: string }
  | { status: "ready"; mailbox: HostMailbox };

export function mailboxReadiness(mailbox: HostMailbox | null, now = Date.now()): HostReadiness {
  const observed = mailbox?.mode === "assistant_current_gmail";
  const modeValid = !!mailbox && (observed
    ? mailbox.provider === "gmail" && mailbox.connectionId === undefined
    : (mailbox.mode === undefined || mailbox.mode === "pinned") && typeof mailbox.connectionId === "string" && !!mailbox.connectionId.trim());
  if (!mailbox || !mailbox.provider.trim() || !modeValid ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox.profileAddress) ||
      !Number.isFinite(mailbox.observedAt) || mailbox.observedAt > now || now - mailbox.observedAt > (observed ? 30_000 : 300_000))
    return { status: "connect_email", message: "Connect an email account or refresh its sender identity." };
  if (!mailbox.canSendMime)
    return { status: "unsupported_attachment", message: "This connected email tool has not confirmed PDF attachment support." };
  return { status: "ready", mailbox };
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}

/** Pinned mode preserves its legacy digest. Observed mode binds the sender without claiming account pinning. */
export async function hostReviewHash(email: ReviewedEmail, artifact: DocumentEmailArtifact, mailbox: HostMailbox, now = Date.now()) {
  const ready = mailboxReadiness(mailbox, now);
  if (ready.status !== "ready") throw new Error(ready.message);
  if (mailbox.profileAddress.toLowerCase() !== email.from.toLowerCase())
    throw new Error("The connected sender changed. Review the email again.");
  const reviewed=await reviewEmail(email, artifact);
  return digest(JSON.stringify(mailbox.mode === "assistant_current_gmail"
    ? [reviewed, mailbox.provider, null, mailbox.profileAddress.toLowerCase(), "assistant_current_gmail"]
    : [reviewed, mailbox.provider, mailbox.connectionId, mailbox.profileAddress.toLowerCase()]));
}

export type GmailMimeRequest = {
  from_address: string; to: string; cc?: string; subject: string;
  payload: { mime_type: "multipart/mixed"; parts: [
    { mime_type: "text/plain"; charset: "UTF-8"; body: { content: string } },
    { mime_type: "application/pdf"; filename: string; content_disposition: "attachment"; body: { base64_url_content: string } },
  ] };
};

/** Construct arguments only. The host owns provider permission, explicit send and receipt.
 * A profile supplied here is a host observation; it is not a server-authenticated receipt. */
export async function gmailMimeRequest(input: {
  email: ReviewedEmail; artifact: DocumentEmailArtifact; mailbox: HostMailbox;
  confirmedHash: string; confirmed: boolean; now?: number;
}): Promise<GmailMimeRequest> {
  if (!input.confirmed) throw new Error("Confirm the reviewed email before sending.");
  if (input.mailbox.provider !== "gmail") throw new Error("This adapter requires a connected Gmail account.");
  if (await hostReviewHash(input.email, input.artifact, input.mailbox, input.now) !== input.confirmedHash)
    throw new Error("The email, sender or attachment changed. Review it again.");
  const base64url = input.artifact.content_base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return {
    from_address: input.email.from, to: input.email.to,
    ...(input.email.cc.length ? { cc: input.email.cc.join(", ") } : {}),
    subject: input.email.subject,
    payload: { mime_type: "multipart/mixed", parts: [
      { mime_type: "text/plain", charset: "UTF-8", body: { content: input.email.body } },
      { mime_type: "application/pdf", filename: input.artifact.filename, content_disposition: "attachment", body: { base64_url_content: base64url } },
    ] },
  };
}
