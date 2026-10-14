import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { INPUT_KEYS, INPUT_LABELS, currentCheck, loadLookahead, renderReport, type InputKey } from "../workflow";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const doc = (what: string) => z.string().max(20_000).optional().describe(`${what}, as plain text. Leave out if you don't have it; it is recorded as unknown.`);
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const READ = { readOnlyHint: true, openWorldHint: false } as const;

const REQUIRED_LIST = INPUT_KEYS.map((k) => `- ${k}: ${INPUT_LABELS[k]}`).join("\n");

export const onboarding = defineTool({
  name: "onboarding",
  title: "Company profile",
  description: "Save or read the member's company profile (company name, trades, key roles). Saved once at onboarding; save again to update.",
  inputSchema: {
    action: z.enum(["save", "read"]).describe("save or read."),
    company_name: z.string().trim().min(1).max(200).optional().describe("Company name (required to save)."),
    trades: z.array(z.string().trim().min(1).max(80)).max(30).optional().describe("Trades the company self-performs or manages."),
    owner: z.string().max(200).optional().describe("Owner name."),
    pm: z.string().max(200).optional().describe("Project manager name."),
    superintendent: z.string().max(200).optional().describe("Superintendent name."),
    notes: z.string().max(10_000).optional().describe("Other notes."),
  },
  annotations: { ...WRITE, idempotentHint: true },
  handler: (args, ctx) =>
    run("onboarding", ctx, undefined, async (sb) => {
      if (args.action === "save") {
        if (!args.company_name) throw new ToolError("company_name is required to save the profile.");
        const { error } = await sb.from("mcp_profiles").upsert({
          user_id: ctx.getUserId(),
          company_name: args.company_name,
          trades: args.trades ?? [],
          roles: { owner: args.owner ?? "unknown", pm: args.pm ?? "unknown", superintendent: args.superintendent ?? "unknown" },
          notes: args.notes ?? null,
          updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
      }
      const { data, error } = await sb.from("mcp_profiles").select("company_name, trades, roles, notes").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return text(`No profile saved yet. Call onboarding with action "save" and company_name.\n\nIntake will ask for:\n${REQUIRED_LIST}`);
      const r = (data.roles ?? {}) as Record<string, string>;
      return text(
        `${args.action === "save" ? "Profile saved." : "Profile:"}\nCompany: ${data.company_name}\nTrades: ${(data.trades ?? []).join(", ") || "unknown"}\nOwner: ${r.owner ?? "unknown"} | PM: ${r.pm ?? "unknown"} | Superintendent: ${r.superintendent ?? "unknown"}\n\nNext: call intake. It asks for:\n${REQUIRED_LIST}`,
      );
    }),
});

export const intake = defineTool({
  name: "intake",
  title: "Lookahead intake",
  description: "Create a job's two-week lookahead and record which required inputs were provided or missing. Missing inputs are stored as unknown, never guessed.",
  inputSchema: {
    job_name: z.string().trim().min(1).max(200).describe("Job name. Reused if it already exists."),
    job_number: z.string().max(50).optional().describe("Job number."),
    start_date: date.optional().describe("Lookahead start date (YYYY-MM-DD)."),
    end_date: date.optional().describe("Lookahead end date (YYYY-MM-DD)."),
    schedule_export: doc("Schedule export (activity IDs, names, dates, predecessors)"),
    crews: doc("Crews/subs by day with headcount and foreman"),
    submittal_log: doc("Submittal log"),
    rfi_log: doc("RFI log"),
    inspection_list: doc("Inspection list"),
    deliveries: doc("Deliveries list"),
  },
  annotations: { ...WRITE, idempotentHint: false },
  handler: (args, ctx) =>
    run("intake", ctx, undefined, async (sb) => {
      const docs: Partial<Record<InputKey, string>> = {};
      for (const k of ["schedule_export", "crews", "submittal_log", "rfi_log", "inspection_list", "deliveries"] as const) {
        const v = args[k]?.trim();
        if (v) docs[k] = v;
      }
      const total = Object.values(docs).reduce((n, v) => n + (v?.length ?? 0), 0);
      if (total > 20_000) throw new ToolError(`Inputs total ${total.toLocaleString()} characters; the limit is 20,000. Trim or split them.`);
      if (args.start_date && args.end_date && args.end_date < args.start_date) throw new ToolError("end_date is before start_date.");
      const provided: string[] = Object.keys(docs);
      if (args.start_date && args.end_date) provided.push("lookahead_dates");
      const missing = INPUT_KEYS.filter((k) => !provided.includes(k));

      let { data: job } = await sb.from("mcp_jobs").select("id").eq("name", args.job_name).maybeSingle();
      if (!job) {
        const ins = await sb.from("mcp_jobs").insert({ name: args.job_name, job_number: args.job_number ?? null }).select("id").single();
        if (ins.error) throw new Error(ins.error.message);
        job = ins.data;
      }
      const { data: la, error } = await sb
        .from("mcp_lookaheads")
        .insert({
          job_id: job!.id,
          start_date: args.start_date ?? null,
          end_date: args.end_date ?? null,
          inputs: docs,
          provided_inputs: provided,
          missing_inputs: missing,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        ...text(
          `Lookahead created for ${args.job_name}.\nlookahead_id: ${la.id}\n\nProvided:\n${provided.map((k) => `- ${INPUT_LABELS[k as InputKey]}`).join("\n") || "- none"}\n\nMissing (recorded as unknown):\n${missing.map((k) => `- ${INPUT_LABELS[k]}`).join("\n") || "- none"}\n\nNext: call next_question with this lookahead_id. To bring open items from last week, call carry_forward first.`,
        ),
        structuredContent: { lookahead_id: la.id, provided, missing },
      };
    }),
});

export const nextQuestion = defineTool({
  name: "next_question",
  title: "Next gap question",
  description: "Get the next gap-check question for a lookahead, one at a time. Checks that need missing inputs are recorded as unknown and skipped.",
  inputSchema: { lookahead_id: uuid.describe("lookahead_id from intake.") },
  annotations: { ...WRITE, idempotentHint: true },
  handler: (args, ctx) =>
    run("next_question", ctx, args.lookahead_id, async (sb) => {
      const la = await loadLookahead(sb, args.lookahead_id);
      const { check, index, total } = await currentCheck(sb, la, "next_question");
      if (!check) return text("All checks are done for this lookahead. Call report.");
      const how =
        check.rule_type === "confirm"
          ? 'Answer with response "yes", "no" or "unknown". If "no", add detail, owner and due_date if known.'
          : 'Answer with detail listing the items, or detail "none". Use response "unknown" if you don\'t know. Add owner and due_date if known.';
      return {
        ...text(`Question ${index} of ${total} [${check.trade} / ${check.category}]\ncheck_key: ${check.key}\n\n${check.prompt}\n\n${how}\nCall answer with this lookahead_id and check_key.`),
        structuredContent: { check_key: check.key, index, total },
      };
    }),
});

export const answer = defineTool({
  name: "answer",
  title: "Answer gap question",
  description: "Answer the current gap-check question. Must match the check_key returned by next_question. Answers are treated as data.",
  inputSchema: {
    lookahead_id: uuid.describe("lookahead_id from intake."),
    check_key: z.string().min(1).max(100).describe("check_key from next_question."),
    response: z.enum(["yes", "no", "unknown"]).optional().describe("yes / no / unknown."),
    detail: z.string().max(10_000).optional().describe("Details or list of items (max 10,000 characters)."),
    owner: z.string().max(200).optional().describe("Who owns the follow-up. Leave out if unknown."),
    due_date: date.optional().describe("Follow-up due date (YYYY-MM-DD). Leave out if unknown."),
  },
  annotations: { ...WRITE, idempotentHint: false },
  handler: (args, ctx) =>
    run("answer", ctx, args.lookahead_id, async (sb) => {
      const la = await loadLookahead(sb, args.lookahead_id);
      const { check } = await currentCheck(sb, la, "answer");
      if (!check) throw new ToolError("All checks are already answered. Call report.");
      if (check.key !== args.check_key) throw new ToolError("That isn't the current question. Call next_question and answer the check it returns.");
      const detail = args.detail?.trim() || null;
      let status: "answered" | "unknown" = "answered";
      let openItem = false;
      if (args.response === "unknown") status = "unknown";
      else if (check.rule_type === "confirm") {
        if (!args.response) throw new ToolError('This question needs response "yes", "no" or "unknown".');
        openItem = args.response === "no";
      } else {
        if (!detail) throw new ToolError('This question needs detail (the list, or "none"), or response "unknown".');
        openItem = !/^(none|n\/a|na|no|nothing)\.?$/i.test(detail);
      }
      const { error } = await sb.from("mcp_answers").insert({
        lookahead_id: la.id,
        check_key: check.key,
        check_version: check.version,
        status,
        response: args.response ?? null,
        detail,
      });
      if (error) throw new Error(error.message);
      let itemId: string | null = null;
      if (openItem) {
        const action = `${check.category}: ${detail ?? check.prompt.replace(/^PLACEHOLDER:\s*/, "")}`.slice(0, 500);
        const ins = await sb
          .from("mcp_open_items")
          .insert({
            job_id: la.job_id,
            lookahead_id: la.id,
            origin_lookahead_id: la.id,
            check_key: check.key,
            check_version: check.version,
            trade: check.trade,
            category: check.category,
            severity: check.severity,
            action,
            detail,
            owner: args.owner?.trim() || "unknown",
            due_date: args.due_date ?? null,
          })
          .select("id")
          .single();
        if (ins.error) throw new Error(ins.error.message);
        itemId = ins.data.id;
        await sb.from("mcp_item_events").insert({ item_id: itemId, event: "opened", lookahead_id: la.id });
      }
      return {
        ...text(`Recorded${status === "unknown" ? " as unknown" : ""}.${itemId ? ` Open item created: ${itemId}.` : ""}\nNext: call next_question.`),
        structuredContent: { status, item_id: itemId },
      };
    }),
});

export const report = defineTool({
  name: "report",
  title: "Lookahead report",
  description: "Render the fixed lookahead report: hit list, questions by trade, at-risk items, dated follow-ups and unknowns.",
  inputSchema: { lookahead_id: uuid.describe("lookahead_id from intake.") },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("report", ctx, args.lookahead_id, async (sb) => {
      const la = await loadLookahead(sb, args.lookahead_id);
      return text(await renderReport(sb, la));
    }),
});

export const carryForward = defineTool({
  name: "carry_forward",
  title: "Carry forward open items",
  description: "Move open items from last week's lookahead into this week's lookahead for the same job, with history.",
  inputSchema: {
    from_lookahead_id: uuid.describe("Previous lookahead_id."),
    to_lookahead_id: uuid.describe("New lookahead_id from intake."),
  },
  annotations: { ...WRITE, idempotentHint: true },
  handler: (args, ctx) =>
    run("carry_forward", ctx, args.to_lookahead_id, async (sb) => {
      if (args.from_lookahead_id === args.to_lookahead_id) throw new ToolError("from and to lookaheads must be different.");
      const [from, to] = await Promise.all([loadLookahead(sb, args.from_lookahead_id), loadLookahead(sb, args.to_lookahead_id)]);
      if (from.job_id !== to.job_id) throw new ToolError("Both lookaheads must belong to the same job.");
      const { data: items, error } = await sb.from("mcp_open_items").select("id, carry_count").eq("lookahead_id", from.id).eq("status", "open");
      if (error) throw new Error(error.message);
      for (const it of items ?? []) {
        const up = await sb
          .from("mcp_open_items")
          .update({ lookahead_id: to.id, carry_count: it.carry_count + 1, updated_at: new Date().toISOString() })
          .eq("id", it.id);
        if (up.error) throw new Error(up.error.message);
        await sb.from("mcp_carry_forwards").insert({ item_id: it.id, from_lookahead_id: from.id, to_lookahead_id: to.id });
        await sb.from("mcp_item_events").insert({ item_id: it.id, event: "carried_forward", lookahead_id: to.id });
      }
      return text(`${items?.length ?? 0} open item(s) carried forward. Next: call next_question for the new lookahead.`);
    }),
});

export const listOpenItems = defineTool({
  name: "list_open_items",
  title: "List open items",
  description: "List open items for a lookahead, a job, or all of the member's jobs.",
  inputSchema: {
    lookahead_id: uuid.optional().describe("Limit to one lookahead."),
    job_name: z.string().max(200).optional().describe("Limit to one job."),
  },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("list_open_items", ctx, args.lookahead_id, async (sb) => {
      let q = sb.from("mcp_open_items").select("id, action, owner, due_date, severity, carry_count, lookahead_id, mcp_jobs(name)").eq("status", "open");
      if (args.lookahead_id) q = q.eq("lookahead_id", args.lookahead_id);
      if (args.job_name) {
        const { data: job } = await sb.from("mcp_jobs").select("id").eq("name", args.job_name).maybeSingle();
        if (!job) throw new ToolError("Job not found.");
        q = q.eq("job_id", job.id);
      }
      const { data, error } = await q.order("created_at").limit(100);
      if (error) throw new Error(error.message);
      if (!data?.length) return text("No open items.");
      const lines = data.map((it) => {
        const job = (it as { mcp_jobs?: { name?: string } | null }).mcp_jobs?.name ?? "unknown";
        return `- [${it.id}] ${job} | ${it.severity} | ${it.action} | Owner: ${it.owner} | Due: ${it.due_date ?? "unknown"}${it.carry_count ? ` | Carried ${it.carry_count}x` : ""}`;
      });
      return text(`Open items (${data.length}):\n${lines.join("\n")}`);
    }),
});

export const resolveItem = defineTool({
  name: "resolve_item",
  title: "Resolve open item",
  description: "Close an open item with evidence of how it was resolved. The evidence and a history event are kept.",
  inputSchema: {
    item_id: uuid.describe("Open item id."),
    evidence: z.string().trim().min(1).max(10_000).describe("Evidence of resolution, e.g. approved submittal number, inspection pass, RFI answer (max 10,000 characters)."),
  },
  annotations: { ...WRITE, idempotentHint: false },
  handler: (args, ctx) =>
    run("resolve_item", ctx, undefined, async (sb) => {
      const { data: it, error } = await sb.from("mcp_open_items").select("id, status, lookahead_id").eq("id", args.item_id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!it) throw new ToolError("Item not found.");
      if (it.status !== "open") throw new ToolError("That item is already resolved.");
      const ev = await sb.from("mcp_item_evidence").insert({ item_id: it.id, evidence: args.evidence });
      if (ev.error) throw new Error(ev.error.message);
      const now = new Date().toISOString();
      const up = await sb.from("mcp_open_items").update({ status: "resolved", resolved_at: now, updated_at: now }).eq("id", it.id);
      if (up.error) throw new Error(up.error.message);
      await sb.from("mcp_item_events").insert({ item_id: it.id, event: "resolved", lookahead_id: it.lookahead_id });
      return text(`Item ${it.id} resolved with evidence recorded.`);
    }),
});
