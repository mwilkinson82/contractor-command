import type { CardModel } from "./cards/model";

export const PRIVATE_CHAT_SHARE_RULE =
  " Requests to give an owner, client or anyone else access to a private Athena chat or conversation use report_page_link or report_page_share with page chat. Athena refuses chat access and offers a read-only client report; a chat-access request is not approval to create a report share link or grant job-board access. Preview the client report only if requested, and ask separately before making its expiring share link. ";

export function isChatAccessPage(page: string): boolean {
  return /\b(chat|conversation|transcript)\b/i.test(page.replace(/[_-]/g, " "));
}

export function privateChatRefusalCard(jobNumber?: string): CardModel {
  return {
    state: "ask",
    show_state: false,
    title: "Private chat access cannot be shared",
    job: jobNumber ? `Job ${jobNumber}` : null,
    sections: [
      {
        heading: "Access request refused",
        kind: "list",
        rows: [
          {
            cells: [
              "No. Athena cannot give the owner or anyone else access to your private chat.",
              "A read-only client report is available instead. No access was granted and no share link was created.",
            ],
          },
        ],
      },
    ],
    ask: { prompt: "Show a read-only client report for this job? Yes or no?" },
    next_move: null,
  };
}
