import {
  boardSchema,
  extended,
  optionNames,
  type Board,
  type OptionName,
  type Selection,
} from "./model";
import { TIER_LABEL } from "./proposal";
import { money, percent, signed } from "./format";
import { isProvisional } from "./line-checks";

/**
 * What the estimate shows for a takeoff line that has Good, Better and Best
 * options saved on the selections board. Contractor-only: it can carry cost,
 * price and margin, so it never goes to a customer view.
 */
export type LineOptionTier = {
  tier: OptionName;
  product: string;
  description: string;
  photo_url: string | null;
  /** The product page for the customer, and the seller page the price was read on (internal). */
  product_url: string | null;
  source_url: string | null;
  /** Per unit. A found price is a web lead, not the contractor's cost or price. */
  found_unit_cents: number | null;
  found_at: string;
  cost_unit_cents: number | null;
  price_unit_cents: number | null;
  price_reviewed_on: string | null;
  /** Extended over the selection quantity; null when the unit amount is unknown. */
  found_cents: number | null;
  cost_cents: number | null;
  price_cents: number | null;
  margin_cents: number | null;
  /** Margin as a share of sell price, in basis points. */
  margin_bp: number | null;
  /** Markup on cost, in basis points. */
  markup_bp: number | null;
  /** Sell price change from the base tier's option on this line. */
  price_vs_base_cents: number | null;
};

export type LineOptions = {
  ref: string;
  line_no: number;
  selection_id: string;
  title: string;
  quantity: number;
  unit: string;
  base_tier: OptionName;
  /** The customer's recorded choice for this line, if any. */
  selected: OptionName | null;
  /** Saved on one reading of the drawings while a conflict is open. */
  provisional: boolean;
  notes: string;
  /** Tiers that have a product saved. */
  tiers_with_product: OptionName[];
  /** Tiers whose sell price the contractor reviewed. */
  tiers_priced: OptionName[];
  tiers: LineOptionTier[];
  currency: string | null;
};

const productName = (o: Selection["options"][OptionName]) =>
  [o.manufacturer, o.model].filter(Boolean).join(" ") || o.description;

const ratio = (part: number | null, whole: number | null) =>
  part === null || whole === null || whole === 0 ? null : Math.round((part * 10000) / whole);

export function selectionLineOptions(board: Board, s: Selection): LineOptions | null {
  if (!s.estimate_line_ref) return null;
  const base = board.proposal.base_tier;
  const basePrice = extended(s.quantity, s.options[base].price_cents);
  const tiers = optionNames.map((tier): LineOptionTier => {
    const o = s.options[tier];
    const price = extended(s.quantity, o.price_cents);
    const cost = extended(s.quantity, o.cost_cents);
    const margin = price === null || cost === null ? null : price - cost;
    return {
      tier,
      product: productName(o),
      description: o.description,
      photo_url: o.photo_url,
      product_url: o.product_url,
      source_url: o.source_url,
      found_unit_cents: o.found_price_cents,
      found_at: o.found_at,
      cost_unit_cents: o.cost_cents,
      price_unit_cents: o.price_cents,
      price_reviewed_on: o.price_reviewed_on,
      found_cents: extended(s.quantity, o.found_price_cents),
      cost_cents: cost,
      price_cents: price,
      margin_cents: margin,
      margin_bp: ratio(margin, price),
      markup_bp: ratio(margin, cost),
      price_vs_base_cents: price === null || basePrice === null ? null : price - basePrice,
    };
  });
  return {
    ref: s.estimate_line_ref,
    line_no: Number(s.estimate_line_ref.slice(2)),
    selection_id: s.id,
    title: s.title,
    quantity: s.quantity,
    unit: s.unit,
    base_tier: base,
    selected: s.selected,
    provisional: isProvisional(s.notes),
    notes: s.notes,
    tiers_with_product: tiers.filter((t) => t.description).map((t) => t.tier),
    tiers_priced: tiers.filter((t) => t.price_reviewed_on).map((t) => t.tier),
    tiers,
    currency: board.currency,
  };
}

/** Every takeoff line with at least one saved option, keyed by its ref (T-3). */
export function estimateLineOptions(input: Board): Map<string, LineOptions> {
  const parsed = boardSchema.safeParse(input);
  const out = new Map<string, LineOptions>();
  if (!parsed.success) return out;
  for (const s of parsed.data.selections) {
    const line = selectionLineOptions(parsed.data, s);
    // Two selections on one line is ambiguous; the first one stays the flag.
    if (line && line.tiers_with_product.length && !out.has(line.ref)) out.set(line.ref, line);
  }
  return out;
}

/** The short flag a takeoff line carries in the estimate. */
export function lineOptionsFlag(line: LineOptions): string {
  const tiers = line.tiers_with_product.map((t) => TIER_LABEL[t]).join("/");
  return `${tiers} options${line.provisional ? " · provisional" : ""}${line.selected ? ` · customer chose ${TIER_LABEL[line.selected]}` : ""}`;
}

/**
 * The option's name as a ready-made markdown link (product page, else the page
 * its price was read on), so a host that writes its own table keeps it clickable.
 */
export function optionNameLink(
  name: string,
  o: { product_url: string | null; source_url: string | null },
): string {
  const url = o.product_url ?? o.source_url;
  return url ? `[${name.replace(/[[\]]/g, "")}](${url})` : name;
}

/** An option's links as plain text, so a host that draws no card still shows them. */
export function optionLinks(o: {
  product_url: string | null;
  photo_url: string | null;
  source_url: string | null;
}): string {
  return [
    `Product page: ${o.product_url ?? "none saved"}`,
    `Photo: ${o.photo_url ?? "none saved"}`,
    `Price read on (internal): ${o.source_url ?? "none saved"}`,
  ].join(" · ");
}

/** One line, comparable side by side: product, found lead, cost, sell, margin and markup. */
export function lineOptionsText(line: LineOptions): string[] {
  const code = line.currency;
  const out = [
    `${line.ref} ${line.title} · ${line.quantity} ${line.unit} · Good, Better, Best options · INTERNAL, not for the customer`,
    `Base tier in the estimate: ${TIER_LABEL[line.base_tier]}${line.selected ? ` · customer chose ${TIER_LABEL[line.selected]}` : ""}`,
    ...(line.provisional
      ? [`${line.notes.slice(0, 400)} The customer view stays locked until it is settled.`]
      : []),
  ];
  for (const t of line.tiers) {
    out.push(
      "",
      `${TIER_LABEL[t.tier]}${t.tier === line.base_tier ? " (base)" : ""}: ${t.product ? optionNameLink(t.product, t) : "No product yet"}${t.description && t.product !== t.description ? ` · ${t.description}` : ""}`,
      `  Found ${money(t.found_unit_cents, code)} per ${line.unit}${t.found_at ? ` at ${t.found_at}` : ""} = ${money(t.found_cents, code)} (a web lead, not a price)`,
      `  Cost ${money(t.cost_unit_cents, code)} per ${line.unit} = ${money(t.cost_cents, code)} · Sell ${money(t.price_unit_cents, code)} per ${line.unit} = ${money(t.price_cents, code)}${t.price_reviewed_on ? ` · reviewed ${t.price_reviewed_on}` : " · NOT PRICED YET"}`,
      `  Margin ${money(t.margin_cents, code)} (${percent(t.margin_bp)}) · markup ${percent(t.markup_bp)} · sell vs base ${t.tier === line.base_tier ? "base" : signed(t.price_vs_base_cents, code)}`,
      ...(t.product ? [`  ${optionLinks(t)}`] : []),
    );
  }
  if (!line.tiers_priced.length)
    out.push(
      "",
      "Margin can't be compared yet: no option has a reviewed cost and sell price. Give each option its cost and markup or sell price to compare them.",
    );
  return out;
}
