// One builder for every job board URL Athena emits. The signed token is a query param
// so a host can append utm_source without dropping it.
import { isUuid, pageUrl, type AnyPage } from "../report-pages";
import { mintJobBoardLinks, withBoardToken, type BoardPage, type BoardScope } from "./board-link";

export type BoardLinkPage = AnyPage | "home";

export const PROJECT_HOME_ROUTE_RULE =
  ' For "open the project board", "open the job board", "give me the job board", "show me the job board", project home, or a job dashboard, call report_page_link with page "home" and the job_number the member supplied; preserve company_id when known. This generic navigation intent takes priority over greeting, morning-brief, open-item, and superintendent rules. Use page "items" or list_open_items for explicit open-items requests; use field_board or superintendent_view for explicit field board, super board, superintendent board, super plan, or crew-plan requests. Never present an Open items or Field board destination as the project home. ';

const ALIASES: Record<string, BoardLinkPage> = {
  board: "home",
  home: "home",
  "job home": "home",
  "project home": "home",
  "job board": "home",
  "project board": "home",
  dashboard: "home",
  "job dashboard": "home",
  "project dashboard": "home",
  items: "items",
  item: "items",
  "open items": "items",
  "items board": "items",
  "open items board": "items",
  ior: "ior",
  "items of record": "ior",
  "ior board": "ior",
  field: "field",
  "field board": "field",
  "super board": "field",
  "superintendent board": "field",
  schedule: "schedule",
  portfolio: "portfolio",
  lookahead: "lookahead",
  "two week lookahead": "lookahead",
  payapp: "payapp",
  "pay app": "payapp",
  briefing: "briefing",
  "morning briefing": "briefing",
  daily: "daily",
  photos: "photos",
  submittals: "submittals",
  submittal: "submittals",
  "submittal log": "submittals",
  "submittals board": "submittals",
};

/** items → /items, IOR → /ior, field → /field. Other saved pages keep their own path. */
export function boardPageFor(raw: string): BoardLinkPage | null {
  const key = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return ALIASES[key] ?? null;
}

/** Signed job page. The token stays in `t` when other query params are added. */
export function signedJobUrl(page: AnyPage, jobId: string, token: string, anchor?: string): string {
  const url = new URL(withBoardToken(pageUrl(page, jobId), token));
  if (anchor) url.hash = anchor.replace(/^#/, "");
  return url.toString();
}

export function readBoardToken(
  search: Record<string, unknown> | URLSearchParams,
): string | undefined {
  const raw = search instanceof URLSearchParams ? search.get("t") : search.t;
  const value = Array.isArray(raw) ? raw.find((v) => typeof v === "string") : raw;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type Rpc = (fn: string, args: Record<string, unknown>) => unknown;

/** Option B: superintendents (scope "super") get signed board links. */
export async function signedJobPages(
  rpc: Rpc,
  jobId: string,
  scope: string | null | undefined,
): Promise<Partial<Record<BoardPage, string>>> {
  if (!isUuid(jobId) || (scope !== "full" && scope !== "super")) return {};
  return mintJobBoardLinks(rpc, jobId, scope as BoardScope);
}

export { submittalRecordUrl } from "./submittal-record-url";

// A record address (/submittal/<number>) is one more path segment after the page name.
const JOB_LINK =
  /https:\/\/app\.meetathena\.io\/r\/job\/[0-9a-f-]{36}\/[a-z]+(?:\/[^)\s"'<>?#]+)?(?:\?[^)\s"'<>]*)?(?:#[^)\s"'<>]*)?/gi;

/** /r/job links whose query has no signed token. utm params do not count as a token. */
export function jobLinksMissingToken(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const bad: string[] = [];
  for (const match of text.matchAll(JOB_LINK)) {
    const href = match[0];
    try {
      if (!new URL(href).searchParams.get("t")) bad.push(href);
    } catch {
      bad.push(href);
    }
  }
  return [...new Set(bad)];
}
