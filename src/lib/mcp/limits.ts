// Per-account Athena call caps. One place to change them; passed to mcp_abuse_cap_check().
// Marshall's numbers (2026-10-19): 200 per hour, 1,000 per day.
export const MCP_HOURLY_CAP = 200;
export const MCP_DAILY_CAP = 1000;
/** These are the two verified platform-owner identities, not company-owner roles.
 * This exception affects the business usage allowance only. Authentication,
 * entitlement, job access and security monitoring still run for every call. */
const PLATFORM_OWNER_IDS = new Set([
  "68ef4232-acf4-423b-a31e-6dde1d4f9639",
  "ffc8331a-1790-4a8e-a423-50c4bf850aa1",
]);
export const isPlatformOwner = (verifiedUserId?: string) =>
  PLATFORM_OWNER_IDS.has(verifiedUserId ?? "");
export function countsTowardAccountCap(tool: string, verifiedUserId?: string): boolean {
  return (
    !isPlatformOwner(verifiedUserId) &&
    !tool.startsWith("estimate_") &&
    ![
      "takeoff_geometry",
      "sheet_calibrate",
      "drawing_set_import",
      "drawing_markup",
      "drawing_sets_list",
    ].includes(tool)
  );
}
/** Time zone used to show when a limit resets. */
export const LIMIT_DISPLAY_TZ = "America/New_York";

export type CapResult = { ok: boolean; limit?: "hourly" | "daily" | "auth"; resets_at?: string };

export const DB_UNAVAILABLE =
  "Athena couldn't reach its database just now. Nothing was saved; please try again in a minute.";

export function capMessage(r: CapResult, now: Date = new Date()): string {
  const at = r.resets_at ? new Date(r.resets_at) : null;
  const hhmm = at
    ? new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: LIMIT_DISPLAY_TZ,
        timeZoneName: "short",
      }).format(at)
    : null;
  const mins = at ? Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 60000)) : null;
  const when = hhmm ? ` It resets at ${hhmm}${mins ? ` (in about ${mins} min)` : ""}.` : "";
  return r.limit === "daily"
    ? `You've hit Athena's daily limit.${when}`
    : `You've hit Athena's hourly limit.${when}`;
}
