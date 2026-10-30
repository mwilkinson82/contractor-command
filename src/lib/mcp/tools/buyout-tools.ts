import { loadBuyoutScheduleLinks } from "../scheduling-buyout";
import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { memberCompanies, resolveCompany, resolveJob } from "../jobs";
import { guide } from "../visible";
import {
  buyoutFacts,
  buyoutProjection,
  buyoutSteps,
  buyoutReviewText,
  type BuyoutLedger,
} from "../buyout";

const context = {
  company_id: z.string().trim().min(1).max(200).optional(),
  job_number: z.string().trim().min(1).max(40).optional(),
  scope: z.enum(["job", "company"]).default("job"),
};
const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
export async function buyoutTarget(
  sb: Sb,
  args: { scope?: string; company_id?: string; job_number?: string },
) {
  if (args.scope === "company")
    return { company: await resolveCompany(sb, args.company_id), job: null };
  if (!args.job_number) throw new ToolError("Which job is this for? Nothing was saved.");
  const job = await resolveJob(sb, args.job_number, args.company_id, "full");
  if (args.company_id) {
    const want = args.company_id.trim().toLowerCase();
    const matches = (await memberCompanies(sb)).filter(
      (c) => c.id.toLowerCase() === want || c.name.trim().toLowerCase() === want,
    );
    if (matches.length !== 1 || matches[0].id !== job.company_id)
      throw new ToolError(
        "That job is not in the selected company. Choose the exact company and job; nothing was saved.",
      );
  }
  return { company: job.company_id, job: job.job_id };
}
async function rpc<T>(sb: Sb, name: string, args: Record<string, unknown>): Promise<T> {
  const r = await (
    sb.rpc as unknown as (
      n: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: T; error: { message: string } | null }>
  )(name, args);
  if (r.error) dbError(r.error);
  return r.data;
}
export const buyoutRead = defineTool({
  name: "buyout_read",
  title: "Supplier, subcontractor and buyout guide",
  description:
    "Reads the company owner directory or job buyout comparisons, exact PO commitments, original-document readiness and history. Returns guided steps and a read-only versioned portfolio projection.",
  inputSchema: context,
  annotations: { ...annotations, readOnlyHint: true, idempotentHint: true },
  handler: (args, ctx) =>
    run(
      "buyout_read",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const t = await buyoutTarget(sb, args),
          ledger = await rpc<BuyoutLedger>(sb, "mcp_buyout_get", {
            _company: t.company,
            _job: t.job,
          });
        const steps = t.job ? buyoutSteps(ledger) : [];
        const scheduleLinks = t.job ? await loadBuyoutScheduleLinks(sb, ledger) : null;
        return guide(
          {
            ...text(
              t.job
                ? `Suppliers, subcontractors and buyout for job ${args.job_number}.\n${steps.map((s) => `${s.step}. ${s.title} — ${s.state}: ${s.detail}`).join("\n")}\nOpen: https://app.meetathena.io/r/job/${t.job}/buyout`
                : "Company supplier/subcontractor directory. Select an exact identity and verified contact; job links preserve existing project-party identity.",
            ),
            structuredContent: {
              ...ledger,
              steps,
              ...(t.job
                ? { portfolio: buyoutProjection(ledger), schedule_links: scheduleLinks }
                : {}),
            } as never,
          },
          "Guide one step at a time. Select exact identities; ask on duplicates. Use existing purchase_orders_record for project parties, approved commitments and terms. Use billing_document_upload and billing_documents to upload/retrieve verified originals, then link the exact document ID/hash with buyout_record readiness. Never use prime contract upload for a subcontract. Show missing/expired evidence and owner exceptions as outstanding review, never compliance approval. No signing, issuance, emails or money movement. Portfolio is a read contract only. Show schedule_links version/missing states without automatically relinking historical pins. Supplier dates remain reported inputs; date differences are not calculated schedule impact and never change CPM or PO/AP state.",
        );
      },
    ),
});
export const buyoutRecord = defineTool({
  name: "buyout_record",
  title: "Review supplier and buyout records",
  description:
    "Guided internal draft/review workflow. Reviews exact facts then separately records a confirmed version or cancels a pending review. Does not approve a PO, bill, payment, coverage or legal compliance.",
  inputSchema: {
    ...context,
    step: z.enum(["review", "save", "cancel"]),
    record: buyoutFacts.optional(),
    id: z.uuid().optional(),
    expected_version: z.number().int().min(0).max(2147483645).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    request_id: z.uuid().optional(),
    review_id: z.uuid().optional(),
    confirmed: z.boolean().optional(),
  },
  annotations,
  handler: (args, ctx) =>
    run(
      "buyout_record",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const t = await buyoutTarget(sb, args);
        if (args.step === "cancel") {
          if (!args.review_id) throw new ToolError("Choose the pending review to cancel.");
          const result = await rpc<{ saved: boolean; cancelled: boolean }>(
            sb,
            "mcp_buyout_review_cancel",
            {
              _company: t.company,
              _job: t.job,
              _review: args.review_id,
            },
          );
          return guide(
            {
              ...text(
                result.saved
                  ? "This version was already saved. The cancellation did not undo it; read its history before making a correction."
                  : "Review cancelled. No business record was saved.",
              ),
              structuredContent: result as never,
            },
            "Stop this save. To go back and edit, start a new review with a new request ID.",
          );
        }
        if (!args.record || !args.reason)
          return guide(
            {
              ...text(
                "Choose a directory entry, job identity link, buyout package or payment requirements, and give the source/reason. Nothing was saved.",
              ),
              structuredContent: {
                saved: false,
                missing: [
                  ...(!args.record ? ["record facts"] : []),
                  ...(!args.reason ? ["reason/source"] : []),
                ],
              },
            },
            "Gather only missing facts. Read current records first. Unknown amounts and dates remain null; zero is a real supplied amount. Do not invent insurance or waiver requirements.",
          );
        const record = buyoutFacts.parse(args.record);
        if ((record.kind === "directory") !== (t.job === null))
          throw new ToolError(
            "Company directory entries use company scope; links, packages and readiness use an exact job.",
          );
        if (args.id && args.expected_version === undefined)
          throw new ToolError("Read the current record version before revising it.");
        if (
          args.step === "save" &&
          (!args.id ||
            !args.request_id ||
            !args.review_id ||
            args.expected_version === undefined ||
            args.confirmed !== true)
        )
          throw new ToolError(
            "Review and explicitly confirm the exact facts first. Nothing was saved.",
          );
        const id = args.id ?? crypto.randomUUID(),
          request = args.request_id ?? crypto.randomUUID(),
          review = args.review_id ?? crypto.randomUUID(),
          expected = args.expected_version ?? 0;
        const payload = {
          _company: t.company,
          _job: t.job,
          _id: id,
          _kind: record.kind,
          _expected: expected,
          _facts: record.data,
          _reason: args.reason,
          _request: request,
          _review: review,
        };
        const result = await rpc<Record<string, unknown>>(
          sb,
          args.step === "review" ? "mcp_buyout_review" : "mcp_buyout_record",
          { ...payload, ...(args.step === "save" ? { _confirmed: true } : {}) },
        );
        return guide(
          {
            ...text(
              args.step === "review"
                ? `Review ${record.kind.replace(/_/g, " ")}:\n${buyoutReviewText(record.data)}\nReason: ${args.reason}\nSave this internal record, edit/back, or cancel?`
                : `Saved ${record.kind.replace(/_/g, " ")} version ${result.version}. No PO/bill approval or payment was performed.`,
            ),
            structuredContent: {
              ...result,
              id,
              request_id: request,
              review_id: review,
              expected_version: expected,
              record,
              reason: args.reason,
            } as never,
          },
          args.step === "review"
            ? "Show the exact facts and effect. Ask the user to save, edit/back, or cancel. A review/confirmed flag is not proof of a human decision. On save send identical returned record, IDs, expected version and reason after explicit confirmation. On edits cancel the old review and review new facts. After uncertain save read state first, then retry only the identical request. Selection is not an approved or issued commitment."
            : "Tell the user which version was recorded and the next missing guided step. Preserve history; never claim a bill was approved, a contract issued, or funds moved.",
        );
      },
    ),
});
