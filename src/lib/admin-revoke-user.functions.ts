import { createServerFn } from "@tanstack/react-start";
import * as React from "react";
import { render } from "@react-email/components";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { template as memberAnnouncement } from "@/lib/email-templates/member-announcement";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
}

/**
 * One-off: delete jtorres auth user (never activated) and send apology email.
 * Safe to re-run — both steps are idempotent-ish.
 */
export const revokeMistakenInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; firstName?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const email = data.email.toLowerCase();

    // 1) Find + delete the auth user (only if not yet confirmed/signed in)
    let deleted = false;
    let deleteSkippedReason: string | null = null;
    const perPage = 200;
    outer: for (let page = 1; page <= 25; page++) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      for (const u of list?.users ?? []) {
        if ((u.email ?? "").toLowerCase() === email) {
          if (u.last_sign_in_at || u.email_confirmed_at) {
            deleteSkippedReason = "user has already signed in or confirmed — not deleting";
          } else {
            const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
            if (delErr) throw delErr;
            deleted = true;
          }
          break outer;
        }
      }
      if ((list?.users ?? []).length < perPage) break;
    }

    // 2) Render apology email and enqueue via existing queue
    const props = {
      firstName: data.firstName,
      preheader: "Quick note about an invite from Contractor Circle",
      headline: "Sent in error — please disregard",
      body: `I'm reaching out personally about an invite email you may have received from the ALP Contractor Circle portal.

That invite was sent in error on our end — it was meant for a different account and went out to you by mistake. Please disregard it. The link has been deactivated, so there's nothing you need to do.

Apologies for the confusion, and thanks for your patience.`,
      signoff: "— Marshall",
    };
    const subject = "Please disregard — Contractor Circle invite sent in error";
    const element = React.createElement(memberAnnouncement.component, props);
    const html = await render(element);
    const text = await render(element, { plainText: true });

    const messageId = crypto.randomUUID();
    const SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
    const FROM_DOMAIN = SENDER_DOMAIN;

    // create unsubscribe token if needed
    const { data: existingTok } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("token")
      .eq("email", email)
      .maybeSingle();
    let unsubscribeToken = existingTok?.token as string | undefined;
    if (!unsubscribeToken) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      unsubscribeToken = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      await supabaseAdmin
        .from("email_unsubscribe_tokens")
        .upsert({ token: unsubscribeToken, email }, { onConflict: "email", ignoreDuplicates: true });
      const { data: stored } = await supabaseAdmin
        .from("email_unsubscribe_tokens")
        .select("token")
        .eq("email", email)
        .maybeSingle();
      unsubscribeToken = (stored?.token as string) ?? unsubscribeToken;
    }

    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: "mistaken-invite-apology",
      recipient_email: email,
      status: "pending",
    });

    const { error: enqErr } = await supabaseAdmin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        message_id: messageId,
        to: email,
        from: `AOS <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: "transactional",
        label: "mistaken-invite-apology",
        idempotency_key: `mistaken-invite-${email}`,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    });
    if (enqErr) throw enqErr;

    return { deleted, deleteSkippedReason, emailQueued: true, messageId };
  });
