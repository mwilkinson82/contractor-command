import { z } from "zod";

// Amounts are whole cents. A missing amount is unknown; zero is a real price.
// Option amounts are per unit; a selection's quantity turns them into totals.
const MAX_UNIT_CENTS = 100_000_000_000; // $1,000,000,000.00
export const MAX_CENTS = 999_999_999_999;
const cents = z.number().int().min(0).max(MAX_CENTS).nullable();
const unitCents = z.number().int().min(0).max(MAX_UNIT_CENTS).nullable();
const text = (max: number) => z.string().trim().max(max);
const date = z.iso.date().nullable();
// The same rule as mcp_private.gbb_is_url, so a link that passes here also saves.
export const HTTPS_URL_RE = /^https:\/\/[^/?#\s]+\S*$/;
export const httpsUrl = z
  .string()
  .max(2048)
  .regex(HTTPS_URL_RE, { message: "Use a full https link." })
  .refine(
    (u) => {
      try {
        return new URL(u).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Use a full https link." },
  )
  .nullable();
/** Cleans a link a web search returned (spaces encoded, scheme lower case) before it is checked. */
export function normalizeUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.href : value;
  } catch {
    return value;
  }
}
// The same rule as the database check on selection ids.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const optionNames = ["good", "better", "best"] as const;
export type OptionName = (typeof optionNames)[number];
export const ESTIMATE_LINE_REF = /^T-[1-9][0-9]{0,5}$/;

const optionSchema = z
  .object({
    // Customer-facing product description, e.g. "2x4 LED flat panel, 4000K".
    description: text(500),
    manufacturer: text(120),
    model: text(120),
    specifications: text(2000),
    // Customer-facing "what's included" bullets.
    included: z.array(text(160).pipe(z.string().min(1))).max(12),
    // Customer-facing link: the manufacturer's product page, never a store listing with a price.
    product_url: httpsUrl,
    // Internal: the seller page the found price was read on. Never shown to a customer.
    source_url: httpsUrl,
    photo_url: httpsUrl,
    // What the contractor's AI found on the web: the listed unit price, where it
    // was listed and the day it was read. Internal; it is a lead, not a price.
    found_price_cents: unitCents,
    found_at: text(160),
    found_on: date,
    // Internal contractor unit cost. Never include this in a customer projection.
    cost_cents: unitCents,
    // Customer unit price.
    price_cents: unitCents,
    // The day the contractor reviewed price_cents. Unreviewed prices never reach a customer.
    price_reviewed_on: date,
    // Internal assumptions behind cost and price. Never shown to a customer.
    assumptions: text(1000),
  })
  .strict()
  .superRefine((option, ctx) => {
    if (option.price_reviewed_on !== null && option.price_cents === null)
      ctx.addIssue({
        code: "custom",
        path: ["price_reviewed_on"],
        message: "A price must be set before it can be marked reviewed.",
      });
  });

// Quantities carry at most three decimals so totals stay exact.
const quantity = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((q) => Number(q.toFixed(3)) === q, {
    message: "Quantity can have at most three decimals.",
  });

export const selectionSchema = z
  .object({
    id: z.string().regex(UUID_RE),
    title: text(160).pipe(z.string().min(1)),
    decision_due: date,
    allowance_cents: cents,
    quantity,
    unit: text(20).pipe(z.string().min(1)),
    // Takeoff line this selection prices, e.g. "T-1". Null when not linked.
    estimate_line_ref: z.string().regex(ESTIMATE_LINE_REF).nullable(),
    options: z.object({ good: optionSchema, better: optionSchema, best: optionSchema }).strict(),
    selected: z.enum(optionNames).nullable(),
    // Internal notes. Never shown to a customer.
    notes: text(2000),
  })
  .strict()
  .superRefine((selection, ctx) => {
    if (selection.selected && !selection.options[selection.selected].description) {
      ctx.addIssue({
        code: "custom",
        path: ["selected"],
        message: "The selected option needs a description.",
      });
    }
  });

/**
 * What one package changes beyond its products' price difference. Every change order carries money
 * and time, so the contractor states both before the customer sees the proposal: extra schedule days
 * and any added cost (extra install labor, for example). Both are 0 unless the contractor says
 * otherwise. The base package is the contract scope, so its terms are always read as 0.
 */
export const packageTermsSchema = z
  .object({
    schedule_days: z.number().int().min(0).max(3650),
    added_cents: z.number().int().min(0).max(MAX_CENTS),
    // Customer-facing: what the added cost is for, e.g. "Extra install labor for the vertical heads".
    added_note: text(300),
  })
  .strict();

export const changeTermsSchema = z
  .object({
    good: packageTermsSchema,
    better: packageTermsSchema,
    best: packageTermsSchema,
    // Set only when the member confirms the terms (set_change_terms with confirmed true).
    reviewed_on: date,
  })
  .strict();

export const proposalSchema = z
  .object({
    // Customer-facing heading and introduction.
    title: text(160),
    intro: text(1200),
    // Customer price of everything else in the proposal, which already includes
    // the base tier's option for every selection.
    base_price_cents: cents,
    base_tier: z.enum(optionNames),
    base_reviewed_on: date,
    // Internal note on where the base price came from, e.g. "Bid summary Nov 4".
    base_basis: text(300),
    valid_until: date,
    // Customer-facing terms and exclusions.
    terms: text(2000),
    // Extra time and added cost per package. Older boards have none: read as 0, not reviewed.
    change_terms: changeTermsSchema.optional(),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    if (proposal.base_reviewed_on !== null && proposal.base_price_cents === null)
      ctx.addIssue({
        code: "custom",
        path: ["base_reviewed_on"],
        message: "A base price must be set before it can be marked reviewed.",
      });
  });

/** Written only by the record-choice function, never by a board save. */
export const acceptedSchema = z
  .object({
    tier: z.enum(optionNames),
    board_version: z.number().int().positive(),
    total_cents: z.number().int().min(0).max(MAX_CENTS),
    recorded_on: z.iso.date(),
    recorded_by: z.uuid(),
    evidence: text(500).pipe(z.string().min(1)),
  })
  .strict();

export const boardSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    proposal: proposalSchema,
    selections: z.array(selectionSchema).max(100),
    accepted: acceptedSchema.nullable(),
  })
  .strict()
  .superRefine((board, ctx) => {
    const ids = new Set<string>();
    for (const [index, selection] of board.selections.entries()) {
      const id = selection.id.toLowerCase();
      if (ids.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["selections", index, "id"],
          message: "Selection IDs must be unique.",
        });
      }
      ids.add(id);
    }
  });

export type Option = z.infer<typeof optionSchema>;
export type Selection = z.infer<typeof selectionSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Accepted = z.infer<typeof acceptedSchema>;
export type Board = z.infer<typeof boardSchema>;
export type PackageTerms = z.infer<typeof packageTermsSchema>;
export type ChangeTerms = z.infer<typeof changeTermsSchema>;

const noTerms = (): PackageTerms => ({ schedule_days: 0, added_cents: 0, added_note: "" });
export const defaultChangeTerms = (): ChangeTerms => ({
  good: noTerms(),
  better: noTerms(),
  best: noTerms(),
  reviewed_on: null,
});

/** The board's change terms, or 0 time and 0 added cost (not reviewed) when it has none. */
export const changeTermsOf = (board: Board): ChangeTerms =>
  board.proposal.change_terms ?? defaultChangeTerms();

/** One package's terms. The base package is the contract scope, so it never adds time or cost. */
export function packageTerms(board: Board, tier: OptionName): PackageTerms {
  return tier === board.proposal.base_tier ? noTerms() : changeTermsOf(board)[tier];
}

export const emptyBoard = (): Board => ({
  currency: null,
  proposal: {
    title: "",
    intro: "",
    base_price_cents: null,
    base_tier: "good",
    base_reviewed_on: null,
    base_basis: "",
    valid_until: null,
    terms: "",
  },
  selections: [],
  accepted: null,
});

/** Quantity in thousandths, exact for the three decimals the schema allows. */
export const quantityMilli = (q: number) => BigInt(Math.round(q * 1000));

/** Total for a quantity at a unit amount, rounded half up to the cent; null when unknown. */
export function extended(q: number, unit: number | null): number | null {
  if (unit === null) return null;
  const milli = quantityMilli(q) * BigInt(unit);
  const total = (milli + 500n) / 1000n;
  return total > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(total);
}

/** Positive means above allowance, negative means below; null means unknown. */
export function differenceFromAllowance(selection: Selection, option: OptionName): number | null {
  const total = extended(selection.quantity, selection.options[option].price_cents);
  return total === null || selection.allowance_cents === null
    ? null
    : total - selection.allowance_cents;
}

/** A selection is recorded, not an owner approval or a contract change. */
export function boardSummary(board: Board, today: string) {
  const currentDate = z.iso.date().parse(today);
  let pending = 0;
  let overdue = 0;
  let missingDate = 0;
  for (const selection of board.selections) {
    if (selection.selected !== null) continue;
    pending++;
    if (selection.decision_due === null) missingDate++;
    else if (selection.decision_due < currentDate) overdue++;
  }
  return { total: board.selections.length, pending, overdue, missing_date: missingDate };
}
