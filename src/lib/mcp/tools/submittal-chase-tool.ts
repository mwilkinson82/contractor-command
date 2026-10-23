// One chase at a time. Persist the exact draft; approval and receipt use submittal_delivery.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, resolveJob } from "../jobs";
import { listCompaniesAndJobs, namedOrSoleJob } from "./workflow-tools";
import { whichJobAsk } from "../which-job";
import { guide } from "../visible";
import { presentChaseCard, type ChaseRow } from "../submittal-chase";
import type { CardModel } from "../cards/model";
import { ToolError } from "@lovable.dev/mcp-js";

const DRAFT = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

async function call<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(fn, args);
  if (error) {
    if (isMissingFunction(error))
      throw new ToolError("This isn't available yet. Nothing was changed.");
    dbError(error);
  }
  return data as T;
}

function whichJob(body: string) {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  const card: CardModel = {
    state: "ask",
    title: "Which job?",
    show_state: false,
    ask: { prompt: whichJobAsk("submittal_chase") },
    sections: [
      {
        heading: "Jobs",
        kind: "list",
        rows: lines.map((line) => ({ cells: [line.replace(/^- /, "")], tone: "action" })),
      },
    ],
    next_move: "Name the job.",
  };
  return guide(
    { ...text(body), structuredContent: { card, which_job: true } },
    "Wait for the job.",
  );
}

export const submittalChase = defineTool({
  name: "submittal_chase",
  title: "Chase a missing or overdue submittal",
  description:
    "Saves one exact chase draft for a missing or overdue registered submittal and waits for approval before sending, or previews it without saving when preview_only is true.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40).optional(),
    company_id: z.string().trim().min(1).max(200).optional(),
    submittal_id: z.string().uuid().optional(),
    package_item_id: z.string().uuid().optional(),
    preview_only: z.boolean().optional(),
  },
  annotations: DRAFT,
  handler: (args, ctx) =>
    run("submittal_chase", ctx, { jobNumber: args.job_number }, async (sb) => {
      const picked = await namedOrSoleJob(sb, args.job_number, args.company_id);
      if (!picked)
        return whichJob(await listCompaniesAndJobs(sb, args.company_id, "submittal_chase"));
      const job = await resolveJob(sb, picked.job_number, picked.company_id);
      if (job.scope !== "full" && job.scope !== "super") throw new ToolError(FULL_ACCESS_MESSAGE);
      const payload = await call<{
        job_number?: string;
        job_name?: string;
        today?: string;
        read_only?: boolean;
        chases?: ChaseRow[];
      }>(sb, "mcp_submittal_chase_rows", { _job: job.job_id });
      const today = (payload.today ?? "").slice(0, 10);
      const chases = (payload.chases ?? []).filter(
        (row) =>
          (!args.submittal_id || row.submittal_id === args.submittal_id) &&
          (!args.package_item_id || row.package_item_id === args.package_item_id),
      );
      const presented = presentChaseCard({
        jobNumber: payload.job_number ?? job.job_number,
        jobName: payload.job_name ?? job.name,
        chases,
        today,
        readOnly: payload.read_only === true,
        previewOnly: args.preview_only === true,
      });
      const saved =
        presented.draft && args.preview_only !== true
          ? await call<{ id: string; draft_key: string }>(sb, "mcp_submittal_delivery", {
              _job: job.job_id,
              _submittal: presented.current!.submittal_id,
              _action: "draft",
              _p: {
                kind: "chase",
                package_item_id: presented.current!.package_item_id ?? null,
                draft: presented.draft,
              },
            })
          : null;
      return guide(
        {
          ...text(presented.text),
          structuredContent: {
            card: presented.card,
            draft: presented.draft,
            draft_key: saved?.draft_key ?? null,
            delivery_id: saved?.id ?? null,
            preview_only: args.preview_only === true,
            submittal_id: presented.current?.submittal_id || null,
            package_item_id: presented.current?.package_item_id || null,
            sent: false,
          },
        },
        saved
          ? "The exact chase draft is saved and not sent; on the member’s separate yes call submittal_delivery approve with this delivery_id and draft_key, then record only a successful connected-email receipt after sending."
          : "Preview only or missing information: nothing was saved or sent; do not send from a preview.",
      );
    }),
});
