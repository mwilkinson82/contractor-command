// A board link lets the browser that opens a tool result read one job without an Athena
// session. Same idea as the report share: only a SHA-256 of the token is stored, it expires,
// and it can be turned off. It is not an owner share. It cannot open another job.
import { pageUrl, type AnyPage } from "../report-pages";
import { newToken, TOKEN_RE, tokenHash } from "./file-share";

export const BOARD_LINK_MS = 24 * 60 * 60 * 1000;
export const BOARD_PAGES = ["field", "items", "daily", "photos", "ior", "payapp", "schedule", "lookahead", "briefing", "submittals"] as const;
export type BoardPage = (typeof BOARD_PAGES)[number];
export type BoardScope = "full" | "super";
export type BoardLinkStatus = "ok" | "expired" | "revoked" | "wrong_job" | "unknown" | "denied";

export type BoardLinkRow = {
  job_id: string;
  scope: BoardScope;
  expires_at: string;
  revoked_at: string | null;
};

export function boardLinkExpiry(now = new Date()): Date {
  return new Date(now.getTime() + BOARD_LINK_MS);
}

export function boardPageAllowed(page: string, scope: BoardScope): page is BoardPage {
  if (page === "ior" || page === "payapp") return scope === "full";
  return scope === "full" || scope === "super" ? (BOARD_PAGES as readonly string[]).includes(page) : false;
}

/** Why a token may or may not open this job's page. Wrong job reveals nothing else. */
export function boardLinkStatus(row: BoardLinkRow | null, jobId: string, page: string, now = new Date()): BoardLinkStatus {
  if (!row) return "unknown";
  if (row.job_id !== jobId) return "wrong_job";
  if (row.revoked_at) return "revoked";
  if (Date.parse(row.expires_at) <= now.getTime()) return "expired";
  if (!boardPageAllowed(page, row.scope)) return "denied";
  return "ok";
}

export function withBoardToken(url: string, token: string): string {
  const next = new URL(url);
  next.searchParams.set("t", token);
  return next.toString();
}

type Rpc = (fn: string, args: Record<string, unknown>) => unknown;

/** Mint one link for this job. A database miss returns no urls, so the tool still answers. */
export async function mintJobBoardLinks(rpc: Rpc, jobId: string, scope: BoardScope): Promise<Partial<Record<BoardPage, string>>> {
  try {
    const minted = await mintBoardToken();
    const { data, error } = (await rpc("mcp_board_link_create", { _job: jobId, _token_hash: minted.hash, _expires_at: minted.expiresAt })) as {
      data?: unknown;
      error: { message?: string } | null;
    };
    const id = data && typeof data === "object" && "id" in data ? (data as { id?: unknown }).id : null;
    if (error || typeof id !== "string") return {};
    return boardLinkSet(jobId, scope, minted.token);
  } catch {
    return {};
  }
}

export async function mintBoardToken(): Promise<{ token: string; hash: string; expiresAt: string }> {
  const token = newToken();
  if (!TOKEN_RE.test(token)) throw new Error("token");
  return { token, hash: await tokenHash(token), expiresAt: boardLinkExpiry().toISOString() };
}

/** One token covers the pages this role may open on this job. */
export async function boardLinkSet(
  jobId: string,
  scope: BoardScope,
  token: string,
): Promise<Partial<Record<BoardPage, string>>> {
  const pages = BOARD_PAGES.filter((page) => boardPageAllowed(page, scope));
  const out: Partial<Record<BoardPage, string>> = {};
  for (const page of pages) out[page] = withBoardToken(pageUrl(page as AnyPage, jobId), token);
  return out;
}
