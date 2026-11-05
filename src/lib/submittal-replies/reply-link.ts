// Submittal replies: one reply code per package link. The code is derived from the package link's own token, so
// drafting the same package email twice gives the same code (the saved draft stays the same draft), and only the
// code's SHA-256 is kept in the database (supabase/migrations/20261105161000_athena_submittal_replies.sql).
// The code is 32 lower-case hex characters, so it survives mail systems that fold an address to lower case.
import { tokenFromLink, tokenHash } from "../mcp/file-share";

export const REPLY_ORIGIN = "https://app.meetathena.io";
/** Athena's own receiving domain. The inbound webhook also accepts the Circle domain it already receives for. */
export const REPLY_DOMAIN = "meetathena.io";
const INBOUND_DOMAINS = ["meetathena.io", "alpcontractorcircle.com"];
export const REPLY_CODE_RE = /^[0-9a-f]{32}$/;

/** Reviewer actions on the return page, in the words of the submittal log. */
export const REPLY_ACTIONS = [
  "approved",
  "approved_as_noted",
  "revise_and_resubmit",
  "rejected",
  "for_record",
] as const;
export type ReplyAction = (typeof REPLY_ACTIONS)[number];
export const REPLY_ACTION_LABEL: Record<ReplyAction, string> = {
  approved: "Approved",
  approved_as_noted: "Approved as noted",
  revise_and_resubmit: "Revise and resubmit",
  rejected: "Rejected",
  for_record: "For record only",
};
/** The submittal log status each action sets. For record only closes the submittal. */
export const REPLY_ACTION_STATUS: Record<ReplyAction, string> = {
  approved: "approved",
  approved_as_noted: "approved_as_noted",
  revise_and_resubmit: "revise_and_resubmit",
  rejected: "rejected",
  for_record: "closed",
};
export const isReplyAction = (v: unknown): v is ReplyAction =>
  typeof v === "string" && (REPLY_ACTIONS as readonly string[]).includes(v);

async function hex(value: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The reply code for a package link, or null when the link carries no package token. */
export async function replyCodeFor(packageLink: string): Promise<string | null> {
  const token = tokenFromLink(packageLink);
  return token ? (await hex(`athena-submittal-reply:v1:${token}`)).slice(0, 32) : null;
}

/** What the database stores and looks a code up by. */
export const replyCodeHash = (code: string) => tokenHash(`submittal-reply:${code}`);
export const replyPageUrl = (code: string) => `${REPLY_ORIGIN}/r/submittal-return/${code}`;
export const replyAddress = (code: string) => `submittals+${code}@${REPLY_DOMAIN}`;

const bare = (value: string) => {
  const m = value.match(/<([^>]+)>/);
  return (m ? m[1]! : value)
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "");
};

/** The reply code in a capture address (submittals+<code>@meetathena.io), or null for any other address. */
export function replyCodeFromAddress(address: string): string | null {
  const m = /^submittals\+([0-9a-f]{32})@([a-z0-9.-]+)$/.exec(bare(address));
  return m && INBOUND_DOMAINS.includes(m[2]!) ? m[1]! : null;
}

/** The first capture code among a message's recipients. */
export function replyCodeFromAddresses(addresses: string[]): string | null {
  for (const a of addresses) {
    const code = replyCodeFromAddress(a);
    if (code) return code;
  }
  return null;
}

export type PackageDraft = {
  to: string;
  cc: string[];
  subject: string;
  body: string;
  link?: string | null;
  attachment?: null;
};

export const REPLY_LINE_LEAD = "To send your review back, open this page and pick your action:";

/**
 * Adds the return page and the capture address to a package email. The member's connected Gmail tool sends only
 * To, CC, subject and body (it cannot set a Reply-To header), so the capture address rides in CC: a reviewer who
 * replies to all is captured. Running it again on its own output changes nothing.
 */
export function withReplyCapture(draft: PackageDraft, code: string): PackageDraft {
  const address = replyAddress(code);
  const page = replyPageUrl(code);
  const cc = draft.cc.some((c) => bare(c) === address) ? draft.cc : [...draft.cc, address];
  const body = draft.body.includes(page)
    ? draft.body
    : `${draft.body.trimEnd()}\n\n${REPLY_LINE_LEAD}\n${page}\nOr reply to all on this email with your stamped copy attached.`;
  return { ...draft, cc, body };
}
