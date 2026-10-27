// 0.8.14: living report pages. report_page_link returns the private, always-current page URL (signed-in company
// members with access only). report_page_share makes an optional owner share link (expiring, revocable; off by
// default). report_page_share_revoke turns one off.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, READ_ONLY_MESSAGE, audit, named, prefix, resolveCompany, resolveJob } from "../jobs";
import { guide } from "../visible";
import { boardLinkExpiry } from "../board-link";
import { boardPageFor, jobLinksMissingToken, signedJobPages, type BoardLinkPage } from "../board-url";
import { newToken, tokenHash } from "../file-share";
import { applyCardClosing } from "../cards/silence";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import type { CardModel } from "../cards/model";
import { shortDate } from "../styled-views";
import { isChatAccessPage, privateChatRefusalCard } from "../private-chat-sharing";
import { PAGE_LABEL, REPORT_PAGES, SHARE_DEFAULT_DAYS, SHARE_MAX_DAYS, pageAllowed, pageUrl, shareExpiry, shareTokenFromLink, shareUrl, type ReportPage } from "../../report-pages";

const jobNumber = z.string().trim().min(1).max(40).optional();
const companyId = z.string().trim().min(1).max(200).optional();
const sharePage = z.enum([...REPORT_PAGES, "chat"]);
const page = z.string().trim().min(1).max(40).default("home");

function refuseChatAccess(jobNumber?: string) {
  const card = privateChatRefusalCard(jobNumber);
  const html = renderHtml(card);
  return { ...text(renderMarkdown(card)), structuredContent: { card, html, refused: true, access_requested: "chat", created: false, alternative: "read_only_client_report" } };
}

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) dbError(error);
  return data as T;
}

async function target(sb: Sb, args: { page: string; job_number?: string; company_id?: string }) {
  const p = args.page as BoardLinkPage;
  if (p === "portfolio") {
    const co = await resolveCompany(sb, args.company_id);
    const leader = await rpc<boolean>(sb, "mcp_is_company_leader", { _company: co });
    if (!pageAllowed(p, null, leader === true)) throw new ToolError("The portfolio page is for owners and leadership. Your role can see your own jobs' pages instead.");
    return { p, id: co, job: null, company: co, head: "" };
  }
  if (!args.job_number) throw new ToolError("Which job? Give the job number.");
  const job = await resolveJob(sb, args.job_number, args.company_id);
  if (!pageAllowed(p === "home" ? "field" : p, job.scope, false)) throw new ToolError(job.scope === "super" ? READ_ONLY_MESSAGE : FULL_ACCESS_MESSAGE);
  return { p, id: job.job_id, job, company: job.company_id, head: prefix(job) };
}

const BOARD_BUTTON: Partial<Record<string, string>> = {
  items: "Open items",
  ior: "Open IOR",
  field: "Open field board",
};

export function jobBoardCard(job: string | null, links: { label: string; href: string }[]): CardModel {
  return {
    state: "result",
    show_state: false,
    title: "Job board",
    job,
    sections: [{ heading: "Open", kind: "chips", rows: links.map((link) => ({ cells: [link.label], href: link.href, tone: "action" as const })) }],
    next_move: null,
  };
}

function boardLinkCard(page: string, job: string | null, url: string, expiresAt: string | null): CardModel {
  const label = page === "home" ? "Project home" : PAGE_LABEL[page as keyof typeof PAGE_LABEL] ?? "Board";
  return {
    state: "result",
    show_state: false,
    title: label,
    job,
    sections: [
      { heading: "Open", kind: "chips", rows: [{ cells: [BOARD_BUTTON[page] ?? `Open ${label}`], href: url, tone: "action" }] },
      ...(expiresAt
        ? [
            {
              heading: "Link",
              kind: "list" as const,
              rows: [
                {
                  cells: [
                    page === "home"
                      ? `Temporary access from this chat lasts 24 hours and expires on ${shortDate(expiresAt.slice(0, 10))}. The project home address stays the same; sign in to keep opening your saved home after this access expires.`
                      : `This link works until ${shortDate(expiresAt.slice(0, 10))}.`,
                  ],
                  tone: "known" as const,
                },
              ],
            },
          ]
        : []),
    ],
    next_move: null,
  };
}

export const reportPageLink = defineTool({
  name: "report_page_link",
  title: "Project home or report link",
  description:
    'Opens the project board, job board, project home, or job dashboard with page "home" by default; use page "items" only for explicit Open items requests, other named pages for their reports, and page "chat" to refuse owner or client chat access and offer a read-only client report instead.',
  inputSchema: { page, job_number: jobNumber, company_id: companyId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("report_page_link", ctx, { jobNumber: args.job_number }, async (sb) => {
      const requestedPage = args.page ?? "home";
      if (isChatAccessPage(requestedPage)) return refuseChatAccess(args.job_number);
      const asked = boardPageFor(requestedPage);
      if (!asked)
        throw new ToolError("Which page? home, items, ior, field, or another named report.");
      const t = await target(sb, { ...args, page: asked });
      const expires = t.p === "portfolio" ? null : boardLinkExpiry();
      const board = t.job ? await signedJobPages((fn, a) => sb.rpc(fn, a), t.job.job_id, t.job.scope) : {};
      const signed =
        t.p === "portfolio"
          ? null
          : t.p === "home"
            ? (board.field?.replace(/\/field(?=\?)/, "/home") ?? null)
            : (board[t.p as keyof typeof board] ?? null);
      if (t.p !== "portfolio" && !signed) throw new ToolError("The board link could not be signed. Ask again in a moment.");
      const url = signed ?? pageUrl(t.p === "home" ? "field" : t.p, t.id);
      if (jobLinksMissingToken(url).length) throw new ToolError("The board link could not be signed. Ask again in a moment.");
      await audit(sb, t.job, "report_page_link", `page_link_${t.p}`, null, t.company);
      const card = boardLinkCard(t.p, t.job ? named(t.job) : null, url, expires ? expires.toISOString() : null);
      const html = renderHtml(card);
      const body = applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false);
      return guide(
        {
          ...text(body),
          structuredContent: { url, page: t.p, private: true, expires_at: expires ? expires.toISOString() : null, card, html },
        },
        "The card is the whole reply. Do not add prose before or after it.",
      );
    }),
});

export const reportPageShare = defineTool({
  name: "report_page_share",
  title: "Share a report page (expiring link)",
  description: "Creates only an expiring read-only report link after confirmation; use page chat to refuse chat access without creating a link.",
  inputSchema: {
    page: sharePage, job_number: jobNumber, company_id: companyId,
    confirmed: z.boolean().optional(),
    expires_in_days: z.number().int().min(1).max(SHARE_MAX_DAYS).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: (args, ctx) =>
    run("report_page_share", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (isChatAccessPage(args.page)) return refuseChatAccess(args.job_number);
      if (args.confirmed !== true) throw new ToolError("Confirm with the member first. No link was made.");
      const t = await target(sb, args);
      const token = newToken();
      const exp = shareExpiry(args.expires_in_days);
      const r = await rpc<{ id: string; show_money: boolean }>(sb, "mcp_report_share_create", { _page: t.p, _job: t.job?.job_id ?? null, _company: t.company, _token_hash: await tokenHash(token), _expires_at: exp.toISOString() });
      await audit(sb, t.job, "report_page_share", `page_share_${t.p}`, r.id, t.company);
      const link = shareUrl(token);
      return guide(
        {
          ...text([`${t.head}${PAGE_LABEL[t.p as ReportPage]} share link: ${link}`, `Anyone with this link can view the latest version until ${exp.toISOString().slice(0, 10)}${r.show_money ? "" : " (no dollar figures)"}. You can turn it off any time.`].join("\n")),
          structuredContent: { link, page: t.p, expires_at: exp.toISOString(), show_money: r.show_money },
        },
        "Give the link on its own line. Never send it yourself. To turn it off later, call report_page_share_revoke with this link after the member asks.",
      );
    }),
});

export const reportPageShareRevoke = defineTool({
  name: "report_page_share_revoke",
  title: "Turn off a report share link",
  description: "Turns off a report page share link.",
  inputSchema: { link: z.string().trim().min(1).max(300) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("report_page_share_revoke", ctx, {}, async (sb) => {
      const token = shareTokenFromLink(args.link);
      if (!token) throw new ToolError("That isn't an Athena report share link. Nothing was changed.");
      const r = await rpc<{ id: string; page: ReportPage } | null>(sb, "mcp_report_share_revoke", { _token_hash: await tokenHash(token) });
      if (!r) throw new ToolError("No share link like that you can turn off. Nothing was changed.");
      await audit(sb, null, "report_page_share_revoke", "revoke_page_share", r.id);
      return guide(
        { ...text(`Share link turned off (${PAGE_LABEL[r.page]}). Anyone who opens it now sees that it's no longer available. The private page is unchanged.`), structuredContent: { revoked: true } },
        "Tell the member the link is off.",
      );
    }),
});

