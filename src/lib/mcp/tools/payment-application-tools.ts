import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, text, type Sb } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { applicationSchema, appMoney, type Application } from "../../payment-applications/model";
import {
  applicationUrl,
  type ApplicationContext,
  type ApplicationReview,
} from "../../payment-applications/workflow";
import {
  draftChangeSchema,
  draftPatchSchema,
  draftProposal,
  workingRequestHash,
  type WorkingIntent,
} from "../../payment-applications/working";
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
        const working = !!s?.working_state;
        return guide(
          {
            ...text(
              s
                ? `${working ? "Working application" : s.body.number} · ${working ? s.working_state : s.body.state} · version ${s.version}\nPeriod ${s.body.period_start} through ${s.body.period_end}.\nCurrent application: ${appMoney(s.calculation.payment_due_cents)}.\nOpen saved application: ${url}`
                : `Payment applications for job ${job.job_number}.\nOpen applications: ${url}${data.snapshot_issue ? `\nBefore preparing: ${data.snapshot_issue}` : ""}\nNo new application was saved.`,
            ),
            structuredContent: {
              ...data,
              application_url: url,
              document_url:
                s && !working
                  ? absolute(applicationUrl(job.job_id, s.application_id, s.version, true))
                  : null,
            } as never,
          },
          "Use the exact saved application link. If the approved contract basis is missing, open that page’s Contract basis section to review the original amount and owner-provided source reference; do not infer it from the SOV or claim document verification. Ask only for missing period, prior certificate and line-level current work/stored materials/retainage facts. Known saved application work must continue from the latest actual saved certificate; never classify it or its related credits as separate billing or restart it as first/external. Cash, credits and daily progress do not prove certification. Keep missing inputs unknown. To prepare and save a formal application use payment_application_record; billing forecasts are separate. Never label this as an official proprietary form or signed certification without evidence.",
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
                `Review ${args.application.number} · ${args.application.state}\n${args.application.period_start} through ${args.application.period_end}\nCurrent requested amount: ${appMoney(review.calculation.payment_due_cents)}.\n${review.billing_effect}\n${review.calculation.issues.length ? `Needed: ${review.calculation.issues.join("\n")}` : "All required inputs are present."}\nConfirm this application to save it.`,
              ),
              structuredContent: review as never,
            },
            "For a certificate-only revision preserve every issued fact, snapshot, evidence choice and amount; change only state, actual certification and revision reason, even when today's SOV has changed. Show the line continuation and totals in plain dollars. Explain draft versus issued billing. Keep request IDs and review keys in tool state, not the human-facing confirmation text. Ask one clear confirmation such as Save this draft or Submit this application. Only after explicit confirmation save the exact reviewed payload and key, retaining the request ID for retries.",
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

export const paymentApplicationPrepare = defineTool({
  name: "payment_application_prepare",
  title: "Prepare or revise a payment application working draft",
  description:
    "Prepare an unissued SOV payment-application working draft from the member's requested line amounts, or revise, cancel, or resume the exact saved working version. Ask when a line or amount basis is ambiguous. This never submits or certifies billing.",
  inputSchema: {
    ...fields,
    operation: z.enum(["prepare", "cancel", "resume"]).default("prepare"),
    request_id: z.string().uuid(),
    application_id: z.string().uuid().optional(),
    expected_version: z.number().int().min(0).optional(),
    request_text: z.string().trim().min(1).max(2000),
    changes: z.array(draftChangeSchema).max(100).default([]),
    patch: draftPatchSchema.optional(),
    no_stored_materials: z
      .boolean()
      .optional()
      .describe(
        "Set true only when the member explicitly confirms no prior or current stored materials and no transfers from storage; otherwise leave unknown.",
      ),
    retainage_bps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe(
        "Apply one rate to work and stored materials only when the member explicitly confirms the same rate applies to both.",
      ),
    first_application: z
      .boolean()
      .optional()
      .describe(
        "Set true only on the member's explicit first-application declaration; existing billing or applications must still be reconciled.",
      ),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "payment_application_prepare",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        if (args.application_id && args.expected_version === undefined)
          throw new ToolError("Read the current draft version before revising it.");
        if (!args.application_id && args.operation !== "prepare")
          throw new ToolError("Choose the working draft first.");
        if (
          args.operation !== "prepare" &&
          (args.changes.length ||
            args.patch ||
            args.no_stored_materials !== undefined ||
            args.retainage_bps !== undefined ||
            args.first_application !== undefined)
        )
          throw new ToolError(
            "Cancel or resume the draft separately from changes to its contents.",
          );
        const id = args.application_id ?? args.request_id;
        const request_hash = await workingRequestHash(args);
        const outcome = await rpc<{ applied: boolean; version?: number }>(
          sb,
          job.job_id,
          "payment_application_working_outcome",
          { id, request_id: args.request_id, request_hash },
        );
        let result: { version: number; working_state: string; already_applied?: boolean };
        let questions: string[] = [];
        if (outcome.applied) {
          if (!outcome.version || outcome.version < 1)
            throw new ToolError(
              "The prior request returned an incomplete receipt. Read the draft before retrying.",
            );
          result = { version: outcome.version, working_state: "open", already_applied: true };
        } else {
          const context = await rpc<ApplicationContext>(
            sb,
            job.job_id,
            "payment_application_read",
            args.application_id ? { id, version: args.expected_version } : {},
          );
          if (
            args.application_id &&
            (!context.selected || context.selected.latest_version !== args.expected_version)
          )
            throw new ToolError(
              "This draft changed in chat or the form. Read the latest version and reconcile your changes.",
            );
          let application: Application | undefined;
          let intent: WorkingIntent | undefined;
          if (args.operation === "prepare") {
            let predecessor;
            if (args.patch?.prior_application) {
              if (args.patch.prior_mode !== "saved")
                throw new ToolError(
                  "Choose the saved certificate basis for the specified predecessor.",
                );
              const requested = args.patch.prior_application;
              const prior = await rpc<ApplicationContext>(
                sb,
                job.job_id,
                "payment_application_read",
                {
                  id: requested.id,
                  version: requested.version,
                },
              );
              predecessor = prior.selected;
              const latest = context.applications
                .filter((item) => item.id !== id && ["submitted", "certified"].includes(item.state))
                .sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
              if (
                !predecessor ||
                !latest ||
                latest.id !== requested.id ||
                latest.version !== requested.version ||
                latest.state !== "certified"
              )
                throw new ToolError(
                  "Choose the latest saved actual certificate for this job before carrying it forward.",
                );
            }
            const proposal = draftProposal(context, args, predecessor ?? undefined);
            questions = proposal.questions;
            if (proposal.blocking.length)
              return guide(
                {
                  ...text(`Before saving a working draft:\n${proposal.blocking.join("\n")}`),
                  structuredContent: { questions: proposal.questions, saved: false } as never,
                },
                "Ask only for these unresolved choices. No draft was saved.",
              );
            application = proposal.application;
            intent = proposal.intent;
          }
          const payload = {
            id,
            request_id: args.request_id,
            request_hash,
            expected_version: args.expected_version ?? 0,
            operation: args.operation === "prepare" ? "save" : args.operation,
            ...(application ? { application, intent } : {}),
          };
          result = await rpc(sb, job.job_id, "payment_application_working", payload);
        }
        const read = await rpc<ApplicationContext>(sb, job.job_id, "payment_application_read", {
          id,
          version: result.version,
        });
        const selected = read.selected;
        if (!selected || selected.version !== result.version)
          throw new ToolError("The working draft could not be verified. Read it before retrying.");
        const url = absolute(applicationUrl(job.job_id, id, result.version));
        const missing = [...questions, ...selected.calculation.issues];
        return guide(
          {
            ...text(
              `Working draft ${selected.working_state === "cancelled" ? "cancelled" : "saved"} · version ${result.version}. No billing was submitted or certified.\nOpen the exact working draft: ${url}${missing.length ? `\nNeeded: ${[...new Set(missing)].join("\n")}` : ""}`,
            ),
            structuredContent: {
              ...read,
              application_url: url,
              questions,
              already_applied: !!result.already_applied,
            } as never,
          },
          "Keep the exact working version and request ID for retries. This draft is not an invoice, approval, certificate or payment. Ask only the remaining Needed questions together when possible. A form edit must be saved as working changes before chat can revise that version. Read the latest version before every revision. When the member selects the latest saved actual certificate, pass its exact prior_application ID and version with prior_mode saved; carryforward then uses that recorded certificate, not cash or an inferred certification. Final review and explicit confirmation use payment_application_record; never infer prior certification from cash, classify a related credit as unrelated, or assume missing values are zero.",
        );
      },
    ),
});
