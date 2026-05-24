/**
 * Phase 3.9 — print a Markdown dry-run report for the 3.6c persisted
 * FS-chain regression fixture.
 *
 * Internal/admin-only. Pure: does NOT touch the database, does NOT
 * affect production routes, does NOT mutate any schedule. Useful for
 * quickly inspecting how the formatter renders the canonical
 * convention-only mismatch case.
 *
 * Run: bun scripts/phase-3-9-report.ts
 *
 * For a report against a real saved schedule, load it through
 * `summarizePersistedDryRun({ scheduleId, projectName, schedule })`
 * and pipe the result through `formatDryRunReportMarkdown`.
 */
import { PERSISTED_FS_CHAIN_3_6C_FIXTURE } from "@/lib/scheduler/__tests__/fixtures/dry-run-fixtures";
import { summarizePersistedDryRun } from "@/lib/scheduler/engine2/persisted-dry-run";
import { formatDryRunReportMarkdown } from "@/lib/scheduler/engine2/dry-run-report";

const schedule = PERSISTED_FS_CHAIN_3_6C_FIXTURE.make();
const report = summarizePersistedDryRun({
  scheduleId: "fixture-3-6c",
  projectName: PERSISTED_FS_CHAIN_3_6C_FIXTURE.name,
  schedule,
});
console.log(formatDryRunReportMarkdown(report));
