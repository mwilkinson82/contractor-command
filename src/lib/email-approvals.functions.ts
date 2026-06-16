import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EmailApprovalRow = {
  id: string;
  message_id: string;
  template_name: string;
  recipient_email: string;
  subject: string;
  html: string;
  plain_text: string;
  template_data: string;
  idempotency_key: string;
  unsubscribe_token: string;
  from_address: string;
  sender_domain: string;
  status: "pending" | "approved" | "rejected";
  requested_by_email: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(data ?? []).some((r) => r.role === "admin")) {
    throw new Error("Forbidden");
  }
  return supabaseAdmin;
}

export const listEmailApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailApprovalRow[]> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("email_approvals")
      .select(
        "id,message_id,template_name,recipient_email,subject,html,plain_text,template_data,idempotency_key,unsubscribe_token,from_address,sender_domain,status,requested_by_email,reviewed_at,review_note,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as EmailApprovalRow[];
  });

export const approveEmailApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const supabaseAdmin = await assertAdmin(context.userId);

    const { data: row, error: fetchErr } = await supabaseAdmin
      .from("email_approvals")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!row) throw new Error("Email approval not found");
    if (row.status !== "pending") {
      throw new Error(`Email is already ${row.status}`);
    }

    // Suppression re-check at approve time
    const { data: suppressed } = await supabaseAdmin
      .from("suppressed_emails")
      .select("id")
      .eq("email", row.recipient_email.toLowerCase())
      .maybeSingle();
    if (suppressed) {
      await supabaseAdmin
        .from("email_approvals")
        .update({
          status: "rejected",
          reviewed_by: context.userId,
          reviewed_at: new Date().toISOString(),
          review_note: "Recipient is on suppression list",
        })
        .eq("id", row.id);
      throw new Error("Recipient is on the suppression list — not sent.");
    }

    const { error: enqueueErr } = await supabaseAdmin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        message_id: row.message_id,
        to: row.recipient_email,
        from: row.from_address,
        sender_domain: row.sender_domain,
        subject: row.subject,
        html: row.html,
        text: row.plain_text,
        purpose: "transactional",
        label: row.template_name,
        idempotency_key: row.idempotency_key,
        unsubscribe_token: row.unsubscribe_token,
        queued_at: new Date().toISOString(),
      },
    });
    if (enqueueErr) throw new Error(`Failed to enqueue: ${enqueueErr.message}`);

    await supabaseAdmin.from("email_send_log").insert({
      message_id: row.message_id,
      template_name: row.template_name,
      recipient_email: row.recipient_email,
      status: "pending",
    });

    const { error: updateErr } = await supabaseAdmin
      .from("email_approvals")
      .update({
        status: "approved",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true };
  });

export const rejectEmailApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; note?: string }) => d)
  .handler(async ({ context, data }) => {
    const supabaseAdmin = await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("email_approvals")
      .update({
        status: "rejected",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        review_note: data.note ?? null,
      })
      .eq("id", data.id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
