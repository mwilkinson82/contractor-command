import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { billingConfig } from "@/lib/athena-billing";
import { ROLE_LABEL, type TeamList } from "@/lib/mcp/team";
import { buildInviteEmail, inviteEnabled, sendInvite } from "@/lib/mcp/team-invite-email";

// v0.8.22: tells /account whether seat checkout is switched on. Read-only: it never creates a payment session.
// Nov 2026: also says whether invite emails are switched on, so the page never promises an email that won't go out.
export const getSeatPurchaseStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async (): Promise<{ checkoutEnabled: boolean; inviteEmailEnabled: boolean }> => ({
      checkoutEnabled: billingConfig().checkoutEnabled,
      inviteEmailEnabled: inviteEnabled(),
    }),
  );

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type InviteEmailResult = { status: "sent" | "off" | "failed" | "not_found" | "not_owner" };

/**
 * Emails a saved team invite (after Save invite, or Resend on a waiting invite). The caller must own the company,
 * and the email must be one of that company's waiting invites, so this can never mail an arbitrary address.
 * The invite itself is saved by mcp_team_invite; this only sends the email. Same sender and kill switch as the
 * team_invite chat tool.
 */
export const sendTeamInviteEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ companyId: z.string().uuid(), email: z.string().trim().email().max(320) }).parse,
  )
  .handler(async ({ data, context }): Promise<InviteEmailResult> => {
    const sb = context.supabase as unknown as {
      rpc: Rpc;
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
        };
      };
    };
    const owner = await sb.rpc("mcp_is_company_owner", { _company: data.companyId });
    if (owner.error || owner.data !== true) return { status: "not_owner" };
    const list = await sb.rpc("mcp_team_list", { _company: data.companyId });
    if (list.error || !list.data) return { status: "failed" };
    const team = list.data as TeamList;
    const wanted = data.email.toLowerCase();
    const invite = team.pending.find((p) => p.email.toLowerCase() === wanted);
    if (!invite) return { status: "not_found" };
    const me = team.members.find((m) => m.user_id === context.userId);
    const profile = await sb
      .from("profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();
    const fullName = (profile.data as { full_name?: string | null } | null)?.full_name?.trim();
    const listed = me?.display_name?.trim();
    const co = await sb.from("mcp_companies").select("name").eq("id", data.companyId).maybeSingle();
    const companyName = (co.data as { name?: string } | null)?.name ?? "your company";
    const mail = buildInviteEmail({
      to: invite.email,
      inviteeName: invite.display_name,
      ownerName: fullName || (listed && listed !== "Owner" ? listed : "") || "Your company owner",
      companyName,
      roleLabel: ROLE_LABEL[invite.role] ?? invite.role,
    });
    return { status: await sendInvite(mail) };
  });
