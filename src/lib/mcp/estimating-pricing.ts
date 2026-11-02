import type { SettledView } from "./estimating";
import {
  BidError,
  applyFactors,
  priceLabor,
  priceMaterial,
  type LaborIn,
  type RateChoice,
  type RateSourceId,
} from "./estimating-bid";

export type MaterialIn = {
  ref: string;
  unit_price?: number | null;
  confirmed?: boolean;
  apply_factor?: boolean;
  source?: RateSourceId | null;
};
type Line = Pick<SettledView, "ref" | "kind" | "status" | "title" | "qty" | "unit">;

/** A legacy title can migrate to its stable reference only when uniquely owned. */
export function mergePricingRates<T extends { ref: string }>(
  prior: T[],
  incoming: T[],
  lines: Line[],
): T[] {
  const normalize = (row: T): T => {
    if (lines.some((line) => line.kind === "line" && line.ref === row.ref)) return row;
    const matches = lines.filter(
      (line) => line.kind === "line" && line.status !== "dropped" && line.title === row.ref,
    );
    return matches.length === 1 ? { ...row, ref: matches[0].ref } : row;
  };
  // Validate a whole request before merging with saved rates. A stable ref and
  // its unique title alias may coexist, but neither may win by array order.
  const agreed = new Map<string, T>();
  for (const input of incoming) {
    const row = Object.fromEntries(
      Object.entries(normalize(input)).filter(([, value]) => value !== undefined),
    ) as T;
    const previous = agreed.get(row.ref);
    if (previous) {
      for (const key of Object.keys(row) as (keyof T)[])
        if (previous[key] !== undefined && previous[key] !== row[key])
          throw new BidError(
            `Conflicting rate inputs for ${row.ref}. Send one agreed value for each field. Nothing was saved.`,
          );
    }
    // Identical values and compatible partial rows represent one update.
    // Explicit null/false/zero remain meaningful; only undefined is omitted.
    agreed.set(row.ref, { ...previous, ...row });
  }
  let result = prior.map(normalize);
  for (const row of [...agreed.values()].sort((a, b) => a.ref.localeCompare(b.ref))) {
    const existing = result.filter((value) => value.ref === row.ref);
    // An explicit update can resolve duplicate old references, but partial input
    // must not inherit arbitrary fields from one of several conflicting rows.
    result = result.filter((value) => value.ref !== row.ref);
    result.push({ ...(existing.length === 1 ? existing[0] : {}), ...row });
  }
  return result;
}
type Component = {
  amount: number | null;
  math: string;
  placeholder: boolean;
  missing: string | null;
};
export type PricedLine = { ref: string; title: string; labor: Component; material: Component };
export type EstimatePricing = {
  rows: PricedLine[];
  direct: number;
  placeholder: boolean;
  blockers: string[];
};
const cents = (n: number) => {
  const rounded = Math.round(n * 100) / 100;
  if (!Number.isFinite(rounded))
    throw new BidError("Pricing exceeds a finite amount. Nothing was saved.");
  return rounded;
};

/** Both reports use this exact calculation. Missing is never an implicit zero.
 * Legacy title keys are supported only when they identify a single active line.
 * The present storage model has no component N/A decision: use an explicitly
 * confirmed zero component rate, or resolve scope, rather than omitting it.
 */
export function calculateEstimatePricing(
  lines: Line[],
  input: { labor: LaborIn[]; material: MaterialIn[]; sources: RateChoice[] },
): EstimatePricing {
  const active = lines.filter((line) => line.kind === "line" && line.status !== "dropped");
  const refs = new Set(lines.filter((line) => line.kind === "line").map((line) => line.ref));
  const blockers: string[] = [];
  const used = new Set<object>();
  function resolve<T extends { ref: string }>(
    line: Line,
    values: T[],
    component: string,
  ): T | null {
    const matches = values.filter(
      (value) => value.ref === line.ref || (!refs.has(value.ref) && value.ref === line.title),
    );
    const ambiguousTitle = matches.some(
      (value) =>
        value.ref !== line.ref && active.filter((other) => other.title === value.ref).length !== 1,
    );
    matches.forEach((value) => used.add(value));
    if (matches.length > 1 || ambiguousTitle) {
      blockers.push(
        `${line.ref} ${component}: rate reference is ambiguous. Use one exact line reference.`,
      );
      return null;
    }
    return matches[0] ?? null;
  }
  function factored(value: Component, rate: LaborIn | MaterialIn | null, ref: string): Component {
    if (!rate?.apply_factor) return value;
    const choices = input.sources.filter(
      (choice) => choice.carry && (!rate.source || choice.source === rate.source),
    );
    const choice = choices.length === 1 ? choices[0] : null;
    const missing = !choice
      ? "select one carried factor source"
      : choice.location_factor == null && choice.work_factor == null
        ? "supply the selected factor or turn factor application off"
        : null;
    if (missing)
      return {
        ...value,
        amount: null,
        missing: [value.missing, missing].filter(Boolean).join("; "),
      };
    for (const factor of [choice!.location_factor, choice!.work_factor])
      if (factor != null && (!Number.isFinite(factor) || factor <= 0))
        throw new BidError(
          `${ref}: factors must be finite and greater than zero. Nothing was saved.`,
        );
    const applied = value.amount == null ? null : applyFactors(value.amount, choice);
    return {
      ...value,
      amount: applied ? cents(applied.amount) : null,
      math: [value.math, applied?.note].filter(Boolean).join(" "),
      placeholder: value.placeholder || choice!.confirmed !== true,
    };
  }
  const rows = active.map((line): PricedLine => {
    if (line.qty != null && (!Number.isFinite(line.qty) || line.qty < 0))
      throw new BidError(
        `${line.ref}: quantity must be finite and zero or more. Nothing was saved.`,
      );
    const lab = resolve(line, input.labor, "labor");
    const mat = resolve(line, input.material, "material");
    const laborPrice = priceLabor(line.qty, line.unit, lab ?? { ref: line.ref });
    const materialPrice = priceMaterial(line.qty, mat?.unit_price ?? null, mat?.confirmed === true);
    const labor = factored(
      {
        amount: laborPrice.labor,
        math: laborPrice.math,
        placeholder: laborPrice.placeholder,
        missing: !lab ? "labor rate and production" : laborPrice.missing,
      },
      lab,
      line.ref,
    );
    const material = factored(
      {
        amount: materialPrice.material,
        math: materialPrice.math,
        placeholder: materialPrice.placeholder,
        missing: materialPrice.missing,
      },
      mat,
      line.ref,
    );
    for (const [name, component] of [
      ["labor", labor],
      ["material", material],
    ] as const) {
      if (component.missing)
        blockers.push(`${line.ref} ${line.title} ${name}: ${component.missing}.`);
      if (component.placeholder)
        blockers.push(`${line.ref} ${line.title} ${name}: confirm the rate and applied factors.`);
    }
    return { ref: line.ref, title: line.title, labor, material };
  });
  for (const [component, values] of [
    ["labor", input.labor],
    ["material", input.material],
  ] as const)
    for (const value of values) {
      if (used.has(value)) continue;
      // Deliberately dropped scope may retain historical rates without carrying cost.
      if (
        lines.some(
          (line) =>
            line.kind === "line" &&
            line.status === "dropped" &&
            (line.ref === value.ref || line.title === value.ref),
        )
      )
        continue;
      blockers.push(
        `${component} rate ${value.ref}: no current line matches. Review the saved reference.`,
      );
    }
  return {
    rows,
    direct: cents(
      rows.reduce((sum, row) => sum + (row.labor.amount ?? 0) + (row.material.amount ?? 0), 0),
    ),
    placeholder: rows.some((row) => row.labor.placeholder || row.material.placeholder),
    blockers: [...new Set(blockers)],
  };
}
