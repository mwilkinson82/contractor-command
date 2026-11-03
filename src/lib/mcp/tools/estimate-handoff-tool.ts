import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { money } from "../sov";
import { estimateHandoffRequest } from "../estimating-handoff.server";
import {
  estimateFactsHandoffRequest,
  readEstimateDestination,
} from "../estimating-facts-handoff.server";
import { destinationPlanSchema } from "../estimating-destination-mapping";

function reviewText(result: Record<string, unknown>, step: string) {
  const dollars = (value: unknown) => (typeof value === "number" ? money(value / 100) : "Unknown");
  if (result.cancelled === true)
    return "Handoff review cancelled. No destination value was changed.";
  if (
    step === "cancel" &&
    result.cancelled === false &&
    (result.saved === true || result.accepted === true)
  )
    return "This handoff was already accepted. Cancellation did not undo its recorded values. Read the history before a correction.";
  if (result.expired === true && result.accepted !== true)
    return "This handoff review expired. Read current records and start a new review.";
  if (result.mapping) return factsReviewText(result, step);
  if (result.status !== "review") {
    if (result.saved === true || result.accepted === true)
      return (
        `Package planning budget recorded at version ${String(result.version ?? "previously saved")}.` +
        (result.already_applied === true
          ? " This request was already accepted; it was not applied again."
          : "") +
        (result.destination_current_version !== undefined &&
        result.destination_current_version !== result.version
          ? ` The current package is now version ${String(result.destination_current_version)}; the recorded handoff remains pinned to its original version.`
          : "")
      );
    return "Handoff has not been accepted.";
  }
  const facts = result.preserved_package_facts as { code?: string; title?: string; scope?: string };
  const allocations = result.allocations as {
    component_id: string;
    include: boolean;
    exclusion_reason: string | null;
  }[];
  const components = result.components as { id: string; cents: number }[];
  return [
    `Package ${facts.code}: ${facts.title} · version ${String(result.expected_version)}`,
    `Scope: ${facts.scope}`,
    `Source and reason: ${String(result.reason)}`,
    `Frozen estimate version ${String(result.source_version)} · ${result.source_current === true ? "current source" : "historical source explicitly chosen"}.`,
    `Replace planning budget ${dollars(result.previous_budget_cents)} with ${dollars(result.proposed_budget_cents)}.`,
    ...(result.correction_of
      ? [
          `This corrects the previously accepted handoff ${String(result.correction_of)}. Its prior active component allocation will be replaced and retained in history.`,
        ]
      : []),
    ...components.map((c) => {
      const a = allocations.find((row) => row.component_id === c.id)!;
      const label = c.id
        .replace(/^direct:/, "Takeoff line ")
        .replace(/^gc:/, "General conditions: ")
        .replace(/^requirement:/, "Requirement ");
      return `${a.include ? "Include" : "Exclude"} ${label}: ${dollars(c.cents)}${a.include ? "" : ` — ${a.exclusion_reason}`}.`;
    }),
    `Frozen bid total: ${dollars(result.source_total_cents)}. Excluded from this package: ${dollars(result.excluded_cents)}.`,
    "Existing candidates, supplier selection, commitments and dates are preserved.",
  ].join("\n");
}

function factsReviewText(result: Record<string, unknown>, step: string) {
  if (result.cancelled === true)
    return "Handoff review cancelled. No destination value was changed.";
  if (step === "cancel" && result.accepted === true)
    return "This handoff was already accepted. Cancellation did not undo its recorded values.";
  if (result.accepted === true)
    return (
      `Recorded ${String(result.destination)} at destination version ${String(result.destination_version)}.` +
      (result.already_applied === true
        ? " This request was already accepted and was not applied again."
        : "") +
      (result.destination_current_version !== undefined &&
      result.destination_current_version !== result.destination_version
        ? ` Current destination version: ${String(result.destination_current_version)}. The handoff remains pinned to its recorded version.`
        : "")
    );
  const mapping = result.mapping as {
    plan: {
      allocations: {
        component_id: string;
        splits: { target_key: string; amount_cents: number }[];
        fee_cents?: number;
        excluded_cents?: number;
        exclusion_reason?: string | null;
      }[];
    };
    review: {
      targets: { key: string; previous_cents: number | null; proposed_cents: number }[];
      resulting_total_cents: number | null;
      excluded_cents: number;
      fee_cents: number;
      retained_change_cents: number;
      fee_pct: number | null;
      billing_basis: string | null;
      retained_rows?: { key: string; amount_cents: number | null }[];
      recorded_contract_original_cents?: number | null;
      recorded_contract_basis?: {
        reference: string;
        provided_by: string;
        provided_at: string;
      } | null;
    };
  };
  const dollars = (n: number | null) => (n === null ? "Unknown" : money(n / 100));
  const basis = mapping.review.recorded_contract_basis;
  const basisText = basis
    ? `${basis.reference} (provided by member ${basis.provided_by} at ${basis.provided_at})`
    : "not recorded";
  return [
    `${String(result.destination)} · destination version ${String(result.expected_destination_version)}`,
    `Frozen estimate version ${String(result.source_version)} · ${result.source_current === true ? "current source" : "historical source explicitly chosen"}.`,
    `Source and reason: ${String(result.reason)}`,
    ...(result.correction_of
      ? [
          `Correct the previously accepted mapping ${String(result.correction_of)}; prior evidence remains in history.`,
        ]
      : []),
    ...mapping.review.targets.map(
      (t) => `${t.key}: replace ${dollars(t.previous_cents)} with ${dollars(t.proposed_cents)}.`,
    ),
    ...(mapping.review.retained_rows ?? []).map(
      (row) => `Retain ${row.key}: ${dollars(row.amount_cents)}.`,
    ),
    ...mapping.plan.allocations.map(
      (a) =>
        `${a.component_id}: ${
          [
            ...a.splits.map((s) => `${s.target_key} ${dollars(s.amount_cents)}`),
            ...(a.fee_cents ? [`fee ${dollars(a.fee_cents)}`] : []),
            ...(a.excluded_cents
              ? [`exclude ${dollars(a.excluded_cents)} — ${a.exclusion_reason}`]
              : []),
          ].join("; ") || "explicit zero"
        }.`,
    ),
    ...(mapping.review.fee_pct !== null
      ? [
          `Fee: ${mapping.review.fee_pct}% of contract total, ${dollars(mapping.review.fee_cents)}. Billing basis: ${mapping.review.billing_basis}.`,
          `Retained executed changes: ${dollars(mapping.review.retained_change_cents)}.`,
          `Recorded original contract: ${dollars(mapping.review.recorded_contract_original_cents ?? null)}. Recorded basis: ${basisText}.`,
        ]
      : []),
    `Resulting destination total: ${dollars(mapping.review.resulting_total_cents)}.`,
    "Recorded contract award values, commitments and payments are preserved.",
  ].join("\n");
}

export const estimateHandoff = defineTool({
  name: "estimate_handoff",
  title: "Review frozen estimate handoff",
  description:
    "Reads versioned destinations, reviews a frozen estimate's explicit allocation into budget, official/draft SOV or existing buyout package budget, then separately accepts it atomically. No contract award, vendor selection, commitment approval or payment.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    destination: z.enum(["buyout", "budget", "sov"]),
    step: z.enum(["review", "save", "read", "cancel"]),
    request_id: z.uuid().optional(),
    correction_of: z.uuid().optional(),
    snapshot_id: z.uuid().optional(),
    package_id: z.uuid().optional(),
    expected_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
    allow_historical: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    plan: destinationPlanSchema.optional(),
    allocations: z
      .array(
        z
          .object({
            component_id: z.string().trim().min(1).max(200),
            include: z.boolean(),
            exclusion_reason: z.string().trim().min(1).max(1000).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000)
      .optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "estimate_handoff",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        if (args.step === "read" && !args.request_id) {
          if (args.destination !== "buyout") {
            const current = await readEstimateDestination(sb, job);
            return guide(
              {
                ...text(
                  `Current ${args.destination} destination version ${current.snapshot.version}. Review saved lines and terms before preparing the handoff.`,
                ),
                structuredContent: {
                  status: "destination",
                  destination: args.destination,
                  ...current.raw,
                } as unknown as JsonValueInput,
              },
              "Show the selected official/draft lines, recorded fees and billing basis, contract/change-order context, and exact destination version. Use that version for a separately reviewed handoff or intake correction; never infer contract award from an estimate.",
            );
          }
          const current = await sb.rpc("mcp_buyout_get", {
            _company: job.company_id,
            _job: job.job_id,
          });
          if (current.error)
            throw new ToolError(
              "The buyout destination could not be read. Refresh current package versions.",
            );
          return guide(
            {
              ...text(
                "Choose the existing buyout package and its exact saved version before handoff.",
              ),
              structuredContent: current.data as JsonValueInput,
            },
            "Show package codes, titles, budgets and versions. Preserve suppliers and commitments; prepare a separate explicit allocation review.",
          );
        }
        if (args.step !== "review" && !args.request_id)
          throw new ToolError("Choose the handoff request to read, save or cancel.");
        const request = args.request_id ?? crypto.randomUUID();
        const result =
          args.destination === "buyout"
            ? await estimateHandoffRequest(sb, ctx, job, { ...args, request_id: request })
            : await estimateFactsHandoffRequest(sb, ctx, job, {
                ...args,
                destination: args.destination,
                request_id: request,
              });
        return guide(
          {
            ...text(
              `${args.step === "review" ? "Review the frozen-source allocation and replacement values" : "Estimate handoff status"}:\n${reviewText(result, args.step)}\nNo contract award, vendor selection, PO approval or payment was performed.`,
            ),
            structuredContent: { ...result, request_id: request } as unknown as JsonValueInput,
          },
          args.step === "review"
            ? "Show source ID/version/checksums, historical status, every split/exclusion/fee, previous and proposed values, retained rows/changes, exact official/draft copy and destination version. For corrections show prior acceptance and retired/replaced allocations. Ask to accept, edit/back or cancel. Save the same request only after explicit human confirmation. A flag is not proof of approval."
            : "After uncertain save, read this exact request before retrying. Acceptance records only the reviewed planning/billing structure; it does not award a contract, issue or approve a commitment, bill or payment.",
        );
      },
    ),
});
