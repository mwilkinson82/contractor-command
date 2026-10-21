// Bid walkthrough tools. Same gate as the other estimating tools.
import { ToolError, defineTool, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  GC_ITEMS,
  METROS,
  RATE_SOURCE_IDS,
  WORK_TYPES,
  BidError,
  applyFactors,
  assembleBid,
  basisCheck,
  calendarDays,
  describeRateChoice,
  gcLineAmount,
  nextMove,
  priceLabor,
  priceMaterial,
  priceRequirement,
  requirementGaps,
  scanProject,
  sourceAsk,
  type LaborIn,
  type RateChoice,
  type RateSourceId,
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
import { audit, prefix, resolveJob } from "../jobs";
import { money } from "../sov";
import { guide } from "../visible";

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
  if (error) dbError(error);
  return data as T;
}

type BidState = {
  labor: LaborIn[];
  material: {
    ref: string;
    unit_price: number | null;
    confirmed?: boolean;
    apply_factor?: boolean;
    source?: RateSourceId | null;
  }[];
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
  requirements: RequirementPrice[];
  overhead: number | null;
  profit: number | null;
};

function num(v: unknown): number | null {
  return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}
function parseBid(raw: unknown): BidState {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pricing = (o.pricing ?? {}) as Record<string, unknown>;
  const gc = (o.general_conditions ?? {}) as Record<string, unknown>;
  const bid = (o.bid ?? {}) as Record<string, unknown>;
  const reqs = Array.isArray(o.requirements) ? (o.requirements as Record<string, unknown>[]) : [];
  return {
    labor: Array.isArray(pricing.labor) ? (pricing.labor as LaborIn[]) : [],
    material: Array.isArray(pricing.material) ? (pricing.material as BidState["material"]) : [],
    quotes: Array.isArray(pricing.quotes) ? (pricing.quotes as BidState["quotes"]) : [],
    sources: Array.isArray(pricing.rate_sources) ? (pricing.rate_sources as RateChoice[]) : [],
    gcLines: Array.isArray(gc.lines) ? (gc.lines as BidState["gcLines"]) : [],
    duration: num(gc.duration_days),
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
  description: "Computes labor cost from the contractor's production and rates for a job.",
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
    run("estimate_pricing", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const loaded = parseState(await rpc(sb, "mcp_estimate_get", { _job: job.job_id }));
      const prior = parseBid(await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }));
      if (!loaded.setup.role) {
        return present(
          "Estimate Summary",
          [
            `${prefix(job)}${job.name} · Pricing`,
            "Save the intake and name general contractor or self-performer before pricing. Nothing was priced.",
            nextMove("takeoff"),
          ],
          { priced: false },
          ["Do not assume the role."],
        );
      }
      const labor = mergeBy(prior.labor, args.labor ?? [], (r) => r.ref);
      const material = mergeBy(
        prior.material,
        (args.material ?? []).map((m) => ({ ...m, unit_price: m.unit_price ?? null })),
        (r) => r.ref,
      );
      const quotes = args.quotes
        ? args.quotes.map((q) => ({
            ...q,
            amount: q.amount ?? null,
            ref: q.ref ?? null,
            trade: q.trade ?? null,
          }))
        : prior.quotes;
      await rpc(sb, "mcp_estimate_pricing_save", {
        _job: job.job_id,
        _labor: labor,
        _material: material,
        _quotes: quotes,
        _sources: null,
      });
      const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
        role: loaded.setup.role,
        trades: loaded.setup.trades,
      });
      const lines = state.items.filter((i) => i.kind === "line" && i.status !== "dropped");
      const body = [
        `${prefix(job)}${job.name} · Pricing`,
        loaded.setup.role === "gc"
          ? "General contractor: labor plus material is the basis for checking a sub quote."
          : "Self-performer: labor is man-hours or man-days from your production, times your rate.",
      ];
      let placeholder = false;
      let direct = 0;
      for (const item of lines) {
        const lab = labor.find((l) => l.ref === item.ref || l.ref === item.title);
        const mat = material.find((m) => m.ref === item.ref || m.ref === item.title);
        if (!lab && !mat) continue;
        const priced = lab ? priceLabor(item.qty, item.unit, lab) : null;
        const materialP = mat
          ? priceMaterial(item.qty, mat.unit_price ?? null, Boolean(mat.confirmed))
          : null;
        const factor =
          prior.sources.find(
            (s) => s.carry && s.source === (lab as { source?: RateSourceId } | undefined)?.source,
          ) ??
          (prior.sources.filter((s) => s.carry).length === 1
            ? prior.sources.find((s) => s.carry)!
            : null);
        let laborDollars = priced?.labor ?? null;
        let extra = "";
        if (laborDollars != null && (lab as { apply_factor?: boolean } | undefined)?.apply_factor) {
          const applied = applyFactors(laborDollars, factor);
          laborDollars = applied.amount;
          extra = applied.note;
        }
        if (priced?.placeholder || materialP?.placeholder) placeholder = true;
        if (laborDollars != null) direct += laborDollars;
        if (materialP?.material != null) direct += materialP.material;
        body.push(
          `- ${item.ref} ${item.title}. ${priced?.math ?? ""} ${materialP?.math ?? ""} ${extra}`
            .replace(/\s+/g, " ")
            .trim(),
        );
      }
      if (loaded.setup.role === "self_performer") {
        body.push(
          "Send, for each line: production per man-hour, or man-hours you already have; crew size; hours in a man-day; and an hourly rate or a blended crew rate.",
        );
      } else {
        body.push(
          "Send labor the same way, plus a material price per line, to build the basis. Then send each sub quote.",
        );
        for (const q of quotes) {
          const item = lines.find((i) => i.ref === q.ref);
          const lab = item
            ? priceLabor(
                item.qty,
                item.unit,
                labor.find((l) => l.ref === item.ref) ?? { ref: item.ref },
              )
            : null;
          const mat = item
            ? priceMaterial(
                item.qty,
                material.find((m) => m.ref === item.ref)?.unit_price ?? null,
                false,
              )
            : null;
          const check = basisCheck(lab?.labor ?? null, mat?.material ?? null, q.amount);
          body.push(`- ${q.sub} ${q.description}. ${check.line}`);
        }
      }
      if (!labor.length && !material.length) body.push("No rates are on file yet.");
      body.push(
        placeholder
          ? "A figure above is PLACEHOLDER until you confirm it."
          : "Confirmed figures are marked.",
      );
      body.push(nextMove("pricing"));
      await audit(sb, job, "estimate_pricing", "save_estimate_pricing", null);
      return present("Estimate Summary", body, { direct, placeholder, role: loaded.setup.role }, [
        "Use only rates in this result. Do not attribute a number to a publisher.",
      ]);
    }),
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
    run("estimate_rate_sources", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const prior = parseBid(await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }));
      const sources = args.sources ? (args.sources as RateChoice[]) : prior.sources;
      if (args.sources)
        await rpc(sb, "mcp_estimate_pricing_save", {
          _job: job.job_id,
          _labor: null,
          _material: null,
          _quotes: null,
          _sources: sources,
        });
      await audit(sb, job, "estimate_rate_sources", "save_estimate_rate_sources", null);
      const body = [
        `${prefix(job)}${job.name} · Rate references`,
        ...sourceAsk(),
        ...(sources.length ? sources.map(describeRateChoice) : ["None carried yet."]),
        nextMove("rates"),
      ];
      return present("Estimate Summary", body, { sources }, [
        "Do not look up or reproduce a licensed table. A factor is PLACEHOLDER until the contractor confirms it.",
      ]);
    }),
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
    run("estimate_general_conditions", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const prior = parseBid(await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }));
      const duration =
        args.start_date && args.finish_date
          ? calendarDays(args.start_date, args.finish_date)
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
      await rpc(sb, "mcp_estimate_gc_save", {
        _job: job.job_id,
        _start: args.start_date ?? null,
        _finish: args.finish_date ?? null,
        _days: duration,
        _lines: sent,
      });
      await audit(sb, job, "estimate_general_conditions", "save_estimate_general_conditions", null);
      const body = [
        `${prefix(job)}${job.name} · General conditions`,
        duration
          ? `Schedule duration: ${duration} calendar days.`
          : "Schedule duration is not set. Supervision stays blank until you send the start and finish, or the number of days.",
        ...priced.map((p) => `- ${p.math}`),
        "This adder is separate from construction labor and material.",
        nextMove("gc"),
      ];
      return present("Estimate Summary", body, { duration_days: duration, lines: priced }, [
        "Do not fill a general conditions figure the contractor did not send.",
      ]);
    }),
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
    run("estimate_requirements", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const loaded = parseState(await rpc(sb, "mcp_estimate_get", { _job: job.job_id }));
      const prior = parseBid(await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }));
      let clauses: { section: string; verbatim_text: string }[] = [];
      const cq = await sb
        .from("mcp_contract_clauses")
        .select("section, verbatim_text")
        .eq("job_id", job.job_id);
      if (!cq.error && Array.isArray(cq.data))
        clauses = cq.data as { section: string; verbatim_text: string }[];
      let hits;
      try {
        hits = scanProject({ setup: loaded.setup, clauses, findings: args.findings });
      } catch (e) {
        if (e instanceof BidError) throw new ToolError(e.message);
        throw e;
      }
      let n = prior.requirements.reduce((m, r) => Math.max(m, Number(r.ref.slice(2)) || 0), 0);
      const priced = hits.map((hit) => {
        const prev = prior.requirements.find(
          (r) =>
            r.kind === hit.kind && r.sourceRef === hit.sourceRef && r.sourceType === hit.sourceType,
        );
        const entered = (args.prices ?? []).find(
          (p) =>
            (p.ref && p.ref === prev?.ref) ||
            (p.kind === hit.kind && p.source_ref === hit.sourceRef),
        );
        const row = priceRequirement(
          hit,
          {
            amount: entered?.amount ?? prev?.amount,
            confirmed: entered?.confirmed ?? prev?.confirmed,
            placement: entered?.placement ?? prev?.placement,
            excluded: entered?.excluded ?? prev?.excluded,
          },
          0,
        );
        if (!prev) n += 1;
        return { ...row, ref: prev?.ref ?? `R-${n}` };
      });
      await rpc(sb, "mcp_estimate_requirements_save", {
        _job: job.job_id,
        _items: priced.map((r) => ({
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
      });
      await audit(sb, job, "estimate_requirements", "save_estimate_requirements", null);
      const gaps = requirementGaps(hits, loaded.setup.role);
      const body = [
        `${prefix(job)}${job.name} · Special requirements`,
        REQUIREMENT_OPEN_LIST,
        "These stay out of installation labor and material. Price each one, or confirm it, and say whether it sits in general conditions or on its own line.",
        ...(priced.length
          ? priced.map(
              (r) =>
                `- ${r.ref} ${r.label}. ${r.sourceType === "contract" ? "Contract clause" : r.sourceType === "spec" ? "Spec" : "Sheet"} ${r.sourceRef}. ${r.citation}${r.excluded ? " Excluded." : r.amount == null ? " Unpriced. Holds the bid." : ` ${money(r.amount)} ${r.confirmed ? "Confirmed." : "PLACEHOLDER."}`}`,
            )
          : [
              "- None found in the documents on file. Send a finding if the drawings call for one.",
            ]),
        nextMove("requirements"),
      ];
      return present("Estimate Analysis", body, { requirements: priced, gaps }, [
        "Cite the source on each item. Do not invent a price.",
      ]);
    }),
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
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_bid_summary", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const loaded = parseState(await rpc(sb, "mcp_estimate_get", { _job: job.job_id }));
      const prior = parseBid(await rpc(sb, "mcp_estimate_bid_get", { _job: job.job_id }));
      const overhead = args.overhead_pct ?? prior.overhead;
      const profit = args.profit_pct ?? prior.profit;
      if (args.overhead_pct != null || args.profit_pct != null)
        await rpc(sb, "mcp_estimate_bid_save", {
          _job: job.job_id,
          _overhead: overhead,
          _profit: profit,
        });
      const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
        role: loaded.setup.role,
        trades: loaded.setup.trades,
      });
      let direct = 0;
      let directPlaceholder = false;
      for (const item of state.items.filter((i) => i.kind === "line" && i.status !== "dropped")) {
        const lab = prior.labor.find((l) => l.ref === item.ref);
        const mat = prior.material.find((m) => m.ref === item.ref);
        const priced = lab ? priceLabor(item.qty, item.unit, lab) : null;
        const materialP = mat
          ? priceMaterial(item.qty, mat.unit_price, Boolean(mat.confirmed))
          : null;
        if (priced?.placeholder || materialP?.placeholder) directPlaceholder = true;
        if (priced?.labor != null) direct += priced.labor;
        if (materialP?.material != null) direct += materialP.material;
      }
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
      const view = assembleBid({
        direct,
        directPlaceholder,
        gc,
        requirements: prior.requirements,
        overheadPct: overhead,
        profitPct: profit,
        settled: state.settled,
      });
      await audit(sb, job, "estimate_bid_summary", "save_estimate_bid", null);
      const body = [
        `${prefix(job)}${job.name} · Bid summary`,
        "Overhead is applied first. Profit is applied on top of overhead.",
        ...view.lines,
        nextMove("bid"),
      ];
      return present("Bid summary", body, { ready: view.ready, total: view.total, direct }, [
        "Show direct cost, general conditions, special requirements, overhead and profit, and the total. Red only on a row that holds the bid.",
      ]);
    }),
});

function mergeBy<T>(prior: T[], incoming: T[], key: (row: T) => string): T[] {
  const map = new Map(prior.map((row) => [key(row), row]));
  for (const row of incoming) map.set(key(row), { ...map.get(key(row)), ...row });
  return [...map.values()];
}
