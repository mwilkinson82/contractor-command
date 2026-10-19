// Per-account Athena call caps. One place to change them; passed to mcp_abuse_cap_check().
// Marshall's numbers (2026-10-19): 200 per hour, 1,000 per day.
export const MCP_HOURLY_CAP = 200;
export const MCP_DAILY_CAP = 1000;
/** Time zone used to show when a limit resets. */
export const LIMIT_DISPLAY_TZ = "America/New_York";

export type CapResult = { ok: boolean; limit?: "hourly" | "daily" | "auth"; resets_at?: string };

export const DB_UNAVAILABLE = "Athena couldn't reach its database just now. Nothing was saved; please try again in a minute.";

export function capMessage(r: CapResult, now: Date = new Date()): string {
  const at = r.resets_at ? new Date(r.resets_at) : null;
  const hhmm = at
    ? new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: LIMIT_DISPLAY_TZ, timeZoneName: "short" }).format(at)
    : null;
  const mins = at ? Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 60000)) : null;
  const when = hhmm ? ` It resets at ${hhmm}${mins ? ` (in about ${mins} min)` : ""}.` : "";
  return r.limit === "daily" ? `You've hit Athena's daily limit.${when}` : `You've hit Athena's hourly limit.${when}`;
}
