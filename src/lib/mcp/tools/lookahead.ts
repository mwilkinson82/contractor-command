import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { guard, text } from "../guard";
import { INTAKE, QUESTIONS, STAGES, analyze, sessionId, stats } from "../lookahead-method";

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const lookahead = z.string().trim().min(1).max(20_000).describe("The two-week lookahead as plain text (max 20,000 characters).");
const projectName = z.string().trim().min(1).max(200).describe("Project name.");
const session = z.string().max(64).optional().describe("session_id returned by submit_lookahead; checked against the project name and lookahead.");
const answers = z.string().max(10_000).optional().describe("Answers to the clarifying questions (max 10,000 characters).");

export const startLookahead = defineTool({
  name: "start_lookahead",
  title: "Start two-week lookahead",
  description: "Begin a PM two-week lookahead review. Returns the intake instructions.",
  annotations: { ...RO, idempotentHint: true },
  handler: async (_args, ctx) => {
    await guard(ctx);
    return text(INTAKE);
  },
});

export const submitLookahead = defineTool({
  name: "submit_lookahead",
  title: "Submit lookahead",
  description: "Check a two-week lookahead before analysis. Nothing is stored; pass the same text to later tools.",
  inputSchema: { project_name: projectName, lookahead },
  annotations: { ...RO, idempotentHint: true },
  handler: async (args, ctx) => {
    await guard(ctx);
    const s = stats(args.lookahead);
    const id = await sessionId(args.project_name, args.lookahead);
    return {
      ...text(
        `Lookahead received for ${args.project_name}: ${s.chars.toLocaleString()} characters, ${s.lines} lines, about ${s.dates} date references.\nsession_id: ${id}\nNext: call get_questions with stage "crews".`,
      ),
      structuredContent: { session_id: id },
    };
  },
});

export const getQuestions = defineTool({
  name: "get_questions",
  title: "Get clarifying questions",
  description: "Get the clarifying questions for one stage of the lookahead review, in order: crews, materials, inspections, rfis, submittals, weather, predecessors.",
  inputSchema: { stage: z.enum(STAGES).optional().describe("Stage to get questions for; defaults to the first stage.") },
  annotations: { ...RO, idempotentHint: true },
  handler: async (args, ctx) => {
    await guard(ctx);
    const stage = args.stage ?? STAGES[0];
    const i = STAGES.indexOf(stage);
    const next = STAGES[i + 1];
    const qs = QUESTIONS[stage].map((q, n) => `${n + 1}. ${q}`).join("\n");
    return text(
      `Stage ${i + 1} of ${STAGES.length}: ${stage}\n${qs}\n\n${next ? `Next stage: ${next}.` : "That's the last stage. Send all answers with submit_answers."}`,
    );
  },
});

export const submitAnswers = defineTool({
  name: "submit_answers",
  title: "Submit answers",
  description: "Check answers to the clarifying questions before analysis. Nothing is stored; pass the same answers to later tools.",
  inputSchema: { answers: z.string().trim().min(1).max(10_000).describe("Answers to the clarifying questions (max 10,000 characters).") },
  annotations: { ...RO, idempotentHint: true },
  handler: async (args, ctx) => {
    await guard(ctx);
    return text(`Answers received: ${args.answers.length.toLocaleString()} characters.\nNext: run_gap_analysis, then build_hit_list, with the lookahead and these answers.`);
  },
});

export const runGapAnalysis = defineTool({
  name: "run_gap_analysis",
  title: "Run gap analysis",
  description: "Find gaps in a two-week lookahead: missing predecessors, open submittals and RFIs, unscheduled inspections, lead-time risks and manpower conflicts.",
  inputSchema: { project_name: projectName, lookahead, answers, session_id: session },
  annotations: RO,
  handler: async (args, ctx) => {
    await guard(ctx);
    if (args.session_id && args.session_id !== (await sessionId(args.project_name, args.lookahead))) {
      throw new ToolError("session_id doesn't match this project name and lookahead. Call submit_lookahead again.");
    }
    return text(await analyze("gap", `Project: ${args.project_name}\n${args.lookahead}`, args.answers, ctx.signal));
  },
});

export const buildHitList = defineTool({
  name: "build_hit_list",
  title: "Build hit list",
  description: "Turn a two-week lookahead into a prioritized action list, each with an owner and due date.",
  inputSchema: { project_name: projectName, lookahead, answers, session_id: session },
  annotations: RO,
  handler: async (args, ctx) => {
    await guard(ctx);
    if (args.session_id && args.session_id !== (await sessionId(args.project_name, args.lookahead))) {
      throw new ToolError("session_id doesn't match this project name and lookahead. Call submit_lookahead again.");
    }
    return text(await analyze("hit", `Project: ${args.project_name}\n${args.lookahead}`, args.answers, ctx.signal));
  },
});
