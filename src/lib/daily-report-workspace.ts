import { accountingDate } from "./accounting-report";
import { assembleDaily, type DailySections } from "./mcp/superintendent";
import { readProductionDaily, type ProductionClient } from "./production-report";

export const DAILY_FIELDS = [
  ["weather", "Weather", 500],
  ["manpower", "Crews & hours", 500],
  ["subs_on_site", "Subcontractors on site", 1000],
  ["deliveries", "Deliveries", 1000],
  ["issues", "Issues & constraints", 2000],
  ["delays", "Delays", 2000],
  ["safety", "Safety", 1000],
] as const;
export function validateDailyCapture(date: string, input: DailySections) {
  if (!accountingDate.safeParse(date).success) throw new Error("Choose a valid report date.");
  if (input.work.length > 80) throw new Error("A daily supports up to 80 work lines.");
  const draft = assembleDaily(input);
  if (!draft.ready) throw new Error(draft.follow_ups.join(" "));
  for (const [key, label, max] of DAILY_FIELDS)
    if ((draft[key]?.length ?? 0) > max) throw new Error(`${label} exceeds ${max} characters.`);
  for (const line of draft.work) {
    if (
      !/^\d{2}\.\d{2,3}$/.test(line.sov_item ?? "") ||
      !line.work.trim() ||
      line.work.length > 400 ||
      !line.activity_id ||
      line.activity_id.length > 20 ||
      !line.unit ||
      line.unit.length > 12
    )
      throw new Error(
        "Each work line needs a description, SOV item (for example 26.04), activity and unit.",
      );
    if ([line.qty, line.crew, line.hours].some((v) => v === null || !Number.isFinite(v) || v <= 0))
      throw new Error("Quantity, crew and hours must be positive numbers.");
    if (
      line.pct_complete !== null &&
      (!Number.isFinite(line.pct_complete) || line.pct_complete < 0 || line.pct_complete > 100)
    )
      throw new Error("Percent complete must be between 0 and 100.");
  }
  return draft;
}
/** The canonical report read rechecks membership and full/assigned-super scope before the index. */
export async function readDailyIndex(client: ProductionClient, jobId: string) {
  await readProductionDaily(client, jobId, new Date().toISOString().slice(0, 10));
  const result = await client
    .from("mcp_daily_reports")
    .select("report_date")
    .eq("job_id", jobId)
    .order("report_date", { ascending: false })
    .limit(201);
  if (result.error || !Array.isArray(result.data))
    throw new Error(
      "Saved report dates are unavailable. Choose an exact date to retry the report read.",
    );
  const dates = result.data.map((row: { report_date: string }) =>
    accountingDate.parse(row.report_date),
  );
  return { dates: dates.slice(0, 200), complete: dates.length <= 200 };
}
export type DailyCaptureReview = Readonly<{
  requestId: string;
  reviewedAt: string;
  fingerprint: string;
}>;
export type DailyCaptureFailure = "conflict" | "stale" | "access" | "unavailable" | "uncertain";
export class DailyCaptureSaveError extends Error {
  constructor(
    public readonly kind: DailyCaptureFailure,
    message: string,
  ) {
    super(message);
  }
}
const captureFingerprint = (job: string, date: string, input: DailySections) =>
  JSON.stringify({ job, date, draft: validateDailyCapture(date, input) });
/** Binds one immutable confirmation to the complete validated draft, date and project. */
export function reviewDailyCapture(
  job: string,
  date: string,
  input: DailySections,
  now = new Date(),
  requestId = crypto.randomUUID(),
): DailyCaptureReview {
  return Object.freeze({
    requestId,
    reviewedAt: now.toISOString(),
    fingerprint: captureFingerprint(job, date, input),
  });
}
/** Create-only guarded RPC. Exact retries reuse the same reviewed payload/key; never fall back to upsert. */
export async function saveDailyCapture(
  client: ProductionClient,
  jobId: string,
  date: string,
  input: DailySections,
  confirmed: boolean,
  review?: DailyCaptureReview,
) {
  if (!confirmed)
    throw new DailyCaptureSaveError("stale", "Review and confirm the daily before saving.");
  if (!review || review.fingerprint !== captureFingerprint(jobId, date, input))
    throw new DailyCaptureSaveError(
      "stale",
      "The draft or date changed after review. Review and confirm it again.",
    );
  const draft = validateDailyCapture(date, input);
  let result: Awaited<ReturnType<ProductionClient["rpc"]>>;
  try {
    result = await client.rpc("mcp_daily_report_create", {
      _job: jobId,
      _date: date,
      _confirmed: true,
      _request: review.requestId,
      _reviewed_at: review.reviewedAt,
      _weather: draft.weather,
      _manpower: draft.manpower,
      _subs: draft.subs_on_site,
      _deliveries: draft.deliveries,
      _issues: draft.issues,
      _delays: draft.delays,
      _safety: draft.safety,
      _lines: draft.work,
    });
  } catch {
    throw new DailyCaptureSaveError(
      "uncertain",
      "The creation receipt was not received. Check or retry this same confirmed request; it cannot replace an existing daily.",
    );
  }
  if (result.error) {
    const { code, message } = result.error;
    if (["PGRST202", "42883"].includes(code ?? ""))
      throw new DailyCaptureSaveError(
        "unavailable",
        "Daily capture is unavailable until the create-only save is installed. Nothing was sent to the existing update workflow.",
      );
    if (message.includes("MCP_DAILY_EXISTS:"))
      throw new DailyCaptureSaveError(
        "conflict",
        "Another daily already exists for this date. Nothing was replaced. Review the saved report or choose a new date.",
      );
    if (/MCP_DAILY_(STALE|KEY|REVIEW|CONFIRM|INPUT):/.test(message))
      throw new DailyCaptureSaveError(
        "stale",
        "This confirmation is stale or no longer matches the draft. Review the current date and draft again.",
      );
    if (
      code === "42501" ||
      /MCP_(DAILY_ACCESS|NO_JOB|INACTIVE|DENIED)|role can't|active membership|not active|membership|entitlement/i.test(
        message,
      )
    )
      throw new DailyCaptureSaveError(
        "access",
        "Current project access could not be verified. This request was refused. Recheck access before reviewing again.",
      );
    // A server SQL error rolls the transaction back, but an unknown transport-shaped error may not.
    throw new DailyCaptureSaveError(
      "uncertain",
      "The creation receipt was not confirmed. Check or retry this same confirmed request before doing anything else.",
    );
  }
  const receipt = result.data as {
    saved?: boolean;
    creation_only?: boolean;
    request_id?: string;
    replayed?: boolean;
    id?: string;
  } | null;
  if (
    !receipt ||
    receipt.saved !== true ||
    receipt.creation_only !== true ||
    receipt.request_id !== review.requestId ||
    typeof receipt.id !== "string" ||
    typeof receipt.replayed !== "boolean"
  )
    throw new DailyCaptureSaveError(
      "uncertain",
      "The create-only receipt was not confirmed. Check or retry this same confirmed request; no alternate save was attempted.",
    );
  return receipt;
}
