import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as React from "react";
import { render } from "@react-email/components";
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

type Audience = "active" | "all_with_login" | "test";

interface Recipient {
  email: string;
  firstName: string | null;
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
    supabaseAdmin
      .from("subscriptions")
      .select("user_id,email,status,is_comped"),
    supabaseAdmin.from("user_roles").select("user_id,role"),
  ]);

  const adminIds = new Set(
    (roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id),
  );

  type SubRow = NonNullable<typeof subs>[number];
  const subByUserId = new Map<string, SubRow>();
  const subByEmail = new Map<string, SubRow>();
  for (const s of subs ?? []) {
    if (s.user_id) subByUserId.set(s.user_id, s);
    if (s.email) subByEmail.set(s.email.toLowerCase(), s);
  }

  const hasAccess = (sub: SubRow | undefined, userId: string | null) => {
    if (userId && adminIds.has(userId)) return true;
    if (!sub) return false;
    if (sub.is_comped) return true;
    return sub.status === "active" || sub.status === "trialing";
  };

  const out = new Map<string, Recipient>();

  for (const p of profiles ?? []) {
    if (!p.email) continue;
    const key = p.email.toLowerCase();
    const sub =
      subByUserId.get(p.id) ?? subByEmail.get(key) ?? undefined;
    const include =
      audience === "all_with_login" ? true : hasAccess(sub, p.id);
    if (!include) continue;
    const firstName = (p.full_name ?? "").trim().split(/\s+/)[0] || null;
    out.set(key, { email: p.email, firstName });
  }

  // Paid subscriptions that never created a portal account
  for (const s of subs ?? []) {
    if (!s.email) continue;
    const key = s.email.toLowerCase();
    if (out.has(key)) continue;
    if (audience === "active" && !hasAccess(s, s.user_id ?? null)) continue;
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
  audience: z.enum(["active", "all_with_login", "test"]),
  testEmail: z.string().email().optional(),
});

export const previewMemberAnnouncementAudience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ audience: z.enum(["active", "all_with_login"]) })
      .parse(input),
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
      return { queued: 0, suppressed: 0, failed: 0, total: 0 };
    }

    // One announcement id ties every send together for idempotency + audit.
    const announcementId = crypto.randomUUID();

    // Bulk-load suppression list once.
    const emails = recipients.map((r) => r.email.toLowerCase());
    const { data: suppressedRows } = await supabaseAdmin
      .from("suppressed_emails")
      .select("email")
      .in("email", emails);
    const suppressedSet = new Set(
      (suppressedRows ?? []).map((s) => s.email.toLowerCase()),
    );

    let queued = 0;
    let suppressed = 0;
    let failed = 0;

    for (const r of recipients) {
      const emailLower = r.email.toLowerCase();
      if (suppressedSet.has(emailLower)) {
        suppressed += 1;
        await supabaseAdmin.from("email_send_log").insert({
          message_id: crypto.randomUUID(),
          template_name: TEMPLATE_NAME,
          recipient_email: r.email,
          status: "suppressed",
          metadata: { announcement_id: announcementId },
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
          metadata: { announcement_id: announcementId },
        });

        const { error: enqueueError } = await supabaseAdmin.rpc(
          "enqueue_email",
          {
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
          },
        );

        if (enqueueError) {
          failed += 1;
          await supabaseAdmin.from("email_send_log").insert({
            message_id: messageId,
            template_name: TEMPLATE_NAME,
            recipient_email: r.email,
            status: "failed",
            error_message: enqueueError.message,
            metadata: { announcement_id: announcementId },
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
      suppressed,
      failed,
      announcementId,
    };
  });
