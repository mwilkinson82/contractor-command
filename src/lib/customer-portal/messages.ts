// Client messages: the team's side. A full-access member replies to one customer (from the board or from chat), and
// the customer gets the reply by email with a button back to their page. The database function checks job access;
// this file only shapes the call and the email.
import { clientMessageEmail, type PortalEmail } from "./email";
import { portalUrl } from "./model";

/** What mcp_job_message_reply returns (supabase/migrations/20261105160000_athena_portal_messages.sql). */
export type TeamReply = {
  message_id: string;
  created_at: string;
  author_name: string;
  body: string;
  item_id: string | null;
  about_label: string | null;
  access_id: string;
  customer_name: string;
  customer_email: string;
  job_id: string;
  job_number: string;
  job_name: string;
  company: string;
};

export const MESSAGE_MAX = 4000;

/** The customer's page opened on Messages. */
export const portalMessagesUrl = (access: string) => `${portalUrl(access)}?s=messages`;

/** The reply email for one team message. */
export function replyEmail(r: TeamReply, logo: string | null = null): PortalEmail {
  return clientMessageEmail({
    to: r.customer_email,
    name: r.customer_name,
    company: r.company,
    jobName: r.job_name,
    from: r.author_name,
    body: r.body,
    about: r.about_label,
    link: portalMessagesUrl(r.access_id),
    logo,
    messageId: r.message_id,
  });
}

/**
 * Posts a team reply as the signed-in member and emails the customer. `rpc` runs as the member (never the service
 * role), so mcp_job_message_reply's full-access check applies. A failed email keeps the reply on the page.
 */
export async function replyToClient(
  deps: {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    send: (m: PortalEmail) => Promise<"sent" | "off" | "failed">;
    logo?: string | null;
  },
  a: { jobId: string; accessId: string; body: string; aboutItem?: string | null },
): Promise<{ reply: TeamReply; email: "sent" | "off" | "failed" }> {
  const body = a.body.trim();
  if (!body || body.length > MESSAGE_MAX)
    throw new Error("Write a reply of up to 4,000 characters.");
  const reply = (await deps.rpc("mcp_job_message_reply", {
    _job: a.jobId,
    _access: a.accessId,
    _body: body,
    _about_item: a.aboutItem ?? null,
  })) as TeamReply;
  const email = await deps
    .send(replyEmail(reply, deps.logo ?? null))
    .catch(() => "failed" as const);
  return { reply, email };
}
