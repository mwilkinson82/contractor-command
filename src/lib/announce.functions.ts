import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as React from "react";
import { render } from "@react-email/components";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { MEMBER_REPLY_TO } from "@/lib/email/reply-to";
import { loadMemberControlRowsForAdmin } from "@/lib/control-admin.functions";

import { circleDecision, loadCircleAudience } from "@/lib/membership/circle.server";
import { circleAnnouncementAllowed } from "@/lib/membership/announcement-guard.server";
import { shouldSkipResendCapture } from "@/lib/resend/never-email";
import {
  assertCircleAudienceReviewed,
  isCircleAnnouncementAudience,
  previewCircleAnnouncementAudience,
} from "@/lib/membership/announcement-audience.server";
import type { CircleAnnouncementAudience } from "@/lib/membership/announcement-audience.server";

// Must match SENDER_DOMAIN / FROM_DOMAIN in
// src/routes/lovable/email/transactional/send.ts
const SITE_NAME = "Contractor Circle";
const SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
const FROM_DOMAIN = "notify.mail.alpcontractorcircle.com";
const TEMPLATE_NAME = "member-announcement";
const ANNOUNCEMENT_MEDIA_BUCKET = "email-assets";
const MAX_ANNOUNCEMENT_MEDIA_BYTES = 8 * 1024 * 1024;
const ANNOUNCEMENT_MEDIA_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

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

type Audience =
  | "active"
  | "all_with_login"
  | "circle"
  | "circle_inactive"
  | "control_baseline"
  | "test";

interface Recipient {
  email: string;
  firstName: string | null;
}

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
    if (page > 20) throw new Error("Sign-in audience exceeds the review limit");
  }
  return out;
}

async function loadRecipients(
  audience: Audience,
  testEmail?: string,
  adminUserId?: string,
): Promise<Recipient[]> {
  if (audience === "test") {
    if (!testEmail) throw new Error("testEmail required");
    return [{ email: testEmail, firstName: null }];
  }
  if (audience === "circle" || audience === "circle_inactive" || audience === "control_baseline") {
    const eligible = await loadCircleAudience(supabaseAdmin);
    if (audience === "circle_inactive") {
      const signedIn = await loadSignedInEmails();
      return eligible.filter((r) => !signedIn.has(r.email));
    }
    if (audience === "circle") return eligible;
    if (!adminUserId) throw new Error("adminUserId required");
    const rows = await loadMemberControlRowsForAdmin(adminUserId);
    const needsBaseline = new Set(
      rows.filter((r) => r.baselineState !== "current").map((r) => r.email.toLowerCase()),
    );
    return eligible.filter((r) => needsBaseline.has(r.email));
  }
  const [profilesResult, subsResult] = await Promise.all([
    supabaseAdmin.from("profiles").select("id,email,full_name"),
    supabaseAdmin.from("subscriptions").select("user_id,email,status,is_comped,tier"),
  ]);
  if (profilesResult.error || subsResult.error)
    throw new Error("Could not load announcement audience");
  const out = new Map<string, Recipient>();
  for (const p of profilesResult.data ?? []) {
    if (!p.email) continue;
    if (audience === "active") {
      const { data, error } = await supabaseAdmin.rpc("get_user_tier", { _user_id: p.id });
      if (error) throw new Error(error.message);
      if (!data) continue;
    }
    out.set(p.email.toLowerCase(), {
      email: p.email,
      firstName: (p.full_name ?? "").trim().split(/\s+/)[0] || null,
    });
  }
  for (const s of subsResult.data ?? []) {
    const email = s.email.toLowerCase();
    if (out.has(email)) continue;
    if (audience === "active") {
      if (s.tier === "circle" || s.tier === "hardcore") {
        const decision = await circleDecision(supabaseAdmin, { userId: s.user_id, email });
        if (decision.state !== "eligible") continue;
      } else if (!(s.is_comped || s.status === "active" || s.status === "trialing")) continue;
    }
    out.set(email, { email, firstName: null });
  }
  return [...out.values()];
}

async function loadReviewedCircleAudience(
  audience: CircleAnnouncementAudience,
  adminUserId: string,
) {
  let includeRecipient: ((email: string) => boolean) | undefined;
  if (audience === "circle_inactive") {
    const signedIn = await loadSignedInEmails();
    includeRecipient = (email) => !signedIn.has(email);
  } else if (audience === "control_baseline") {
    const rows = await loadMemberControlRowsForAdmin(adminUserId);
    const needsBaseline = new Set(
      rows.filter((r) => r.baselineState !== "current").map((r) => r.email.toLowerCase()),
    );
    includeRecipient = (email) => needsBaseline.has(email);
  }
  return previewCircleAnnouncementAudience(supabaseAdmin, audience, {
    includeRecipient,
  });
}

const InputSchema = z.object({
  subject: z.string().min(1).max(255),
  headline: z.string().min(1).max(160),
  preheader: z.string().max(200).optional(),
  body: z.string().min(1).max(20000),
  ctaLabel: z.string().max(60).optional(),
  ctaUrl: z.string().url().max(500).optional(),
  signoff: z.string().max(120).optional(),
  audience: z.enum([
    "active",
    "all_with_login",
    "circle",
    "circle_inactive",
    "control_baseline",
    "test",
  ]),
  testEmail: z.string().email().optional(),
  circleReview: z
    .object({
      snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
      excludedReviewEmails: z.array(z.string().email()).max(10000),
    })
    .optional(),
});

const MediaUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  fileSize: z.number().int().positive().max(MAX_ANNOUNCEMENT_MEDIA_BYTES),
});

export const createAnnouncementMediaUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => MediaUploadSchema.parse(input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);

    const extension = ANNOUNCEMENT_MEDIA_EXTENSIONS[data.contentType];
    const path = `announcements/${context.userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { data: signedUpload, error } = await supabaseAdmin.storage
      .from(ANNOUNCEMENT_MEDIA_BUCKET)
      .createSignedUploadUrl(path);

    if (error) throw new Error(`Could not prepare image upload: ${error.message}`);

    const { data: publicAsset } = supabaseAdmin.storage
      .from(ANNOUNCEMENT_MEDIA_BUCKET)
      .getPublicUrl(path);

    return {
      bucket: ANNOUNCEMENT_MEDIA_BUCKET,
      path,
      token: signedUpload.token,
      publicUrl: publicAsset.publicUrl,
    };
  });

export const previewMemberAnnouncementAudience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        audience: z.enum([
          "active",
          "all_with_login",
          "circle",
          "circle_inactive",
          "control_baseline",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const recipients = await loadRecipients(data.audience, undefined, context.userId);
    return { count: recipients.length };
  });

export const previewReviewedCircleAnnouncement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ audience: z.enum(["circle", "circle_inactive", "control_baseline"]) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    return loadReviewedCircleAudience(data.audience, context.userId);
  });

export const sendMemberAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);

    if (data.circleReview && !isCircleAnnouncementAudience(data.audience))
      throw new Error("Circle audience review cannot be used for this audience");
    const snapshot =
      data.circleReview && isCircleAnnouncementAudience(data.audience)
        ? await loadReviewedCircleAudience(data.audience, context.userId)
        : null;
    if (snapshot && data.circleReview) assertCircleAudienceReviewed(snapshot, data.circleReview);
    // Calls without explicit reviewed exclusions retain the original fail-closed path.
    const recipients =
      snapshot?.recipients ?? (await loadRecipients(data.audience, data.testEmail, context.userId));
    if (recipients.length === 0) {
      return { queued: 0, sent: 0, suppressed: 0, failed: 0, total: 0 };
    }

    // One announcement id ties every send together for idempotency + audit.
    const announcementId = crypto.randomUUID();
    const audienceReviewMetadata = snapshot
      ? {
          audience_review: {
            snapshot_hash: snapshot.snapshotHash,
            reviewed_by: context.userId,
            selected_emails: snapshot.recipients.map((r) => r.email),
            review_holds: snapshot.reviewHolds,
            suppressions: snapshot.suppressions,
          },
        }
      : {};

    // Persist a copy of the composed announcement so the form can always
    // re-load the last thing we sent (real or test). This is the safety net
    // against losing a draft when the preview/browser blows up.
    const { error: announcementError } = await supabaseAdmin.from("member_announcements").insert({
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
    if (announcementError) throw new Error("Could not save announcement audit");

    if (snapshot && (snapshot.reviewHolds.length || snapshot.suppressions.length)) {
      const { error } = await supabaseAdmin.from("email_send_log").insert(
        [
          ...snapshot.reviewHolds.map((hold) => ({
            ...hold,
            exclusion: "membership_review_excluded",
          })),
          ...snapshot.suppressions.map((suppression) => ({
            ...suppression,
            exclusion: "marketing_suppressed",
          })),
        ].map((excluded) => ({
          message_id: crypto.randomUUID(),
          template_name: TEMPLATE_NAME,
          recipient_email: excluded.email,
          status: "suppressed",
          metadata: {
            announcement_id: announcementId,
            channel: "admin_announcement",
            send_method: "pgmq_transactional",
            reason: excluded.exclusion,
            decision_reason: excluded.reason,
            ...audienceReviewMetadata,
          },
        })),
      );
      if (error) throw new Error("Could not save reviewed audience exclusions");
    }

    // Bulk-load suppression list once.
    const emails = recipients.map((r) => r.email.toLowerCase());
    const { data: suppressedRows, error: suppressionError } = await supabaseAdmin
      .from("suppressed_emails")
      .select("email")
      .in("email", emails);
    if (suppressionError) throw new Error(suppressionError.message);
    const suppressedSet = new Set((suppressedRows ?? []).map((s) => s.email.toLowerCase()));

    let queued = 0;
    let sent = 0;
    let suppressed = 0;
    let failed = 0;
    const directTestSend = data.audience === "test";
    const circleRequired = ["circle", "circle_inactive", "control_baseline"].includes(
      data.audience,
    );

    for (const r of recipients) {
      const emailLower = r.email.toLowerCase();
      if (
        suppressedSet.has(emailLower) ||
        shouldSkipResendCapture({ email: emailLower, firstName: r.firstName })
      ) {
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
            ...audienceReviewMetadata,
          },
        });
        continue;
      }

      try {
        // Ensure unsubscribe token (one per email).
        let unsubscribeToken: string;
        const { data: existing, error: tokenLookupError } = await supabaseAdmin
          .from("email_unsubscribe_tokens")
          .select("token,used_at")
          .eq("email", emailLower)
          .maybeSingle();
        if (tokenLookupError) throw new Error("Could not verify unsubscribe token");

        if (existing && !existing.used_at) {
          unsubscribeToken = existing.token;
        } else if (!existing) {
          const newToken = generateToken();
          const { error: tokenWriteError } = await supabaseAdmin
            .from("email_unsubscribe_tokens")
            .upsert(
              { token: newToken, email: emailLower },
              { onConflict: "email", ignoreDuplicates: true },
            );
          if (tokenWriteError) throw new Error("Could not create unsubscribe token");
          const { data: stored, error: storedTokenError } = await supabaseAdmin
            .from("email_unsubscribe_tokens")
            .select("token")
            .eq("email", emailLower)
            .maybeSingle();
          if (storedTokenError || !stored) throw new Error("unsubscribe token lookup failed");
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
              ...audienceReviewMetadata,
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

        // Recheck after rendering, immediately before audit + enqueue. The worker
        // independently repeats this guard at delivery to catch later changes.
        if (circleRequired) {
          const permission = await circleAnnouncementAllowed(supabaseAdmin, r.email);
          if (!permission.allowed) {
            const { error } = await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: TEMPLATE_NAME,
              recipient_email: r.email,
              status: "suppressed",
              metadata: {
                announcement_id: announcementId,
                channel: "admin_announcement",
                send_method: "pgmq_transactional",
                reason: permission.reason,
                ...audienceReviewMetadata,
              },
            });
            if (error) throw new Error("Could not record changed recipient eligibility");
            suppressed++;
            continue;
          }
        }

        const { error: logError } = await supabaseAdmin.from("email_send_log").insert({
          message_id: messageId,
          template_name: TEMPLATE_NAME,
          recipient_email: r.email,
          status: "pending",
          metadata: {
            announcement_id: announcementId,
            channel: directTestSend ? "admin_announcement_test" : "admin_announcement",
            send_method: directTestSend ? "direct_lovable" : "pgmq_transactional",
            ...audienceReviewMetadata,
          },
        });
        if (logError) throw new Error("Could not save recipient audit before enqueue");

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
                reply_to: MEMBER_REPLY_TO,
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
            reply_to: MEMBER_REPLY_TO,
            sender_domain: SENDER_DOMAIN,
            subject: data.subject,
            html,
            text: plainText,
            purpose: "transactional",
            label: TEMPLATE_NAME,
            idempotency_key: idempotencyKey,
            unsubscribe_token: unsubscribeToken,
            queued_at: new Date().toISOString(),
            circle_membership_required: circleRequired,
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
        await supabaseAdmin.from("email_send_log").insert({
          message_id: crypto.randomUUID(),
          template_name: TEMPLATE_NAME,
          recipient_email: r.email,
          status: "failed",
          error_message: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
          metadata: {
            announcement_id: announcementId,
            channel: "admin_announcement",
            send_method: "pgmq_transactional",
            ...audienceReviewMetadata,
          },
        });
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
