// P0: the only email path Athena offers the host. email_draft shows the card (read-only, sends nothing);
// email_confirm_send is the separate, destructive confirm step that must follow an explicit yes.
// Athena itself never sends these emails; the host's own email tool does, and only after the confirm.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { guide } from "../visible";
import {
  confirmQuestion,
  draftCardText,
  draftKey,
  emailRules,
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
    .describe(
      "Recipient address exactly as the member gave it or as Athena's job data shows it. Leave out if unknown; never guess.",
    ),
  cc: z.array(z.string().trim().email().max(320)).max(20).optional(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(20000),
  link: z
    .string()
    .trim()
    .url()
    .max(2000)
    .optional()
    .describe(
      "A file_share or report page link to put under the body, when the email tool can't attach the file.",
    ),
};
const toDraft = (a: {
  to?: string;
  cc?: string[];
  subject: string;
  body: string;
  link?: string;
}): EmailDraft => ({
  to: a.to ?? null,
  cc: a.cc ?? [],
  subject: a.subject,
  body: a.body,
  link: a.link ?? null,
});

export const emailDraft = defineTool({
  name: "email_draft",
  title: "Show an email draft for review",
  description:
    'Call this whenever the member asks to email or send anything ("send the lookahead to ...", "email this to the sub"). Returns the draft card only; nothing is sent. Show the card, then ask the confirm question it returns. Never call any send action in the same reply.',
  inputSchema: { ...fields, job_number: z.string().trim().max(40).optional() },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run("email_draft", ctx, {}, async () => {
      const d = toDraft(args);
      const key = draftKey(d);
      const off = outboundEmailDisabled();
      return guide(
        {
          ...text(draftCardText(d)),
          structuredContent: {
            draft: d,
            draft_key: key,
            sent: false,
            requires_confirm: true,
            send_allowed: !off,
            confirm_question: off ? null : confirmQuestion(d),
          },
        },
        ...emailRules(),
        off ? "" : `Ask exactly: "${confirmQuestion(d)}" and stop. Send nothing in this reply.`,
      );
    }),
});

export const emailConfirmSend = defineTool({
  name: "email_confirm_send",
  title: "Confirm sending one reviewed email",
  description:
    "Only after the member answered yes to the exact confirm question for a draft from email_draft, in a later message. Pass the same fields and draft_key with confirmed true. Athena sends nothing; on success you may send that one email, unchanged, with your email tool.",
  inputSchema: {
    ...fields,
    draft_key: z
      .string()
      .trim()
      .regex(/^D[0-9A-F]{8}$/),
    confirmed: z
      .literal(true)
      .describe("true only after the member said yes to the exact confirm question."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: (args, ctx) =>
    run("email_confirm_send", ctx, {}, async () => {
      if (outboundEmailDisabled())
        throw new ToolError(
          "Sending email from Athena is turned off right now. Nothing was sent; copy the draft into your email app.",
        );
      if (args.confirmed !== true) throw new ToolError("Ask the member first. Nothing was sent.");
      const d = toDraft(args);
      if (!d.to) throw new ToolError("The draft has no recipient. Nothing was sent.");
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
