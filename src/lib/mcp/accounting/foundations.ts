// Accounting phase 1 foundations shared by every new accounting, log and record tool (pay apps, logs, transmittals,
// ledger, project record): the approved + base_version write pattern, one role scope check, and the version stamp.
import { ToolError } from "@lovable.dev/mcp-js";
import { FULL_ACCESS_MESSAGE, READ_ONLY_MESSAGE, type Job } from "../jobs";

/** Every new write: approved must be true (the user said yes to this exact change) and base_version must be current. */
export function requireApproved(args: { approved?: unknown }): void {
  if (args.approved !== true) throw new ToolError("Ask first and save only after a yes to this exact change. Nothing was saved.");
}

export function requireBase(label: string, current: number, base: number): void {
  if (current !== base) throw new ToolError(`${label} moved to v${current}. Reload first. Nothing was saved.`);
}

/**
 * One role scope check for every new accounting tool, run before any data is read.
 * - "dollars": reads that carry money (pay apps, retainage, ledger). Full job access only.
 * - "write": every save. Full job access only.
 * - "schedule_logs": logs and schedule without dollars. Anyone with job access except the contract-only role.
 * Which roles see dollars in the Project Record is decision D9 (open); phase 1 does not widen "dollars".
 * The database re-checks the same scope (mcp_job_scope) on every read and write.
 */
export type AccountingNeed = "dollars" | "write" | "schedule_logs";
export function accountingScope(job: Job, need: AccountingNeed): void {
  const sc = job.scope ?? "full";
  if (need === "schedule_logs") {
    if (sc === "contract") throw new ToolError(FULL_ACCESS_MESSAGE);
    return;
  }
  if (sc === "full") return;
  throw new ToolError(sc === "super" ? READ_ONLY_MESSAGE : FULL_ACCESS_MESSAGE);
}

/** "2027-03-10 08:05 CST, Luis Ortega": the stamp prints in the job time zone with its label. */
export function versionStamp(atIso: string, timeZone: string, who: string | null): string {
  const d = new Date(atIso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")} ${p("timeZoneName")}${who ? `, ${who}` : ""}`;
}

/** Next number in a sequence, zero padded: ("T-", 7) -> "T-007"; ("RFI-", 12) -> "RFI-012". */
export const seqLabel = (prefix: string, n: number, width = 3) => `${prefix}${String(n).padStart(width, "0")}`;
