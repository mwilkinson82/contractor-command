// 0.8.14: living report pages. report_page_link returns the private, always-current page URL (signed-in company
// members with access only). report_page_share makes an optional owner share link (expiring, revocable; off by
// default). report_page_share_revoke turns one off.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, READ_ONLY_MESSAGE, audit, prefix, resolveCompany, resolveJob } from "../jobs";
import { guide } from "../visible";
import { newToken, tokenHash } from "../file-share";
import { PAGE_LABEL, REPORT_PAGES, SHARE_DEFAULT_DAYS, SHARE_MAX_DAYS, pageAllowed, pageUrl, shareExpiry, shareTokenFromLink, shareUrl, type ReportPage } from "../../report-pages";

const jobNumber = z.string().trim().min(1).max(40).optional().describe("Job number, exact match (e.g. 2701). Required for ior and schedule; leave out for portfolio.");
const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company. Pass the company name exactly as Athena lists it.");
const page = z.enum(REPORT_PAGES).describe("ior, schedule (the CPM gantt) or portfolio (owners and leadership only).");

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) dbError(error);
  return data as T;
}

async function target(sb: Sb, args: { page: string; job_number?: string; company_id?: string }) {
  const p = args.page as ReportPage;
  if (p === "portfolio") {
    const co = await resolveCompany(sb, args.company_id);
    const leader = await rpc<boolean>(sb, "mcp_is_company_leader", { _company: co });
    if (!pageAllowed(p, null, leader === true)) throw new ToolError("The portfolio page is for owners and leadership. Your role can see your own jobs' pages instead.");
    return { p, id: co, job: null, company: co, head: "" };
  }
  if (!args.job_number) throw new ToolError("Which job? Give the job number.");
  const job = await resolveJob(sb, args.job_number, args.company_id);
  if (!pageAllowed(p, job.scope, false)) throw new ToolError(job.scope === "super" ? READ_ONLY_MESSAGE : FULL_ACCESS_MESSAGE);
  return { p, id: job.job_id, job, company: job.company_id, head: prefix(job) };
}

export const reportPageLink = defineTool({
  name: "report_page_link",
  title: "Permanent report page link",
  description:
    "Call only after the member says yes to \"Want this as a permanent link I keep updated?\". Returns the private page for a job's IOR or schedule, or the company portfolio, at app.meetathena.io. The page always shows the latest saved version and is viewable only by signed-in members of the company with access to that job (supers: schedule without dollars; portfolio: owners and leadership). It is not a public link.",
  inputSchema: { page, job_number: jobNumber, company_id: companyId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("report_page_link", ctx, { jobNumber: args.job_number }, async (sb) => {
      const t = await target(sb, args);
      const url = pageUrl(t.p, t.id);
      await audit(sb, t.job, "report_page_link", `page_link_${t.p}`, null, t.company);
      return guide(
        {
          ...text([`${t.head}${PAGE_LABEL[t.p]} page: ${url}`, "It stays up to date: every time a new version is saved, the page shows it. Only signed-in people at your company with access to this job can open it."].join("\n")),
          structuredContent: { url, page: t.p, private: true },
        },
        "Give the member the link on its own line. Don't call it public. Only if the member asks to share it with someone outside the company (an owner's rep, a lender), offer an expiring share link with report_page_share after they confirm.",
      );
    }),
});

export const reportPageShare = defineTool({
  name: "report_page_share",
  title: "Share a report page (expiring link)",
  description:
    "Only when the member explicitly asks to share a report page with someone who can't sign in. Makes a link anyone with it can open, that shows the latest saved version until it expires (30 days by default, at most 90) or is turned off. IOR and portfolio: owners and leadership only. Schedule: supers' links never show dollars.",
  inputSchema: {
    page, job_number: jobNumber, company_id: companyId,
    confirmed: z.literal(true).describe("true only after the member confirmed they want a link anyone with it can open."),
    expires_in_days: z.number().int().min(1).max(SHARE_MAX_DAYS).optional().describe(`Days the link works, default ${SHARE_DEFAULT_DAYS}.`),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: (args, ctx) =>
    run("report_page_share", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (args.confirmed !== true) throw new ToolError("Confirm with the member first. No link was made.");
      const t = await target(sb, args);
      const token = newToken();
      const exp = shareExpiry(args.expires_in_days);
      const r = await rpc<{ id: string; show_money: boolean }>(sb, "mcp_report_share_create", { _page: t.p, _job: t.job?.job_id ?? null, _company: t.company, _token_hash: await tokenHash(token), _expires_at: exp.toISOString() });
      await audit(sb, t.job, "report_page_share", `page_share_${t.p}`, r.id, t.company);
      const link = shareUrl(token);
      return guide(
        {
          ...text([`${t.head}${PAGE_LABEL[t.p]} share link: ${link}`, `Anyone with this link can view the latest version until ${exp.toISOString().slice(0, 10)}${r.show_money ? "" : " (no dollar figures)"}. You can turn it off any time.`].join("\n")),
          structuredContent: { link, page: t.p, expires_at: exp.toISOString(), show_money: r.show_money },
        },
        "Give the link on its own line. Never send it yourself. To turn it off later, call report_page_share_revoke with this link after the member asks.",
      );
    }),
});

export const reportPageShareRevoke = defineTool({
  name: "report_page_share_revoke",
  title: "Turn off a report share link",
  description: "Turns off a report page share link right away. Call only after the member asks. The member who made it, or an owner or leadership member.",
  inputSchema: { link: z.string().trim().min(1).max(300).describe("The share link (https://app.meetathena.io/r/s/...).") },
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

