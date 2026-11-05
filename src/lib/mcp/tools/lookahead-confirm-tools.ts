// Look-ahead date confirmations (lookahead_confirm): Athena emails a supplier or a sub a private link to lock in a
// delivery date, a crew start or a work date on a two-week look-ahead line, and reads where each request stands.
// Their answer comes back as a field notice to the job's PM and the supers on the job. A proposed new date never
// moves the look-ahead; the super or the PM makes that call. Sending needs confirmed: true after the member's yes,
// because it emails someone outside the team.
import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { audit, jobTimeZone, named, resolveJob } from "../jobs";
import { todayIn } from "../deadlines";
import { guide } from "../visible";
import { newToken, tokenHash } from "../file-share";
import { lookaheadRef } from "../refs";
import { activityTitle } from "../styled-views";
import { itemName } from "../open-feed";
import { companyLogoUrl } from "../document-email-brand";
import { portalEmailEnabled, sendPortalEmail } from "../../customer-portal/email";
import { longDate } from "../../customer-portal/render";
import { confirmRequestEmail } from "../../lookahead-confirm/email";
import {
  ASK_KINDS,
  ASK_NOUN,
  CONFIRM_DEFAULT_DAYS,
  CONFIRM_MAX_DAYS,
  PARTY_KINDS,
  askAllowed,
  confirmUrl,
  dateSpan,
  shortDate,
  type AskKind,
  type PartyKind,
} from "../../lookahead-confirm/model";
import { lookaheadData, lookaheadForJob } from "./workflow-tools";

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

export type ConfirmRow = {
  id: string;
  lookahead_id: string | null;
  item_id: string | null;
  activity_id: string | null;
  party_kind: PartyKind;
  party_name: string;
  party_email: string;
  ask_kind: AskKind;
  what: string;
  asked_date: string;
  window_end: string | null;
  expires_at: string;
  status: string;
  state: "asked" | "confirmed" | "proposed_new_date" | "declined" | "expired" | "cancelled";
  response_date: string | null;
  responder_name: string | null;
  response_note: string | null;
  responded_at: string | null;
  email_status: string;
  needs_call: boolean;
  created_by_name: string | null;
};
type ListResult = {
  requests: ConfirmRow[];
  can_send: boolean;
  counts: { asked: number; confirmed: number; needs_call: number };
};

/** One request as a line the member reads. */
export function confirmLine(r: ConfirmRow): string {
  const asked = dateSpan(r.asked_date, r.window_end);
  const noun = ASK_NOUN[r.ask_kind];
  const by = r.responder_name ? ` (${r.responder_name})` : "";
  const state =
    r.state === "confirmed"
      ? `confirmed ${noun} ${asked}${by}`
      : r.state === "proposed_new_date"
        ? `proposed ${shortDate(r.response_date)} instead of ${asked}${by}. Needs the super's or PM's call; the look-ahead still shows ${asked}`
        : r.state === "declined"
          ? `can't make ${noun} ${asked}${by}. Needs the super's or PM's call`
          : r.state === "expired"
            ? `no answer, link expired (asked for ${asked})`
            : r.state === "cancelled"
              ? `cancelled (asked for ${asked})`
              : `waiting on them for ${noun} ${asked}${r.email_status === "sent" ? "" : ", email not sent"}`;
  const note = r.response_note ? ` · their note: ${r.response_note}` : "";
  return `- ${r.party_name} <${r.party_email}> · ${r.what}: ${state}${note} · request ${r.id}`;
}

/** The link's end: the member's days (default 14), and never before the day after the date asked. Capped at 30. */
export function linkExpiry(now: Date, asked: string, days?: number): Date {
  const want = now.getTime() + (days ?? CONFIRM_DEFAULT_DAYS) * 86_400_000;
  const afterAsked = new Date(`${asked}T23:59:59Z`).getTime() + 86_400_000;
  const cap = now.getTime() + CONFIRM_MAX_DAYS * 86_400_000;
  return new Date(Math.min(Math.max(want, afterAsked), cap));
}

export const LOOKAHEAD_CONFIRM_RULE =
  " To have a supplier lock in a delivery date or a sub lock in a crew start or work date on the look-ahead, use lookahead_confirm: action send with the line (item_id from lookahead_get, or activity_id), the party's name and email and the date. Show the member who gets the email and what it asks, and pass confirmed true only after they say yes. Use action list for where each request stands. A proposed new date never moves the look-ahead; it waits for the super's or PM's call.";

export const lookaheadConfirm = defineTool({
  name: "lookahead_confirm",
  title: "Look-ahead date confirmations",
  description:
    "Emails a supplier or a sub a private link to confirm a two-week look-ahead date (a supplier's delivery, a sub's crew start or work date), lists where each request stands, and cancels an unanswered one. Their answer comes back as a field notice to the job's PM and supers. A proposed new date does not move the look-ahead.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    action: z.enum(["list", "send", "cancel"]),
    lookahead_ref: z.string().trim().min(1).max(64).optional(),
    item_id: z.string().uuid().optional(),
    activity_id: z.string().trim().min(1).max(80).optional(),
    party_kind: z.enum(PARTY_KINDS).optional(),
    party_name: z.string().trim().min(2).max(120).optional(),
    party_email: z.string().trim().email().max(320).optional(),
    ask_kind: z.enum(ASK_KINDS).optional(),
    what: z.string().trim().min(2).max(200).optional(),
    date: z.iso.date().optional(),
    window_end: z.iso.date().optional(),
    days: z.number().int().min(1).max(CONFIRM_MAX_DAYS).optional(),
    request_id: z.string().uuid().optional(),
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
      "lookahead_confirm",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id);
        const head = `${named(job)} · Look-ahead date confirmations`;

        if (args.action === "list") {
          const la = args.lookahead_ref ? await lookaheadForJob(sb, job, args.lookahead_ref) : null;
          const l = await rpc<ListResult>(sb, "mcp_lookahead_confirms_list", {
            _job: job.job_id,
            _lookahead: la?.id ?? null,
          });
          const calls = l.requests.filter((r) => r.needs_call);
          const lines = [
            `${head}${la ? ` · ${lookaheadRef(la.id)}` : ""}`,
            l.requests.length
              ? `${l.counts.confirmed} confirmed, ${l.counts.asked} waiting, ${l.counts.needs_call} need a call.`
              : "No supplier or sub has been asked to confirm a date yet.",
            ...(calls.length
              ? ["", "Needs the super's or PM's call:", ...calls.map(confirmLine)]
              : []),
            ...(l.requests.length > calls.length
              ? ["", "All requests:", ...l.requests.filter((r) => !r.needs_call).map(confirmLine)]
              : []),
          ];
          return guide(
            { ...text(lines.join("\n")), structuredContent: l as unknown as JsonValueInput },
            "A proposed date or a can't make it is the super's or PM's call. Don't change the look-ahead or the schedule unless the member asks.",
          );
        }

        if (job.scope === "contract")
          throw new ToolError(
            "Only the job's PM, a super on the job or a member with full access can send or cancel date confirmations. Nothing changed.",
          );

        if (args.action === "cancel") {
          if (!args.request_id)
            throw new ToolError("Which request? Use list to get its request id. Nothing changed.");
          if (args.confirmed !== true)
            throw new ToolError(
              "Ask the member to confirm taking this request back. Its link stops working. Nothing changed.",
            );
          const r = await rpc<ConfirmRow>(sb, "mcp_lookahead_confirm_cancel", {
            _job: job.job_id,
            _id: args.request_id,
          });
          await audit(sb, job, "lookahead_confirm", "cancel", r.id);
          return text(
            `${head}\nCancelled the request to ${r.party_name}. Their link no longer works.`,
          );
        }

        // send
        if (!args.party_kind || !args.party_name || !args.party_email)
          throw new ToolError(
            "Say whether it's a supplier or a sub, and give their company name and email. Nothing was sent.",
          );
        const ask: AskKind =
          args.ask_kind ?? (args.party_kind === "supplier" ? "delivery" : "start");
        if (!askAllowed(args.party_kind, ask))
          throw new ToolError(
            "A supplier confirms a delivery date. A sub confirms a crew start or a work date. Nothing was sent.",
          );
        const la = await lookaheadForJob(sb, job, args.lookahead_ref ?? "latest");
        let what = args.what ?? null;
        let date = args.date ?? null;
        if (args.item_id) {
          const { data, error } = await sb
            .from("mcp_open_items")
            .select("id, action, needed_by, due_date")
            .eq("job_id", job.job_id)
            .eq("id", args.item_id)
            .maybeSingle();
          if (error) dbError(error);
          const it = data as {
            action: string;
            needed_by?: string | null;
            due_date?: string | null;
          } | null;
          if (!it)
            throw new ToolError(
              "That look-ahead line isn't on this job. Use an item id from lookahead_get. Nothing was sent.",
            );
          what ??= itemName(it.action);
          date ??= (it.needed_by ?? it.due_date ?? null)?.slice(0, 10) ?? null;
        } else if (args.activity_id) {
          const d = await lookaheadData(sb, job, la);
          const a = d.acts.find((x) => x.id === args.activity_id);
          if (!a)
            throw new ToolError(
              "That activity isn't in the saved schedule for this job. Use an activity id from lookahead_get. Nothing was sent.",
            );
          what ??= activityTitle(a);
          date ??= a.start?.slice(0, 10) ?? null;
        }
        if (!what)
          throw new ToolError(
            "Say what they are confirming, like delivery of switchgear or crew start for level 2 drywall. Nothing was sent.",
          );
        if (!date) throw new ToolError("Give the date to confirm. Nothing was sent.");
        const today = todayIn(await jobTimeZone(sb, job.job_id));
        if (date < today)
          throw new ToolError(`${date} has passed. Pick a date from today on. Nothing was sent.`);
        const noun = ASK_NOUN[ask];
        const when = dateSpan(date, args.window_end);

        if (args.confirmed !== true)
          throw new ToolError(
            `Show the member exactly this, then ask them to confirm: Athena will email ${args.party_name} <${args.party_email}> from their company's name a private link to confirm ${noun} ${when} for "${what}" on ${named(job)}. The page shows the job's name, what is being confirmed and the date; no costs. ${args.party_name} can confirm, propose another date or say they can't make it, and the answer comes back to the job's PM and supers. Call again with the same details and confirmed true only after they say yes. Nothing was sent.`,
          );

        const token = newToken();
        const expires = linkExpiry(new Date(), date, args.days);
        const r = await rpc<ConfirmRow & { job_number: string; job_name: string; company: string }>(
          sb,
          "mcp_lookahead_confirm_create",
          {
            _job: job.job_id,
            _lookahead: la.id,
            _item: args.item_id ?? null,
            _activity: args.item_id ? null : (args.activity_id ?? null),
            _party_kind: args.party_kind,
            _party_name: args.party_name,
            _party_email: args.party_email,
            _ask_kind: ask,
            _what: what,
            _asked_date: date,
            _window_end: args.window_end ?? null,
            _token_hash: await tokenHash(token),
            _expires_at: expires.toISOString(),
          },
        );
        await audit(sb, job, "lookahead_confirm", "send", r.id);
        const link = confirmUrl(token);
        const sent = portalEmailEnabled()
          ? await sendPortalEmail(
              confirmRequestEmail({
                to: r.party_email,
                partyName: r.party_name,
                partyKind: r.party_kind,
                askKind: r.ask_kind,
                company: r.company,
                logo: await companyLogoUrl(sb, job.company_id),
                jobNumber: r.job_number,
                jobName: r.job_name,
                what: r.what,
                date: r.asked_date,
                windowEnd: r.window_end,
                sender: r.created_by_name,
                link,
                expires: longDate(expires.toISOString()),
                requestId: r.id,
              }),
            )
          : ("off" as const);
        await rpc(sb, "mcp_lookahead_confirm_email_result", {
          _job: job.job_id,
          _id: r.id,
          _status: sent,
        }).catch(() => null);
        return guide(
          {
            ...text(
              [
                head,
                sent === "sent"
                  ? `Emailed ${r.party_name} <${r.party_email}> to confirm ${noun} ${when} for ${r.what}.`
                  : `The request to ${r.party_name} <${r.party_email}> is saved, but the email didn't go out${sent === "off" ? " (email to suppliers and subs is off)" : ""}. Their link: ${link}`,
                `The link works until ${longDate(expires.toISOString())}. Their answer comes back to the job's PM and the supers on the job.`,
              ].join("\n"),
            ),
            structuredContent: {
              request_id: r.id,
              party_email: r.party_email,
              asked_date: r.asked_date,
              window_end: r.window_end,
              email_sent: sent === "sent",
              expires_at: expires.toISOString(),
              ...(sent === "sent" ? {} : { link }),
            } as unknown as JsonValueInput,
          },
          sent === "sent"
            ? "Tell the member the request went out. Do not send the link yourself."
            : "Tell the member the email didn't go out and give them the link to pass on themselves. Do not send it yourself.",
        );
      },
    ),
});
