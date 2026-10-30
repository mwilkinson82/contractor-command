export type JobsResponseGroup = {
  name: string;
  jobs: { job_number: string; name: string | null }[];
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
  for (const group of groups) {
    lines.push("", `### ${literal(group.name)}`);
    if (!group.jobs.length) {
      lines.push("", "No jobs on file.");
      continue;
    }
    for (const [index, job] of group.jobs.entries()) {
      if (index) lines.push("", "---");
      const name = job.name?.trim();
      lines.push("", `**${name ? literal(name) : `Job ${literal(job.job_number)}`}**`);
      if (name) lines.push("", `Job ${literal(job.job_number)}`);
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
