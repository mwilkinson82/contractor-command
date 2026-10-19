// Show who is accountable as "Name (Role)". Unassigned items default to the job's PM.
import type { Sb } from "./guard";

type Member = { user_id: string; display_name: string; role: string };

export function roleLabel(role: string): string {
  return role === "pm" ? "PM" : role === "all_access" ? "All-access" : role.charAt(0).toUpperCase() + role.slice(1);
}

export function makeWho(members: Member[], pmUserId: string | null) {
  const pm = members.find((m) => m.user_id === pmUserId) ?? null;
  return (raw: string | null | undefined): string => {
    const v = (raw ?? "").trim();
    if (!v || v.toLowerCase() === "unknown") return pm ? `${pm.display_name} (PM)` : "Unassigned — set the job's PM";
    if (/\([^)]+\)\s*$/.test(v)) return v;
    const m = members.find((x) => x.display_name.trim().toLowerCase() === v.toLowerCase());
    if (!m) return v;
    return `${m.display_name} (${m.user_id === pmUserId ? "PM" : roleLabel(m.role)})`;
  };
}

export async function whoForJob(sb: Sb, companyId: string, jobId: string) {
  const [mR, jR] = await Promise.all([
    sb.from("mcp_company_members").select("user_id, display_name, role").eq("company_id", companyId),
    sb.from("mcp_jobs").select("pm_user_id").eq("id", jobId).maybeSingle(),
  ]);
  return makeWho((mR.data ?? []) as Member[], (jR.data as { pm_user_id: string | null } | null)?.pm_user_id ?? null);
}
