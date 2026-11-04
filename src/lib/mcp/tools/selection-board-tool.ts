import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  boardSchema,
  boardSummary,
  differenceFromAllowance,
  ESTIMATE_LINE_REF,
  extended,
  optionNames,
  proposalSchema,
  type Board,
  type Option,
  type OptionName,
  type Selection,
} from "../../selections/model";
import {
  contractorReview,
  customerProposal,
  customerProposalSchema,
  estimateCarry,
  packageTotals,
  proposalBlockers,
  TIER_LABEL,
  type CustomerProposal,
} from "../../selections/proposal";
import { money, percent, signed } from "../../selections/format";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { jobTimeZone, named, resolveJob } from "../jobs";
import { todayIn } from "../deadlines";
import { guide } from "../visible";
import { newToken, tokenHash, TOKEN_RE } from "../file-share";
import { PAGE_ORIGIN, shareExpiry, SHARE_MAX_DAYS } from "../../report-pages";

const NOT_INSTALLED = "Selections storage is not installed yet. Nothing was saved.";
const NO_RECORD_CHANGE =
  "No contract, budget, SOV, billing or accounting record was changed, and the estimate was not written.";

async function call(sb: Sb, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await (
    sb.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (result.error && isMissingFunction(result.error)) throw new ToolError(NOT_INSTALLED);
  if (result.error) dbError(result.error);
  return result.data;
}

type SavedBoard = { version: number; board: Board; scope: string | null };
const savedSchema = z
  .object({
    version: z.number().int().nonnegative(),
    board: boardSchema,
    scope: z.string().nullable().optional(),
  })
  .passthrough();
async function boardRpc(sb: Sb, name: string, args: Record<string, unknown>): Promise<SavedBoard> {
  const parsed = savedSchema.safeParse(await call(sb, name, args));
  if (!parsed.success)
    throw new ToolError(
      "The selections result could not be verified. If this was a save, it may have completed; read the current board before retrying.",
    );
  return {
    version: parsed.data.version,
    board: parsed.data.board,
    scope: parsed.data.scope ?? null,
  };
}
const readBoard = (sb: Sb, jobId: string) =>
  boardRpc(sb, "mcp_residential_selections_get", { _job: jobId });
const saveBoard = (sb: Sb, jobId: string, expected: number, board: Board) =>
  boardRpc(sb, "mcp_residential_selections_save", {
    _job: jobId,
    _expected_version: expected,
    _board: boardSchema.parse(board),
  });

const blankOption = (): Option => ({
  description: "",
  manufacturer: "",
  model: "",
  specifications: "",
  included: [],
  source_url: null,
  photo_url: null,
  found_price_cents: null,
  found_at: "",
  found_on: null,
  cost_cents: null,
  price_cents: null,
  price_reviewed_on: null,
  assumptions: "",
});

const tierLabel = (tier: OptionName) => TIER_LABEL[tier];
const productName = (o: Option) =>
  [o.manufacturer, o.model].filter(Boolean).join(" ") || o.description || "No product yet";

/** The contractor's private board text: products, leads, cost, price, margin. */
function contractorText(board: Board, version: number, today: string): string[] {
  const code = board.currency;
  const summary = boardSummary(board, today);
  const review = contractorReview(board);
  const totals = packageTotals(board);
  const lines = [
    `Selections board v${version} · INTERNAL, not for the customer`,
    `${summary.total} selections · ${summary.pending} awaiting a choice · ${summary.overdue} overdue · ${summary.missing_date} need a decision date`,
    `Base proposal price: ${money(board.proposal.base_price_cents, code)} (includes ${tierLabel(board.proposal.base_tier)} options) · ${board.proposal.base_reviewed_on ? `reviewed ${board.proposal.base_reviewed_on}` : "NOT REVIEWED"}${board.proposal.base_basis ? ` · basis: ${board.proposal.base_basis}` : ""}`,
  ];
  for (const s of board.selections) {
    const row = review.selections.find((r) => r.id === s.id)!;
    lines.push(
      "",
      `${s.title} · ${s.quantity} ${s.unit}${s.estimate_line_ref ? ` · estimate line ${s.estimate_line_ref}` : " · not linked to an estimate line"} · selection id ${s.id}`,
      `Decision due: ${s.decision_due ?? "Unknown"} · allowance: ${money(s.allowance_cents, code)} · recorded choice: ${s.selected ? tierLabel(s.selected) : "None"}`,
    );
    for (const tier of optionNames) {
      const o = s.options[tier];
      const m = row.options[tier];
      lines.push(
        `${tierLabel(tier)}: ${productName(o)}${o.description ? ` · ${o.description}` : ""}`,
        `  Specs: ${o.specifications || "Unknown"} · Included: ${o.included.length ? o.included.join("; ") : "None listed"}`,
        `  Source: ${o.source_url ?? "Unknown"} · Photo: ${o.photo_url ?? "Unknown"}`,
        `  Found: ${money(o.found_price_cents, code)} per ${s.unit}${o.found_at ? ` at ${o.found_at}` : ""}${o.found_on ? ` on ${o.found_on}` : ""} (a web lead, not a price)`,
        `  Unit cost ${money(o.cost_cents, code)} · unit price ${money(o.price_cents, code)} · ${o.price_reviewed_on ? `price reviewed ${o.price_reviewed_on}` : "PRICE NOT REVIEWED"}`,
        `  Extended: price ${money(m.price_cents, code)} · cost ${money(m.cost_cents, code)} · margin ${money(m.margin_cents, code)} (${percent(m.margin_bp)}) · markup ${percent(m.markup_bp)} · vs allowance ${signed(differenceFromAllowance(s, tier), code)}${o.assumptions ? ` · assumptions: ${o.assumptions}` : ""}`,
      );
    }
  }
  lines.push("", "Packages (contractor view):");
  for (const p of review.packages) {
    const t = totals[p.tier];
    lines.push(
      `${tierLabel(p.tier)}: proposal total ${money(t.total_cents, code)} · ${signed(t.difference_cents, code)} vs base · selections price ${money(p.selections.price_cents, code)}, cost ${money(p.selections.cost_cents, code)}, margin ${money(p.selections.margin_cents, code)} (${percent(p.selections.margin_bp)}), markup ${percent(p.selections.markup_bp)}`,
    );
  }
  lines.push(
    "Margin and markup cover the selections only; the base price's own cost is not on this board.",
  );
  if (board.accepted)
    lines.push(
      `Recorded customer choice: ${tierLabel(board.accepted.tier)} · ${money(board.accepted.total_cents, code)} · on ${board.accepted.recorded_on} against v${board.accepted.board_version} · ${board.accepted.evidence}${board.accepted.board_version === version ? "" : ` · the board changed after this choice (now v${version}); confirm it again with the customer`}`,
    );
  const blockers = proposalBlockers(board);
  lines.push(
    "",
    blockers.length
      ? `Not ready for the customer:\n${blockers.map((b) => `- ${b}`).join("\n")}`
      : "Ready for the customer preview.",
  );
  if (review.warnings.length) lines.push(`Check: ${review.warnings.join(" ")}`);
  return lines;
}

/** The customer view as plain text. It holds no cost, margin or notes by construction. */
export function customerText(view: CustomerProposal): string[] {
  const code = view.currency;
  const lines = [`${view.title}`];
  if (view.intro) lines.push(view.intro);
  lines.push("");
  for (const p of view.packages)
    lines.push(
      `${tierLabel(p.tier)}: ${money(p.total_cents, code)}${p.tier === view.base_tier ? " (base proposal)" : ` · ${signed(p.difference_cents, code)} vs base`}`,
    );
  for (const s of view.selections) {
    lines.push("", `${s.title} · ${s.quantity} ${s.unit}`);
    for (const tier of optionNames) {
      const o = s.options[tier];
      lines.push(
        `${tierLabel(tier)}: ${[o.manufacturer, o.model].filter(Boolean).join(" ")}${o.description ? ` · ${o.description}` : ""}${o.specifications ? ` · ${o.specifications}` : ""}${o.included.length ? ` · Includes: ${o.included.join("; ")}` : ""}${o.source_url ? ` · ${o.source_url}` : ""}`,
      );
    }
  }
  if (view.accepted)
    lines.push("", `Selected: ${tierLabel(view.accepted.tier)} on ${view.accepted.recorded_on}`);
  if (view.valid_until) lines.push(`Prices valid until ${view.valid_until}.`);
  if (view.terms) lines.push(view.terms);
  return lines;
}

const lineSchema = z
  .object({
    line_no: z.number().int(),
    item: z.string().nullable().optional(),
    material: z.string().nullable().optional(),
    qty: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    sheet: z.string().nullable().optional(),
    detail: z.string().nullable().optional(),
    spec_section: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .passthrough();
async function takeoffLine(sb: Sb, jobId: string, ref: string) {
  const data = z
    .object({
      takeoff: z
        .object({ lines: z.array(z.unknown()) })
        .passthrough()
        .nullable()
        .optional(),
    })
    .passthrough()
    .safeParse(await call(sb, "mcp_estimate_get", { _job: jobId }));
  if (!data.success) throw new ToolError("The estimate could not be read. Nothing was saved.");
  const lineNo = Number(ref.slice(2));
  for (const raw of data.data.takeoff?.lines ?? []) {
    const line = lineSchema.safeParse(raw);
    if (line.success && line.data.line_no === lineNo) return line.data;
  }
  throw new ToolError(
    `Estimate line ${ref} was not found on the saved takeoff. Nothing was saved.`,
  );
}

function sourcingBrief(s: Selection, line: z.infer<typeof lineSchema> | null): string[] {
  return [
    `Sourcing brief for ${s.title} (${s.quantity} ${s.unit}${s.estimate_line_ref ? `, estimate line ${s.estimate_line_ref}` : ""}) · selection id ${s.id}`,
    ...(line
      ? [
          `From the takeoff: ${line.item ?? "Unknown item"} · qty ${line.qty ?? "Unknown"} ${line.unit ?? ""} · sheet ${line.sheet ?? "Unknown"}${line.detail ? ` · ${line.detail}` : ""}${line.spec_section ? ` · spec ${line.spec_section}` : ""}`,
          ...(line.note ? [`Takeoff note: ${line.note}`] : []),
        ]
      : []),
    "Find three real products that meet the drawings and specifications: Good (meets the spec at the lowest sound cost), Better (adds useful features or quality) and Best (premium quality, efficiency or controls).",
    "For each, read the product page and capture: manufacturer, model or catalog number, a short customer description, key specifications, what is included, the product page URL, a direct https photo URL, and the listed unit price with the seller and the date you read it.",
    "Submit each one with selection_board action propose_option. Never invent a product, link, photo or price; leave a field empty when the page doesn't show it.",
    "If the drawings or takeoff note show a conflict, say so and don't pick a side.",
  ];
}

const candidateSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    manufacturer: z.string().trim().max(120).default(""),
    model: z.string().trim().max(120).default(""),
    specifications: z.string().trim().max(2000).default(""),
    included: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
    source_url: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable()
      .default(null),
    photo_url: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable()
      .default(null),
    found_price_cents: z.number().int().min(0).max(100_000_000_000).nullable().default(null),
    found_at: z.string().trim().max(160).default(""),
    found_on: z.iso.date().nullable().default(null),
  })
  .strict();

const proposalPatch = z
  .object({
    title: z.string().trim().max(160),
    intro: z.string().trim().max(1200),
    base_price_cents: z.number().int().min(0).max(999_999_999_999).nullable(),
    base_tier: z.enum(optionNames),
    base_basis: z.string().trim().max(300),
    valid_until: z.iso.date().nullable(),
    terms: z.string().trim().max(2000),
  })
  .partial()
  .strict();

const findSelection = (board: Board, id: string) => {
  const s = board.selections.find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!s)
    throw new ToolError(
      "That selection is not on the board. Read the board first. Nothing was saved.",
    );
  return s;
};
const needVersion = (v: number | undefined) => {
  if (v === undefined)
    throw new ToolError("Read the current board first and pass its version. Nothing was saved.");
  return v;
};

/** This is a contractor's record, not evidence of a client approval. */
export const selectionBoard = defineTool({
  name: "selection_board",
  title: "Good, Better, Best selections",
  description:
    "Builds a job's Good, Better and Best selections from estimate lines: starts a selection and its sourcing brief, stores products the member's AI found on the web, and records the contractor's reviewed cost and price, without writing estimates, budgets or accounting.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    action: z.enum(["read", "start", "propose_option", "review_price", "set_proposal", "save"]),
    expected_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    estimate_line_ref: z.string().regex(ESTIMATE_LINE_REF).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    quantity: z.number().positive().max(1_000_000).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    selection_id: z.uuid().optional(),
    tier: z.enum(optionNames).optional(),
    candidate: candidateSchema.optional(),
    cost_cents: z.number().int().min(0).max(100_000_000_000).optional(),
    price_cents: z.number().int().min(0).max(100_000_000_000).optional(),
    assumptions: z.string().trim().max(1000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    proposal: proposalPatch.optional(),
    review_base_price: z.boolean().optional(),
    confirmed: z.boolean().optional(),
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
        const today = todayIn(await jobTimeZone(sb, job.job_id));
        const writes = args.action !== "read";
        if (!writes && (args.board || args.expected_version !== undefined || args.candidate))
          throw new ToolError("Read requests cannot include changes.");
        if (args.action === "save" && (!args.board || args.expected_version === undefined))
          throw new ToolError(
            "Read the current board first and provide its version and the complete updated board.",
          );

        const current = writes && args.action !== "save" ? await readBoard(sb, job.job_id) : null;
        if (current && current.version !== needVersion(args.expected_version))
          throw new ToolError(
            "Selections changed since you read them. Read the board again. Nothing was saved.",
          );
        const next: Board | null = current ? structuredClone(current.board) : null;
        let brief: string[] = [];

        if (args.action === "start") {
          if (!args.estimate_line_ref && !args.title)
            throw new ToolError(
              "Name the estimate line (for example T-3) or give the selection a title. Nothing was saved.",
            );
          const line = args.estimate_line_ref
            ? await takeoffLine(sb, job.job_id, args.estimate_line_ref)
            : null;
          const existing = args.estimate_line_ref
            ? next!.selections.find((s) => s.estimate_line_ref === args.estimate_line_ref)
            : undefined;
          if (existing) {
            brief = sourcingBrief(existing, line);
          } else {
            const quantity = args.quantity ?? line?.qty ?? null;
            if (quantity === null || !(quantity > 0))
              throw new ToolError(
                "The quantity is unknown. Ask the member for it. Nothing was saved.",
              );
            const created: Selection = {
              id: crypto.randomUUID(),
              title: (args.title ?? line?.item ?? "").slice(0, 160) || "Selection",
              decision_due: null,
              allowance_cents: null,
              quantity: Math.round(quantity * 1000) / 1000,
              unit: (args.unit ?? line?.unit ?? "ea").slice(0, 20) || "ea",
              estimate_line_ref: args.estimate_line_ref ?? null,
              options: { good: blankOption(), better: blankOption(), best: blankOption() },
              selected: null,
              notes: "",
            };
            next!.selections.push(created);
            brief = sourcingBrief(created, line);
          }
        } else if (args.action === "propose_option") {
          if (!args.selection_id || !args.tier || !args.candidate)
            throw new ToolError(
              "Send selection_id, tier and the candidate product. Nothing was saved.",
            );
          const s = findSelection(next!, args.selection_id);
          // A new product clears any reviewed price: the contractor reviews again.
          s.options[args.tier] = {
            ...blankOption(),
            ...args.candidate,
            assumptions: s.options[args.tier].assumptions,
          };
          if (s.selected === args.tier) s.selected = null;
        } else if (args.action === "review_price") {
          if (
            !args.selection_id ||
            !args.tier ||
            args.cost_cents === undefined ||
            args.price_cents === undefined
          )
            throw new ToolError(
              "Send selection_id, tier, cost_cents and price_cents. Nothing was saved.",
            );
          if (args.confirmed !== true)
            throw new ToolError(
              "Show the member the cost and price and ask them to confirm. Nothing was saved.",
            );
          const s = findSelection(next!, args.selection_id);
          const o = s.options[args.tier];
          if (!o.description)
            throw new ToolError(
              "Add a product for this option before pricing it. Nothing was saved.",
            );
          o.cost_cents = args.cost_cents;
          o.price_cents = args.price_cents;
          o.price_reviewed_on = today;
          if (args.assumptions !== undefined) o.assumptions = args.assumptions;
        } else if (args.action === "set_proposal") {
          if (!args.proposal && !args.currency && !args.review_base_price)
            throw new ToolError("Send the proposal details to change. Nothing was saved.");
          const patch = args.proposal ?? {};
          const baseChanged =
            patch.base_price_cents !== undefined &&
            patch.base_price_cents !== next!.proposal.base_price_cents;
          next!.proposal = proposalSchema.parse({ ...next!.proposal, ...patch });
          if (args.currency) next!.currency = args.currency;
          if (baseChanged || patch.base_tier !== undefined) next!.proposal.base_reviewed_on = null;
          if (args.review_base_price) {
            if (args.confirmed !== true)
              throw new ToolError(
                "Show the member the base price and its basis and ask them to confirm. Nothing was saved.",
              );
            if (next!.proposal.base_price_cents === null)
              throw new ToolError("Set the base price before reviewing it. Nothing was saved.");
            next!.proposal.base_reviewed_on = today;
          }
        }

        const result =
          args.action === "read"
            ? await readBoard(sb, job.job_id)
            : args.action === "save"
              ? await saveBoard(sb, job.job_id, needVersion(args.expected_version), args.board!)
              : await saveBoard(sb, job.job_id, current!.version, next!);

        return guide(
          {
            ...text(
              [
                `${named(job)} · Good, Better, Best${writes ? " · saved" : ""}`,
                ...(brief.length ? [...brief, ""] : []),
                ...contractorText(result.board, result.version, today),
                "",
                `A recorded choice is not owner approval or a contract change. ${NO_RECORD_CHANGE}`,
              ].join("\n"),
            ),
            structuredContent: {
              version: result.version,
              board: result.board,
              packages: packageTotals(result.board),
              review: contractorReview(result.board),
              blockers: proposalBlockers(result.board),
              saved: writes,
              shared: false,
              internal: true,
            } as unknown as JsonValueInput,
          },
          "This board is internal: cost, found price, margin, markup, assumptions and notes are for the contractor only. Never put them in a customer message; use selection_proposal preview for the customer view.",
          "To source products, use your own web search to find real products, read each product page, then call propose_option once per tier with what the page shows. If you can't search the web, ask the member to paste product links and read those. Never invent a product, link, photo or price.",
          "A found price is a lead. Call review_price with confirmed true only after the member states or confirms the unit cost and the customer unit price for that option.",
          "Save only the changes the member asked for, using the version you just read. Saving does not share anything or change the estimate, contract, budget or billing.",
        );
      },
    ),
});

const PROPOSAL_PATH = "/p/s/";
export const proposalShareUrl = (token: string, origin = PAGE_ORIGIN) =>
  `${origin.replace(/\/$/, "")}${PROPOSAL_PATH}${token}`;
const tokenFromLink = (link: string) => {
  const m =
    /\/p\/s\/([A-Za-z0-9_-]{43})(?:[/?#]|$)/.exec(link) ??
    /^([A-Za-z0-9_-]{43})$/.exec(link.trim());
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
};

export const selectionProposal = defineTool({
  name: "selection_proposal",
  title: "Good, Better, Best proposal",
  description:
    "Shows the customer's side-by-side Good, Better and Best comparison without costs or margin, makes or turns off its expiring customer link, and records the package the customer chose, without changing contract, budget, billing or estimate records.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    action: z.enum(["preview", "share", "revoke", "record_choice"]),
    expected_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    days: z.number().int().min(1).max(SHARE_MAX_DAYS).optional(),
    link: z.string().trim().min(1).max(400).optional(),
    tier: z.enum(optionNames).optional(),
    evidence: z.string().trim().min(1).max(500).optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "selection_proposal",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(
          sb,
          args.job_number,
          args.company_id,
          args.action === "preview" ? "write" : "full",
        );
        const today = todayIn(await jobTimeZone(sb, job.job_id));

        if (args.action === "revoke") {
          const token = args.link ? tokenFromLink(args.link) : null;
          if (!token) throw new ToolError("Send the proposal link to turn off. Nothing changed.");
          const off = await call(sb, "mcp_selection_proposal_share_revoke", {
            _token_hash: await tokenHash(token),
          });
          return text(
            off
              ? "That proposal link is off. Anyone who opens it now sees that it is no longer available."
              : "No proposal link you can turn off matched. Nothing changed.",
          );
        }

        const saved = await readBoard(sb, job.job_id);
        if (args.action === "preview") {
          const blockers = proposalBlockers(saved.board);
          if (blockers.length)
            return guide(
              {
                ...text(
                  [
                    `${named(job)} · Customer proposal is not ready (board v${saved.version})`,
                    ...blockers.map((b) => `- ${b}`),
                  ].join("\n"),
                ),
                structuredContent: {
                  ready: false,
                  version: saved.version,
                  blockers,
                } as unknown as JsonValueInput,
              },
              "Help the member fix these with selection_board. Nothing was shared.",
            );
          const view = customerProposal(saved.board, saved.version);
          return guide(
            {
              ...text(
                [
                  `${named(job)} · Customer view preview (board v${saved.version}). This is exactly what the customer sees; no costs, margin or notes.`,
                  "",
                  ...customerText(view),
                ].join("\n"),
              ),
              structuredContent: {
                ready: true,
                version: saved.version,
                customer_view: view,
              } as unknown as JsonValueInput,
            },
            "Show only this customer view. Do not add cost, margin, markup, found prices, assumptions or notes. Ask separately before making an expiring customer link with action share and confirmed true.",
          );
        }

        if (args.expected_version === undefined || args.expected_version !== saved.version)
          throw new ToolError(
            "Preview the current proposal first and pass its board version. Nothing changed.",
          );
        if (args.confirmed !== true)
          throw new ToolError(
            args.action === "share"
              ? "Ask the member to confirm making a customer link for this preview. No link was made."
              : "Show the member the package and total, and ask them to confirm the customer's choice. Nothing was recorded.",
          );

        if (args.action === "share") {
          const token = newToken();
          const expires = shareExpiry(args.days);
          const created = z
            .object({
              board_version: z.number().int().positive(),
              proposal: customerProposalSchema,
            })
            .passthrough()
            .safeParse(
              await call(sb, "mcp_selection_proposal_share_create", {
                _job: job.job_id,
                _expected_version: saved.version,
                _token_hash: await tokenHash(token),
                _expires_at: expires.toISOString(),
              }),
            );
          if (!created.success)
            throw new ToolError(
              "The link result could not be verified. Turn off any link you were given and try again.",
            );
          const url = proposalShareUrl(token);
          return guide(
            {
              ...text(
                [
                  `${named(job)} · Customer proposal link (board v${created.data.board_version})`,
                  url,
                  `Expires ${expires.toISOString().slice(0, 10)}. It shows the board as it is now; later edits need a new link.`,
                  "It shows the Good, Better and Best packages, what each includes and its total. No cost, margin or notes.",
                ].join("\n"),
              ),
              structuredContent: {
                url,
                expires_at: expires.toISOString(),
                board_version: created.data.board_version,
                shared: true,
              } as unknown as JsonValueInput,
            },
            "Give the member this link exactly. Do not send it to anyone yourself.",
          );
        }

        // record_choice
        if (!args.tier || !args.evidence)
          throw new ToolError(
            "Say which package the customer chose and how they told you. Nothing was recorded.",
          );
        const recorded = await boardRpc(sb, "mcp_residential_selections_record_choice", {
          _job: job.job_id,
          _expected_version: saved.version,
          _tier: args.tier,
          _recorded_on: today,
          _evidence: args.evidence,
        });
        const carry = estimateCarry(recorded.board, args.tier);
        const code = recorded.board.currency;
        const total = packageTotals(recorded.board)[args.tier];
        return guide(
          {
            ...text(
              [
                `${named(job)} · Recorded: the customer chose ${tierLabel(args.tier)} (board v${recorded.version})`,
                `Proposal total ${money(total.total_cents, code)} · ${signed(total.difference_cents, code)} vs base · ${args.evidence}`,
                "",
                "To carry this into the estimate (not done yet; needs the estimator's yes):",
                ...(carry.carry.length
                  ? carry.carry.map((c) => {
                      const s = recorded.board.selections.find(
                        (x) => x.estimate_line_ref === c.ref,
                      )!;
                      return `- ${c.ref} ${c.item}: material unit cost ${money(Math.round(c.unit_price * 100), code)} for ${c.product} · ${s.quantity} ${s.unit} = ${money(extended(s.quantity, Math.round(c.unit_price * 100)), code)}`;
                    })
                  : ["- Nothing to carry."]),
                ...carry.skipped.map((s) => `- Skipped ${s.title}: ${s.reason}`),
                "",
                "The customer proposal now shows the chosen package. Links made earlier still show the version they froze; make a new link to send the updated proposal.",
                NO_RECORD_CHANGE,
              ].join("\n"),
            ),
            structuredContent: {
              version: recorded.version,
              accepted: recorded.board.accepted,
              estimate_carry: carry,
            } as unknown as JsonValueInput,
          },
          "Recording the customer's choice is not a contract change, change order, budget or billing entry. To carry the chosen products into the estimate, show the member the carry lines and, only after they say yes, call estimate_pricing with material set to those ref and unit_price values and confirmed true. Ask separately before making a new customer link.",
        );
      },
    ),
});
