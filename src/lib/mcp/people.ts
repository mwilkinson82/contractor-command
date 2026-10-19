// Show who is accountable as "Name (Role)". Unassigned items default to the job's PM.
import type { Sb } from "./guard";

type Member = { user_id: string; display_name: string; role: string };

export const UNASSIGNED = "Unassigned (no PM set)";

export function roleLabel(role: string): string {
  return role === "pm" ? "PM" : role === "all_access" ? "All-access" : role.charAt(0).toUpperCase() + role.slice(1);
}

export function makeWho(members: Member[], pmUserId: string | null, pmContact: string | null = null) {
  const pm = members.find((m) => m.user_id === pmUserId) ?? null;
  // A PM who isn't an Athena member is kept as a contact name (0019).
  const pmName = pm?.display_name ?? (pmContact?.trim() || null);
  return (raw: string | null | undefined): string => {
    const v = (raw ?? "").trim();
    if (!v || v.toLowerCase() === "unknown") return pmName ? `${pmName} (PM)` : UNASSIGNED;
    if (!pm && pmName && v.toLowerCase() === pmName.toLowerCase()) return `${pmName} (PM)`;
    if (/\([^)]+\)\s*$/.test(v)) return v;
    const m = members.find((x) => x.display_name.trim().toLowerCase() === v.toLowerCase());
    if (!m) return v;
    return `${m.display_name} (${m.user_id === pmUserId ? "PM" : roleLabel(m.role)})`;
  };
}

export async function whoForJob(sb: Sb, companyId: string, jobId: string) {
  const [mR, jR] = await Promise.all([
    sb.from("mcp_company_members").select("user_id, display_name, role").eq("company_id", companyId),
    sb.from("mcp_jobs").select("pm_user_id, pm_name").eq("id", jobId).maybeSingle(),
  ]);
  // Before migration 0019 pm_name doesn't exist; fall back to the member PM only.
  const j = (jR.error ? (await sb.from("mcp_jobs").select("pm_user_id").eq("id", jobId).maybeSingle()).data : jR.data) as { pm_user_id: string | null; pm_name?: string | null } | null;
  return makeWho((mR.data ?? []) as Member[], j?.pm_user_id ?? null, j?.pm_name ?? null);
}
