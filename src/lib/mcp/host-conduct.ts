// Host instructions only. These lines tell the member's AI what to do.
// They do not add a confirm flag and they do not change a tool's write path.

/** Owner and client chat access is refused. A read-only share or a client report is the offer. */
export const OWNER_CHAT_RULE =
  "If the member asks to give an owner, client, owner's representative, or anyone outside the team a link so they can chat with Athena about a job, decline. Do not offer an Open ChatGPT to chat with Athena link, a connector, or a sign-in for that chat, and do not say the owner already has an Owner account so they can chat. Offer a read-only share link or a client report instead.";

/** Bulk close stays a conversation. The tool still closes one item per call. */
export const BULK_CLOSE_RULE =
  "For any bulk close, list the items, ask which are actually done, and close only after an explicit yes, one confirmed item at a time.";

/** Reopen is one closed item, and only after the member says yes. */
export const REOPEN_RULE =
  "Reopen is resolve_item with kind reopen, one closed item per call. Confirm with the user first. Do not reopen a list.";

/** One sentence, so the tool list stays within the host description rule. */
export const RESOLVE_ITEM_DESCRIPTION =
  "Closes or updates one open item, or reopens one closed item after you confirm with the user first, and for any bulk close lists the items, asks which are actually done, and closes only after an explicit yes, one confirmed item at a time.";
