import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, text, type Sb } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { paymentApplicationArtifact } from "../document-email-artifact";
import { documentEmailBrand } from "../document-email-brand";
import type { ApplicationContext } from "../../payment-applications/workflow";

/** No share is created and no email is drafted or sent by this tool. */
export const documentEmailExport = defineTool({
  name: "document_email_export",
  title: "Prepare a saved document for email",
  description: "Returns the exact saved payment application PDF bytes and version for an email attachment. This does not create a share or send mail.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    document_id: z.string().uuid(),
    version: z.number().int().positive(),
    include_historical_version: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) => run("document_email_export", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
    const job = await resolveJob(sb as Sb, args.job_number, args.company_id, "full");
    const result = await (sb as Sb).rpc("mcp_billing_evidence_record", { _job: job.job_id, _action: "payment_application_read", _p: { id: args.document_id, version: args.version } });
    if (result.error) dbError(result.error);
    let artifact;
    try {
      const brand = await documentEmailBrand(sb as Sb, job.company_id);
      artifact = await paymentApplicationArtifact({ companyId: job.company_id, jobId: job.job_id, applicationId: args.document_id, version: args.version, allowHistorical: args.include_historical_version === true, context: result.data as ApplicationContext, brand });
    } catch (error) {
      throw new ToolError(error instanceof Error ? error.message : "The saved document could not be prepared.");
    }
    return guide({ ...text(`Prepared ${artifact.filename} from saved version ${artifact.version}. No email was sent.`), structuredContent: { artifact, attached: false, sent: false } }, "The bytes are private and for the authenticated member's requested email only. Do not create a public link. Use the exact artifact after showing and confirming the complete email, including the sender, recipient and document version. This tool does not send email.");
  }),
});
