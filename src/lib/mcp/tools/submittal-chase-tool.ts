// One chase at a time. The draft is shown here. The send is email_confirm_send after a yes.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, resolveJob } from "../jobs";
import { listCompaniesAndJobs, namedOrSoleJob } from "./workflow-tools";
import { whichJobAsk } from "../which-job";
import { guide } from "../visible";
import { draftKey } from "../email-safety";
import { presentChaseCard, type ChaseRow } from "../submittal-chase";
import type { CardModel } from "../cards/model";
import { ToolError } from "@lovable.dev/mcp-js";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

async function call<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>)(fn, args);
  if (error) {
    if (isMissingFunction(error)) throw new ToolError("This isn't available yet. Nothing was changed.");
    dbError(error);
  }
  return data as T;
}

function whichJob(body: string) {
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("- "));
  const card: CardModel = {
    state: "ask",
    title: "Which job?",
    show_state: false,
    ask: { prompt: whichJobAsk("submittal_chase") },
    sections: [{ heading: "Jobs", kind: "list", rows: lines.map((line) => ({ cells: [line.replace(/^- /, "")], tone: "action" })) }],
    next_move: "Name the job.",
  };
  return guide({ ...text(body), structuredContent: { card, which_job: true } }, "Wait for the job.");
}

export const submittalChase = defineTool({
  name: "submittal_chase",
  title: "Chase a missing or overdue submittal",
  description: "Drafts one chase email for an overdue, missing, registered submittal, shows that draft as not sent and needing confirm, and waits for a separate yes before anything is sent.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40).optional(),
    company_id: z.string().trim().min(1).max(200).optional(),
    submittal_id: z.string().uuid().optional(),
    package_item_id: z.string().uuid().optional(),
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("submittal_chase", ctx, { jobNumber: args.job_number }, async (sb) => {
      const picked = await namedOrSoleJob(sb, args.job_number, args.company_id);
      if (!picked) return whichJob(await listCompaniesAndJobs(sb, args.company_id, "submittal_chase"));
      const job = await resolveJob(sb, picked.job_number, picked.company_id);
      if (job.scope !== "full" && job.scope !== "super") throw new ToolError(FULL_ACCESS_MESSAGE);
      const payload = await call<{ job_number?: string; job_name?: string; today?: string; read_only?: boolean; chases?: ChaseRow[] }>(sb, "mcp_submittal_chase_rows", { _job: job.job_id });
      const today = (payload.today ?? "").slice(0, 10);
      const chases = (payload.chases ?? []).filter((row) => (!args.submittal_id || row.submittal_id === args.submittal_id) && (!args.package_item_id || row.package_item_id === args.package_item_id));
      const presented = presentChaseCard({
        jobNumber: payload.job_number ?? job.job_number,
        jobName: payload.job_name ?? job.name,
        chases,
        today,
        readOnly: payload.read_only === true,
      });
      const key = presented.draft ? draftKey(presented.draft) : null;
      return guide(
        {
          ...text(presented.text),
          structuredContent: {
            card: presented.card,
            draft: presented.draft,
            draft_key: key,
            submittal_id: presented.current?.submittal_id || null,
            package_item_id: presented.current?.package_item_id || null,
            sent: false,
          },
        },
        "Show this chase card. The draft is not sent and needs confirm. Do not send the email in this reply. Save the exact draft using submittal_delivery action draft kind chase, with the submittal_id and package_item_id from this card, then show that saved draft for a separate yes before action approve. Do not count a chase until a successful send receipt is recorded.",
      );
    }),
});
