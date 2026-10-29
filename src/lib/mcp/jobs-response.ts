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

export const JOBS_RESPONSE_GUIDANCE =
  "Compose this jobs response in the host's normal response style, as for billing records. Lead with the two counts, then group every source job under its company name. When the host supports visual composition, use two simple metric columns and clean white grouped rows with bold project names, muted job numbers, and subtle dividers. Show the project name as the primary text and its job number as secondary text; keep jobs with missing names and all empty states explicit. Use grouped response formatting only if the host supports it; plain Markdown is the complete fallback. Do not create an Athena embed or custom HTML card, claim a native card was shown, or invent links, buttons, statuses, file icons, or verification/success labels.";
