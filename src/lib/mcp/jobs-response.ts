import { companyChoiceLabel } from "./company-choice";

export type JobsResponseGroup = {
  id?: string;
  name: string;
  /** no_pm: the job has no PM Athena can email, so client approvals and notices go to the owner. */
  jobs: { job_number: string; name: string | null; no_pm?: boolean }[];
};

/** Literal source text in a portable chat response; no links, HTML, or invented statuses. */
function literal(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_{}[\]()#+.!|<>]/g, "\\$&");
}

export function jobsResponseText(
  groups: JobsResponseGroup[],
  counts: { jobs: number; companies: number },
  named: boolean,
): string {
  const lines = [
    `## ${named ? "Company jobs" : "Your jobs · All companies"}`,
    "",
    `**Jobs:** ${counts.jobs} · **Companies:** ${counts.companies}`,
  ];
  if (!groups.length) return [...lines, "", "No accessible company on file."].join("\n");
  const noPm = groups.flatMap((g) => g.jobs.filter((j) => j.no_pm));
  if (noPm.length)
    lines.push(
      "",
      `**No PM set:** ${noPm.length === 1 ? "1 job" : `${noPm.length} jobs`}. Client approvals and notices on ${noPm.length === 1 ? "it" : "those"} email the company owner until you name a PM.`,
    );
  for (const group of groups) {
    lines.push("", `### ${literal(companyChoiceLabel(group, groups))}`);
    if (!group.jobs.length) {
      lines.push("", "No jobs on file.");
      continue;
    }
    for (const [index, job] of group.jobs.entries()) {
      if (index) lines.push("", "---");
      const name = job.name?.trim();
      lines.push("", `**${name ? literal(name) : `Job ${literal(job.job_number)}`}**`);
      const pmFlag = job.no_pm ? " · No PM set" : "";
      if (name) lines.push("", `Job ${literal(job.job_number)}${pmFlag}`);
      else if (pmFlag) lines.push("", "No PM set");
    }
  }
  return lines.join("\n");
}

export { READ_RESPONSE_GUIDANCE as JOBS_RESPONSE_GUIDANCE } from "./read-response";

/** Old discovered job tools still open a viewer that requires structuredContent.html.
 * Supply complete, inert source text without advertising a new widget to current clients. */
export function jobsLegacyHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><style>.jobs-text{margin:0;padding:20px;background:#fff;color:#18314f;font:15px/1.6 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><div class="jobs-text">${escaped}</div></body></html>`;
}
