export type SubmittalTimeZones = {
  job?: string | null;
  company?: string | null;
  member?: string | null;
};

/** Never infer a job's local zone from the server or the viewing device. */
export function submittalTimeZone(zones: SubmittalTimeZones = {}) {
  for (const source of ["job", "company", "member"] as const) {
    const zone = zones[source]?.trim();
    if (!zone) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
      return { zone, source };
    } catch {
      /* An invalid saved zone does not mask a valid fallback. */
    }
  }
  return { zone: "UTC", source: "fallback" as const };
}

/** Named, date-specific zone (including DST); stored instants stay unchanged. */
export function submittalBuildTime(value: string, zones: SubmittalTimeZones = {}): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "Build time unavailable";
  const selected = submittalTimeZone(zones);
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: selected.zone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
  return `${clock} (${selected.source === "fallback" ? "UTC; no saved time zone" : selected.zone})`;
}
