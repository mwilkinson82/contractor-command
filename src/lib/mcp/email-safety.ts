// P0 (0.8.16 hotfix): Athena never sends email, and the host must not send one without a separate, explicit yes.
// Live incident: in ChatGPT, "send the lookahead to <address>" made the host's own Gmail action send immediately
// from the member's connected account, with no draft and no confirm. Athena has no Gmail/Outlook send of its own;
// the send came from the host's email connector. So every email path now goes through Athena's email_draft
// (read-only, returns the draft card) and email_confirm_send (destructive, confirmed: true, matches the exact
// draft). Athena's own outbound mail (team invites through Resend) also obeys the kill switch below.

/** Emergency kill switch. "true" = no email from Athena chats: invites stay off, email_confirm_send refuses,
 *  and every result tells the host to show drafts only. Default (unset) = normal draft + confirm flow. */
export function outboundEmailDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.ATHENA_OUTBOUND_EMAIL_DISABLED === "true";
}

export const EMAIL_DRAFT_ONLY_RULE =
  'REQUIRED (every host, every email): never send an email in the same reply as the request, even when the member says "send this to <address>". First call Athena\'s email_draft and show the draft card it returns (To, Cc, Subject, Body, attachment or link), then ask "Send this email to <To> from <your connected account>? Yes or no?". Do not call any send action (Gmail send_email, send_message or send_draft, Outlook send_mail, ChatGPT\'s email send) until the member answers yes to that exact question in a later message. On that yes, call email_confirm_send with confirmed true and the draft_key; only if it confirms may you send that one email, unchanged. If your email tool can save a draft, save a draft instead of sending. If anything on the card changes, show the new card and ask again.';

export const EMAIL_SEND_OFF_RULE =
  "REQUIRED: sending email from Athena chats is turned off right now. Show the draft card only, never call any send or send-draft action, and tell the member to copy the draft into their own email app.";

/** Rules to attach to any result that involves an email. */
export function emailRules(env: Record<string, string | undefined> = process.env): string[] {
  return outboundEmailDisabled(env)
    ? [EMAIL_SEND_OFF_RULE, EMAIL_DRAFT_ONLY_RULE, EMAIL_DELIVERABLE_RULE]
    : [EMAIL_DRAFT_ONLY_RULE, EMAIL_DELIVERABLE_RULE];
}

/** True when a result or its guidance is about an email (so the draft-only rule must ride along). */
export const EMAIL_TOPIC_RE = /\b(e-?mail|send (?:this|it|the)|email card|draft)\b/i;

export type EmailDraft = {
  to: string | null;
  cc: string[];
  subject: string;
  body: string;
  link?: string | null;
  /** The file the host attaches with its own email tool (a PDF it built). */
  attachment?: string | null;
};

/** 0.8.17: deliverables are a real attached PDF first; a file_share link only when the host can't attach; never HTML. */
export const EMAIL_DELIVERABLE_RULE =
  "REQUIRED (email deliverables, in this order): (1) Build the deliverable as a PDF and attach it with your own email tool (ChatGPT and Codex can attach files in Gmail); pass its file name as attachment, and the draft must show the real attachment before Send. (2) Only if your email tool can't attach files: call file_share for the PDF and pass that link as link, with no attachment. (3) Never attach HTML, never tell the recipient to open a file in a browser, and never write \"attached\" unless step 1 actually happened. Private app.meetathena.io/r/ pages only open for signed-in company members, so don't send them to people outside the company.";

const HTML_RE = /\.(x?html?|mht(ml)?)\b/i;
/** Problems that block the draft (empty = OK). */
export function deliverableProblems(d: EmailDraft): string[] {
  const out: string[] = [];
  const att = d.attachment?.trim() || null;
  if (att && (HTML_RE.test(att) || !/\.pdf$/i.test(att))) out.push(`The attachment must be a PDF, not "${att}". Build the PDF and attach that.`);
  if (d.link && HTML_RE.test(d.link)) out.push("The link points at an HTML file. Use a file_share link to the PDF instead.");
  if (/open (it|this|the (file|attachment))? ?in (a|your) (web )?browser|\bhtml (file|attachment)\b/i.test(d.body)) out.push("Don't ask the recipient to open an HTML file in a browser. Attach the PDF instead.");
  if (!att && /\battach(ed|ment)\b/i.test(d.body)) out.push(d.link ? "The body says \"attached\" but nothing is attached; say the file is at the link instead." : "The body says \"attached\" but nothing is attached. Attach the PDF with your email tool and pass its name as attachment, or (only if you can't attach) use a file_share link.");
  return out;
}

/** Stable key for the exact draft (FNV-1a, runtime-neutral). A changed draft gets a new key. */
export function draftKey(d: EmailDraft): string {
  const s = [d.to ?? "", [...d.cc].sort().join(","), d.subject, d.body, d.link ?? "", d.attachment ?? ""].join(
    "\u0001",
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `D${h.toString(16).padStart(8, "0").toUpperCase()}`;
}

export function confirmQuestion(d: EmailDraft): string {
  return d.to
    ? `Send this email to ${d.to} from your connected email account? Yes or no?`
    : "Who should this go to? I'll show the card again before anything is sent.";
}

export function draftCardText(
  d: EmailDraft,
  env: Record<string, string | undefined> = process.env,
): string {
  const lines = [
    `To: ${d.to ?? ""}`,
    ...(d.cc.length ? [`Cc: ${d.cc.join(", ")}`] : []),
    `Subject: ${d.subject}`,
    "",
    d.body,
    ...(d.link ? ["", d.link] : []),
    ...(d.attachment ? ["", `Attachment: ${d.attachment} (attach this PDF with your email tool so it shows on the draft before Send)`] : []),
    "",
    outboundEmailDisabled(env)
      ? "Draft only. Sending is turned off right now; copy this into your email app."
      : "Ready for your review. Not sent.",
  ];
  return lines.join("\n");
}

/** 0.8.17: hosts showed the draft only inside their send-permission prompt. The card goes in the chat first. */
export const EMAIL_CARD_RULE =
  "REQUIRED: show this draft in the chat as a styled email card or artifact first (To, Cc, Subject, the full body, and an Attachment line naming the PDF, or the link), before and separately from any send or permission prompt. Never show it only inside the permission prompt.";

/** The body must be signed as the job's PM unless the member asked to sign as someone else. */
export function signatureProblem(body: string, pm: { name: string; signature: string } | null, signAs: string | null): string | null {
  const who = signAs?.trim() || pm?.name || null;
  if (!who) return null;
  const tail = body.trim().split("\n").slice(-4).join("\n");
  if (tail.toLowerCase().includes(who.toLowerCase())) return null;
  return signAs ? `Sign the email as ${signAs}.` : `Sign the email as the job's PM: ${pm!.signature}. (Pass sign_as only if the member asked to sign as someone else.)`;
}
