import { jobLaborTerms } from "../work-profile";
import {
  engineSnapshot,
  verifiedLines,
  measurementStatus,
  type EngineSnapshot,
} from "../takeoff/state";
import { viewEngine } from "../takeoff/service";
// Bid walkthrough tools. Same gate as the other estimating tools.
import { ToolError, defineTool, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  GC_ITEMS,
  METROS,
  RATE_SOURCE_IDS,
  QUOTE_COVERAGE_REQUIRED,
  WORK_TYPES,
  BidError,
  assembleBid,
  basisCheck,
  calendarDays,
  describeRateChoice,
  gcLineAmount,
  nextMove,
  priceRequirement,
  requirementGaps,
  scanProject,
  sourceAsk,
  type LaborIn,
  type RateChoice,
  type RequirementHit,
  type RequirementPrice,
} from "../estimating-bid";
import {
  ESTIMATE_QUANTITY_REQUIRED,
  ESTIMATE_VIEW_SPEC,
  REQUIREMENT_OPEN_LIST,
  estimateLayout,
  parseState,
  settle,
} from "../estimating";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { audit, named, resolveJob } from "../jobs";
import { money } from "../sov";
import { guide } from "../visible";
import {
  calculateEstimatePricing,
  duplicateRateSourceIds,
  validStoredRateSource,
  directBidRows,
  mergePricingRates,
  type MaterialIn,
} from "../estimating-pricing";
import {
  applyReviewedQuoteCoverage,
  type CoverageSnapshot as QuoteCoverageSnapshot,
} from "../estimating-quote-pricing";
import { canonicalBidCsv } from "../estimating-bid-csv";
import { canonicalBidExport } from "../estimating-bid-files";
import { prepareHandoffDraft } from "../estimating-handoff-draft";
import { saveBidArtifact } from "../estimating-bid-artifact";
import {
  requirementSourceManifest,
  requirementSourceBlocker,
  verifyRequirementClauses,
} from "../estimating-requirement-sources";

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SAVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const moneyIn = z.number().finite().min(0);

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  )(fn, args);
  if (error && isMissingFunction(error))
    throw new ToolError("Estimating storage is not available yet. Nothing was changed.");
  if (error && ["40P01", "40001"].includes(error.code ?? ""))
    throw new ToolError(
      "A concurrent change interrupted this request. Read the latest state before retrying.",
    );
  if (error) dbError(error);
  return data as T;
}

type BidState = {
  labor: LaborIn[];
  material: MaterialIn[];
  quotes: {
    sub: string;
    description: string;
    amount: number | null;
    ref?: string | null;
    trade?: string | null;
  }[];
  sources: RateChoice[];
  gcLines: {
    key: string;
    amount?: number | null;
    qty?: number | null;
    rate?: number | null;
    confirmed?: boolean;
  }[];
  duration: number | null;
  startDate: string | null;
  finishDate: string | null;
  requirements: RequirementPrice[];
  overhead: number | null;
  profit: number | null;
};

type CoverageSnapshot = QuoteCoverageSnapshot & {
  estimate: unknown;
  takeoff: EngineSnapshot | null;
  bid: unknown;
  capabilities?: { gc_requirements_cas?: boolean };
  requirements_max_ref?: number;
};

/** The new RPC captures every bid input under one job-version lock. Older
 * installations retain the pre-coverage path and cannot carry quotes. */
async function coverageSnapshot(sb: Sb, job: string): Promise<CoverageSnapshot | null> {
  const { data, error } = await sb.rpc("mcp_estimate_coverage_snapshot", { _job: job });
  if (error && isMissingFunction(error)) return null;
  if (error && ["40P01", "40001"].includes(error.code ?? ""))
    throw new ToolError(
      "A concurrent change interrupted this request. Read the latest state before retrying.",
    );
  if (error) dbError(error);
  const snapshot = data as CoverageSnapshot | null;
  if (!snapshot || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0)
    throw new ToolError(
      "The current estimate version is unavailable. Refresh before making changes.",
    );
  return snapshot;
}

function snapshotMeasurement(
  snapshot: CoverageSnapshot,
  setup: ReturnType<typeof parseState>["setup"],
) {
  if (!snapshot.takeoff?.available) return null;
  return {
    ...snapshot.takeoff,
    estimate_scope: {
      role: setup.role ?? null,
      trades: setup.trades ?? [],
      in_scope: setup.in_scope ?? [],
      out_scope: setup.out_scope ?? [],
      doc_review: setup.doc_review ?? null,
    },
  };
}

function num(v: unknown): number | null {
  return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}

/** An update may add quotes but must not silently erase or rewrite an existing
 * comparison. Each existing object must still appear, including duplicates. */
function retainsQuotes(prior: BidState["quotes"], next: BidState["quotes"]): boolean {
  const canonical = (row: Record<string, unknown>) =>
    JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
  const counts = new Map<string, number>();
  for (const row of next) {
    const key = canonical(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return prior.every((row) => {
    const key = canonical(row);
    const remaining = counts.get(key) ?? 0;
    if (!remaining) return false;
    counts.set(key, remaining - 1);
    return true;
  });
}

/** Keep the original JSON object when a caller repeats a saved quote, so
 * legacy omitted optional fields and source metadata are not rewritten. */
function preserveQuoteObjects(
  prior: BidState["quotes"],
  input: BidState["quotes"],
): BidState["quotes"] {
  const key = (q: BidState["quotes"][number]) =>
    JSON.stringify([q.sub, q.description, q.amount ?? null, q.ref ?? null, q.trade ?? null]);
  const unused = new Set(prior.map((_, index) => index));
  return input.map((quote) => {
    const index = [...unused].find((i) => key(prior[i]) === key(quote));
    if (index === undefined) return quote;
    unused.delete(index);
    return prior[index];
  });
}
function parseBid(raw: unknown): BidState {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pricing = (o.pricing ?? {}) as Record<string, unknown>;
  const gc = (o.general_conditions ?? {}) as Record<string, unknown>;
  const bid = (o.bid ?? {}) as Record<string, unknown>;
  const reqs = Array.isArray(o.requirements) ? (o.requirements as Record<string, unknown>[]) : [];
  for (const field of ["labor", "material", "quotes", "rate_sources"] as const)
    if (Object.hasOwn(pricing, field) && !Array.isArray(pricing[field]))
      throw new ToolError(
        `Saved pricing ${field.replace("_", " ")} needs review. No pricing result was returned.`,
      );
  if (Object.hasOwn(o, "requirements") && !Array.isArray(o.requirements))
    throw new ToolError("Saved requirements need review. No bid total was returned.");
  if (Object.hasOwn(gc, "lines") && !Array.isArray(gc.lines))
    throw new ToolError("Saved general conditions need review. No bid total was returned.");
  const gcKeys = new Set<string>();
  for (const line of Array.isArray(gc.lines) ? gc.lines : []) {
    const key = line && typeof line === "object" ? (line as { key?: unknown }).key : null;
    if (typeof key !== "string" || !GC_ITEMS.some((item) => item.key === key) || gcKeys.has(key))
      throw new ToolError(
        "A saved general condition is unknown or duplicated. Review the saved lines before pricing.",
      );
    gcKeys.add(key);
  }
  return {
    labor: Array.isArray(pricing.labor) ? (pricing.labor as LaborIn[]) : [],
    material: Array.isArray(pricing.material) ? (pricing.material as BidState["material"]) : [],
    quotes: Array.isArray(pricing.quotes) ? (pricing.quotes as BidState["quotes"]) : [],
    sources: Array.isArray(pricing.rate_sources) ? (pricing.rate_sources as RateChoice[]) : [],
    gcLines: Array.isArray(gc.lines) ? (gc.lines as BidState["gcLines"]) : [],
    duration: num(gc.duration_days),
    startDate: typeof gc.start_date === "string" ? gc.start_date : null,
    finishDate: typeof gc.finish_date === "string" ? gc.finish_date : null,
    requirements: reqs.map((r) => ({
      ref: String(r.ref),
      kind: String(r.kind ?? "other"),
      description: typeof r.description === "string" ? r.description : null,
      label: String(r.label ?? ""),
      sourceType: (r.source_type as RequirementHit["sourceType"]) ?? "spec",
      sourceRef: String(r.source_ref ?? ""),
      citation: String(r.citation ?? ""),
      placement: r.placement === "gc" ? "gc" : "own_line",
      amount: num(r.amount),
      confirmed: r.confirmed === true,
      excluded: r.excluded === true,
    })),
    overhead: num(bid.overhead_pct),
    profit: num(bid.profit_pct),
  };
}

/** Replays a guarded saved source using the same calculator as the live summary.
 * The caller must authenticate the snapshot; this function grants no write or approval. */
function calculateBidView(
  loaded: ReturnType<typeof parseState>,
  prior: BidState,
  snapshot: CoverageSnapshot | null,
  overhead: number | null,
  profit: number | null,
  measurementsSettled = true,
) {
  const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, loaded.setup);
  let pricing: ReturnType<typeof calculateEstimatePricing>;
  try {
    pricing = calculateEstimatePricing(state.items, prior);
  } catch (error) {
    if (error instanceof BidError)
      throw new ToolError(`Saved pricing needs review. ${error.message}`);
    throw error;
  }
  const quoteCoverage =
    prior.quotes.length && snapshot
      ? applyReviewedQuoteCoverage(pricing, prior.quotes, snapshot)
      : undefined;
  const { direct, placeholder: directPlaceholder } = pricing;
  const gc = GC_ITEMS.map((item) => {
    const row = prior.gcLines.find((l) => l.key === item.key);
    const calc = gcLineAmount({
      key: item.key,
      amount: row?.amount,
      qty: row?.qty,
      rate: row?.rate,
      duration: prior.duration,
      confirmed: row?.confirmed,
    });
    return {
      label: item.label,
      amount: calc.amount,
      placeholder: calc.placeholder,
      risk: calc.amount == null,
      note: calc.math,
    };
  });
  const requirementBlocker = requirementSourceBlocker(snapshot);
  const view = assembleBid({
    direct,
    directPlaceholder,
    directBlockers: pricing.blockers,
    sourceBlockers: requirementBlocker ? [requirementBlocker] : [],
    gc,
    requirements: prior.requirements,
    quotes: prior.quotes,
    quoteCoverage,
    directRows: directBidRows(pricing) ?? undefined,
    overheadPct: overhead,
    profitPct: profit,
    settled: state.settled && measurementsSettled,
  });
  return { view, pricing, state, direct: quoteCoverage?.accepted ? quoteCoverage.direct : direct };
}

export function calculateSavedBidSnapshot(raw: unknown) {
  const snapshot = raw as CoverageSnapshot | null;
  if (!snapshot || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0)
    throw new ToolError("The saved source version is invalid. No bid was calculated.");
  const loaded = parseState(snapshot.estimate);
  const measurement = snapshotMeasurement(snapshot, loaded.setup);
  if (measurement) {
    loaded.setup = { ...loaded.setup, ...measurement.estimate_scope };
    loaded.lines = verifiedLines(loaded.lines, measurement);
    loaded.verdicts = loaded.verdicts.map((v) =>
      v.item_kind === "line" ? { ...v, corrected_qty: null } : v,
    );
  }
  const prior = parseBid(snapshot.bid);
  return {
    ...calculateBidView(
      loaded,
      prior,
      snapshot,
      prior.overhead,
      prior.profit,
      !measurement || measurementStatus(measurement).settled,
    ),
    snapshot,
  };
}

function present(
  report: string,
  body: string[],
  structured: Record<string, unknown>,
  guidance: string[],
) {
  return guide(
    {
      ...text(
        [ESTIMATE_QUANTITY_REQUIRED, ...ESTIMATE_VIEW_SPEC, `Report: ${report}`, ...body].join(
          "\n",
        ),
      ),
      structuredContent: {
        report,
        layout: estimateLayout(),
        ...structured,
      } as unknown as JsonValueInput,
    },
    ...guidance,
  );
}

const laborIn = z.object({
  ref: z.string().trim().min(1).max(40),
  production_per_man_hour: moneyIn.nullable().optional(),
  man_hours: moneyIn.nullable().optional(),
  man_days: moneyIn.nullable().optional(),
  crew_size: moneyIn.nullable().optional(),
  hours_per_day: z.number().finite().positive().max(24).nullable().optional(),
  hourly_rate: moneyIn.nullable().optional(),
  crew_rate: moneyIn.nullable().optional(),
  confirmed: z.boolean().optional(),
  apply_factor: z.boolean().optional(),
  source: z.enum(RATE_SOURCE_IDS).optional(),
});

export const estimatePricing = defineTool({
  name: "estimate_pricing",
  title: "Pricing walkthrough",
  description:
    "Prices a job from the contractor's rates while preserving existing quotes for separate coverage review.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    labor: z.array(laborIn).max(400).optional(),
    material: z
      .array(
        z.object({
          ref: z.string().trim().min(1).max(40),
          unit_price: moneyIn.nullable().optional(),
          confirmed: z.boolean().optional(),
          apply_factor: z.boolean().optional(),
          source: z.enum(RATE_SOURCE_IDS).optional(),
        }),
      )
      .max(400)
      .optional(),
    quotes: z
      .array(
        z.object({
          sub: z.string().trim().min(1).max(160),
          description: z.string().trim().min(1).max(300),
          amount: moneyIn.nullable().optional(),
          ref: z.string().trim().max(40).optional(),
          trade: z.string().trim().max(80).optional(),
        }),
      )
      .max(80)
      .optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run(
      "estimate_pricing",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const snapshot = await coverageSnapshot(sb, job.job_id);
        const loaded = parseState(
          snapshot ? snapshot.estimate : await rpc(sb, "mcp_estimate_get", { _job: job.job_id }),
        );
        const measurement = snapshot
          ? snapshotMeasurement(snapshot, loaded.setup)
          : await engineSnapshot(sb, job.job_id);
        if (measurement) {
          if (measurement.estimate_scope)
            loaded.setup = { ...loaded.setup, ...measurement.estimate_scope };
          loaded.lines = verifiedLines(loaded.lines, measurement);
          loaded.verdicts = loaded.verdicts.map((v) =>
            v.item_kind === "line" ? { ...v, corrected_qty: null } : v,
          );
        }
        const prior = parseBid(
          snapshot ? snapshot.bid : await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }),
        );
        const asked = (args.labor?.length ?? 0) + (args.material?.length ?? 0) > 0;
        const onFile = prior.labor.length + prior.material.length > 0;
        const laborTerms = await jobLaborTerms(sb, job.job_id);
        if (!asked && !onFile && !args.quotes?.length && !prior.quotes.length) {
          return present(
            "Pricing",
            [
              `${named(job)} · Pricing`,
              ...(laborTerms ? [laborTerms] : []),
              "Before pricing, send the labor rate and the material rate, or save them on this job first.",
              "Labor: production per man-hour, or the man-hours you already have, crew size, hours in a man-day, and an hourly rate or a blended crew rate.",
              "Material: a unit price for each line.",
              "Nothing was priced.",
            ],
            {
              priced: false,
              card: {
                state: "ask",
                title: "Rates",
                ask: { prompt: "What are the labor and material rates?" },
              },
            },
            ["Ask for labor and material rates before pricing. Do not invent a rate."],
          );
        }
        if (!loaded.setup.role) {
          return present(
            "Estimate Summary",
            [
              `${named(job)} · Pricing`,
              "Save the intake and name general contractor or self-performer before pricing. Nothing was priced.",
              nextMove("takeoff"),
            ],
            { priced: false },
            ["Do not assume the role."],
          );
        }
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, loaded.setup);
        const { labor, material, pricing } = (() => {
          try {
            const labor = mergePricingRates(prior.labor, args.labor ?? [], state.items);
            const material = mergePricingRates(prior.material, args.material ?? [], state.items);
            return {
              labor,
              material,
              pricing: calculateEstimatePricing(state.items, {
                labor,
                material,
                sources: prior.sources,
              }),
            };
          } catch (error) {
            if (error instanceof BidError) throw new ToolError(error.message);
            throw error;
          }
        })();
        const quotes = args.quotes
          ? preserveQuoteObjects(
              prior.quotes,
              args.quotes.map((q) => ({
                ...q,
                amount: q.amount ?? null,
                ref: q.ref ?? null,
                trade: q.trade ?? null,
              })),
            )
          : prior.quotes;
        if (args.quotes !== undefined && !retainsQuotes(prior.quotes, quotes))
          throw new ToolError(
            "This quote update would remove or change an existing quote. Include every saved quote unchanged and add the new one; nothing was saved.",
          );
        const changed =
          args.labor !== undefined || args.material !== undefined || args.quotes !== undefined;
        if (changed) {
          if (!snapshot)
            throw new ToolError(
              "Version-checked estimating storage is unavailable. Pricing was not saved; refresh after storage is updated.",
            );
          const payload = {
            _job: job.job_id,
            _labor: args.labor === undefined ? null : labor,
            _material: args.material === undefined ? null : material,
            _quotes: args.quotes === undefined ? null : quotes,
            _sources: null,
          };
          await rpc(sb, "mcp_estimate_pricing_save_versioned", {
            ...payload,
            _expected_version: snapshot.version,
          });
        }
        const body = [
          `${named(job)} · Pricing`,
          ...(laborTerms ? [laborTerms] : []),
          loaded.setup.role === "gc"
            ? "General contractor: labor plus material is the basis for checking a sub quote."
            : "Self-performer: labor is man-hours or man-days from your production, times your rate.",
          asked
            ? "Using the rates in this call."
            : onFile
              ? "Using the labor and material rates saved on this job."
              : "No direct labor or material rates are on file.",
        ];
        const coverage =
          !changed && snapshot && quotes.length
            ? applyReviewedQuoteCoverage(pricing, quotes, snapshot)
            : undefined;
        const usableCoverage = coverage?.accepted ? coverage : undefined;
        const direct = usableCoverage ? usableCoverage.direct : pricing.direct;
        const placeholder = usableCoverage ? usableCoverage.directPlaceholder : pricing.placeholder;
        const blockers = usableCoverage
          ? usableCoverage.blockers
          : [...pricing.blockers, ...(quotes.length ? [QUOTE_COVERAGE_REQUIRED] : [])];
        for (const row of pricing.rows) {
          const carried = usableCoverage?.rows.find(
            (value) => value.ref === row.ref && value.basis === "quote",
          );
          body.push(
            carried
              ? `- ${row.ref} ${row.title}. Carried subcontract ${carried.amountCents == null ? "amount unresolved" : money(carried.amountCents / 100)} replaces direct labor and material.`
              : `- ${row.ref} ${row.title}. ${row.labor.math} ${row.material.math}`,
          );
        }
        body.push(...blockers.map((blocker) => `- ${blocker} Holds the bid.`));
        if (usableCoverage) {
          if (blockers.length)
            body.push("Complete any unresolved pricing and confirmations for uncovered scope.");
        } else if (loaded.setup.role === "self_performer") {
          body.push(
            "Send, for each line: production per man-hour, or man-hours you already have; crew size; hours in a man-day; and an hourly rate or a blended crew rate.",
          );
        } else {
          body.push(
            "Send labor the same way, plus a material price per line, to build the basis. Then send each sub quote.",
          );
        }
        if (usableCoverage) {
          quotes.forEach((q, index) => {
            const carried = usableCoverage.rows.find((row) => row.quoteId === String(index));
            body.push(
              `- ${q.sub} ${q.description}: ${carried ? `carried for ${carried.ref}` : "comparison only"}.`,
            );
          });
        } else if (loaded.setup.role === "gc") {
          for (const q of quotes) {
            const row = pricing.rows.find((row) => row.ref === q.ref);
            const check = basisCheck(
              row?.labor.amount ?? null,
              row?.material.amount ?? null,
              q.amount,
            );
            body.push(`- ${q.sub} ${q.description}. ${check.line}`);
          }
        }
        if (quotes.length && !usableCoverage)
          body.push(
            "Subcontract quote coverage needs review before a bid total can be built. Identify carried scope and any self-perform replacement or split; comparison quotes are preserved.",
          );
        else if (usableCoverage)
          body.push(
            "Using the saved quote coverage for this version. Each carried quote replaces its line's direct labor and material.",
          );
        if (!labor.length && !material.length) body.push("No rates are on file yet.");
        body.push(
          placeholder
            ? "A figure above is PLACEHOLDER until you confirm it."
            : "Confirmed figures are marked.",
        );
        body.push(nextMove("pricing"));
        await audit(sb, job, "estimate_pricing", "save_estimate_pricing", null);
        return present(
          "Estimate Summary",
          body,
          {
            direct,
            placeholder,
            blockers,
            pricing_rows: pricing.rows,
            coverage_rows: usableCoverage?.rows ?? null,
            role: loaded.setup.role,
            snapshot_version: !changed ? (snapshot?.version ?? null) : null,
          },
          ["Use only rates in this result. Do not attribute a number to a publisher."],
        );
      },
    ),
});

export const estimateRateSources = defineTool({
  name: "estimate_rate_sources",
  title: "Rate references",
  description: "Saves which rate references the contractor chooses to carry for a job.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    sources: z
      .array(
        z.object({
          source: z.enum(RATE_SOURCE_IDS),
          carry: z.boolean(),
          metro: z.enum(METROS).optional(),
          location_factor: z.number().finite().positive().optional(),
          work_type: z.enum(WORK_TYPES).optional(),
          work_factor: z.number().finite().positive().optional(),
          confirmed: z.boolean().optional(),
        }),
      )
      .max(8)
      .optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run(
      "estimate_rate_sources",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const snapshot = await coverageSnapshot(sb, job.job_id);
        const prior = parseBid(
          snapshot ? snapshot.bid : await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }),
        );
        const sources = args.sources ? (args.sources as RateChoice[]) : prior.sources;
        if (args.sources) {
          const duplicates = duplicateRateSourceIds(args.sources);
          if (duplicates.length)
            throw new ToolError(
              `Rate sources ${duplicates.join(", ")} contain duplicate choices. Send one decision per source. Nothing was saved.`,
            );
          if (!snapshot)
            throw new ToolError(
              "Version-checked estimating storage is unavailable. Rate references were not saved; refresh after storage is updated.",
            );
          await rpc(sb, "mcp_estimate_pricing_save_versioned", {
            _job: job.job_id,
            _labor: null,
            _material: null,
            _quotes: null,
            _sources: sources,
            _expected_version: snapshot.version,
          });
        }
        await audit(sb, job, "estimate_rate_sources", "save_estimate_rate_sources", null);
        const body = [
          `${named(job)} · Rate references`,
          ...(await jobLaborTerms(sb, job.job_id).then((t) => (t ? [t] : []))),
          ...sourceAsk(),
          ...(sources.length
            ? sources.map((source) =>
                validStoredRateSource(source)
                  ? describeRateChoice(source)
                  : "A saved rate-source choice is malformed and needs review before pricing.",
              )
            : ["None carried yet."]),
          nextMove("rates"),
        ];
        return present("Estimate Summary", body, { sources }, [
          "Do not look up or reproduce a licensed table. A factor is PLACEHOLDER until the contractor confirms it.",
        ]);
      },
    ),
});

export const estimateGeneralConditions = defineTool({
  name: "estimate_general_conditions",
  title: "General conditions",
  description: "Builds the general conditions adder from the contractor's figures.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    start_date: date.optional(),
    finish_date: date.optional(),
    duration_days: z.number().int().min(1).max(5000).optional(),
    lines: z
      .array(
        z.object({
          key: z.enum(["trailer", "office", "cad", "water", "supplies", "supervision"]),
          amount: moneyIn.nullable().optional(),
          qty: moneyIn.nullable().optional(),
          rate: moneyIn.nullable().optional(),
          confirmed: z.boolean().optional(),
        }),
      )
      .max(12)
      .optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run(
      "estimate_general_conditions",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const snapshot = await coverageSnapshot(sb, job.job_id);
        const prior = parseBid(
          snapshot ? snapshot.bid : await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }),
        );
        const changed =
          args.start_date !== undefined ||
          args.finish_date !== undefined ||
          args.duration_days !== undefined ||
          args.lines !== undefined;
        const start = args.start_date ?? prior.startDate;
        const finish = args.finish_date ?? prior.finishDate;
        for (const rows of [prior.gcLines, args.lines ?? []]) {
          const seen = new Set<string>();
          for (const row of rows) {
            if (seen.has(row.key))
              throw new ToolError(
                `General conditions contain duplicate ${row.key} entries. Review them before saving.`,
              );
            seen.add(row.key);
          }
        }
        const duration =
          start && finish && (args.start_date !== undefined || args.finish_date !== undefined)
            ? calendarDays(start, finish)
            : (args.duration_days ?? prior.duration);
        const sent = mergeBy(prior.gcLines, args.lines ?? [], (r) => r.key);
        const priced = GC_ITEMS.map((item) => {
          const row = sent.find((s) => s.key === item.key);
          const calc = gcLineAmount({
            key: item.key,
            amount: row?.amount,
            qty: row?.qty,
            rate: row?.rate,
            duration,
            confirmed: row?.confirmed,
          });
          return { key: item.key, label: item.label, ...calc };
        });
        if (changed) {
          if (!snapshot || snapshot.capabilities?.gc_requirements_cas !== true)
            throw new ToolError(
              "Version-checked general conditions storage is unavailable. Nothing was saved.",
            );
          await rpc(sb, "mcp_estimate_gc_save", {
            _job: job.job_id,
            _start: start,
            _finish: finish,
            _days: duration,
            _lines: { expected_version: snapshot.version, lines: sent },
          });
        }
        await audit(
          sb,
          job,
          "estimate_general_conditions",
          "save_estimate_general_conditions",
          null,
        );
        const body = [
          `${named(job)} · General conditions`,
          duration
            ? `Schedule duration: ${duration} calendar days.`
            : sent.some((row) => row.key === "supervision" && row.qty != null)
              ? "Schedule duration is not set. Supervision uses the quantity that was sent."
              : "Schedule duration is not set. Supervision stays blank until you send a quantity, the start and finish, or the number of days.",
          ...priced.map((p) => `- ${p.math}`),
          "This adder is separate from construction labor and material.",
          nextMove("gc"),
        ];
        return present("Estimate Summary", body, { duration_days: duration, lines: priced }, [
          "Do not fill a general conditions figure the contractor did not send.",
          "After an interrupted or uncertain save, read the current estimate before deciding whether to retry.",
        ]);
      },
    ),
});

export const estimateRequirements = defineTool({
  name: "estimate_requirements",
  title: "Special requirements",
  description:
    "Lists every non-installation project requirement, not only the examples, and keeps it out of labor and material.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    findings: z
      .array(
        z.object({
          kind: z.string().trim().min(1).max(80),
          description: z.string().trim().max(200).optional(),
          title: z.string().trim().min(1).max(200),
          source_type: z.enum(["sheet", "spec", "contract"]),
          source_ref: z.string().trim().min(1).max(80),
          citation: z.string().trim().min(1).max(500),
        }),
      )
      .max(80)
      .optional(),
    prices: z
      .array(
        z.object({
          ref: z.string().trim().max(12).optional(),
          kind: z.string().trim().max(80).optional(),
          source_ref: z.string().trim().max(80).optional(),
          amount: moneyIn.nullable().optional(),
          confirmed: z.boolean().optional(),
          placement: z.enum(["gc", "own_line"]).optional(),
          excluded: z.boolean().optional(),
        }),
      )
      .max(80)
      .optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run(
      "estimate_requirements",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const snapshot = await coverageSnapshot(sb, job.job_id);
        if (!snapshot || snapshot.capabilities?.gc_requirements_cas !== true)
          throw new ToolError(
            "Version-checked requirements storage is unavailable. Nothing was saved.",
          );
        const requirementSources = requirementSourceManifest(snapshot);
        const sourcesChanged = requirementSourceBlocker(snapshot) !== null;
        const reviewedConfirmations: string[] = [];
        const loaded = parseState(snapshot.estimate);
        const measurement = snapshotMeasurement(snapshot, loaded.setup);
        if (measurement) {
          if (measurement.estimate_scope)
            loaded.setup = { ...loaded.setup, ...measurement.estimate_scope };
          loaded.lines = verifiedLines(loaded.lines, measurement);
          loaded.verdicts = loaded.verdicts.map((v) =>
            v.item_kind === "line" ? { ...v, corrected_qty: null } : v,
          );
        }
        const prior = parseBid(snapshot.bid);
        const cq = await sb
          .from("mcp_contract_clauses")
          .select("id, section, source, verbatim_text")
          .eq("job_id", job.job_id);
        if (cq.error)
          throw new ToolError(
            "Saved requirement clauses could not be read. No absence was inferred and nothing was saved.",
          );
        const clauses = await verifyRequirementClauses(requirementSources, cq.data);
        let hits;
        try {
          hits = scanProject({ setup: loaded.setup, clauses, findings: args.findings });
        } catch (e) {
          if (e instanceof BidError) throw new ToolError(e.message);
          throw e;
        }
        const sequence = snapshot.requirements_max_ref;
        if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0)
          throw new ToolError(
            "The saved requirement sequence is unavailable or out of range. Nothing was saved.",
          );
        let n = sequence;
        const usedPrices = new Set<number>();
        const findPrice = (ref: string | undefined, kind: string, sourceRef: string) => {
          const matches = (args.prices ?? [])
            .map((price, index) => ({ price, index }))
            .filter(
              ({ price }) =>
                (price.ref && price.ref === ref) ||
                (price.kind === kind && price.source_ref === sourceRef),
            );
          if (matches.length > 1 || (matches.length === 1 && usedPrices.has(matches[0].index)))
            throw new ToolError(
              "More than one price or requirement matches. Clarify the exact requirement before saving.",
            );
          if (matches.length === 1) usedPrices.add(matches[0].index);
          return matches[0]?.price;
        };
        const priced = hits.map((hit) => {
          const prev = prior.requirements.find(
            (r) =>
              r.kind === hit.kind &&
              r.sourceRef === hit.sourceRef &&
              r.sourceType === hit.sourceType,
          );
          const entered = findPrice(prev?.ref, hit.kind, hit.sourceRef);
          const row = priceRequirement(
            hit,
            {
              amount: entered?.amount !== undefined ? entered.amount : prev?.amount,
              confirmed: entered?.confirmed ?? (sourcesChanged ? false : prev?.confirmed),
              placement: entered?.placement ?? prev?.placement,
              excluded: entered?.excluded ?? (sourcesChanged ? false : prev?.excluded),
            },
            0,
          );
          if (!prev) {
            if (n >= 9_999_999_999)
              throw new ToolError(
                "The saved requirement sequence is out of range. Nothing was saved.",
              );
            n += 1;
          }
          const ref = prev?.ref ?? `R-${n}`;
          if (entered?.confirmed === true || entered?.excluded === true)
            reviewedConfirmations.push(ref);
          return { ...row, ref };
        });
        for (const existing of prior.requirements) {
          if (priced.some((row) => row.ref === existing.ref)) continue;
          const entered = findPrice(existing.ref, existing.kind, existing.sourceRef);
          if (entered?.confirmed === true || entered?.excluded === true)
            reviewedConfirmations.push(existing.ref);
          priced.push({
            ...existing,
            amount: entered?.amount !== undefined ? entered.amount : existing.amount,
            confirmed: entered?.confirmed ?? (sourcesChanged ? false : existing.confirmed),
            placement: entered?.placement ?? existing.placement,
            excluded: entered?.excluded ?? (sourcesChanged ? false : existing.excluded),
          });
        }
        if (usedPrices.size !== (args.prices ?? []).length)
          throw new ToolError(
            "A supplied requirement price did not match a current requirement. Nothing was saved.",
          );
        await rpc(sb, "mcp_estimate_requirements_save", {
          _job: job.job_id,
          _items: {
            expected_version: snapshot.version,
            source_sha256: requirementSources.sha256,
            reviewed_confirmations: reviewedConfirmations,
            items: priced.map((r) => ({
              ref: r.ref,
              kind: r.kind,
              label: r.label,
              description: r.description,
              source_type: r.sourceType,
              source_ref: r.sourceRef,
              citation: r.citation,
              placement: r.placement,
              amount: r.amount,
              confirmed: r.confirmed,
              excluded: r.excluded,
            })),
          },
        });
        await audit(sb, job, "estimate_requirements", "save_estimate_requirements", null);
        const gaps = requirementGaps(hits, loaded.setup.role);
        const body = [
          `${named(job)} · Special requirements`,
          REQUIREMENT_OPEN_LIST,
          "These stay out of installation labor and material. Price each one, or confirm it, and say whether it sits in general conditions or on its own line.",
          ...(priced.length
            ? priced.map(
                (r) =>
                  `- ${r.label} (${r.ref}). ${r.sourceType === "contract" ? "Contract clause" : r.sourceType === "spec" ? "Spec" : "Sheet"} ${r.sourceRef}. ${r.citation}${r.excluded ? " Excluded." : r.amount == null ? " Unpriced. Holds the bid." : ` ${money(r.amount)} ${r.confirmed ? "Confirmed." : "PLACEHOLDER."}`}`,
              )
            : [
                "- None found in the documents on file. Send a finding if the drawings call for one.",
              ]),
          nextMove("requirements"),
        ];
        return present(
          "Estimate Analysis",
          body,
          {
            requirements: priced,
            gaps,
            requirement_source_sha256: requirementSources.sha256,
            requirement_source_version: snapshot.version,
          },
          [
            "After an interrupted or uncertain save, read the current estimate before deciding whether to retry.",
            "Cite the source on each item. Do not invent a price.",
          ],
        );
      },
    ),
});

export const estimateBidSummary = defineTool({
  name: "estimate_bid_summary",
  title: "Bid summary",
  description: "Compounds overhead and profit and returns the bid total for a job.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    overhead_pct: z.number().finite().min(0).max(100).optional(),
    profit_pct: z.number().finite().min(0).max(100).optional(),
    export_format: z.enum(["pdf", "xlsx"]).optional(),
    handoff_draft: z.boolean().optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run(
      "estimate_bid_summary",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        let snapshot = await coverageSnapshot(sb, job.job_id);
        const loadBidInputs = async (current: CoverageSnapshot | null) => {
          const loaded = parseState(
            current ? current.estimate : await rpc(sb, "mcp_estimate_get", { _job: job.job_id }),
          );
          const measurement = current
            ? snapshotMeasurement(current, loaded.setup)
            : await engineSnapshot(sb, job.job_id);
          if (measurement) {
            if (measurement.estimate_scope)
              loaded.setup = { ...loaded.setup, ...measurement.estimate_scope };
            loaded.lines = verifiedLines(loaded.lines, measurement);
            loaded.verdicts = loaded.verdicts.map((v) =>
              v.item_kind === "line" ? { ...v, corrected_qty: null } : v,
            );
          }
          return { loaded, measurement };
        };
        let { loaded, measurement } = await loadBidInputs(snapshot);
        if (measurement && !measurementStatus(measurement).settled)
          return viewEngine(sb, job, measurement);
        const priorForUpdate = snapshot ? parseBid(snapshot.bid) : null;
        const markupChanged =
          priorForUpdate &&
          ((args.overhead_pct != null && args.overhead_pct !== priorForUpdate.overhead) ||
            (args.profit_pct != null && args.profit_pct !== priorForUpdate.profit));
        if (snapshot && markupChanged) {
          await rpc(sb, "mcp_estimate_bid_save_versioned", {
            _job: job.job_id,
            _expected_version: snapshot.version,
            _overhead: args.overhead_pct ?? priorForUpdate!.overhead,
            _profit: args.profit_pct ?? priorForUpdate!.profit,
          });
          snapshot = await coverageSnapshot(sb, job.job_id);
          if (!snapshot)
            throw new ToolError(
              "The saved bid version could not be read. Refresh before continuing.",
            );
          ({ loaded, measurement } = await loadBidInputs(snapshot));
          if (measurement && !measurementStatus(measurement).settled)
            return viewEngine(sb, job, measurement);
        }
        const prior = parseBid(
          snapshot ? snapshot.bid : await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }),
        );
        const overhead = args.overhead_pct ?? prior.overhead;
        const profit = args.profit_pct ?? prior.profit;
        const { view, direct } = calculateBidView(loaded, prior, snapshot, overhead, profit);
        if (!snapshot && (args.overhead_pct != null || args.profit_pct != null))
          await rpc(sb, "mcp_estimate_bid_save", {
            _job: job.job_id,
            _overhead: overhead,
            _profit: profit,
          });
        await audit(sb, job, "estimate_bid_summary", "save_estimate_bid", null);
        const body = [
          `${named(job)} · Bid summary`,
          ...(snapshot
            ? [
                `Based on saved estimate version ${snapshot.version}. Review a new summary after any change.`,
              ]
            : []),
          "Overhead is applied first. Profit is applied on top of overhead.",
          ...view.lines,
          nextMove("bid"),
        ];
        let receipt: Awaited<ReturnType<typeof prepareHandoffDraft>> | null = null;
        if (snapshot && view.ready && view.breakdown) {
          try {
            receipt = await prepareHandoffDraft({
              companyId: job.company_id,
              jobId: job.job_id,
              snapshot,
              ready: view.ready,
              breakdown: view.breakdown,
            });
          } catch {
            throw new ToolError(
              "The bid source could not be reconciled for provenance. Review the estimate before exporting.",
            );
          }
        }
        const provenance =
          receipt && view.breakdown
            ? {
                companyId: job.company_id,
                jobId: job.job_id,
                sourceSha256: receipt.sha256,
                selectedQuotes: view.breakdown.direct
                  .filter((row) => row.basis === "quote")
                  .map((row) => {
                    const quote = prior.quotes[Number(row.quoteId)];
                    return {
                      quoteId: row.quoteId!,
                      ref: row.ref,
                      sub: quote.sub,
                      description: quote.description,
                    };
                  }),
              }
            : undefined;
        const csv = snapshot
          ? canonicalBidCsv({
              job: named(job),
              version: snapshot.version,
              ready: view.ready,
              breakdown: view.breakdown,
              provenance,
            })
          : null;
        const files =
          snapshot && provenance && args.export_format
            ? canonicalBidExport(
                {
                  job: named(job),
                  version: snapshot.version,
                  ready: view.ready,
                  breakdown: view.breakdown,
                  provenance,
                },
                args.export_format,
              )
            : null;
        if (args.export_format && !files) {
          if (!snapshot || !view.ready || !provenance)
            throw new ToolError(
              "A complete, reconciled bid is required before exporting. Review the held rows and pricing first.",
            );
          throw new ToolError(
            args.export_format === "pdf"
              ? "The PDF contains unsupported report text or amounts beyond export precision. Try XLSX for Unicode labels, or review the report values."
              : "The workbook contains unsupported report text or amounts beyond spreadsheet precision. Review the report values before exporting.",
          );
        }
        let handoff = null;
        if (args.handoff_draft) {
          if (!snapshot)
            throw new ToolError(
              "A current versioned estimate is required to prepare a handoff draft.",
            );
          if (!receipt) {
            throw new ToolError(
              "A current, reconciled bid is required to prepare a handoff draft. Review the estimate first.",
            );
          }
          handoff = receipt;
        }
        if (handoff)
          body.push(
            "Handoff draft prepared for review. It is not saved, confirmed, or applied to a budget, schedule of values, or buyout.",
          );
        const artifact =
          files && args.export_format
            ? await saveBidArtifact(
                sb,
                job,
                snapshot!.version,
                args.export_format,
                files.bytes,
                provenance!.sourceSha256,
              )
            : null;
        if (artifact)
          body.push(
            `Download the bid summary for estimate version ${artifact.snapshot_version}: [${artifact.filename}](${artifact.url}). This private link expires in 15 minutes.`,
          );
        const result = {
          ready: view.ready,
          total: view.total,
          direct,
          blockers: view.blockers,
          snapshot_version: snapshot?.version ?? null,
          bid_csv: csv,
          handoff_draft: handoff,
          bid_export: artifact,
        };
        if (measurement) {
          const response = await viewEngine(sb, job, measurement, undefined, {
            report_title: "Bid summary",
            bid_summary: result,
            report_rows: body,
            ...(artifact ? { downloads: [artifact] } : {}),
          });
          if (artifact)
            response.content.push({
              type: "text",
              text: `Private download (15 minutes), estimate version ${artifact.snapshot_version}: [${artifact.filename}](${artifact.url})`,
            });
          return response;
        }
        return present("Bid summary", body, result, [
          "Show direct cost, general conditions, special requirements, overhead and profit, and the total. Red only on a row that holds the bid.",
        ]);
      },
    ),
});

function mergeBy<T>(prior: T[], incoming: T[], key: (row: T) => string): T[] {
  const map = new Map(prior.map((row) => [key(row), row]));
  for (const row of incoming) map.set(key(row), { ...map.get(key(row)), ...row });
  return [...map.values()];
}
