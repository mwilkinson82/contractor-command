// P0: the only email path Athena offers the host. email_draft shows the card (read-only, sends nothing);
// email_confirm_send is the separate, destructive confirm step that must follow an explicit yes.
// Athena itself never sends these emails; the host's own email tool does, and only after the confirm.
import { EMAIL_DRAFT_ARTIFACT_LINE, EMAIL_DRAFT_VIEW_SPEC } from "../views";
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text, type Sb } from "../guard";
import { resolveJob, type Job } from "../jobs";
import { whoForJob } from "../people";
import { draftIdentity } from "../drafts";
import { guide } from "../visible";
import { fileLinkLive } from "./file-tools";
import {
  confirmQuestion,
  draftCardText,
  draftKey,
  deliverableProblems,
  emailRules,
  EMAIL_CARD_RULE,
  ATHENA_FILE_LINK_RE,
  signatureProblem,
  outboundEmailDisabled,
  type EmailDraft,
} from "../email-safety";

const fields = {
  to: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    ,
  cc: z.array(z.string().trim().email().max(320)).max(20).optional(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(20000),
  link: z
    .string()
    .trim()
    .url()
    .max(2000)
    .optional()
    ,
  attachment: z
    .string()
    .trim()
    .max(200)
    .optional()
    ,
};
const toDraft = (a: {
  to?: string;
  cc?: string[];
  subject: string;
  body: string;
  link?: string;
  attachment?: string;
}): EmailDraft => ({
  to: a.to ?? null,
  cc: a.cc ?? [],
  subject: a.subject,
  body: a.body,
  link: a.link ?? null,
  attachment: a.attachment ?? null,
});
const checkDeliverable = async (d: EmailDraft, sb?: Sb) => {
  const p = deliverableProblems(d);
  // 0.8.18: an Athena file link must actually open (exists, not turned off, not expired).
  if (!p.length && sb && d.link && ATHENA_FILE_LINK_RE.test(d.link.trim()) && !(await fileLinkLive(sb, d.link.trim())))
    p.push("That file link doesn't work (turned off, expired or never made). Call lookahead_pdf (or file_share) again for a fresh link.");
  if (p.length) throw new ToolError(`Fix the draft first. Nothing was sent.\n${p.map((x) => `- ${x}`).join("\n")}`);
};

export const emailDraft = defineTool({
  name: "email_draft",
  title: "Show an email draft for review",
  description: "Shows an email draft for review.",
  inputSchema: {
    ...fields,
    job_number: z.string().trim().max(40).optional(),
    company_id: z.string().trim().max(200).optional(),
    sign_as: z.string().trim().max(200).optional(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run("email_draft", ctx, {}, async (sb) => {
      const d = toDraft(args);
      await checkDeliverable(d, sb as Sb);
      // 0.8.17: signed as the job's PM by default (not the person chatting), from the member's current company.
      const sig = args.job_number ? await pmSignature(sb as Sb, await resolveJob(sb as Sb, args.job_number, args.company_id)) : null;
      const sp = signatureProblem(d.body, sig, args.sign_as ?? null);
      if (sp) throw new ToolError(`Fix the draft first. Nothing was sent.\n- ${sp}`);
      const key = draftKey(d);
      const off = outboundEmailDisabled();
      return guide(
        {
          ...text([EMAIL_DRAFT_ARTIFACT_LINE, "", draftCardText(d), "", ...EMAIL_DRAFT_VIEW_SPEC, ...(off ? [] : ["", `Confirm question: ${confirmQuestion(d)}`])].join("\n")),
          structuredContent: {
            draft: d,
            signature: args.sign_as ?? sig?.signature ?? null,
            draft_key: key,
            sent: false,
            requires_confirm: true,
            send_allowed: !off,
            confirm_question: off ? null : confirmQuestion(d),
          },
        },
        EMAIL_CARD_RULE,
        ...emailRules(),
        off ? "" : `Ask exactly: "${confirmQuestion(d)}" and stop. Send nothing in this reply.`,
      );
    }),
});

export const emailConfirmSend = defineTool({
  name: "email_confirm_send",
  title: "Confirm sending one reviewed email",
  description: "Confirms that one reviewed email may be sent.",
  inputSchema: {
    ...fields,
    draft_key: z
      .string()
      .trim()
      .regex(/^D[0-9A-F]{8}$/),
    confirmed: z
      .literal(true)
      ,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: (args, ctx) =>
    run("email_confirm_send", ctx, {}, async (sb) => {
      if (outboundEmailDisabled())
        throw new ToolError(
          "Sending email from Athena is turned off right now. Nothing was sent; copy the draft into your email app.",
        );
      if (args.confirmed !== true) throw new ToolError("Ask the member first. Nothing was sent.");
      const d = toDraft(args);
      if (!d.to) throw new ToolError("The draft has no recipient. Nothing was sent.");
      await checkDeliverable(d, sb as Sb);
      if (draftKey(d) !== args.draft_key)
        throw new ToolError(
          "This draft changed after it was reviewed. Show the new draft and ask again. Nothing was sent.",
        );
      return guide(
        {
          ...text(`Confirmed: one email to ${d.to}, subject "${d.subject}".`),
          structuredContent: {
            send_confirmed: true,
            draft_key: args.draft_key,
            sent_by_athena: false,
          },
        },
        "You may now send this one email exactly as reviewed with your email tool, then tell the member it went out and from which account.",
      );
    }),
});

/** The job's PM as the default signer: "Name, Title, Company". */
export async function pmSignature(sb: Sb, job: Job): Promise<{ name: string; signature: string } | null> {
  const [who, jr, co] = await Promise.all([
    whoForJob(sb, job.company_id, job.job_id),
    sb.from("mcp_jobs").select("pm_name, pm_email, pm_title").eq("id", job.job_id).maybeSingle(),
    sb.from("mcp_companies").select("name").eq("id", job.company_id).maybeSingle(),
  ]);
  const j = (jr.error ? {} : jr.data ?? {}) as { pm_name?: string | null; pm_email?: string | null; pm_title?: string | null };
  const label = who("unknown").replace(/ \(PM\)$/, "");
  const name = label.startsWith("Unassigned") || label === "unknown" ? j.pm_name ?? null : label;
  const d = draftIdentity({ name, email: j.pm_email ?? null, title: j.pm_title ?? null, isMember: false }, { name: (co.data as { name?: string | null } | null)?.name ?? null });
  return name && d.signature ? { name, signature: d.signature.replace(/\n/g, ", ") } : null;
}
