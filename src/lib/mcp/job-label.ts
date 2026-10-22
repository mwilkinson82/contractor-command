/** Job number once, then the name. A name that already starts with the number is not prefixed again. */
export function jobTitle(job: { job_number: string; name?: string | null }): string {
  const number = job.job_number.trim();
  const name = (job.name ?? "").replace(/\s+/g, " ").trim();
  if (!number) return name;
  if (!name) return number;
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = new RegExp(`^(?:${escaped}(?:[\\s–—-]+|$))+`, "i");
  if (!lead.test(name)) return `${number} ${name}`;
  const rest = name.replace(lead, "").replace(/^[–—-]+\s*/, "").trim();
  return rest ? `${number} ${rest}` : number;
}

/**
 * Label used on cards and pages.
 * A dash is used when the number is being added. A name that already carries the number keeps a single copy.
 */
export function jobHeading(
  job: { job_number: string; name?: string | null },
  sep: " " | " – " = " – ",
): string {
  const number = job.job_number.trim();
  const titled = jobTitle(job);
  const raw = (job.name ?? "").replace(/\s+/g, " ").trim();
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const already = Boolean(number) && new RegExp(`^${escaped}(?:\\s|[–—-]|$)`, "i").test(raw);
  if (!number || titled === number || already || sep === " ") return titled;
  const rest = titled.slice(number.length).trim();
  return rest ? `${number}${sep}${rest}` : titled;
}
