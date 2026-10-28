import { attachVersionedAp, buildVersionedApReport } from "./accounting-ap-versioned";
import { apReportingCapability } from "./accounting-ap-snapshot";
import {
  accountingDate,
  billingReportSchema,
  buildAccountingReport,
  poReportSchema,
  type AccountingOptions,
  type BudgetFact,
  type Dependency,
} from "./accounting-report";

type ReadError = { message: string; code?: string };
type Result = { data: unknown; error: ReadError | null };
export type AccountingIO = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Result>;
  budgetPage: (jobId: string, start: number, end: number) => PromiseLike<Result>;
};
export const BUDGET_PAGE_SIZE = 500;
const MAX_ROWS = 10_000;
function bounded(data: unknown) {
  if (JSON.stringify(data)?.length > 10_000_000)
    throw new Error(
      "Accounting source exceeds the bounded report limit. Narrowing source support is required; no partial total was returned.",
    );
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if ("currency" in v && (v as { currency: unknown }).currency !== "USD")
      throw new Error("Unsupported currency. Cross-currency totals are unavailable.");
    if (Array.isArray(v)) {
      if (v.length > MAX_ROWS)
        throw new Error("Accounting source row limit exceeded; no partial totals.");
      v.forEach(walk);
    } else Object.values(v).forEach(walk);
  };
  walk(data);
  return data;
}
const missing = (e: ReadError) => ["PGRST202", "42883"].includes(e.code ?? "");
async function dependency<T>(
  io: AccountingIO,
  name: string,
  job: string,
  parse: (v: unknown) => T,
  label: string,
): Promise<Dependency<T>> {
  const r = await io.rpc(name, { _job: job });
  if (r.error) {
    if (missing(r.error))
      return {
        available: false,
        reason: `${label} unavailable: source integration is not installed. No zero is inferred.`,
      };
    // Permission, membership and transport failures do not masquerade as a missing integration.
    throw new Error(
      `${label} could not be read. Access or source availability must be resolved before reporting.`,
    );
  }
  try {
    return { available: true, data: parse(bounded(r.data)) };
  } catch {
    return {
      available: false,
      reason: `${label} unavailable: source contract or currency is unsupported. No partial total was inferred.`,
    };
  }
}
/** Caller supplies a user-scoped client only. The billing RPC rechecks active membership and full job scope FIRST. */
export async function readAccountingReport(
  io: AccountingIO,
  jobId: string,
  options: AccountingOptions,
  companyId?: string,
  now = new Date(),
) {
  const capturedAt = now.toISOString();
  accountingDate.parse(options.asOf);
  if (options.from) accountingDate.parse(options.from);
  if (options.asOf > capturedAt.slice(0, 10) || (options.from && options.from > options.asOf))
    throw new Error("Choose dates through today, with start on or before as-of.");
  const billing = await io.rpc("mcp_billing_evidence_get", { _job: jobId });
  if (billing.error)
    throw new Error(
      "Accounting reports require active membership and full access to this project. The source could not be read.",
    );
  const billingData = billingReportSchema.parse(bounded(billing.data));
  const budgets: BudgetFact[] = [];
  for (let start = 0; ; start += BUDGET_PAGE_SIZE) {
    const r = await io.budgetPage(jobId, start, start + BUDGET_PAGE_SIZE - 1);
    if (r.error || !Array.isArray(r.data))
      throw new Error("Budget source unavailable; no partial report returned.");
    if (r.data.length > BUDGET_PAGE_SIZE || budgets.length + r.data.length > MAX_ROWS)
      throw new Error("Budget row limit exceeded; no partial totals returned.");
    bounded(r.data);
    for (const row of r.data) {
      if (
        !row ||
        typeof row !== "object" ||
        typeof row.job_id !== "string" ||
        typeof row.key !== "string" ||
        typeof row.status !== "string"
      )
        throw new Error("Budget source contract changed.");
      budgets.push(row as BudgetFact);
    }
    if (r.data.length < BUDGET_PAGE_SIZE) break;
  }
  const ap = await io.rpc("mcp_cost_reconciliation_snapshot", { _job: jobId });
  if (ap.error && !missing(ap.error))
    throw new Error(
      "AP snapshot could not be read. Access or source availability must be resolved before reporting.",
    );
  const versioned = !ap.error
    ? buildVersionedApReport(ap.data, jobId, options.asOf, options.from || null, companyId)
    : null;
  const costs = ap.error
    ? {
        available: false as const,
        reason:
          "AP snapshot unavailable: source integration is not installed. No zero or partial-reader fallback is inferred.",
      }
    : apReportingCapability(ap.data, jobId, companyId);
  const orders = await dependency(
    io,
    "mcp_project_purchase_orders_get",
    jobId,
    (v) => poReportSchema.parse(v),
    "PO commitments",
  );
  const report = buildAccountingReport(
    { jobId, companyId, capturedAt, billing: billingData, budgets, costs, orders },
    options,
  );
  return versioned ? attachVersionedAp(report, versioned) : report;
}
/** Bridge for the existing Supabase query builder, always the signed-in user's client; never an admin. */
export function accountingIO(client: unknown): AccountingIO {
  const sb = client as {
    rpc: AccountingIO["rpc"];
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          eq: (
            column: string,
            value: string,
          ) => {
            order: (
              column: string,
              options: { ascending: boolean },
            ) => { range: (start: number, end: number) => PromiseLike<Result> };
          };
        };
      };
    };
  };
  return {
    rpc: (name, args) => sb.rpc(name, args),
    budgetPage: (job, start, end) =>
      sb
        .from("mcp_job_facts")
        .select("job_id,key,value,status")
        .eq("job_id", job)
        .eq("module", "budget")
        .order("key", { ascending: true })
        .range(start, end),
  };
}
