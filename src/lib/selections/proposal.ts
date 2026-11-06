import { z } from "zod";
import {
  boardSchema,
  extended,
  MAX_CENTS,
  optionNames,
  packageTerms,
  UUID_RE,
  type Board,
  type OptionName,
  type Selection,
} from "./model";
import { internalNote, isProvisional } from "./line-checks";

export const TIER_LABEL: Record<OptionName, string> = {
  good: "Good",
  better: "Better",
  best: "Best",
};

/** Everything that stops a board from becoming a customer proposal. Empty means ready. */
export function proposalBlockers(input: Board): string[] {
  const board = boardSchema.parse(input);
  const blockers: string[] = [];
  if (!board.currency) blockers.push("Set the proposal currency.");
  if (!board.proposal.title) blockers.push("Give the proposal a title.");
  if (board.proposal.base_price_cents === null) blockers.push("Set the base proposal price.");
  else if (board.proposal.base_reviewed_on === null)
    blockers.push("Review the base proposal price.");
  if (board.selections.length === 0) blockers.push("Add at least one selection.");
  for (const selection of board.selections)
    if (isProvisional(selection.notes))
      blockers.push(
        `${selection.title}: provisional until its open drawing conflict is answered. Confirm the options still fit the answer, then take PROVISIONAL off its notes.`,
      );
  const move =
    "Move it to the selection notes or the option's assumptions; the customer sees this text.";
  for (const [field, text] of [
    ["title", board.proposal.title],
    ["intro", board.proposal.intro],
    ["terms", board.proposal.terms],
  ] as const) {
    const note = internalNote(text);
    if (note) blockers.push(`Proposal ${field} has an internal note ("${note}"). ${move}`);
  }
  for (const selection of board.selections) {
    const note = internalNote(selection.title);
    if (note)
      blockers.push(`${selection.title}: its title has an internal note ("${note}"). ${move}`);
  }
  for (const selection of board.selections)
    for (const tier of optionNames) {
      const option = selection.options[tier];
      const where = `${selection.title} (${TIER_LABEL[tier]})`;
      for (const [field, text] of [
        ["description", option.description],
        ["manufacturer", option.manufacturer],
        ["model", option.model],
        ["specifications", option.specifications],
        ["included items", option.included.join("\n")],
      ] as const) {
        const note = internalNote(text);
        if (note) blockers.push(`${where}: its ${field} has an internal note ("${note}"). ${move}`);
      }
      if (!option.description) blockers.push(`${where}: add a description.`);
      if (!option.photo_url?.startsWith("https://"))
        blockers.push(
          `${where}: add a product photo. The customer page never shows an empty photo box.`,
        );
      if (option.price_cents === null) blockers.push(`${where}: set a customer price.`);
      else if (option.price_reviewed_on === null)
        blockers.push(`${where}: review the customer price.`);
    }
  for (const gap of stepUpGaps(board, "price_cents"))
    blockers.push(
      `${gap.title} (${TIER_LABEL[gap.higher]}): sells for ${gap.high === gap.low ? "the same as" : "less than"} ${TIER_LABEL[gap.lower]} (${money(gap.high)} vs ${money(gap.low)} each), so the customer sees no upgrade. Pick a ${TIER_LABEL[gap.higher]} product whose web price for this finish is above ${TIER_LABEL[gap.lower]}'s.`,
    );
  if (blockers.length === 0) {
    const totals = packageTotals(board);
    if (optionNames.some((tier) => totals[tier].total_cents === null))
      blockers.push("A package total is out of range. Check the base price and base tier.");
  }
  return blockers;
}

export type StepUpGap = {
  id: string;
  title: string;
  lower: OptionName;
  higher: OptionName;
  low: number;
  high: number;
};

/**
 * Where a step up doesn't cost more than the tier below it: Better at or under Good, or Best at or
 * under Better, by sell price or by the web price found for that finish. The customer would see a
 * $0 (or negative) upgrade, so neither a save nor a share lets one through.
 */
export function stepUpGaps(
  board: Board,
  field: "price_cents" | "found_price_cents",
  only?: string[],
): StepUpGap[] {
  const gaps: StepUpGap[] = [];
  for (const s of board.selections) {
    if (only && !only.some((id) => id.toLowerCase() === s.id.toLowerCase())) continue;
    for (const [lower, higher] of [
      ["good", "better"],
      ["better", "best"],
    ] as const) {
      const low = s.options[lower][field];
      const high = s.options[higher][field];
      if (
        s.options[lower].description &&
        s.options[higher].description &&
        low !== null &&
        high !== null &&
        high <= low
      )
        gaps.push({ id: s.id, title: s.title, lower, higher, low, high });
    }
  }
  return gaps;
}

const money = (cents: number) =>
  "$" +
  (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Totals =
  | { total_cents: number; difference_cents: number }
  | { total_cents: null; difference_cents: null };
const unknown = { total_cents: null, difference_cents: null } as const;

/**
 * Package total = base price + the change from the base tier's option to this
 * tier's option on every selection + the package's added cost. The base price
 * already includes the base tier's options. Unknown when any amount is missing.
 */
export function packageTotals(input: Board): Record<OptionName, Totals> {
  const board = boardSchema.parse(input);
  const base = board.proposal.base_price_cents;
  const baseTier = board.proposal.base_tier;
  const out = {} as Record<OptionName, Totals>;
  for (const tier of optionNames) {
    if (base === null || !board.currency) {
      out[tier] = unknown;
      continue;
    }
    let delta = 0;
    let known = true;
    // Added cost beyond the products (extra install labor, for example) is part of the change.
    delta += packageTerms(board, tier).added_cents;
    for (const selection of board.selections) {
      const from = extended(selection.quantity, selection.options[baseTier].price_cents);
      const to = extended(selection.quantity, selection.options[tier].price_cents);
      if (from === null || to === null) {
        known = false;
        break;
      }
      delta += to - from;
    }
    const total = base + delta;
    out[tier] =
      known && Math.abs(delta) <= MAX_CENTS && total >= 0 && total <= MAX_CENTS
        ? { total_cents: total, difference_cents: delta }
        : unknown;
  }
  return out;
}

/**
 * A customer never gets a product link: contractors mark up materials, and a maker or store page
 * would show the customer a lower price. Views frozen before that rule may still hold product_url,
 * so it is dropped on read and never rendered.
 */
const dropProductLink = (v: unknown) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const { product_url: _drop, ...rest } = v as Record<string, unknown>;
  void _drop;
  return rest;
};
const customerOptionSchema = z.preprocess(
  dropProductLink,
  z
    .object({
      description: z.string(),
      manufacturer: z.string(),
      model: z.string(),
      specifications: z.string(),
      included: z.array(z.string()),
      photo_url: z.string().nullable(),
      /** This line's price change from the base tier's option, extended for the quantity. Older views lack it. */
      difference_cents: z.number().int().optional(),
    })
    .strict(),
);

/**
 * The only shape a customer ever sees. It is strict, so a cost, margin,
 * assumption or internal note cannot ride along unnoticed.
 */
export const customerProposalSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    title: z.string(),
    intro: z.string(),
    terms: z.string(),
    valid_until: z.iso.date().nullable(),
    base_tier: z.enum(optionNames),
    packages: z
      .array(
        z
          .object({
            tier: z.enum(optionNames),
            total_cents: z.number().int().min(0),
            difference_cents: z.number().int(),
            /** Extra schedule days this package needs. Older views lack it: read as no added time. */
            schedule_days: z.number().int().min(0).optional(),
            /** Added cost beyond the products, already inside difference_cents. */
            added_cents: z.number().int().min(0).optional(),
            added_note: z.string().optional(),
          })
          .strict(),
      )
      .length(3),
    selections: z
      .array(
        z
          .object({
            id: z.string().regex(UUID_RE),
            title: z.string(),
            quantity: z.number().positive(),
            unit: z.string(),
            options: z
              .object({
                good: customerOptionSchema,
                better: customerOptionSchema,
                best: customerOptionSchema,
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    accepted: z
      .object({ tier: z.enum(optionNames), recorded_on: z.iso.date() })
      .strict()
      .nullable(),
  })
  .strict();
export type CustomerProposal = z.infer<typeof customerProposalSchema>;

/**
 * Builds the customer view of board `version`, or throws with every blocker
 * when it is not ready. A recorded choice shows only on the version it was
 * recorded against, so later edits never look customer-approved.
 */
export function customerProposal(input: Board, version: number): CustomerProposal {
  const board = boardSchema.parse(input);
  const blockers = proposalBlockers(board);
  if (blockers.length) throw new Error(`Proposal is not ready: ${blockers.join(" ")}`);
  const totals = packageTotals(board);
  return customerProposalSchema.parse({
    currency: board.currency,
    title: board.proposal.title,
    intro: board.proposal.intro,
    terms: board.proposal.terms,
    valid_until: board.proposal.valid_until,
    base_tier: board.proposal.base_tier,
    packages: optionNames.map((tier) => ({ tier, ...totals[tier], ...packageTerms(board, tier) })),
    selections: board.selections.map((s) => ({
      id: s.id,
      title: s.title,
      quantity: s.quantity,
      unit: s.unit,
      options: Object.fromEntries(
        optionNames.map((tier) => {
          const o = s.options[tier];
          const here = extended(s.quantity, o.price_cents);
          const base = extended(s.quantity, s.options[board.proposal.base_tier].price_cents);
          return [
            tier,
            {
              ...(here !== null && base !== null ? { difference_cents: here - base } : {}),
              description: o.description,
              manufacturer: o.manufacturer,
              model: o.model,
              specifications: o.specifications,
              included: o.included,
              photo_url: o.photo_url,
            },
          ];
        }),
      ),
    })),
    accepted:
      board.accepted && board.accepted.board_version === version
        ? { tier: board.accepted.tier, recorded_on: board.accepted.recorded_on }
        : null,
  });
}

type Margin = {
  price_cents: number | null;
  cost_cents: number | null;
  margin_cents: number | null;
  /** Margin as a share of price, in basis points (2500 = 25.00%). */
  margin_bp: number | null;
  /** Markup on cost, in basis points (3333 = 33.33%). */
  markup_bp: number | null;
};
const margin = (price: number | null, cost: number | null): Margin => {
  const m = price === null || cost === null ? null : price - cost;
  return {
    price_cents: price,
    cost_cents: cost,
    margin_cents: m,
    margin_bp: m === null || price === null || price === 0 ? null : Math.round((m * 10000) / price),
    markup_bp: m === null || cost === null || cost === 0 ? null : Math.round((m * 10000) / cost),
  };
};

/** Contractor-only numbers. Never pass this to a customer page or share. */
export function contractorReview(input: Board) {
  const board = boardSchema.parse(input);
  const warnings: string[] = [];
  const selections = board.selections.map((s: Selection) => ({
    id: s.id,
    title: s.title,
    options: Object.fromEntries(
      optionNames.map((tier) => {
        const o = s.options[tier];
        const row = margin(extended(s.quantity, o.price_cents), extended(s.quantity, o.cost_cents));
        if (o.cost_cents === null) warnings.push(`${s.title} (${TIER_LABEL[tier]}): cost unknown.`);
        if (row.margin_cents !== null && row.margin_cents < 0)
          warnings.push(`${s.title} (${TIER_LABEL[tier]}): price is below cost.`);
        return [
          tier,
          { ...row, assumptions: o.assumptions, price_reviewed_on: o.price_reviewed_on },
        ];
      }),
    ) as Record<OptionName, Margin & { assumptions: string; price_reviewed_on: string | null }>,
  }));
  const packages = optionNames.map((tier) => {
    let price: number | null = 0;
    let cost: number | null = 0;
    for (const s of selections) {
      const o = s.options[tier];
      price = price === null || o.price_cents === null ? null : price + o.price_cents;
      cost = cost === null || o.cost_cents === null ? null : cost + o.cost_cents;
    }
    return { tier, selections: margin(price, cost) };
  });
  return { selections, packages, warnings };
}

/**
 * The estimate pricing a recorded choice implies, for the estimator to review
 * and apply through estimate_pricing. It never writes anything itself.
 */
export function estimateCarry(
  input: Board,
  tier: OptionName,
  /** Takeoff line units by ref. When given, a line that is missing or priced in another unit is skipped. */
  lineUnits?: ReadonlyMap<string, string | null>,
) {
  const board = boardSchema.parse(input);
  const sameUnit = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const carry: { ref: string; unit_price: number; unit: string; item: string; product: string }[] =
    [];
  const skipped: { title: string; reason: string }[] = [];
  const refs = board.selections.map((s) => s.estimate_line_ref).filter(Boolean);
  for (const s of board.selections) {
    const o = s.options[tier];
    const product = [o.manufacturer, o.model].filter(Boolean).join(" ") || o.description;
    if (!s.estimate_line_ref)
      skipped.push({ title: s.title, reason: "Not linked to a takeoff line." });
    else if (refs.filter((r) => r === s.estimate_line_ref).length > 1)
      skipped.push({
        title: s.title,
        reason: `More than one selection is linked to ${s.estimate_line_ref}.`,
      });
    else if (o.cost_cents === null) skipped.push({ title: s.title, reason: "Unit cost unknown." });
    else if (lineUnits && !lineUnits.has(s.estimate_line_ref))
      skipped.push({
        title: s.title,
        reason: `Takeoff line ${s.estimate_line_ref} was not found.`,
      });
    else if (
      lineUnits?.get(s.estimate_line_ref) &&
      !sameUnit(lineUnits.get(s.estimate_line_ref)!, s.unit)
    )
      skipped.push({
        title: s.title,
        reason: `Priced per ${s.unit}, but takeoff line ${s.estimate_line_ref} is in ${lineUnits.get(s.estimate_line_ref)}.`,
      });
    else
      carry.push({
        ref: s.estimate_line_ref,
        unit_price: o.cost_cents / 100,
        unit: s.unit,
        item: s.title,
        product,
      });
  }
  return { tier, carry, skipped };
}
