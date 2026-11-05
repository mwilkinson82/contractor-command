// Sends the daily morning brief email through Resend. Server only. Every send here checks briefEmailEnabled,
// and goes only to the member's own sign-in address. Nothing in this file decides who opted in: the database does.
import type { SupabaseClient } from "@supabase/supabase-js";
import { postResendEmail } from "../support/resend-send";
import { composeBriefFor } from "./morning-brief-as-user";
import {
  BRIEF_EMAIL_FROM_DEFAULT,
  BRIEF_EMAIL_REPLY_TO,
  briefEmailEnabled,
  dispatchBriefEmails,
  type BriefEmail,
} from "./morning-brief-email";

export async function sendBriefEmail(mail: BriefEmail & { to: string; key: string }): Promise<{ id: string }> {
  if (!briefEmailEnabled()) throw new Error("The morning brief email is off.");
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const sent = await postResendEmail(
    key,
    fetch,
    {
      from: process.env.ATHENA_BRIEF_FROM || BRIEF_EMAIL_FROM_DEFAULT,
      to: [mail.to],
      reply_to: BRIEF_EMAIL_REPLY_TO,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    },
    mail.key.slice(0, 256),
  );
  return { id: sent.id };
}

export async function runBriefEmails(admin: SupabaseClient) {
  if (!briefEmailEnabled()) return { sent: 0, failed: 0, skipped: 0, off: true };
  const { data, error } = await admin.rpc("mcp_morning_brief_email_candidates");
  if (error) return { sent: 0, failed: 0, skipped: 0, error: "Could not read morning brief emails." };
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const settingsOf = new Map(rows.map((r) => [String(r.user_id), { send_local: String(r.send_local ?? "06:30"), time_zone: String(r.time_zone ?? "America/New_York") }]));
  return dispatchBriefEmails({
    rows,
    compose: (userId) => composeBriefFor(admin, userId, settingsOf.get(userId) ?? { send_local: "06:30", time_zone: "America/New_York" }),
    claim: async (userId, day) => {
      const res = await admin.rpc("mcp_morning_brief_email_claim", { _user: userId, _day: day });
      if (res.error) throw new Error("Could not claim the morning brief email.");
      return (res.data as { claimed?: boolean } | null)?.claimed === true;
    },
    release: async (userId, day) => {
      await admin.rpc("mcp_morning_brief_email_release", { _user: userId, _day: day });
    },
    sent: async (userId, day, id) => {
      await admin.rpc("mcp_morning_brief_email_sent", { _user: userId, _day: day, _id: id });
    },
    send: sendBriefEmail,
  });
}
