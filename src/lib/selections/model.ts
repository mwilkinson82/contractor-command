import { z } from "zod";

// Amounts are whole cents. A missing amount is unknown; zero is a real price.
const cents = z.number().int().min(0).max(999_999_999_999).nullable();
const text = (max: number) => z.string().trim().max(max);
const date = z.iso.date().nullable();
export const optionNames = ["good", "better", "best"] as const;
export type OptionName = (typeof optionNames)[number];

const optionSchema = z
  .object({
    description: text(500),
    // Internal contractor cost. Never include this in a customer projection.
    cost_cents: cents,
    price_cents: cents,
    specifications: text(2000),
    source_url: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
    photo_url: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
  })
  .strict();

export const selectionSchema = z
  .object({
    id: z.uuid(),
    title: text(160).pipe(z.string().min(1)),
    decision_due: date,
    allowance_cents: cents,
    options: z.object({ good: optionSchema, better: optionSchema, best: optionSchema }).strict(),
    selected: z.enum(optionNames).nullable(),
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

export const boardSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    selections: z.array(selectionSchema).max(500),
  })
  .strict()
  .superRefine((board, ctx) => {
    const ids = new Set<string>();
    for (const [index, selection] of board.selections.entries()) {
      if (ids.has(selection.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["selections", index, "id"],
          message: "Selection IDs must be unique.",
        });
      }
      ids.add(selection.id);
    }
  });

export type Selection = z.infer<typeof selectionSchema>;
export type Board = z.infer<typeof boardSchema>;

/** Positive means above allowance, negative means below; null means unknown. */
export function differenceFromAllowance(selection: Selection, option: OptionName): number | null {
  const price = selection.options[option].price_cents;
  return price === null || selection.allowance_cents === null
    ? null
    : price - selection.allowance_cents;
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
