// Customer page (0.8.24): one private page per job for the contractor's customer. The member invites the customer,
// posts weekly updates and shares a priced change order, the Good, Better, Best proposal or a pay application for
// the customer to decide on the page. Every write needs full job access and confirmed: true after the member's yes.
import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { audit, jobTimeZone, named, resolveJob } from "../jobs";
import { todayIn } from "../deadlines";
import { guide } from "../visible";
import { newToken, tokenHash } from "../file-share";
import {
  inviteEmail,
  noticeEmail,
  portalEmailEnabled,
  sendPortalEmail,
} from "../../customer-portal/email";
import { portalInviteUrl, portalUrl } from "../../customer-portal/model";
import { longDate } from "../../customer-portal/render";
import { companyLogoUrl } from "../document-email-brand";
import { displayPrice } from "../../selections/format";

const INVITE_DEFAULT_DAYS = 14;

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args);
  if (error) dbError(error);
  return data as T;
}

type Recipient = { email: string; name: string; access_id?: string };
type Shared = { recipients: Recipient[]; company: string; job_name: string };
type ListResult = {
  job_number: string;
  job_name: string;
  customers: {
    access_id: string;
    email: string;
    name: string;
    invited_at: string;
    invite_expires_at: string;
    last_seen_at: string | null;
    revoked_at: string | null;
  }[];
  items: {
    item_id: string;
    kind: string;
    label: string;
    shared_at: string;
    withdrawn_at: string | null;
    decision: {
      decision: string;
      choice: string | null;
      typed_name: string;
      email: string;
      decided_at: string;
      note: string | null;
      reference: string;
    } | null;
  }[];
  updates: { id: string; week_of: string; title: string; posted_at: string }[];
};

const SAFE =
  "The customer page shows only what is shared: weekly updates you post, photos marked customer-safe, a daily summary (date, weather, crew, work done; no issues, delays, safety notes or costs), schedule milestones, and the change orders, selections and pay applications you share.";

async function notify(
  recipients: Recipient[],
  jobName: string,
  company: string,
  kind: "update" | "decision",
  label: string | undefined,
  accessFor: (r: Recipient) => string | null,
  logo: string | null = null,
  item?: "change_order" | "selection" | "pay_app",
) {
  const out: string[] = [];
  for (const r of recipients) {
    const access = accessFor(r);
    if (!access) continue;
    const res = await sendPortalEmail(
      noticeEmail({
        to: r.email,
        name: r.name,
        company,
        jobName,
        link: portalUrl(access),
        kind,
        label,
        logo,
        item,
        nonce: newToken(),
      }),
    );
    out.push(
      `${r.email}: ${res === "sent" ? "emailed" : res === "off" ? "not emailed (customer email is off)" : "email failed"}`,
    );
  }
  return out;
}

// After an invite, the member shouldn't have to work out what comes next.
const NEXT_AFTER_INVITE =
  "Then offer the next step: if this job has a Good, Better, Best proposal that is ready (selection_proposal preview shows it ready) and it isn't on the client page yet, ask whether to send it to their client page now, and on the member's yes call customer_portal share_selection with the preview's version and confirmed true. If a priced change order is waiting on the customer, offer to share it the same way.";

export const CUSTOMER_PORTAL_RULE =
  " To invite a job's customer, owner or homeowner to their private customer page, call customer_portal with action invite, the job number and their email; never use team_invite or a team role for a customer, and never say Athena has no customer access. Pass confirmed true only after the member says yes to that invite.";

export const customerPortal = defineTool({
  name: "customer_portal",
  title: "Customer page",
  description:
    "Runs the job's private customer page: invite or remove the customer (owner or homeowner) by email, post a weekly update, share a priced change order, the Good, Better, Best proposal or a ready or submitted pay application (under the name the member confirms the customer will see, client_number) for the customer to approve or choose on the page, take a shared item back, and list who has access and every customer decision.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    action: z.enum([
      "list",
      "invite",
      "revoke",
      "post_update",
      "share_change_order",
      "share_selection",
      "share_pay_app",
      "withdraw",
    ]),
    email: z.string().trim().email().max(320).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    days: z.number().int().min(1).max(30).optional(),
    access_id: z.string().uuid().optional(),
    week_of: z.iso.date().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(6000).optional(),
    submittal_id: z.string().uuid().optional(),
    expected_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    item_id: z.string().uuid().optional(),
    application_id: z.string().uuid().optional(),
    application_number: z.string().trim().min(1).max(120).optional(),
    client_number: z.string().trim().min(1).max(60).optional(),
    due_on: z.iso.date().optional(),
    notify: z.boolean().optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: (args, ctx) =>
    run(
      "customer_portal",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const head = `${named(job)} · Customer page`;

        if (args.action === "list") {
          const l = await rpc<ListResult>(sb, "mcp_portal_list", { _job: job.job_id });
          const live = l.customers.filter((c) => !c.revoked_at);
          const lines = [
            head,
            live.length ? "Customers with access:" : "No customer has access yet.",
            ...live.map(
              (c) =>
                `- ${c.name} <${c.email}> · ${c.last_seen_at ? `last opened ${longDate(c.last_seen_at)}` : "not opened yet"} · access ${c.access_id}`,
            ),
            "",
            l.items.length ? "Shared for a decision:" : "Nothing shared for a decision.",
            ...l.items.map((i) => {
              const d = i.decision;
              const state = d
                ? `${d.decision === "chosen" ? `chose ${d.choice}` : d.decision} by ${d.typed_name} <${d.email}> on ${longDate(d.decided_at)} (${d.reference})${d.note ? ` · note: ${d.note}` : ""}`
                : i.withdrawn_at
                  ? "taken back"
                  : "waiting on the customer";
              return `- ${i.label} · shared ${longDate(i.shared_at)} · ${state} · item ${i.item_id}`;
            }),
            "",
            `Weekly updates posted: ${l.updates.length}${l.updates[0] ? `, latest week of ${longDate(l.updates[0].week_of)}` : ""}.`,
          ];
          return guide(
            { ...text(lines.join("\n")), structuredContent: l as unknown as JsonValueInput },
            SAFE,
          );
        }

        if (args.confirmed !== true && args.action === "share_pay_app") {
          if (!args.application_id && !args.application_number)
            throw new ToolError(
              "Read the pay application with payment_application_read and pass its id or number. Nothing was shared.",
            );
          const n = await rpc<{ saved_number: string; suggested_name: string }>(
            sb,
            "mcp_portal_pay_app_name",
            {
              _job: job.job_id,
              _application: args.application_id ?? null,
              _number: args.application_id ? null : (args.application_number ?? null),
            },
          );
          const name = args.client_number ?? n.suggested_name;
          throw new ToolError(
            `Show the member the period, the amount due now, the approve-by date and the name their customer will see, pre-filled as "${name}". They can keep it or type any name they want; the saved pay application keeps its own number (${n.saved_number}). Ask them to confirm, then call again with client_number set to the name they confirmed and confirmed true. Nothing was shared.`,
          );
        }
        if (args.confirmed !== true) {
          const ask: Record<string, string> = {
            invite:
              "Show the member the customer's name and email, say Athena will email them a private link to this job's customer page, and ask them to confirm. Nothing was sent.",
            revoke: "Ask the member to confirm removing this customer's access. Nothing changed.",
            post_update:
              "Show the member the exact update text and ask them to confirm posting it to the customer page. Nothing was posted.",
            share_change_order:
              "Show the member the change order number, title, price and schedule days the customer will see, and ask them to confirm sharing it for the customer's decision. Nothing was shared.",
            share_selection:
              "Preview the proposal with selection_proposal first, then ask the member to confirm sharing it on the customer page. Nothing was shared.",
            share_pay_app:
              "Show the member the period, the amount due now, the approve-by date and the name the customer will see, and ask them to confirm sharing it for the customer's approval. Nothing was shared.",
            withdraw:
              "Ask the member to confirm taking this item back from the customer page. Nothing changed.",
          };
          throw new ToolError(ask[args.action]!);
        }

        if (args.action === "invite") {
          if (!args.email || !args.name)
            throw new ToolError("Give the customer's name and email. Nothing was sent.");
          if (!portalEmailEnabled())
            throw new ToolError(
              "Customer page email is turned off, so the customer couldn't get a sign-in code. No invite was made. Tell the member it isn't switched on yet.",
            );
          const token = newToken();
          const expires = new Date(Date.now() + (args.days ?? INVITE_DEFAULT_DAYS) * 86_400_000);
          const r = await rpc<{
            access_id: string;
            email: string;
            name: string;
            reinvited: boolean;
            company: string;
            job_name: string;
            pm_name: string | null;
          }>(sb, "mcp_portal_invite", {
            _job: job.job_id,
            _email: args.email,
            _name: args.name,
            _invite_hash: await tokenHash(token),
            _expires_at: expires.toISOString(),
          });
          await audit(sb, job, "customer_portal", r.reinvited ? "reinvite" : "invite", r.access_id);
          const link = portalInviteUrl(token);
          const sent = await sendPortalEmail(
            inviteEmail({
              to: r.email,
              name: r.name,
              company: r.company,
              jobName: r.job_name,
              pmName: r.pm_name,
              link,
              expires: longDate(expires.toISOString()),
              logo: await companyLogoUrl(sb, job.company_id),
              nonce: newToken(),
            }),
          );
          return guide(
            {
              ...text(
                [
                  head,
                  sent === "sent"
                    ? `Invited ${r.name} <${r.email}>. Athena emailed them the link${r.reinvited ? " (a new link; the old one no longer works)" : ""}.`
                    : `${r.name} <${r.email}> has access, but the invite email didn't go out. Their link: ${link}`,
                  `The link works until ${longDate(expires.toISOString())}. Opening it asks for a code emailed to ${r.email}, so the link alone shows nothing.`,
                  SAFE,
                ].join("\n"),
              ),
              structuredContent: {
                access_id: r.access_id,
                email: r.email,
                invited: true,
                email_sent: sent === "sent",
                expires_at: expires.toISOString(),
              } as unknown as JsonValueInput,
            },
            sent === "sent"
              ? "Tell the member the invite went out. Do not send the link yourself."
              : "Tell the member the email didn't go out and give them the link to pass on themselves. Do not send it yourself.",
            NEXT_AFTER_INVITE,
          );
        }

        if (args.action === "revoke") {
          if (!args.access_id)
            throw new ToolError(
              "Which customer? Use list to get their access id. Nothing changed.",
            );
          const r = await rpc<{ email: string; name: string }>(sb, "mcp_portal_revoke", {
            _job: job.job_id,
            _access: args.access_id,
          });
          await audit(sb, job, "customer_portal", "revoke", args.access_id);
          return text(
            `${head}\n${r.name} <${r.email}> no longer has access. They're signed out everywhere, and their link stops working.`,
          );
        }

        if (args.action === "withdraw") {
          if (!args.item_id)
            throw new ToolError("Which item? Use list to get its item id. Nothing changed.");
          await rpc(sb, "mcp_portal_withdraw", { _job: job.job_id, _item: args.item_id });
          await audit(sb, job, "customer_portal", "withdraw", args.item_id);
          return text(`${head}\nTaken back. The customer no longer sees it on their page.`);
        }

        if (args.action === "post_update") {
          if (!args.title || !args.body)
            throw new ToolError("Give the update a short title and its text. Nothing was posted.");
          const week = args.week_of ?? todayIn(await jobTimeZone(sb, job.job_id));
          const r = await rpc<{ id: string } & Shared>(sb, "mcp_portal_post_update", {
            _job: job.job_id,
            _week_of: week,
            _title: args.title,
            _body: args.body,
          });
          await audit(sb, job, "customer_portal", "post_update", r.id);
          const sent =
            args.notify === false
              ? []
              : await notifyAll(r, "update", undefined, await companyLogoUrl(sb, job.company_id));
          return text(
            [
              head,
              `Posted "${args.title}" for the week of ${longDate(week)}.`,
              ...(r.recipients.length
                ? sent
                : ["No customer has access yet, so no one sees it until you invite them."]),
            ].join("\n"),
          );
        }

        if (args.action === "share_change_order") {
          if (!args.submittal_id || !args.expected_version)
            throw new ToolError(
              "Read the change order with change_order_log and pass its submittal id and record version. Nothing was shared.",
            );
          const r = await rpc<
            {
              item_id: string;
              number: string;
              title: string;
              view: { price_cents: number; schedule_days: number | null };
              fingerprint: string;
            } & Shared
          >(sb, "mcp_portal_share_change_order", {
            _job: job.job_id,
            _submittal: args.submittal_id,
            _expected_version: args.expected_version,
          });
          await audit(sb, job, "customer_portal", "share_change_order", r.item_id);
          const label = `${r.number} · ${r.title}`;
          const sent =
            args.notify === false
              ? []
              : await notifyAll(
                  r,
                  "decision",
                  label,
                  await companyLogoUrl(sb, job.company_id),
                  "change_order",
                );
          return guide(
            {
              ...text(
                [
                  head,
                  `Shared ${label} for the customer's decision: ${displayPrice(r.view.price_cents, "USD")}, ${r.view.schedule_days ? `${r.view.schedule_days} schedule days` : "no schedule change"}.`,
                  "They see why, what's included, the price and the schedule effect. No cost lines or markup.",
                  "If they approve, it is recorded as approved with their typed name, an emailed code and a fingerprint of what they saw. It is not executed and billing does not change.",
                  ...(r.recipients.length
                    ? sent
                    : ["No customer has access yet. Invite them first."]),
                ].join("\n"),
              ),
              structuredContent: {
                item_id: r.item_id,
                fingerprint: r.fingerprint,
              } as unknown as JsonValueInput,
            },
            "Sharing on the customer page counts as issuing this change order to the customer. Editing it later takes it off their page until you share it again.",
          );
        }

        if (args.action === "share_selection") {
          if (!args.expected_version)
            throw new ToolError(
              "Preview with selection_proposal and pass its board version. Nothing was shared.",
            );
          const r = await rpc<{ item_id: string; title: string; fingerprint: string } & Shared>(
            sb,
            "mcp_portal_share_selection",
            {
              _job: job.job_id,
              _expected_version: args.expected_version,
            },
          );
          await audit(sb, job, "customer_portal", "share_selection", r.item_id);
          const sent =
            args.notify === false
              ? []
              : await notifyAll(
                  r,
                  "decision",
                  r.title,
                  await companyLogoUrl(sb, job.company_id),
                  "selection",
                );
          return text(
            [
              head,
              `Shared "${r.title}" for the customer to choose Good, Better or Best. They see the same view as the proposal link: no costs, margin or notes.`,
              "Their choice is recorded on the selection board with their typed name and an emailed code. The estimate, contract and billing do not change.",
              ...(r.recipients.length ? sent : ["No customer has access yet. Invite them first."]),
              "",
              r.recipients.length
                ? "What happens next: they open their client page, pick Good, Better or Best, type their name and confirm with an emailed code. Athena emails the job's PM when they choose."
                : "Next: invite the customer to their client page. They'll see this proposal as soon as they sign in.",
            ].join("\n"),
          );
        }
        if (args.action === "share_pay_app") {
          if (!args.application_id && !args.application_number)
            throw new ToolError(
              "Read the pay application with payment_application_read and pass its id or number. Nothing was shared.",
            );
          const r = await rpc<
            {
              item_id: string;
              application_id: string;
              version: number;
              label: string;
              due_on: string | null;
              view: {
                period_start: string;
                period_end: string;
                totals: { current_due_cents: number; retainage_cents: number };
              };
              fingerprint: string;
            } & Shared
          >(sb, "mcp_portal_share_pay_app", {
            _job: job.job_id,
            _application: args.application_id ?? null,
            _number: args.application_id ? null : (args.application_number ?? null),
            _expected_version: args.expected_version ?? null,
            _due_on: args.due_on ?? null,
            _client_number: args.client_number ?? null,
          });
          await audit(sb, job, "customer_portal", "share_pay_app", r.item_id);
          const sent =
            args.notify === false
              ? []
              : await notifyAll(
                  r,
                  "decision",
                  r.label,
                  await companyLogoUrl(sb, job.company_id),
                  "pay_app",
                );
          return guide(
            {
              ...text(
                [
                  head,
                  `Shared ${r.label} (version ${r.version}) for the customer's approval: ${displayPrice(r.view.totals.current_due_cents, "USD")} due for work ${longDate(r.view.period_start)} to ${longDate(r.view.period_end)}${r.due_on ? `, approve by ${longDate(r.due_on)}` : ""}.`,
                  "They see the contract, each SOV line's work and stored materials, retainage held, what was already approved and what is due now. No cost, fee basis, sources, reasons or notes.",
                  "If they approve, it is recorded with their typed name, an emailed code and a fingerprint of what they saw. The pay application is not certified, and billing and payments do not change.",
                  ...(r.recipients.length
                    ? sent
                    : ["No customer has access yet. Invite them first."]),
                ].join("\n"),
              ),
              structuredContent: {
                item_id: r.item_id,
                application_id: r.application_id,
                version: r.version,
                fingerprint: r.fingerprint,
              } as unknown as JsonValueInput,
            },
            "Revising the pay application later takes it off the customer's page until you share it again.",
          );
        }
        throw new ToolError("Unknown action.");
      },
    ),
});

async function notifyAll(
  r: { recipients: Recipient[]; company: string; job_name: string },
  kind: "update" | "decision",
  label?: string,
  logo: string | null = null,
  item?: "change_order" | "selection" | "pay_app",
): Promise<string[]> {
  return notify(
    r.recipients,
    r.job_name,
    r.company,
    kind,
    label,
    (x) => x.access_id ?? null,
    logo,
    item,
  );
}

export { INVITE_DEFAULT_DAYS };
