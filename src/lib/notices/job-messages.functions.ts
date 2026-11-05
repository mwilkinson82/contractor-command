import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MESSAGE_MAX, replyToClient } from "@/lib/customer-portal/messages";
import { sendPortalEmail } from "@/lib/customer-portal/email";
import { companyLogoUrl } from "@/lib/mcp/document-email-brand";
import { rpcMessage } from "./board-notices";
import type { ReplyResult } from "./job-messages";

const Input = z.object({
  jobId: z.string().uuid(),
  accessId: z.string().uuid(),
  body: z.string().trim().min(1).max(MESSAGE_MAX),
  aboutItem: z.string().uuid().nullable().optional(),
});

type MemberDb = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
};

/**
 * The board's reply to a client. Runs as the signed-in member (their own token, never the service role), so
 * mcp_job_message_reply's full-access check applies, then emails the client through the customer page sender.
 */
export const replyJobMessageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ context, data }): Promise<ReplyResult> => {
    const sb = context.supabase as unknown as MemberDb;
    const job = await sb.from("mcp_jobs").select("company_id").eq("id", data.jobId).maybeSingle();
    const companyId = (job.data as { company_id?: string } | null)?.company_id ?? null;
    const { reply, email } = await replyToClient(
      {
        rpc: async (fn, args) => {
          const res = await sb.rpc(fn, args);
          if (res.error)
            throw new Error(rpcMessage(res.error, "Your reply was not sent. Try again."));
          return res.data;
        },
        send: sendPortalEmail,
        logo: companyId ? await companyLogoUrl(sb as never, companyId) : null,
      },
      {
        jobId: data.jobId,
        accessId: data.accessId,
        body: data.body,
        aboutItem: data.aboutItem ?? null,
      },
    );
    return {
      message_id: reply.message_id,
      customer_name: reply.customer_name,
      customer_email: reply.customer_email,
      email,
    };
  });
