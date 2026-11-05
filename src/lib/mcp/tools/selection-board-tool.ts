import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  boardSchema,
  boardSummary,
  changeTermsOf,
  defaultChangeTerms,
  differenceFromAllowance,
  ESTIMATE_LINE_REF,
  extended,
  httpsUrl,
  normalizeUrl,
  optionNames,
  packageTerms,
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
import { canonical, enforceReviews, type ReviewGrant } from "../../selections/reviews";
import {
  estimateLineOptions,
  lineOptionsText,
  optionLinks,
  optionNameLink,
  selectionLineOptions,
} from "../../selections/estimate-options";
import { SAVE_OFFER_GUIDANCE } from "../estimate-options";
import {
  conflictLine,
  lineLabel,
  lineMismatch,
  matchingLines,
  openLineConflicts,
  provisionalNote,
  type CheckGap,
} from "../../selections/line-checks";
import { suggestLines, type LineCandidate } from "../../selections/line-candidates";
import { proposalNextSteps, type PortalState } from "../../selections/proposal-next-steps";
import { timeLabel, timeSentence } from "../../selections/change-terms";
import type { CardModel } from "../cards/model";
import { parseState } from "../estimating";
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
function saveBoard(sb: Sb, jobId: string, expected: number, board: Board) {
  const checked = boardSchema.safeParse(board);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new ToolError(
      `The board is not valid${issue?.path.length ? ` at ${issue.path.join(".")}` : ""}: ${(issue?.message ?? "check the values").replace(/\.$/, "")}. Nothing was saved.`,
    );
  }
  return boardRpc(sb, "mcp_residential_selections_save", {
    _job: jobId,
    _expected_version: expected,
    _board: checked.data,
  });
}

const blankOption = (): Option => ({
  description: "",
  manufacturer: "",
  model: "",
  specifications: "",
  included: [],
  product_url: null,
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
        `${tierLabel(tier)}: ${o.description || o.model ? optionNameLink(productName(o), o) : productName(o)}${o.description ? ` · ${o.description}` : ""}`,
        `  Specs: ${o.specifications || "Unknown"} · Included: ${o.included.length ? o.included.join("; ") : "None listed"}`,
        `  Product page (contractor only, never shown to the customer): ${o.product_url ?? "None"} · Photo: ${o.photo_url ?? "Unknown"} · Price read on (internal): ${o.source_url ?? "Unknown"}`,
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
      `${tierLabel(p.tier)}: proposal total ${money(t.total_cents, code)} · ${signed(t.difference_cents, code)} vs base${p.tier === board.proposal.base_tier ? "" : ` · ${timeLabel(packageTerms(board, p.tier).schedule_days)} · added cost ${money(packageTerms(board, p.tier).added_cents, code)}${packageTerms(board, p.tier).added_note ? ` (${packageTerms(board, p.tier).added_note})` : ""}`} · selections price ${money(p.selections.price_cents, code)}, cost ${money(p.selections.cost_cents, code)}, margin ${money(p.selections.margin_cents, code)} (${percent(p.selections.margin_bp)}), markup ${percent(p.selections.markup_bp)}`,
    );
  }
  lines.push(
    "Margin and markup cover the selections only; the base price's own cost is not on this board.",
    `Extra time and added cost per upgrade: ${changeTermsOf(board).reviewed_on ? `confirmed ${changeTermsOf(board).reviewed_on}` : "NOT CONFIRMED (set with set_change_terms before sending to the client page)"}`,
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
      `${tierLabel(p.tier)}: ${money(p.total_cents, code)}${p.tier === view.base_tier ? " (base proposal)" : ` · ${signed(p.difference_cents, code)} vs base · ${timeSentence(p.schedule_days ?? 0)}${p.added_cents ? ` Includes ${money(p.added_cents, code)}${p.added_note ? ` for ${p.added_note}` : " added cost"}.` : ""}`}`,
    );
  for (const s of view.selections) {
    lines.push("", `${s.title} · ${s.quantity} ${s.unit}`);
    for (const tier of optionNames) {
      const o = s.options[tier];
      lines.push(
        `${tierLabel(tier)}: ${[o.manufacturer, o.model].filter(Boolean).join(" ")}${o.description ? ` · ${o.description}` : ""}${o.specifications ? ` · ${o.specifications}` : ""}${o.included.length ? ` · Includes: ${o.included.join("; ")}` : ""}`,
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
async function takeoffLines(sb: Sb, jobId: string, raw?: unknown) {
  const data = z
    .object({
      takeoff: z
        .object({ lines: z.array(z.unknown()) })
        .passthrough()
        .nullable()
        .optional(),
    })
    .passthrough()
    .safeParse(raw ?? (await call(sb, "mcp_estimate_get", { _job: jobId })));
  if (!data.success) throw new ToolError("The estimate could not be read. Nothing was saved.");
  return (data.data.takeoff?.lines ?? []).flatMap((raw) => {
    const line = lineSchema.safeParse(raw);
    return line.success ? [line.data] : [];
  });
}
/** Takeoff lines plus the open drawing gaps and their verdicts, from one read. */
async function estimateRead(sb: Sb, jobId: string) {
  const raw = await call(sb, "mcp_estimate_get", { _job: jobId });
  const lines = await takeoffLines(sb, jobId, raw);
  let gaps: CheckGap[] = [];
  let verdicts: { item_kind: string; gap_ref: string | null }[] = [];
  try {
    const state = parseState(raw);
    gaps = state.gaps;
    verdicts = state.verdicts;
  } catch {
    // An unreadable gap list never blocks a selection; it only shows no conflicts.
  }
  return { lines, gaps, verdicts };
}

/** A selection named for other fixture types than its line is on the wrong line. */
function refuseMismatch(
  title: string | undefined,
  line: { line_no: number; item?: string | null },
  lines: { line_no: number; item?: string | null; qty?: number | null; unit?: string | null }[],
) {
  if (!title || !lineMismatch(title, line.item)) return;
  const better = matchingLines(title, lines);
  throw new ToolError(
    `"${title}" doesn't match estimate line T-${line.line_no}, which is ${line.item ?? "another item"}. ${
      better.length
        ? `The takeoff lines for it are: ${better.map(lineLabel).join("; ")}. Use those refs.`
        : "Ask the member which takeoff line it belongs to."
    } Nothing was saved.`,
  );
}

/**
 * An open conflict on the line has to be settled by the member's choice of
 * basis before options are saved against one reading of the drawings.
 */
function needBasis(ref: string, conflicts: CheckGap[], basis: string | undefined): void {
  if (!conflicts.length || basis) return;
  throw new ToolError(
    [
      `Estimate line ${ref} has an open drawing conflict, so there is no single spec to build Good, Better, Best against yet:`,
      ...conflicts.map((g) => `- ${conflictLine(g)}`),
      "Tell the member and offer two ways. Recommended: run it now on the basis they name (for example the electrical schedule), marked provisional until the conflict or its RFI is answered; the customer view stays locked until then. Or hold until the answer comes back. Once they pick provisional, call again with basis set to what they chose. Nothing was saved.",
    ].join("\n"),
  );
}

async function takeoffLine(sb: Sb, jobId: string, ref: string) {
  const lineNo = Number(ref.slice(2));
  const line = (await takeoffLines(sb, jobId)).find((l) => l.line_no === lineNo);
  if (line) return line;
  throw new ToolError(
    `Estimate line ${ref} was not found on the saved takeoff. Nothing was saved.`,
  );
}

/** Hosts that draw no card still show where each option can be seen. */
const OPTION_LINKS_GUIDANCE =
  "When you show the options, give each one a link the member can click: its product page, or the seller page its price was read on when no product page is saved. In a table, put the option's product name as the markdown link this result gives it, so the link stays in the table. Use only the links in this result.";

/**
 * Each saved option's links, listed in the reply text so a host that draws no
 * card (Claude) still shows them, and a note for any option missing one.
 */
function linkBrief(s: Selection, tiers: readonly OptionName[] = optionNames): string[] {
  const out: string[] = [];
  const missing: string[] = [];
  for (const tier of tiers) {
    const o = s.options[tier];
    if (!o.description && !o.model) continue;
    out.push(`  ${tierLabel(tier)} ${productName(o)}: ${optionLinks(o)}`);
    const gaps = [!o.product_url && "product page", !o.photo_url && "photo"].filter(Boolean);
    if (gaps.length) missing.push(`${tierLabel(tier)} has no ${gaps.join(" or ")}`);
  }
  if (missing.length)
    out.push(
      `  Missing links: ${missing.join("; ")}. Read that product's page and send what it shows with propose_option; never make a link up.`,
    );
  return out;
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
    "For each, read the product page and capture: manufacturer, model or catalog number, a short customer description, key specifications, what is included, a direct https photo URL, the listed unit price with the seller and the date you read it, and two links: source_url, the seller page you read the price on (internal), and product_url, the manufacturer's own product page, kept for the contractor and never shown to the customer. Send product_url and photo_url for every option, read from the product page; never use a store listing that shows a price as product_url, and leave a link empty only when no page shows one.",
    "The customer sees the selection title and each option's description, manufacturer, model, specifications and included items, so write them for the customer. RFI numbers, drawing conflicts, provisional status, price leads and where a price came from are internal: put them in the option's assumptions (review_price or apply_markup) or the selection notes, never in those fields. The customer view stays locked while any of them holds one.",
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
    product_url: z.preprocess(normalizeUrl, httpsUrl).default(null),
    source_url: z.preprocess(normalizeUrl, httpsUrl).default(null),
    photo_url: z.preprocess(normalizeUrl, httpsUrl).default(null),
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

const packageTermsPatch = z
  .object({
    schedule_days: z.number().int().min(0).max(3650),
    added_cents: z.number().int().min(0).max(999_999_999_999),
    added_note: z
      .string()
      .trim()
      .max(300)
      .describe("What the added cost is for, as the customer reads it, e.g. Extra install labor."),
  })
  .partial()
  .strict();
const changeTermsPatch = z
  .object({ good: packageTermsPatch, better: packageTermsPatch, best: packageTermsPatch })
  .partial()
  .strict();

/**
 * The card the contractor sees before an upgrade goes to the customer: each upgrade package with its
 * product difference, extra time and added cost, and what the customer will read before they sign.
 */
export function changeTermsCard(board: Board, jobLabel: string, confirmed: boolean): CardModel {
  const code = board.currency;
  const totals = packageTotals(board);
  const ups = optionNames.filter((t) => t !== board.proposal.base_tier);
  return {
    state: confirmed ? "result" : "ask",
    show_state: false,
    title: confirmed ? "Time and cost confirmed" : "Time and cost for each upgrade",
    job: jobLabel,
    sections: [
      {
        heading: `Upgrades from ${tierLabel(board.proposal.base_tier)}`,
        kind: "table",
        columns: ["Package", "Products", "Added cost", "Extra time", "Change to the contract"],
        rows: ups.map((t) => {
          const terms = packageTerms(board, t);
          const d = totals[t].difference_cents;
          return {
            cells: [
              tierLabel(t),
              d === null ? "Not priced" : signed(d - terms.added_cents, code),
              terms.added_cents
                ? `${money(terms.added_cents, code)}${terms.added_note ? ` · ${terms.added_note}` : ""}`
                : "None",
              timeLabel(terms.schedule_days),
              d === null ? "Not priced" : signed(d, code),
            ],
          };
        }),
      },
      {
        heading: "What the customer reads before they sign",
        kind: "list",
        rows: ups.map((t) => ({
          cells: [`${tierLabel(t)}: ${timeSentence(packageTerms(board, t).schedule_days)}`],
        })),
      },
    ],
    ask: confirmed
      ? null
      : {
          prompt: `Does ${ups.map(tierLabel).join(" or ")} need extra time or added cost beyond the product price? Both stay at 0 unless you change them.`,
        },
    next_move: confirmed
      ? "Next: send the proposal to the customer's client page."
      : "Enter any extra days and added cost (with what it's for), or confirm none.",
  };
}

const comparisonLineSchema = z
  .object({
    estimate_line_ref: z.string().regex(ESTIMATE_LINE_REF),
    title: z.string().trim().min(1).max(160).optional(),
    notes: z.string().trim().max(2000).optional(),
    options: z
      .object({ good: candidateSchema, better: candidateSchema, best: candidateSchema })
      .strict(),
  })
  .strict();

const sameProduct = (a: Option, b: Option) => {
  const key = (o: Option) =>
    [o.manufacturer, o.model, o.description].map((v) => v.trim().toLowerCase()).join("|");
  return key(a) === key(b);
};

/** Puts a comparison's product on one tier; keeps the contractor's cost and price when it's the same product. */
function placeCandidate(
  s: Selection,
  tier: OptionName,
  candidate: z.infer<typeof candidateSchema>,
) {
  const old = s.options[tier];
  const next: Option = {
    ...blankOption(),
    ...candidateSchema.parse(candidate),
    assumptions: old.assumptions,
  };
  if (old.description && sameProduct(old, next)) {
    next.cost_cents = old.cost_cents;
    next.price_cents = old.price_cents;
    next.price_reviewed_on = old.price_reviewed_on;
  } else if (s.selected === tier) s.selected = null;
  s.options[tier] = next;
}

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

const SKIP_LABEL = {
  code_required: "code-required life-safety items",
  rough_in: "rough-in, wiring, gear and connections",
  accessory: "accessories that follow another line's choice",
  no_quantity: "lines with no quantity yet",
  not_a_choice: "items the customer doesn't choose",
} as const;

/** Estimate lines worth offering Good, Better and Best on, most customer-visible first. */
async function suggestReply(sb: Sb, job: Awaited<ReturnType<typeof resolveJob>>) {
  const read = await estimateRead(sb, job.job_id);
  const saved = await readBoard(sb, job.job_id);
  const refs = saved.board.selections.flatMap((s) =>
    s.estimate_line_ref ? [s.estimate_line_ref] : [],
  );
  const result = suggestLines(read.lines, refs);
  const byNo = new Map(read.lines.map((l) => [l.line_no, l]));
  const conflictsFor = (c: LineCandidate) =>
    openLineConflicts(byNo.get(c.line_no)!, read.gaps, read.verdicts).map((g) => g.ref);
  const row = (c: LineCandidate) => {
    const open = conflictsFor(c);
    return `- ${c.estimate_line_ref} ${c.item}, ${c.qty} ${c.unit}: ${c.why}${open.length ? ` Open drawing question ${open.join(", ")}: settle it first, or run the options as provisional.` : ""}`;
  };
  const skipped = (Object.keys(SKIP_LABEL) as (keyof typeof SKIP_LABEL)[])
    .filter((k) => result.skipped[k] > 0)
    .map((k) => `${result.skipped[k]} ${SKIP_LABEL[k]}`);
  const lines = [
    `${named(job)} · Lines worth offering Good, Better, Best`,
    ...(read.lines.length
      ? result.suggested.length
        ? ["", "Suggested, most customer-visible first:", ...result.suggested.map(row)]
        : ["", "No estimate line is a clear Good, Better, Best candidate yet."]
      : ["", "This job has no takeoff lines yet. Build the takeoff first."]),
    ...(result.on_board.length
      ? ["", "Already on the selections board:", ...result.on_board.map(row)]
      : []),
    ...(skipped.length ? ["", `Left out: ${skipped.join("; ")}.`] : []),
    "",
    "Nothing was saved. Suggestions don't change the estimate.",
  ];
  return guide(
    {
      ...text(lines.join("\n")),
      structuredContent: {
        version: saved.version,
        suggested: result.suggested.map((c) => ({ ...c, open_conflicts: conflictsFor(c) })),
        on_board: result.on_board,
        skipped: result.skipped,
        internal: true,
      } as unknown as JsonValueInput,
    },
    "Show the suggested lines with their reason in one short list, most visible first, and say which already have options. The contractor picks: ask which lines to build Good, Better, Best on, then call selection_board start with each chosen estimate_line_ref. Never start a selection the member didn't pick.",
    "Good meets the drawings and specification at the lowest sound cost, Better adds useful features or quality, and Best is premium quality, efficiency or controls. Explain it that way when the member asks how the tiers are chosen.",
  );
}

async function lineOptionsReply(
  sb: Sb,
  job: Awaited<ReturnType<typeof resolveJob>>,
  ref: string | undefined,
) {
  const saved = await readBoard(sb, job.job_id);
  const lines = ref
    ? saved.board.selections
        .filter((s) => s.estimate_line_ref === ref)
        .slice(0, 1)
        .map((s) => selectionLineOptions(saved.board, s)!)
    : [...estimateLineOptions(saved.board).values()];
  if (!lines.length)
    return guide(
      {
        ...text(
          `${named(job)} · ${ref ? `Estimate line ${ref} has` : "No estimate line has"} no Good, Better, Best options saved yet.`,
        ),
        structuredContent: {
          version: saved.version,
          line_options: [],
          internal: true,
        } as unknown as JsonValueInput,
      },
      "To add options, prepare a Good, Better, Best comparison for the line, then ask the member whether to save it with selection_board save_comparison.",
    );
  return guide(
    {
      ...text(
        [
          `${named(job)} · Good, Better, Best options (board v${saved.version})`,
          ...lines.flatMap((l) => ["", ...lineOptionsText(l)]),
          "",
          "Saved options do not change the estimate total.",
        ].join("\n"),
      ),
      structuredContent: {
        version: saved.version,
        line_options: lines,
        internal: true,
      } as unknown as JsonValueInput,
    },
    "This view is internal: cost, found price, margin and markup are for the contractor only. Show the three options side by side for each line, with product, sell price, cost, margin and markup, and say which are not priced yet.",
    OPTION_LINKS_GUIDANCE,
    "To price an option, ask for its unit cost and either its markup or sell price, then call review_price with confirmed true after the member says yes.",
  );
}

/** This is a contractor's record, not evidence of a client approval. */
export const selectionBoard = defineTool({
  name: "selection_board",
  title: "Good, Better, Best selections",
  description:
    "Builds a job's Good, Better and Best selections from estimate lines: suggests which estimate lines are worth offering options on (suggest), starts a selection and its sourcing brief, stores products the member's AI found on the web, saves a whole Good/Better/Best or value-engineering comparison to its estimate lines after the member says yes (save_comparison), shows one line's options with cost, sell price and margin side by side (options), sets each upgrade package's extra schedule days and added cost before it goes to the customer (set_change_terms, 0 by default), and records the contractor's reviewed cost and sell price per option or one markup across options (apply_markup), without changing the estimate total, budgets or accounting.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    action: z.enum([
      "read",
      "options",
      "suggest",
      "start",
      "propose_option",
      "save_comparison",
      "review_price",
      "apply_markup",
      "set_proposal",
      "set_change_terms",
      "remove_selection",
      "save",
    ]),
    expected_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    estimate_line_ref: z.string().regex(ESTIMATE_LINE_REF).optional(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .optional()
      .describe(
        "The selection's name as the customer reads it, for example Type A track heads. No RFI numbers, provisional status or other internal notes.",
      ),
    quantity: z.number().positive().max(1_000_000).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    selection_id: z.uuid().optional(),
    tier: z.enum(optionNames).optional(),
    candidate: candidateSchema.optional(),
    cost_cents: z.number().int().min(0).max(100_000_000_000).optional(),
    price_cents: z.number().int().min(0).max(100_000_000_000).optional(),
    markup_pct: z.number().min(0).max(1000).optional(),
    cost_basis: z.enum(["entered", "found"]).optional(),
    comparison: z.array(comparisonLineSchema).min(1).max(20).optional(),
    base_tier: z.enum(optionNames).optional(),
    basis: z
      .string()
      .trim()
      .min(3)
      .max(300)
      .optional()
      .describe(
        'Only when an estimate line has an open drawing conflict: the basis the member chose to run on, for example "E1 schedule, pending RFI-001". The options are saved marked provisional in the internal selection notes and the customer view stays locked until the conflict is settled. Keep the basis out of the selection title.',
      ),
    assumptions: z.string().trim().max(1000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    proposal: proposalPatch.optional(),
    change_terms: changeTermsPatch
      .optional()
      .describe(
        "set_change_terms only: extra schedule days and added cost beyond the product price for each upgrade package, as the member gives them. Leave a package out to keep it as is; both default to 0. The base package is the contract scope and takes none.",
      ),
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
        const writes =
          args.action !== "read" && args.action !== "options" && args.action !== "suggest";
        if (
          !writes &&
          (args.board || args.expected_version !== undefined || args.candidate || args.comparison)
        )
          throw new ToolError("Read requests cannot include changes.");
        if (args.action === "options") return lineOptionsReply(sb, job, args.estimate_line_ref);
        if (args.action === "suggest") return suggestReply(sb, job);
        if (args.action === "save" && (!args.board || args.expected_version === undefined))
          throw new ToolError(
            "Read the current board first and provide its version and the complete updated board.",
          );

        const current = writes ? await readBoard(sb, job.job_id) : null;
        // A comparison only touches the lines it names, so it can save on the version read here.
        const expected =
          (args.action === "save_comparison" ||
            (args.action === "set_change_terms" && args.confirmed !== true)) &&
          args.expected_version === undefined
            ? current?.version
            : args.expected_version;
        if (current && current.version !== needVersion(expected))
          throw new ToolError(
            "Selections changed since you read them. Read the board again. Nothing was saved.",
          );
        let next: Board | null = current ? structuredClone(current.board) : null;
        const brief: string[] = [];
        let grant: ReviewGrant = {};
        const skipped: string[] = [];

        if (args.action === "start") {
          if (!args.estimate_line_ref && !args.title)
            throw new ToolError(
              "Name the estimate line (for example T-3) or give the selection a title. Nothing was saved.",
            );
          const read = args.estimate_line_ref ? await estimateRead(sb, job.job_id) : null;
          const line = args.estimate_line_ref
            ? (read!.lines.find((l) => l.line_no === Number(args.estimate_line_ref!.slice(2))) ??
              (await takeoffLine(sb, job.job_id, args.estimate_line_ref)))
            : null;
          if (line) refuseMismatch(args.title, line, read!.lines);
          const conflicts = line ? openLineConflicts(line, read!.gaps, read!.verdicts) : [];
          if (line) needBasis(args.estimate_line_ref!, conflicts, args.basis);
          const existing = args.estimate_line_ref
            ? next!.selections.find((s) => s.estimate_line_ref === args.estimate_line_ref)
            : undefined;
          if (line)
            brief.push(
              `Linked to ${lineLabel(line)}.`,
              ...(conflicts.length
                ? [
                    `Provisional on: ${args.basis}. Open: ${conflicts.map((g) => g.ref).join(", ")}.`,
                  ]
                : []),
            );
          if (existing) {
            if (conflicts.length && args.basis)
              existing.notes = provisionalNote(
                args.basis,
                conflicts.map((g) => g.ref),
                existing.notes,
              );
            brief.push(...sourcingBrief(existing, line));
          } else {
            const quantity = args.quantity ?? line?.qty ?? null;
            if (quantity === null || !(Math.round(quantity * 1000) > 0))
              throw new ToolError(
                "The quantity is unknown. Ask the member for it. Nothing was saved.",
              );
            if (
              args.unit &&
              line?.unit &&
              args.unit.trim().toLowerCase() !== line.unit.trim().toLowerCase()
            )
              throw new ToolError(
                `Takeoff line ${args.estimate_line_ref} is measured in ${line.unit}, so price this selection per ${line.unit}. Nothing was saved.`,
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
              notes:
                conflicts.length && args.basis
                  ? provisionalNote(
                      args.basis,
                      conflicts.map((g) => g.ref),
                      "",
                    )
                  : "",
            };
            next!.selections.push(created);
            brief.push(...sourcingBrief(created, line));
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
            ...candidateSchema.parse(args.candidate),
            assumptions: s.options[args.tier].assumptions,
          };
          if (s.selected === args.tier) s.selected = null;
          brief.push(...linkBrief(s, [args.tier]));
        } else if (args.action === "save_comparison") {
          if (!args.comparison?.length)
            throw new ToolError(
              "Send the comparison: each estimate line with its Good, Better and Best products. Nothing was saved.",
            );
          if (args.confirmed !== true)
            throw new ToolError(
              "Ask the member whether to save these Good, Better and Best options to the estimate lines, and pass confirmed true only after they say yes. Nothing was saved.",
            );
          const refs = args.comparison.map((c) => c.estimate_line_ref);
          if (new Set(refs).size !== refs.length)
            throw new ToolError(
              "Each estimate line can appear once in a comparison. Nothing was saved.",
            );
          const read = await estimateRead(sb, job.job_id);
          const lines = new Map(read.lines.map((l) => [`T-${l.line_no}`, l]));
          const conflictsByRef = new Map<string, CheckGap[]>();
          for (const c of args.comparison) {
            const line = lines.get(c.estimate_line_ref);
            if (!line)
              throw new ToolError(
                `Estimate line ${c.estimate_line_ref} was not found on the saved takeoff. Nothing was saved.`,
              );
            refuseMismatch(c.title, line, read.lines);
            const conflicts = openLineConflicts(line, read.gaps, read.verdicts);
            needBasis(c.estimate_line_ref, conflicts, args.basis);
            conflictsByRef.set(c.estimate_line_ref, conflicts);
          }
          for (const c of args.comparison) {
            const line = lines.get(c.estimate_line_ref)!;
            const conflicts = conflictsByRef.get(c.estimate_line_ref) ?? [];
            let s = next!.selections.find((x) => x.estimate_line_ref === c.estimate_line_ref);
            if (!s) {
              const quantity = line.qty ?? null;
              if (quantity === null || !(Math.round(quantity * 1000) > 0))
                throw new ToolError(
                  `Takeoff line ${c.estimate_line_ref} has no quantity yet. Settle it first. Nothing was saved.`,
                );
              s = {
                id: crypto.randomUUID(),
                title: (c.title ?? line.item ?? "").slice(0, 160) || "Selection",
                decision_due: null,
                allowance_cents: null,
                quantity: Math.round(quantity * 1000) / 1000,
                unit: (line.unit ?? "ea").slice(0, 20) || "ea",
                estimate_line_ref: c.estimate_line_ref,
                options: { good: blankOption(), better: blankOption(), best: blankOption() },
                selected: null,
                notes: "",
              };
              next!.selections.push(s);
            } else if (c.title) s.title = c.title;
            if (c.notes !== undefined) s.notes = c.notes;
            if (conflicts.length && args.basis)
              s.notes = provisionalNote(
                args.basis,
                conflicts.map((g) => g.ref),
                s.notes,
              );
            for (const tier of optionNames) placeCandidate(s, tier, c.options[tier]);
            brief.push(
              `${lineLabel(line)}: saved${conflicts.length ? `, provisional on ${args.basis} (open ${conflicts.map((g) => g.ref).join(", ")})` : ""}.`,
              ...linkBrief(s),
            );
          }
          if (args.base_tier) next!.proposal.base_tier = args.base_tier;
          if (args.currency && !next!.currency) next!.currency = args.currency;
        } else if (args.action === "review_price") {
          // A markup on cost sets the sell price; a stated sell price wins.
          const priceCents =
            args.price_cents ??
            (args.markup_pct !== undefined && args.cost_cents !== undefined
              ? Math.round((args.cost_cents * (100 + args.markup_pct)) / 100)
              : undefined);
          if (
            !args.selection_id ||
            !args.tier ||
            args.cost_cents === undefined ||
            priceCents === undefined ||
            priceCents > 100_000_000_000
          )
            throw new ToolError(
              "Send selection_id, tier, cost_cents and either price_cents or markup_pct. Nothing was saved.",
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
          o.price_cents = priceCents;
          o.price_reviewed_on = today;
          if (args.assumptions !== undefined) o.assumptions = args.assumptions;
          grant = { option: { id: s.id, tier: args.tier } };
        } else if (args.action === "apply_markup") {
          if (args.markup_pct === undefined)
            throw new ToolError("Send markup_pct, the markup on cost. Nothing was saved.");
          if (args.confirmed !== true)
            throw new ToolError(
              `Show the member which options get a ${args.markup_pct}% markup on ${args.cost_basis === "found" ? "the found web price as their cost" : "their entered cost"} and the resulting sell prices, and ask them to confirm. Nothing was saved.`,
            );
          const targets = next!.selections.filter(
            (s) => !args.estimate_line_ref || s.estimate_line_ref === args.estimate_line_ref,
          );
          if (!targets.length)
            throw new ToolError(
              `${args.estimate_line_ref ? `Estimate line ${args.estimate_line_ref} has` : "The board has"} no Good, Better, Best options to price. Nothing was saved.`,
            );
          const reviewed: { id: string; tier: OptionName }[] = [];
          for (const s of targets)
            for (const tier of args.tier ? [args.tier] : optionNames) {
              const o = s.options[tier];
              if (!o.description) continue;
              const cost =
                args.cost_basis === "found" ? (o.cost_cents ?? o.found_price_cents) : o.cost_cents;
              if (cost === null) {
                skipped.push(
                  `${s.title} (${tierLabel(tier)}): no ${args.cost_basis === "found" ? "cost or found price" : "cost"}`,
                );
                continue;
              }
              const price = Math.round((cost * (100 + args.markup_pct)) / 100);
              if (price > 100_000_000_000) {
                skipped.push(`${s.title} (${tierLabel(tier)}): sell price out of range`);
                continue;
              }
              o.cost_cents = cost;
              o.price_cents = price;
              o.price_reviewed_on = today;
              if (args.assumptions !== undefined) o.assumptions = args.assumptions;
              else if (
                args.cost_basis === "found" &&
                cost === o.found_price_cents &&
                !o.assumptions
              )
                o.assumptions = `Cost is the found web price${o.found_at ? ` at ${o.found_at}` : ""}; ${args.markup_pct}% markup.`;
              reviewed.push({ id: s.id, tier });
            }
          if (!reviewed.length)
            throw new ToolError(
              `No option could be priced: ${skipped.join("; ")}. Ask the member for each option's cost. Nothing was saved.`,
            );
          grant = { options: reviewed };
        } else if (args.action === "set_proposal") {
          if (!args.proposal && !args.currency && !args.review_base_price)
            throw new ToolError("Send the proposal details to change. Nothing was saved.");
          const patch = args.proposal ?? {};
          next!.proposal = proposalSchema.parse({ ...next!.proposal, ...patch });
          if (args.currency) next!.currency = args.currency;
          if (args.review_base_price) {
            if (args.confirmed !== true)
              throw new ToolError(
                "Show the member the base price and its basis and ask them to confirm. Nothing was saved.",
              );
            if (next!.proposal.base_price_cents === null)
              throw new ToolError("Set the base price before reviewing it. Nothing was saved.");
            next!.proposal.base_reviewed_on = today;
            grant = { base: true };
          }
        } else if (args.action === "set_change_terms") {
          const base = next!.proposal.base_tier;
          if (args.change_terms?.[base])
            throw new ToolError(
              `${tierLabel(base)} is the base package, already in the contract price, so it takes no extra time or added cost. Set them on the upgrades. Nothing was saved.`,
            );
          const terms = structuredClone(next!.proposal.change_terms ?? defaultChangeTerms());
          for (const t of optionNames) Object.assign(terms[t], args.change_terms?.[t] ?? {});
          next!.proposal.change_terms = terms;
          if (args.confirmed !== true) {
            // Show the card and ask; nothing is saved until the member confirms.
            const shown = boardSchema.parse(next!);
            return guide(
              {
                ...text(
                  [
                    `${named(job)} · Time and added cost for each upgrade (not saved yet)`,
                    ...optionNames
                      .filter((t) => t !== base)
                      .map((t) => {
                        const k = packageTerms(shown, t);
                        return `${tierLabel(t)}: ${timeLabel(k.schedule_days)} · added cost ${money(k.added_cents, shown.currency)}${k.added_note ? ` (${k.added_note})` : ""} · the customer reads: "${timeSentence(k.schedule_days)}"`;
                      }),
                    "",
                    "Every change order carries money and time. Both stay at 0 unless the member changes them.",
                  ].join("\n"),
                ),
                structuredContent: {
                  saved: false,
                  version: current!.version,
                  change_terms: terms,
                  packages: packageTotals(shown),
                  card: changeTermsCard(shown, named(job), false),
                  internal: true,
                } as unknown as JsonValueInput,
              },
              "Show this card and ask the member, for each upgrade package, whether it needs extra schedule days or added cost beyond the product price (extra install labor, for example), with a few words on what the added cost is for. Both default to 0.",
              "When they answer, or say none is needed, call set_change_terms again with expected_version, their numbers in change_terms, and confirmed true. Confirming 0 is a real answer: it tells the customer no added time is needed.",
              "If the member isn't sure how many days a change needs, say a schedule update can work it out; for now take the number they give.",
            );
          }
          grant = { terms: true };
          next!.proposal.change_terms = { ...terms, reviewed_on: today };
          brief.push(
            `Time and added cost confirmed: ${optionNames
              .filter((t) => t !== base)
              .map((t) => {
                const k = terms[t];
                return `${tierLabel(t)} ${timeLabel(k.schedule_days).toLowerCase()}, added cost ${money(k.added_cents, next!.currency)}`;
              })
              .join("; ")}.`,
          );
        } else if (args.action === "remove_selection") {
          if (!args.selection_id)
            throw new ToolError("Send the selection_id to remove. Nothing was saved.");
          const s = findSelection(next!, args.selection_id);
          if (args.confirmed !== true)
            throw new ToolError(
              `Ask the member whether to remove "${s.title}"${s.estimate_line_ref ? ` from estimate line ${s.estimate_line_ref}` : ""} with its options, and pass confirmed true only after they say yes. Nothing was saved.`,
            );
          if (next!.accepted && s.selected)
            throw new ToolError(
              "The customer's accepted choice includes this selection, so it stays. Nothing was saved.",
            );
          next!.selections = next!.selections.filter((x) => x.id !== s.id);
          brief.push(
            `Removed "${s.title}"${s.estimate_line_ref ? ` from ${s.estimate_line_ref}` : ""}.`,
          );
        } else if (args.action === "save") {
          next = args.board!;
          // A full save that leaves the time and cost out keeps them; only set_change_terms changes them.
          if (!next.proposal.change_terms && current!.board.proposal.change_terms)
            next = {
              ...next,
              proposal: { ...next.proposal, change_terms: current!.board.proposal.change_terms },
            };
        }

        // Only a confirmed review in this call can set a review date; a change
        // to what an earlier review covers marks it not reviewed again.
        const guarded = current && next ? enforceReviews(current.board, next, grant) : null;
        const parsedNext = guarded ? boardSchema.safeParse(guarded.board) : null;
        const unchanged =
          !!parsedNext?.success && canonical(parsedNext.data) === canonical(current!.board);
        const result =
          args.action === "read"
            ? await readBoard(sb, job.job_id)
            : unchanged
              ? current!
              : await saveBoard(sb, job.job_id, current!.version, guarded!.board);
        const saved = writes && !unchanged;
        const cleared = guarded && !unchanged ? guarded.cleared : [];

        return guide(
          {
            ...text(
              [
                `${named(job)} · Good, Better, Best${saved ? " · saved" : writes ? " · nothing changed" : ""}`,
                ...(cleared.length
                  ? [
                      `Marked not reviewed again because what they cover changed: ${cleared.join(", ")}. Ask the member to confirm them again.`,
                      "",
                    ]
                  : []),
                ...(brief.length ? [...brief, ""] : []),
                ...(skipped.length ? [`Not priced: ${skipped.join("; ")}.`, ""] : []),
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
              saved,
              reviews_cleared: cleared,
              shared: false,
              internal: true,
            } as unknown as JsonValueInput,
          },
          "This board is internal: cost, found price, margin, markup, assumptions and notes are for the contractor only. Never put them in a customer message; use selection_proposal preview for the customer view.",
          OPTION_LINKS_GUIDANCE,
          "To source products, use your own web search to find real products, read each product page, then call propose_option once per tier with what the page shows. If you can't search the web, ask the member to paste product links and read those. Never invent a product, link, photo or price.",
          "A found price is a lead, never a customer price. Call review_price with confirmed true only after the member states or confirms the unit cost and the sell price or markup for that option. For one markup across options (a line, a tier or the whole board), use apply_markup with markup_pct, and cost_basis found only when the member says to use the found web price as their cost.",
          SAVE_OFFER_GUIDANCE,
          "Save only the changes the member asked for, using the version you just read. A save cannot mark a price reviewed; use review_price or review_base_price. Saving does not share anything or change the estimate, contract, budget or billing.",
          ...(args.action === "save_comparison" && saved
            ? [
                "Tell the member the options are saved on those estimate lines, which now show Good/Better/Best options, and that the estimate total did not change. Found prices are leads: to compare margin, ask for each option's cost and markup or sell price and record them with review_price after their yes.",
              ]
            : []),
        );
      },
    ),
});

/**
 * Who is on the job's client page and whether a proposal already waits there,
 * for the next steps after a preview. Null when the client page can't be read
 * (not installed, or the member can't manage it); the steps then still lead there.
 */
async function portalState(sb: Sb, jobId: string): Promise<PortalState | null> {
  try {
    const { data, error } = await (
      sb.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    )("mcp_portal_list", { _job: jobId });
    if (error) return null;
    const parsed = z
      .object({
        customers: z.array(
          z
            .object({ name: z.string(), email: z.string(), revoked_at: z.string().nullable() })
            .passthrough(),
        ),
        items: z.array(
          z
            .object({
              kind: z.string(),
              withdrawn_at: z.string().nullable(),
              decision: z
                .object({ decision: z.string(), choice: z.string().nullable() })
                .passthrough()
                .nullable(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .safeParse(data);
    if (!parsed.success) return null;
    const live = parsed.data.items.filter((i) => i.kind === "selection" && !i.withdrawn_at);
    return {
      customers: parsed.data.customers
        .filter((c) => !c.revoked_at)
        .map((c) => ({ name: c.name, email: c.email })),
      open_on_client_page: live.some((i) => !i.decision),
      chosen_on_client_page:
        live.find((i) => i.decision?.decision === "chosen")?.decision?.choice ?? null,
    };
  } catch {
    return null;
  }
}

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
          const steps = proposalNextSteps(
            view,
            saved.version,
            await portalState(sb, job.job_id),
            changeTermsOf(saved.board).reviewed_on !== null,
          );
          return guide(
            {
              ...text(
                [
                  `${named(job)} · Customer view preview (board v${saved.version}). This is exactly what the customer sees; no costs, margin or notes.`,
                  "",
                  ...customerText(view),
                  "",
                  "Next steps:",
                  ...steps.map((st, i) => `${i + 1}. ${st.label}. ${st.detail}`),
                ].join("\n"),
              ),
              structuredContent: {
                ready: true,
                version: saved.version,
                customer_view: view,
                next_steps: steps,
              } as unknown as JsonValueInput,
            },
            "Show only this customer view. Do not add cost, margin, markup, found prices, assumptions or notes.",
            "Then walk the member through what comes next: end your reply with the next steps in the order given, as short choices they can tap, the first one as the main choice, each with its one-line detail. Don't leave the member to work out the process, and don't skip a step. Each step that changes, invites, sends or shares needs the member's yes first: for an invite, show the customer's name and email; for sending to the client page, say the customer will be emailed. Then do the step exactly as its how says, and after it offer the next one.",
            "The client page is where the customer chooses and approves: Send it to their client page is the main way to send a proposal. The view-only link is a secondary option for a quick look; never offer it as the way to get the customer's approval.",
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
          const blockers = proposalBlockers(saved.board);
          if (blockers.length)
            throw new ToolError(
              `The customer proposal is not ready: ${blockers.join(" ")} No link was made.`,
            );
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
        // Check units against the takeoff so a cost per unit lands on a line measured the same way.
        const lineUnits = new Map(
          (await takeoffLines(sb, job.job_id).catch(() => [])).map(
            (l) => [`T-${l.line_no}`, l.unit ?? null] as const,
          ),
        );
        const carry = estimateCarry(recorded.board, args.tier, lineUnits);
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
                      return `- ${c.ref} ${c.item}: material unit cost ${money(Math.round(c.unit_price * 100), code)} per ${c.unit} for ${c.product} · ${s.quantity} ${s.unit} = ${money(extended(s.quantity, Math.round(c.unit_price * 100)), code)}`;
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
