import { ToolError } from "@lovable.dev/mcp-js";
import { memberCompanies, type Job } from "./jobs";
import type { Sb } from "./guard";

/** The legacy resolver can fall back to a uniquely found job in another company.
 * A controlled schedule edit must honor an explicitly selected company. */
export async function assertScheduleCompany(sb: Sb, job: Job, requested?: string) {
  if (!requested || requested.trim().toLowerCase() === job.company_id.toLowerCase()) return;
  const wanted = requested.trim().toLowerCase();
  const matches = (await memberCompanies(sb)).filter(
    (c) => c.id.toLowerCase() === wanted || c.name.trim().toLowerCase() === wanted,
  );
  if (matches.length !== 1 || matches[0].id !== job.company_id)
    throw new ToolError(
      "That job is not in the company you named. No schedule was read or changed.",
    );
}
