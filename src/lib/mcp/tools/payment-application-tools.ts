import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, text, type Sb } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { applicationSchema, appMoney } from "../../payment-applications/model";
import {
  applicationUrl,
  type ApplicationContext,
  type ApplicationReview,
} from "../../payment-applications/workflow";
const fields = {
  job_number: z.string().trim().min(1).max(40),
  company_id: z.string().trim().min(1).max(200).optional(),
};
async function rpc<T>(sb: Sb, job: string, action: string, p: unknown): Promise<T> {
  const r = await (sb.rpc as any)("mcp_billing_evidence_record", {
    _job: job,
    _action: action,
    _p: p,
  });
  if (r.error) dbError(r.error);
  return r.data;
}
const absolute = (path: string) => `https://app.meetathena.io${path}`;
export const paymentApplicationRead = defineTool({
  name: "payment_application_read",
  title: "Saved SOV payment applications",
  description:
    "Reads the current SOV, prior billing evidence and versioned saved payment applications and provides the exact saved application and downloadable PDF link, distinct from the monthly billing forecast and daily progress preview.",
  inputSchema: {
    ...fields,
    application_id: z.string().uuid().optional(),
    version: z.number().int().positive().optional(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "payment_application_read",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        if (args.version && !args.application_id)
          throw new ToolError("Choose the application before its version.");
        const data = await rpc<ApplicationContext>(sb, job.job_id, "payment_application_read", {
          id: args.application_id,
          version: args.version,
        });
        const s = data.selected;
        const url = absolute(applicationUrl(job.job_id, s?.application_id, s?.version));
        return guide(
          {
            ...text(
              s
                ? `${s.body.number} · ${s.body.state} · version ${s.version}\nPeriod ${s.body.period_start} through ${s.body.period_end}.\nCurrent application: ${appMoney(s.calculation.payment_due_cents)} USD.\nOpen saved application: ${url}`
                : `Payment applications for job ${job.job_number}.\nOpen applications: ${url}\nNo new application was saved.`,
            ),
            structuredContent: {
              ...data,
              application_url: url,
              document_url: s
                ? absolute(applicationUrl(job.job_id, s.application_id, s.version, true))
                : null,
            } as never,
          },
          "Use the exact saved application link. Ask only for missing period, prior certificate and line-level current work/stored materials/retainage facts. Cash, credits and daily progress do not prove certification. Keep missing inputs unknown. To prepare and save a formal application use payment_application_record; billing forecasts are separate. Never label this as an official proprietary form or signed certification without evidence.",
        );
      },
    ),
});
export const paymentApplicationRecord = defineTool({
  name: "payment_application_record",
  title: "Review or save an SOV payment application",
  description:
    "Reviews the exact SOV-linked application and saves it only after explicit confirmation; draft/ready do not issue billing; submitted creates one incremental current-amount billing record; certified records the actual certificate on that same record. No payment is sent.",
  inputSchema: {
    ...fields,
    step: z.enum(["review", "save"]),
    id: z.string().uuid(),
    request_id: z.string().uuid(),
    expected_version: z.number().int().min(0),
    application: applicationSchema,
    review_key: z.string().uuid().optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "payment_application_record",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const p = {
          id: args.id,
          request_id: args.request_id,
          expected_version: args.expected_version,
          application: args.application,
        };
        if (args.step === "review") {
          const review = await rpc<ApplicationReview>(
            sb,
            job.job_id,
            "payment_application_review",
            p,
          );
          return guide(
            {
              ...text(
                `Review ${args.application.number} · ${args.application.state}\n${args.application.period_start} through ${args.application.period_end}\nCurrent requested amount: ${appMoney(review.calculation.payment_due_cents)} USD.\n${review.billing_effect}\n${review.calculation.issues.length ? `Needed: ${review.calculation.issues.join("\n")}` : "All required inputs are present."}\nConfirm this application to save it.`,
              ),
              structuredContent: review as never,
            },
            "Show the line continuation and totals in plain dollars. Explain draft versus issued billing. Keep request IDs and review keys in tool state, not the human-facing confirmation text. Ask one clear confirmation such as Save this draft or Submit this application. Only after explicit confirmation save the exact reviewed payload and key, retaining the request ID for retries.",
          );
        }
        if (!args.confirmed || !args.review_key)
          throw new ToolError(
            "Review the application and confirm before saving. Nothing was saved.",
          );
        const result = await rpc<{
          id: string;
          version: number;
          state: string;
          already_applied: boolean;
        }>(sb, job.job_id, "payment_application_save", { ...p, review_key: args.review_key });
        const data = await rpc<ApplicationContext>(sb, job.job_id, "payment_application_read", {
          id: result.id,
          version: result.version,
        });
        const url = absolute(applicationUrl(job.job_id, result.id, result.version));
        return guide(
          {
            ...text(
              `Saved and read back ${args.application.number} · ${result.state} · version ${result.version}.\nOpen saved application: ${url}\nDownload PDF: ${absolute(applicationUrl(job.job_id, result.id, result.version, true))}`,
            ),
            structuredContent: { ...result, ...data, application_url: url } as never,
          },
          "Confirm the exact saved state and version. Draft is not issued billing; submitted is not certified or paid. Link to this saved application, not the forecast. No payment was sent.",
        );
      },
    ),
});
