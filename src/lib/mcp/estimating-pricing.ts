import type { SettledView } from "./estimating";
import {
  BidError,
  METROS,
  RATE_SOURCE_IDS,
  WORK_TYPES,
  applyFactors,
  priceLabor,
  priceMaterial,
  type LaborIn,
  type RateChoice,
  type RateSourceId,
  type BidDirectRow,
} from "./estimating-bid";

export type MaterialIn = {
  ref: string;
  unit_price?: number | null;
  confirmed?: boolean;
  apply_factor?: boolean;
  source?: RateSourceId | null;
};
type Line = Pick<SettledView, "ref" | "kind" | "status" | "title" | "qty" | "unit">;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const optionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";
const optionalNumber = (value: unknown, positive = false) =>
  value == null ||
  (typeof value === "number" && Number.isFinite(value) && (positive ? value > 0 : value >= 0));

/** Stored rows are not guaranteed to have passed the current tool schema. A
 * string such as "false" is not an estimator's boolean selection. */
export function validStoredRateSource(value: unknown): value is RateChoice {
  if (!object(value)) return false;
  return (
    typeof value.source === "string" &&
    RATE_SOURCE_IDS.some((source) => source === value.source) &&
    typeof value.carry === "boolean" &&
    optionalBoolean(value.confirmed) &&
    optionalNumber(value.location_factor, true) &&
    optionalNumber(value.work_factor, true) &&
    (value.metro == null || METROS.some((metro) => metro === value.metro)) &&
    (value.work_type == null || WORK_TYPES.some((type) => type === value.work_type))
  );
}

function validStoredRate(value: unknown, component: "labor" | "material"): boolean {
  if (!object(value) || typeof value.ref !== "string" || !value.ref.trim()) return false;
  if (!optionalBoolean(value.confirmed) || !optionalBoolean(value.apply_factor)) return false;
  if (value.source != null && !RATE_SOURCE_IDS.some((source) => source === value.source))
    return false;
  const keys =
    component === "labor"
      ? [
          "production_per_man_hour",
          "man_hours",
          "man_days",
          "crew_size",
          "hours_per_day",
          "hourly_rate",
          "crew_rate",
        ]
      : ["unit_price"];
  if (!keys.every((key) => optionalNumber(value[key]))) return false;
  if (component === "labor") {
    for (const key of ["production_per_man_hour", "crew_size", "hours_per_day"])
      if (value[key] === 0) return false;
    if (typeof value.hours_per_day === "number" && value.hours_per_day > 24) return false;
  }
  return true;
}

/** A source identity has one carried/not-carried decision. Repeated identities
 * cannot be resolved by filtering on `carry`, which would silently discard a
 * conflicting not-carried row. Normalize legacy spelling for detection only;
 * the actual source and factor values are never inferred or changed. */
export function duplicateRateSourceIds(sources: ReadonlyArray<{ source?: unknown }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of sources) {
    const id = typeof row?.source === "string" ? row.source.trim().toLowerCase() : "";
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

/** A legacy title can migrate to its stable reference only when uniquely owned. */
export function mergePricingRates<T extends { ref: string }>(
  prior: T[],
  incoming: T[],
  lines: Line[],
): T[] {
  const normalize = (row: T): T => {
    if (!row || typeof row.ref !== "string" || !row.ref.trim())
      throw new BidError(
        "A saved rate has no valid reference. Review the saved rate before pricing.",
      );
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
export type PricedLine = {
  ref: string;
  title: string;
  labor: Component;
  material: Component;
  /** Issues attributable to this exact line; global issues remain on the calculation. */
  blockers: string[];
};
export type EstimatePricing = {
  rows: PricedLine[];
  direct: number;
  placeholder: boolean;
  blockers: string[];
};

/** Export the same already-calculated direct rows without re-pricing them. */
export function directBidRows(pricing: EstimatePricing): BidDirectRow[] | null {
  const rows: BidDirectRow[] = [];
  for (const row of pricing.rows) {
    if (row.labor.amount == null || row.material.amount == null) return null;
    const labor = Math.round(row.labor.amount * 100);
    const material = Math.round(row.material.amount * 100);
    const amountCents = labor + material;
    if (
      !Number.isSafeInteger(labor) ||
      labor < 0 ||
      !Number.isSafeInteger(material) ||
      material < 0 ||
      Math.abs(row.labor.amount * 100 - labor) >= 1e-7 ||
      Math.abs(row.material.amount * 100 - material) >= 1e-7 ||
      !Number.isSafeInteger(amountCents)
    )
      return null;
    rows.push({ ref: row.ref, basis: "direct", amountCents, quoteId: null });
  }
  return rows;
}
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
  for (const [component, values] of [
    ["labor", input.labor],
    ["material", input.material],
  ] as const)
    for (const row of values) {
      if (!object(row)) continue;
      const stored = row as unknown as Record<string, unknown>;
      const keys =
        component === "labor"
          ? [
              "production_per_man_hour",
              "man_hours",
              "man_days",
              "crew_size",
              "hours_per_day",
              "hourly_rate",
              "crew_rate",
            ]
          : ["unit_price"];
      if (!keys.every((key) => optionalNumber(stored[key])))
        throw new BidError(
          `A saved ${component} rate contains invalid numbers. Nothing was saved.`,
        );
      if (
        component === "labor" &&
        (["production_per_man_hour", "crew_size", "hours_per_day"].some(
          (key) => stored[key] === 0,
        ) ||
          (typeof stored.hours_per_day === "number" && stored.hours_per_day > 24))
      )
        throw new BidError(
          "A saved labor rate contains invalid production or hours. Nothing was saved.",
        );
    }
  for (const row of input.sources)
    if (
      object(row) &&
      (!optionalNumber(row.location_factor, true) || !optionalNumber(row.work_factor, true))
    )
      throw new BidError("Rate factors must be finite and greater than zero. Nothing was saved.");
  const active = lines.filter((line) => line.kind === "line" && line.status !== "dropped");
  const refs = new Set(lines.filter((line) => line.kind === "line").map((line) => line.ref));
  const blockers: string[] = duplicateRateSourceIds(input.sources).map(
    (id) => `Rate source ${id}: conflicting or duplicate choices need one reviewed decision.`,
  );
  if (input.sources.some((choice) => !choice || !RATE_SOURCE_IDS.includes(choice.source)))
    blockers.push("A rate source has an unknown or missing identity. Review the saved choices.");
  if (input.sources.some((choice) => !validStoredRateSource(choice)))
    blockers.push("A saved rate source has invalid choices or factors. Review the saved choices.");
  if (input.labor.some((row) => !validStoredRate(row, "labor")))
    blockers.push("A saved labor rate has invalid values or confirmation. Review the saved rates.");
  if (input.material.some((row) => !validStoredRate(row, "material")))
    blockers.push(
      "A saved material rate has invalid values or confirmation. Review the saved rates.",
    );
  const validSources = input.sources.filter(validStoredRateSource);
  const validLabor = input.labor.filter((row) => validStoredRate(row, "labor"));
  const validMaterial = input.material.filter((row) => validStoredRate(row, "material"));
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
    if (rate?.apply_factor !== true) return value;
    const choices = validSources.filter(
      (choice) => choice.carry === true && (!rate.source || choice.source === rate.source),
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
    const blockerStart = blockers.length;
    if (line.qty != null && (!Number.isFinite(line.qty) || line.qty < 0))
      throw new BidError(
        `${line.ref}: quantity must be finite and zero or more. Nothing was saved.`,
      );
    const lab = resolve(line, validLabor, "labor");
    const mat = resolve(line, validMaterial, "material");
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
    return {
      ref: line.ref,
      title: line.title,
      labor,
      material,
      blockers: blockers.slice(blockerStart),
    };
  });
  // Settlement can close a gap by assigning an owner or quantity, neither of
  // which puts its cost into the priced takeoff. SettledView does not retain
  // the gap's line link, so even a "seen" gap cannot safely be inferred to
  // duplicate a priced line. Keep it open until explicitly resolved.
  for (const gap of lines.filter((line) => line.kind === "gap" && line.status !== "dropped"))
    blockers.push(
      `${gap.ref} ${gap.title}: review and close this gap after its scope is incorporated into a priced takeoff line or excluded.`,
    );
  for (const [component, values] of [
    ["labor", validLabor],
    ["material", validMaterial],
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
