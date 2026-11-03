import { z } from "zod";
import { boardSchema, optionNames, type Board, type OptionName } from "./model";

const pick = z.object({ selection_id: z.uuid(), option: z.enum(optionNames) }).strict();
export const packagePlanSchema = z
  .object({
    // A reference is necessary but is not proof the source exists or is current.
    source_snapshot_id: z.uuid(),
    source_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    base_price_cents: z.number().int().nonnegative().max(999_999_999_999).nullable(),
    base_includes_listed_selections: z.boolean(),
    base_choices: z.array(pick).max(500),
    choices: z.array(pick).max(500),
  })
  .strict();
export type PackagePlan = z.infer<typeof packagePlanSchema>;

/** Preview arithmetic only; caller must separately verify the frozen source and
 * the user's base-inclusion and customer-price evidence before any proposal. */
export function previewPackage(
  boardInput: Board,
  planInput: PackagePlan,
):
  | { total_cents: number; difference_cents: number }
  | { total_cents: null; difference_cents: null } {
  const board = boardSchema.parse(boardInput);
  const plan = packagePlanSchema.parse(planInput);
  const unknown = { total_cents: null, difference_cents: null } as const;
  if (!board.currency || plan.base_price_cents === null || !plan.base_includes_listed_selections)
    return unknown;
  if (
    plan.base_choices.length !== board.selections.length ||
    plan.choices.length !== board.selections.length
  )
    return unknown;
  const base = new Map(plan.base_choices.map((p) => [p.selection_id, p.option]));
  const chosen = new Map(plan.choices.map((p) => [p.selection_id, p.option]));
  if (base.size !== board.selections.length || chosen.size !== board.selections.length)
    return unknown;
  let delta = 0;
  for (const selection of board.selections) {
    const from = base.get(selection.id) as OptionName | undefined;
    const to = chosen.get(selection.id) as OptionName | undefined;
    if (!from || !to) return unknown;
    const fromPrice = selection.options[from].price_cents;
    const toPrice = selection.options[to].price_cents;
    if (fromPrice === null || toPrice === null) return unknown;
    delta += toPrice - fromPrice;
    if (!Number.isSafeInteger(delta)) return unknown;
  }
  const total = plan.base_price_cents + delta;
  if (!Number.isSafeInteger(total) || total < 0) return unknown;
  return { total_cents: total, difference_cents: delta };
}
