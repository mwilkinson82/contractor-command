// 0.8.16: team management for owners. Owner-only, seat caps and plan role gating are enforced by the database
// functions (mcp_team_*); the host only collects choices. Every write needs confirmed: true after a yes/no.
// ChatGPT renders the selection card (TEAM_WIDGET_URI); Claude, Codex and Grok Bot get a numbered list + text confirm.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text, type Sb } from "../guard";
import { resolveCompany } from "../jobs";
import { guide } from "../visible";
import { ROLE_LABEL, SEAT_LIMIT_MESSAGE, TEAM_WIDGET_MIME, TEAM_WIDGET_URI, confirmLine, normalizeRole, renderTeamList, rolesMenu, seatLimitFromError, seatLine, teamWidgetHtml, type TeamList, type TeamRole } from "../team";
import { buildInviteEmail, sendInvite } from "../team-invite-email";
import { accountLinkCard, accountUrl } from "./account-tools";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";

export const OWNER_ONLY_MESSAGE = "Only a company owner can manage the team. Ask your owner to make this change.";

const companyId = z.string().trim().min(1).max(200).optional();
const confirmed = z.literal(true);
const jobNumbers = z.array(z.string().trim().min(1).max(40)).max(200).optional();
const person = z.string().trim().min(1).max(320);

type RpcErr = { message: string } | null;
async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcErr }> {
  const r = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: RpcErr }>)(fn, args);
  return { data: r.data as T | null, error: r.error };
}
function fail(e: RpcErr): never {
  const m = e?.message ?? "";
  const seat = seatLimitFromError(m);
  if (seat) throw new ToolError(SEAT_LIMIT_MESSAGE(seat.used, seat.limit));
  if (m.includes("Only a company owner")) throw new ToolError(OWNER_ONLY_MESSAGE);
  if (m.startsWith("MCP_BAD:")) throw new ToolError(m.slice(8));
  if (m.includes("MCP_NO_COMPANY")) throw new ToolError("You aren't a member of that company.");
  if (m.includes("MCP_INACTIVE")) throw new ToolError("Your membership isn't active, so Athena is paused. Your job data is saved.");
  throw new Error(m || "database error");
}
async function ownerCompany(sb: Sb, company?: string): Promise<string> {
  const co = await resolveCompany(sb, company);
  const { data, error } = await rpc<boolean>(sb, "mcp_is_company_owner", { _company: co });
  if (error) fail(error);
  if (data !== true) throw new ToolError(OWNER_ONLY_MESSAGE);
  return co;
}
async function list(sb: Sb, co: string): Promise<TeamList> {
  const { data, error } = await rpc<TeamList>(sb, "mcp_team_list", { _company: co });
  if (error) fail(error);
  return data as TeamList;
}
function findMember(t: TeamList, who: string) {
  const w = who.trim().toLowerCase();
  const n = Number(w);
  if (Number.isInteger(n) && n >= 1 && n <= t.members.length) return t.members[n - 1];
  const hits = t.members.filter((m) => m.user_id === w || (m.email ?? "").toLowerCase() === w || m.display_name.trim().toLowerCase() === w);
  if (hits.length > 1) throw new ToolError(`More than one person matches "${who}". Use their email.`);
  return hits[0] ?? null;
}
function role(input?: string): TeamRole | undefined {
  if (!input) return undefined;
  const r = normalizeRole(input);
  if (!r) throw new ToolError("Role must be Owner, PM, All-access, AP, Estimating, Contracts or Super.");
  return r;
}
const widgetMeta = { "openai/outputTemplate": TEAM_WIDGET_URI };
// 0.8.16.1: the card HTML is never put in the result content (Claude, Codex and Grok Bot printed it as text).
// ChatGPT loads the card from TEAM_WIDGET_URI via _meta["openai/outputTemplate"]; teamWidgetHtml() is the resource body.
export const TEAM_WIDGET = { uri: TEAM_WIDGET_URI, mimeType: TEAM_WIDGET_MIME, html: teamWidgetHtml };

export const teamList = defineTool({
  name: "team_list",
  title: "Team: people, roles and jobs",
  description: "Lists the company's people, roles, and seats.",
  inputSchema: { company_id: companyId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("team_list", ctx, {}, async (sb) => {
      const co = await ownerCompany(sb, args.company_id);
      const t = await list(sb, co);
      return guide(
        { ...text(renderTeamList(t)), structuredContent: { team: { ...t, company: co }, roles_menu: rolesMenu(t.roles_allowed) }, _meta: widgetMeta },
        "Card shown. Do not add text; wait for the user's pick. Hosts without the card (Claude, Codex, Grok Bot) already have the numbered list. Do not add a question after it.",
      );
    }),
});

export const teamInvite = defineTool({
  name: "team_invite",
  title: "Invite a person to the team",
  description: "Invites a person to the company team; a job's customer, owner or homeowner is invited with customer_portal instead.",
  inputSchema: {
    company_id: companyId,
    email: z.string().trim().email().max(320),
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(40),
    job_numbers: jobNumbers,
    confirmed,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  handler: (args, ctx) =>
    run("team_invite", ctx, {}, async (sb) => {
      if (args.confirmed !== true) throw new ToolError("Confirm with the owner first. No invite was sent.");
      const r = role(args.role)!;
      const co = await ownerCompany(sb, args.company_id);
      const { data, error } = await rpc<{ id: string; role: TeamRole; seats_used: number; seat_limit: number | null }>(sb, "mcp_team_invite", { _company: co, _email: args.email, _display_name: args.name, _role: r, _jobs: args.job_numbers ?? [] });
      if (error) {
        const seat = seatLimitFromError(error.message);
        if (seat) {
          return guide(
            { ...text(SEAT_LIMIT_MESSAGE(seat.used, seat.limit)), structuredContent: { invited: false, seat_limit_reached: true, seats_used: seat.used, seat_limit: seat.limit } },
            "Tell the owner they're at the seat limit and no invite was sent. Offer to add seats; on a yes, ask how many and call team_add_seats with confirmed true. Never send a payment link yourself.",
          );
        }
        fail(error);
      }
      const co2 = await sb.from("mcp_companies").select("name").eq("id", co).maybeSingle();
      const companyName = (co2.data as { name?: string } | null)?.name ?? "your company";
      const mail = buildInviteEmail({ to: args.email, inviteeName: args.name, ownerName: "Your company owner", companyName, roleLabel: ROLE_LABEL[data!.role] });
      const sent = await sendInvite(mail);
      const note = sent === "sent"
        ? `${args.name} will get an email asking them to sign in at app.meetathena.io.`
        : `Let ${args.name} know to sign in at app.meetathena.io with ${args.email}; they join your team the first time they sign in.`;
      const seats = data!.seat_limit == null ? "" : ` Seats: ${data!.seats_used} of ${data!.seat_limit}.`;
      return guide(
        { ...text(`Invited ${args.name} as ${ROLE_LABEL[data!.role]}. ${note}${seats}`), structuredContent: { invited: true, email_sent: sent === "sent", role: data!.role } },
        "Tell the owner the invite is saved, exactly as written.",
      );
    }),
});

export const teamUpdateMember = defineTool({
  name: "team_update_member",
  title: "Change a person's role or job access",
  description: "Changes a person's company role or which jobs they can open, and never makes anyone a job's PM (for \"make X the PM on job N\", call intake with section job_settings, the job_number and pm instead).",
  inputSchema: { company_id: companyId, person: person.optional(), user_id: z.string().uuid().optional(), role: z.string().trim().min(1).max(40).optional(), job_numbers: jobNumbers, confirmed },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("team_update_member", ctx, {}, async (sb) => {
      if (args.confirmed !== true) throw new ToolError("Confirm with the owner first. Nothing was changed.");
      const r = role(args.role);
      if (!r && !args.job_numbers) throw new ToolError("Say what to change: a role, job access, or both.");
      const co = await ownerCompany(sb, args.company_id);
      const t = await list(sb, co);
      const m = findMember(t, args.user_id ?? args.person ?? "");
      if (!m) throw new ToolError("That person isn't on this team. Nothing was changed.");
      const { data, error } = await rpc<{ before: Record<string, string | string[]> | null; after: { role: TeamRole; jobs: string[] } }>(sb, "mcp_team_update_member", { _company: co, _user: m.user_id, _role: r ?? null, _jobs: args.job_numbers ?? null });
      if (error) fail(error);
      const a = data!.after;
      return guide(
        { ...text(`${m.display_name} is now ${ROLE_LABEL[a.role]}${a.jobs.length ? ` with access to jobs ${a.jobs.join(", ")}` : ""}.`), structuredContent: { updated: true, before: data!.before, after: a } },
        "Tell the owner the change is saved.",
      );
    }),
});

export const teamRemoveMember = defineTool({
  name: "team_remove_member",
  title: "Remove a person from the team",
  description: "Removes a person from the company.",
  inputSchema: { company_id: companyId, person, confirmed },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("team_remove_member", ctx, {}, async (sb) => {
      if (args.confirmed !== true) throw new ToolError("Confirm with the owner first. Nothing was changed.");
      const co = await ownerCompany(sb, args.company_id);
      const t = await list(sb, co);
      const m = findMember(t, args.person);
      const pend = !m ? t.pending.find((p) => p.email.toLowerCase() === args.person.trim().toLowerCase()) : undefined;
      if (!m && !pend) throw new ToolError("That person isn't on this team. Nothing was changed.");
      const { error } = await rpc(sb, "mcp_team_remove_member", { _company: co, _user: m?.user_id ?? null, _email: pend?.email ?? null });
      if (error) fail(error);
      return guide(
        { ...text(m ? `${m.display_name} was removed from your team. Their job history stays.` : `The invite for ${pend!.email} was cancelled.`), structuredContent: { removed: true } },
        "Tell the owner it's done.",
      );
    }),
});

// Nov 2026: seats are bought on the owner's Athena account page (Team & access > Add seats), never in chat.
// ChatGPT and Claude directory rules keep payment for digital subscriptions out of the conversation, so this tool
// only checks the caller owns the company and hands back the account page link. No Stripe call from chat.
export const teamAddSeats = defineTool({
  name: "team_add_seats",
  title: "Add seats",
  description:
    "Gives the company owner the account page link where they add seats.",
  inputSchema: {
    company_id: companyId,
    seats: z.number().int().min(1).max(500).optional(),
    confirmed: z.literal(true).optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("team_add_seats", ctx, {}, async (sb) => {
      await ownerCompany(sb, args.company_id);
      const url = accountUrl("team");
      const card = accountLinkCard("team");
      const n = args.seats;
      const lead = `To add ${n ? `${n} seat${n === 1 ? "" : "s"}` : "seats"}, open Team & access on your Athena account page and choose Add seats. Price and payment are on that page.`;
      return guide(
        { ...text(`${lead}\n\n${renderMarkdown(card)}`), structuredContent: { url, section: "team", seats: n ?? null, checkout: null, card, html: renderHtml(card) } },
        "Give the account page link. Payment happens only on that page.",
      );
    }),
});

export const setCurrentCompany = defineTool({
  name: "set_current_company",
  title: "Set my current company",
  description: "Sets which company to use when the member belongs to more than one.",
  inputSchema: { company_id: z.string().trim().min(1).max(200) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("set_current_company", ctx, {}, async (sb) => {
      const co = await resolveCompany(sb, args.company_id);
      const { error } = await rpc(sb, "mcp_set_current_company", { _company: co });
      if (error) fail(error);
      return guide({ ...text(`Done. Athena will use ${args.company_id} unless you name another company.`), structuredContent: { current_company: co } }, "Tell the member it's saved.");
    }),
});

export { confirmLine, seatLine };
