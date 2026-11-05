// The company board (Nov 5 2026): the company's own record above its jobs, at app.meetathena.io/r/company/<id>.
// Profile, kinds of work, labor rules, decision authority, tools, and the company details and logo editor.
// Any signed-in member of the company opens it; the jobs and money summary on it is for owners and leadership.
// Kept small so the account page and the chat tools can import it without the report renderers.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPANY_BOARD_ORIGIN = "https://app.meetathena.io";

export function companyBoardPath(companyId: string): string {
  if (!UUID_RE.test(companyId)) throw new Error("bad id");
  return `/r/company/${companyId}`;
}

export const companyBoardUrl = (companyId: string, origin = COMPANY_BOARD_ORIGIN) =>
  `${origin.replace(/\/$/, "")}${companyBoardPath(companyId)}`;

export const isCompanyId = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
