import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { render } from "@react-email/components";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { template as memberAnnouncement } from "@/lib/email-templates/member-announcement";

// One-off admin endpoint: delete an unconfirmed auth user and send an
// apology email saying the invite was sent in error. Gated by AOS_SHARED_SECRET.
// Intended to be invoked once, then this file can be deleted.

const SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";

export const Route = createFileRoute("/api/public/_one-off-revoke-mistaken-invite")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-admin-token");
        if (!token || token !== process.env.AOS_SHARED_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as {
          email?: string;
          firstName?: string;
        };
        const email = (body.email || "").toLowerCase().trim();
        if (!email) return new Response("email required", { status: 400 });

        // 1) Find + delete the auth user only if not yet confirmed/signed in
        let deleted = false;
        let skipped: string | null = null;
        const perPage = 200;
        outer: for (let page = 1; page <= 25; page++) {
          const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
          if (error) return Response.json({ error: error.message }, { status: 500 });
          for (const u of list?.users ?? []) {
            if ((u.email ?? "").toLowerCase() === email) {
              if (u.last_sign_in_at || (u as any).email_confirmed_at) {
                skipped = "user already signed in or confirmed";
              } else {
                const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
                if (delErr) return Response.json({ error: delErr.message }, { status: 500 });
                deleted = true;
              }
              break outer;
            }
          }
          if ((list?.users ?? []).length < perPage) break;
        }

        // 2) Render + enqueue apology email
        const props = {
          firstName: body.firstName,
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

        // unsubscribe token (one per email)
        let unsubscribeToken: string;
        const { data: existingTok } = await supabaseAdmin
          .from("email_unsubscribe_tokens")
          .select("token")
          .eq("email", email)
          .maybeSingle();
        if (existingTok?.token) {
          unsubscribeToken = existingTok.token as string;
        } else {
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

        const messageId = crypto.randomUUID();
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
            from: `AOS <noreply@${SENDER_DOMAIN}>`,
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
        if (enqErr) return Response.json({ error: enqErr.message }, { status: 500 });

        return Response.json({ ok: true, deleted, skipped, messageId });
      },
    },
  },
});
