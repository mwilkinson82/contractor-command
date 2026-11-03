import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  boardSchema,
  boardSummary,
  differenceFromAllowance,
  optionNames,
  type Board,
} from "../../selections/model";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { jobTimeZone, named, resolveJob } from "../jobs";
import { todayIn } from "../deadlines";
import { guide } from "../visible";

type SavedBoard = { version: number; board: Board };
async function rpc(sb: Sb, name: string, args: Record<string, unknown>): Promise<SavedBoard> {
  const result = await (
    sb.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (result.error && isMissingFunction(result.error))
    throw new ToolError("Selections storage is not installed. Nothing was saved.");
  if (result.error) dbError(result.error);
  const parsed = z
    .object({ version: z.number().int().nonnegative(), board: boardSchema })
    .passthrough()
    .safeParse(result.data);
  if (!parsed.success)
    throw new ToolError(
      "The selections result could not be verified. If this was a save, it may have completed; read the current board before retrying.",
    );
  return parsed.data;
}

const currency = (amount: number | null, code: string | null) =>
  amount === null
    ? "Unknown"
    : code
      ? `${code} ${(amount / 100).toFixed(2)}`
      : `${(amount / 100).toFixed(2)} (currency unknown)`;
const signed = (amount: number | null, code: string | null) =>
  amount === null
    ? "Unknown"
    : `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${currency(Math.abs(amount), code)}`;

/** This is a contractor's record, not evidence of a client approval. */
export const selectionBoard = defineTool({
  name: "selection_board",
  title: "Project selections",
  description:
    "Reads or saves a project's Good, Better and Best selections board without changing estimates, budgets or accounting.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    action: z.enum(["read", "save"]),
    expected_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    board: boardSchema.optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "selection_board",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        if (
          args.action === "read" &&
          (args.board !== undefined || args.expected_version !== undefined)
        )
          throw new ToolError("Read requests cannot include changes.");
        if (
          args.action === "save" &&
          (args.board === undefined || args.expected_version === undefined)
        )
          throw new ToolError(
            "Read the current board first and provide its version and the complete updated board.",
          );
        const result =
          args.action === "read"
            ? await rpc(sb, "mcp_residential_selections_get", { _job: job.job_id })
            : await rpc(sb, "mcp_residential_selections_save", {
                _job: job.job_id,
                _expected_version: args.expected_version,
                _board: args.board,
              });
        const summary = boardSummary(result.board, todayIn(await jobTimeZone(sb, job.job_id)));
        const lines = result.board.selections.flatMap((selection) => [
          `\n${selection.title} · decision due: ${selection.decision_due ?? "Unknown"} · allowance: ${currency(selection.allowance_cents, result.board.currency)}`,
          ...optionNames.map(
            (name) =>
              `${name[0].toUpperCase()}${name.slice(1)}: ${selection.options[name].description || "Description needed"} · customer price ${currency(selection.options[name].price_cents, result.board.currency)} · difference ${signed(differenceFromAllowance(selection, name), result.board.currency)} · internal cost ${currency(selection.options[name].cost_cents, result.board.currency)} · source ${selection.options[name].source_url ?? "Unknown"} · photo ${selection.options[name].photo_url ?? "Unknown"} · specifications ${selection.options[name].specifications || "Unknown"}`,
          ),
          `Recorded choice: ${selection.selected ?? "None"}${selection.notes ? ` · Notes: ${selection.notes}` : ""}`,
        ]);
        return guide(
          {
            ...text(
              [
                `${named(job)} · Selections board v${result.version}${args.action === "save" ? " saved" : ""}`,
                `${summary.pending} awaiting a choice · ${summary.overdue} overdue · ${summary.missing_date} need a date`,
                ...lines,
                "A recorded choice is not owner approval or a contract change. No budget or accounting entry was made.",
              ].join("\n"),
            ),
            structuredContent: {
              ...result,
              summary,
              saved: args.action === "save",
              shared: false,
            } as unknown as JsonValueInput,
          },
          "Show all saved choices and mark unknown values as unknown. Save only the explicitly requested changes, using the current board/version and preserving all other rows. A recorded choice does not establish owner approval. This tool does not create a client link or send anything.",
        );
      },
    ),
});
