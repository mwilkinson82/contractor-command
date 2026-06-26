import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as React from "react";
import { render } from "@react-email/components";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TEMPLATES } from "@/lib/email-templates/registry";

// Must match SENDER_DOMAIN / FROM_DOMAIN in
// src/routes/lovable/email/transactional/send.ts
const SITE_NAME = "Contractor Circle";
const SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
const FROM_DOMAIN = "notify.mail.alpcontractorcircle.com";
const TEMPLATE_NAME = "member-announcement";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Audience = "active" | "all_with_login" | "circle" | "circle_inactive" | "test";

interface Recipient {
  email: string;
  firstName: string | null;
}

// Tiers that count as "Contractor Circle membership". Bi-weekly Circle calls
// are open to circle + hardcore subscribers (hardcore is a strict superset).
const CIRCLE_TIERS = new Set(["circle", "hardcore"]);

// Returns a Set of lowercased emails for users who have logged in at least once.
// Used by the "circle_inactive" audience to skip anyone who already signed in.
async function loadSignedInEmails(): Promise<Set<string>> {
  const out = new Set<string>();
  let page = 1;
  // perPage max is 1000 in supabase-js admin.listUsers.
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const u of data.users) {
      if (u.last_sign_in_at && u.email) out.add(u.email.toLowerCase());
    }
    if (data.users.length < 1000) break;
    page += 1;
    if (page > 20) break; // safety cap
  }
  return out;
}

async function loadRecipients(audience: Audience, testEmail?: string): Promise<Recipient[]> {
  if (audience === "test") {
    if (!testEmail) throw new Error("testEmail required");
    return [{ email: testEmail, firstName: null }];
  }

  // Pull profiles + subscriptions; keep anyone with a portal account (profile),
  // plus subscription rows without a profile yet (paid but never logged in).
  const [{ data: profiles }, { data: subs }, { data: roles }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id,email,full_name"),
    supabaseAdmin.from("subscriptions").select("user_id,email,status,is_comped,tier"),
    supabaseAdmin.from("user_roles").select("user_id,role"),
  ]);

  const adminIds = new Set((roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id));

  type SubRow = NonNullable<typeof subs>[number];
  // A user can have multiple subscription rows (e.g. AOS add-on + Circle).
  // Track every active sub per identity so the Circle filter sees them all.
  const subsByUserId = new Map<string, SubRow[]>();
  const subsByEmail = new Map<string, SubRow[]>();
  for (const s of subs ?? []) {
    if (s.user_id) {
      const list = subsByUserId.get(s.user_id) ?? [];
      list.push(s);
      subsByUserId.set(s.user_id, list);
    }
    if (s.email) {
      const key = s.email.toLowerCase();
      const list = subsByEmail.get(key) ?? [];
      list.push(s);
      subsByEmail.set(key, list);
    }
  }

  const isActive = (sub: SubRow) =>
    sub.is_comped || sub.status === "active" || sub.status === "trialing";

  const hasAccess = (subList: SubRow[], userId: string | null) => {
    if (userId && adminIds.has(userId)) return true;
    return subList.some(isActive);
  };

  const hasCircleTier = (subList: SubRow[], userId: string | null) => {
    if (userId && adminIds.has(userId)) return true;
    return subList.some((s) => isActive(s) && s.tier && CIRCLE_TIERS.has(s.tier));
  };

  const out = new Map<string, Recipient>();

  for (const p of profiles ?? []) {
    if (!p.email) continue;
    const key = p.email.toLowerCase();
    const subList = [
      ...(subsByUserId.get(p.id) ?? []),
      ...(subsByEmail.get(key) ?? []),
    ];
    let include: boolean;
    if (audience === "all_with_login") include = true;
    else if (audience === "circle") include = hasCircleTier(subList, p.id);
    else include = hasAccess(subList, p.id);
    if (!include) continue;
    const firstName = (p.full_name ?? "").trim().split(/\s+/)[0] || null;
    out.set(key, { email: p.email, firstName });
  }

  // Paid subscriptions that never created a portal account
  for (const s of subs ?? []) {
    if (!s.email) continue;
    const key = s.email.toLowerCase();
    if (out.has(key)) continue;
    const subList = subsByEmail.get(key) ?? [s];
    if (audience === "active" && !hasAccess(subList, s.user_id ?? null)) continue;
    if (audience === "circle" && !hasCircleTier(subList, s.user_id ?? null)) continue;
    out.set(key, { email: s.email, firstName: null });
  }

  return [...out.values()];
}

const InputSchema = z.object({
  subject: z.string().min(1).max(255),
  headline: z.string().min(1).max(160),
  preheader: z.string().max(200).optional(),
  body: z.string().min(1).max(8000),
  ctaLabel: z.string().max(60).optional(),
  ctaUrl: z.string().url().max(500).optional(),
  signoff: z.string().max(120).optional(),
  audience: z.enum(["active", "all_with_login", "circle", "test"]),
  testEmail: z.string().email().optional(),
});

export const previewMemberAnnouncementAudience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ audience: z.enum(["active", "all_with_login", "circle"]) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const recipients = await loadRecipients(data.audience);
    return { count: recipients.length };
  });

export const sendMemberAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);

    const recipients = await loadRecipients(data.audience, data.testEmail);
    if (recipients.length === 0) {
      return { queued: 0, sent: 0, suppressed: 0, failed: 0, total: 0 };
    }

    // One announcement id ties every send together for idempotency + audit.
    const announcementId = crypto.randomUUID();

    // Persist a copy of the composed announcement so the form can always
    // re-load the last thing we sent (real or test). This is the safety net
    // against losing a draft when the preview/browser blows up.
    await supabaseAdmin.from("member_announcements").insert({
      announcement_id: announcementId,
      sent_by: context.userId,
      audience: data.audience,
      subject: data.subject,
      headline: data.headline,
      preheader: data.preheader ?? null,
      body: data.body,
      cta_label: data.ctaLabel ?? null,
      cta_url: data.ctaUrl ?? null,
      signoff: data.signoff ?? null,
      recipient_count: recipients.length,
      was_test: data.audience === "test",
    });

    // Bulk-load suppression list once.
    const emails = recipients.map((r) => r.email.toLowerCase());
    const { data: suppressedRows } = await supabaseAdmin
      .from("suppressed_emails")
      .select("email")
      .in("email", emails);
    const suppressedSet = new Set((suppressedRows ?? []).map((s) => s.email.toLowerCase()));

    let queued = 0;
    let sent = 0;
    let suppressed = 0;
    let failed = 0;
    const directTestSend = data.audience === "test";

    for (const r of recipients) {
      const emailLower = r.email.toLowerCase();
      if (suppressedSet.has(emailLower)) {
        suppressed += 1;
        await supabaseAdmin.from("email_send_log").insert({
          message_id: crypto.randomUUID(),
          template_name: TEMPLATE_NAME,
          recipient_email: r.email,
          status: "suppressed",
          metadata: {
            announcement_id: announcementId,
            channel: directTestSend ? "admin_announcement_test" : "admin_announcement",
            send_method: directTestSend ? "direct_lovable" : "pgmq_transactional",
            reason: "suppressed_email",
          },
        });
        continue;
      }

      try {
        // Ensure unsubscribe token (one per email).
        let unsubscribeToken: string;
        const { data: existing } = await supabaseAdmin
          .from("email_unsubscribe_tokens")
          .select("token,used_at")
          .eq("email", emailLower)
          .maybeSingle();

        if (existing && !existing.used_at) {
          unsubscribeToken = existing.token;
        } else if (!existing) {
          const newToken = generateToken();
          await supabaseAdmin
            .from("email_unsubscribe_tokens")
            .upsert(
              { token: newToken, email: emailLower },
              { onConflict: "email", ignoreDuplicates: true },
            );
          const { data: stored } = await supabaseAdmin
            .from("email_unsubscribe_tokens")
            .select("token")
            .eq("email", emailLower)
            .maybeSingle();
          if (!stored) throw new Error("unsubscribe token lookup failed");
          unsubscribeToken = stored.token;
        } else {
          // token already used → email should already be suppressed; skip.
          suppressed += 1;
          await supabaseAdmin.from("email_send_log").insert({
            message_id: crypto.randomUUID(),
            template_name: TEMPLATE_NAME,
            recipient_email: r.email,
            status: "suppressed",
            error_message: "Unsubscribe token used",
            metadata: {
              announcement_id: announcementId,
              channel: directTestSend ? "admin_announcement_test" : "admin_announcement",
              send_method: directTestSend ? "direct_lovable" : "pgmq_transactional",
              reason: "unsubscribe_token_used",
            },
          });
          continue;
        }

        // Render template per-recipient (firstName varies).
        const entry = TEMPLATES[TEMPLATE_NAME];
        const props = {
          firstName: r.firstName ?? undefined,
          headline: data.headline,
          preheader: data.preheader,
          body: data.body,
          ctaLabel: data.ctaLabel,
          ctaUrl: data.ctaUrl,
          signoff: data.signoff,
        };
        const element = React.createElement(entry.component, props);
        const html = await render(element);
        const plainText = await render(element, { plainText: true });

        const messageId = crypto.randomUUID();
        const idempotencyKey = `announce-${announcementId}-${emailLower}`;

        await supabaseAdmin.from("email_send_log").insert({
          message_id: messageId,
          template_name: TEMPLATE_NAME,
          recipient_email: r.email,
          status: "pending",
          metadata: {
            announcement_id: announcementId,
            channel: directTestSend ? "admin_announcement_test" : "admin_announcement",
            send_method: directTestSend ? "direct_lovable" : "pgmq_transactional",
          },
        });

        if (directTestSend) {
          const apiKey = process.env.LOVABLE_API_KEY;

          if (!apiKey) {
            failed += 1;
            await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: TEMPLATE_NAME,
              recipient_email: r.email,
              status: "failed",
              error_message: "LOVABLE_API_KEY missing",
              metadata: {
                announcement_id: announcementId,
                channel: "admin_announcement_test",
                send_method: "direct_lovable",
                reason: "lovable_api_key_missing",
              },
            });
            continue;
          }

          try {
            await sendLovableEmail(
              {
                to: r.email,
                from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
                sender_domain: SENDER_DOMAIN,
                subject: data.subject,
                html,
                text: plainText,
                purpose: "transactional",
                label: TEMPLATE_NAME,
                idempotency_key: idempotencyKey,
                unsubscribe_token: unsubscribeToken,
                message_id: messageId,
              },
              { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
            );

            await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: TEMPLATE_NAME,
              recipient_email: r.email,
              status: "sent",
              metadata: {
                announcement_id: announcementId,
                channel: "admin_announcement_test",
                send_method: "direct_lovable",
              },
            });
            sent += 1;
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            failed += 1;
            await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: TEMPLATE_NAME,
              recipient_email: r.email,
              status: "failed",
              error_message: errorMessage.slice(0, 1000),
              metadata: {
                announcement_id: announcementId,
                channel: "admin_announcement_test",
                send_method: "direct_lovable",
              },
            });
            console.error("announce test send failed", {
              email: r.email,
              error: errorMessage,
            });
          }

          continue;
        }

        const { error: enqueueError } = await supabaseAdmin.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            message_id: messageId,
            to: r.email,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject: data.subject,
            html,
            text: plainText,
            purpose: "transactional",
            label: TEMPLATE_NAME,
            idempotency_key: idempotencyKey,
            unsubscribe_token: unsubscribeToken,
            queued_at: new Date().toISOString(),
          },
        });

        if (enqueueError) {
          failed += 1;
          await supabaseAdmin.from("email_send_log").insert({
            message_id: messageId,
            template_name: TEMPLATE_NAME,
            recipient_email: r.email,
            status: "failed",
            error_message: enqueueError.message,
            metadata: {
              announcement_id: announcementId,
              channel: "admin_announcement",
              send_method: "pgmq_transactional",
            },
          });
          continue;
        }

        queued += 1;
      } catch (err) {
        failed += 1;
        console.error("announce enqueue failed", {
          email: r.email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      total: recipients.length,
      queued,
      sent,
      suppressed,
      failed,
      announcementId,
    };
  });

export const getLastMemberAnnouncement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("member_announcements")
      .select(
        "subject,headline,preheader,body,cta_label,cta_url,signoff,audience,was_test,recipient_count,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { announcement: data ?? null };
  });
