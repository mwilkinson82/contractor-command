// Void any submittal status. The row stays. Confirmation is required before the write.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, audit } from "../jobs";
import { submittalRecordUrl } from "../board-url";
import { listCompaniesAndJobs } from "./workflow-tools";
import { whichJobAsk } from "../which-job";
import { guide } from "../visible";
import type { CardModel } from "../cards/model";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { applyCardClosing } from "../cards/silence";
import { cardWidgetMeta } from "../cards/widget";
import { presentSubmittalLog, postureSentence, resolvePosture, type SubmittalRecord } from "../submittals";
import { boardFor, readSubmittalRows, resolveSubmittalJob } from "./submittal-tools";
import { callHost } from "../call-host";
import { pickSubmittal, voidDecision, VOID_LABEL, type VoidTarget } from "../submittal-void";

const SAVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

async function call<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>)(fn, args);
  if (error) {
    if (isMissingFunction(error)) throw new ToolError("This isn't available yet. Nothing was changed.");
    dbError(error);
  }
  return data as T;
}

function cardResult(card: CardModel, extra: Record<string, unknown> = {}) {
  const html = renderHtml({ ...card, show_state: false });
  const shown = applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false);
  return guide(
    { ...text(shown), structuredContent: { card, html, ...extra }, _meta: { ...cardWidgetMeta } },
    "Show this card. Do not add text after it. Pass confirmed true and this confirm_key only after the member says yes.",
  );
}

function whichJobCard(body: string) {
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("- "));
  const card: CardModel = {
    state: "ask",
    title: "Which job?",
    show_state: false,
    ask: { prompt: whichJobAsk("submittal_void") },
    sections: [{ heading: "Jobs", kind: "list", rows: lines.map((line) => ({ cells: [line.replace(/^- /, "")], tone: "action" })) }],
    next_move: "Name the job.",
  };
  return guide({ ...text(body), structuredContent: { card, which_job: true } }, "Wait for the job.");
}

function askCard(job: { job_number: string; name: string }, row: VoidTarget, prompt: string, key: string | null) {
  const card: CardModel = {
    state: "ask",
    title: "Void submittal",
    show_state: false,
    job: `${job.job_number} – ${job.name}`,
    ask: { prompt },
    sections: [{ heading: "Submittal", kind: "list", rows: [{ cells: [`${row.number} revision ${row.revision}, ${row.title}. Status ${row.status === "void" ? VOID_LABEL : row.status}.`] }] }],
    next_move: "Nothing was changed.",
  };
  return cardResult(card, { confirm_key: key, written: false, submittal_id: row.id });
}

export const submittalVoid = defineTool({
  name: "submittal_void",
  title: "Void a submittal",
  description: "Marks a submittal Void after a separate yes, keeps the row, and records who, when, and the reason.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40).optional(),
    company_id: z.string().trim().min(1).max(200).optional(),
    submittal_id: z.string().uuid().optional(),
    number: z.string().trim().max(40).optional(),
    reason: z.string().trim().max(500).optional(),
    confirmed: z.boolean().optional(),
    confirm_key: z.string().trim().max(20).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("submittal_void", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveSubmittalJob(sb, args.job_number, args.company_id, "full");
      if (!job) return whichJobCard(await listCompaniesAndJobs(sb, args.company_id, "submittal_void"));
      if (job.scope !== "full") throw new ToolError(FULL_ACCESS_MESSAGE);
      const rows = await readSubmittalRows(sb, job.job_id);
      const row = pickSubmittal(rows as VoidTarget[], args);
      if (!row) throw new ToolError("Name the submittal. Nothing was changed.");
      const decision = voidDecision(row, args);
      if (!decision.write) return askCard(job, row, decision.prompt, decision.key);
      const saved = await call<{
        submittals?: SubmittalRecord[];
        saved_id?: string;
        status?: string;
        reason?: string;
        number?: string;
        revision?: number;
        title?: string;
        today?: string;
        posture_set?: string | null;
        posture?: string | null;
        public_job?: string | null;
        job_number?: string;
        job_name?: string;
      }>(sb, "mcp_submittal_log", {
        _job: job.job_id,
        _action: "void",
        _payload: { ...decision.payload, host: callHost(ctx) },
      });
      await audit(sb, job, "submittal_void", "void", saved.saved_id ?? row.id);
      const boardUrl = await boardFor(sb, job);
      const listed = (saved.submittals ?? []).length ? saved.submittals! : await readSubmittalRows(sb, job.job_id);
      const presented = presentSubmittalLog({
        jobNumber: saved.job_number ?? job.job_number,
        jobName: saved.job_name ?? job.name,
        rows: listed,
        today: (saved.today ?? "").slice(0, 10) || "1970-01-01",
        boardUrl,
        posture: postureSentence(resolvePosture(saved.posture_set ?? saved.posture, saved.public_job)),
      });
      const reason = saved.reason ?? decision.payload.reason;
      presented.card.sections = [
        { heading: "Void", kind: "list", rows: [{ cells: [`Voided ${saved.number ?? row.number} revision ${saved.revision ?? row.revision}, ${saved.title ?? row.title}. Status ${VOID_LABEL}. Reason: ${reason}.`] }] },
        ...(presented.card.sections ?? []),
      ];
      return cardResult(presented.card, {
        written: true,
        saved_id: saved.saved_id ?? row.id,
        status: VOID_LABEL,
        record_url: submittalRecordUrl(boardUrl, saved.number ?? row.number),
      });
    }),
});
