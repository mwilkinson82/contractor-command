/** Display package history in the requested review zone; stored timestamps stay unchanged. */
export function submittalBuildTime(value: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "Build time unavailable";
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Manaus",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)} Manaus (UTC-4)`;
}
