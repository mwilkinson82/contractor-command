import { z } from "zod";
import { boardSchema } from "../selections/model";
import {
  estimateLineOptions,
  lineOptionsFlag,
  type LineOptions,
} from "../selections/estimate-options";
import type { Sb } from "./guard";

const saved = z.object({ board: boardSchema }).passthrough();

/**
 * Takeoff lines that have Good, Better and Best options on the job's
 * selections board. A read only: when the board is missing, not installed or
 * not readable for this member, the estimate simply shows no flags.
 */
export async function readEstimateOptions(
  sb: Sb,
  jobId: string,
): Promise<Map<string, LineOptions>> {
  try {
    const result = await (
      sb.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    )("mcp_residential_selections_get", { _job: jobId });
    if (result.error) return new Map();
    const parsed = saved.safeParse(result.data);
    return parsed.success ? estimateLineOptions(parsed.data.board) : new Map();
  } catch {
    return new Map();
  }
}

/** Structured flags for an estimate payload: one row per line with options. */
export function estimateOptionsPayload(lines: Map<string, LineOptions>) {
  return [...lines.values()].map((l) => ({
    ref: l.ref,
    line_no: l.line_no,
    selection_id: l.selection_id,
    title: l.title,
    quantity: l.quantity,
    unit: l.unit,
    base_tier: l.base_tier,
    selected: l.selected,
    provisional: l.provisional,
    tiers_with_product: l.tiers_with_product,
    tiers_priced: l.tiers_priced,
    currency: l.currency,
    tiers: l.tiers.map((t) => ({
      tier: t.tier,
      product: t.product,
      found_unit_cents: t.found_unit_cents,
      cost_unit_cents: t.cost_unit_cents,
      price_unit_cents: t.price_unit_cents,
      price_reviewed_on: t.price_reviewed_on,
      price_cents: t.price_cents,
      margin_bp: t.margin_bp,
    })),
  }));
}

export const ESTIMATE_OPTIONS_GUIDANCE =
  "Lines marked with Good/Better/Best options have saved options on the selections board. When the member asks about one, or clicks it, show them with selection_board action options and that estimate_line_ref. The estimate total is unchanged by saved options; carrying one into pricing is a separate estimate_pricing step after the estimator says yes.";

/** Adds the options flags to a legacy takeoff view (T-refs): a section, each line's flag and the payload. */
export function withEstimateOptions<
  V extends { text: string; structured: Record<string, unknown>; guidance: string[] },
>(view: V, lines: Map<string, LineOptions>): V {
  if (!lines.size) return view;
  const structuredLines = Array.isArray(view.structured.lines)
    ? (view.structured.lines as { ref?: unknown }[]).map((l) => {
        const o = typeof l.ref === "string" ? lines.get(l.ref) : undefined;
        return o ? { ...l, options: lineOptionsFlag(o) } : l;
      })
    : view.structured.lines;
  return {
    ...view,
    text: [
      view.text,
      "",
      "Good, Better, Best options",
      ...[...lines.values()].map(
        (o) =>
          `- ${o.ref} ${o.title}: ${lineOptionsFlag(o)} · ${o.tiers_priced.length} of 3 priced. Saved alternates; the estimate total is unchanged.`,
      ),
    ].join("\n"),
    structured: {
      ...view.structured,
      lines: structuredLines,
      estimate_options: estimateOptionsPayload(lines),
    },
    guidance: [...view.guidance, ESTIMATE_OPTIONS_GUIDANCE],
  };
}

/**
 * Rides on every takeoff read and selections board read, so a host that builds a
 * Good, Better, Best comparison from them offers to save it, even when no line
 * has options yet. Server instructions alone were not enough: ChatGPT ended a
 * comparison with "for review only" and never offered the save.
 */
export const SAVE_OFFER_GUIDANCE =
  "After you show a Good, Better, Best or value-engineering comparison for a takeoff line, end that reply by asking the member whether to save it to the estimate, naming the line (takeoff line 3 is estimate_line_ref T-3); never end it as review only. On their yes, call selection_board action save_comparison with confirmed true: all three tiers with manufacturer, model, description, and for every option its product_url (the manufacturer's product page), photo_url (a direct image from that page) and source_url (the seller page the price was read on), each read from the page and never made up, and the web price per unit for that exact finish as found_price_cents, a cost lead and never a sell price. Every option needs a photo and a web price: when a seller doesn't show one for that finish, use a seller that does or the next comparable product, never a gap. Each step up must cost more for that finish: Better's web price above Good's and Best's above Better's; when a step-up product sells for the same as the tier below, pick a different product before you show the comparison. Description and specifications are what the customer reads, so keep them to product facts, with no caveats like \"to confirm\" or pricing notes (those go in the selection notes); set base_tier to the option they pick. If they also give a markup (for example 25%), follow with selection_board apply_markup with that markup_pct and confirmed true, using cost_basis found only when they say to use the web price as their cost; otherwise ask for their cost first. Saving never changes the estimate total.";
