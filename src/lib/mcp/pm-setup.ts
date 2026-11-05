// Every job needs a PM Athena can email: client approvals, client messages, submittal replies and sub or supplier
// confirmations all go to the job's PM. With no PM email they go to the company owner instead (job notices), so
// setup, import and job settings walk the member to a PM on a teammate's account.
import type { Sb } from "./guard";

export type Teammate = { name: string; role: string };
export type PmState = { pm: string | null; pm_email: string | null; pm_is_member: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when Athena can email the job's PM. */
export const pmReachable = (s: {
  pm_email?: string | null;
  pm_is_member?: boolean | null;
  pm_user_id?: string | null;
}) => !!s.pm_user_id || s.pm_is_member === true || EMAIL.test((s.pm_email ?? "").trim());

export const NO_PM_EMAIL_NOTE =
  "No PM email on this job yet, so client approvals and notices email the company owner until there is one.";

const words = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Teammates the member probably meant when the PM they typed isn't a teammate's exact Athena name: "Marshall
 * Wilkinson" for the teammate "Marshall", or "Sam" for "Sam Ortiz". Matches on whole words only.
 */
export function pmNearMatches(typed: string | null | undefined, team: Teammate[]): Teammate[] {
  const t = words(typed ?? "");
  if (!t.length) return [];
  return team.filter((m) => {
    const n = words(m.name);
    if (!n.length || n.join(" ") === t.join(" ")) return false;
    const [short, long] = n.length <= t.length ? [n, t] : [t, n];
    return short.every((w, i) => long[i] === w);
  });
}

const nameList = (team: Teammate[]) => team.map((m) => m.name).join(", ");

/**
 * What to say after a PM is saved (or left unset): a plain confirmation when the PM is a teammate Athena can email,
 * otherwise the note that emails go to the owner and one question that gets the PM onto a teammate's account.
 */
export function pmSetupNext(
  s: PmState,
  team: Teammate[],
  typed?: string | null,
): { lines: string[]; guidance: string[] } {
  if (s.pm && s.pm_is_member)
    return {
      lines: [
        `${s.pm} is the job's PM${s.pm_email ? `. Client approvals and notices email ${s.pm_email}` : ""}.`,
      ],
      guidance: [],
    };
  if (s.pm && pmReachable(s))
    return {
      lines: [
        `${s.pm} is the job's PM as a contact. Client approvals and notices email ${s.pm_email}.`,
      ],
      guidance: [],
    };
  const near = pmNearMatches(typed ?? s.pm, team);
  const lines = [NO_PM_EMAIL_NOTE];
  if (near.length === 1)
    return {
      lines,
      guidance: [
        `"${typed ?? s.pm}" isn't a teammate's Athena name, but your teammate ${near[0]!.name} is. Ask: "Did you mean ${near[0]!.name}?" On yes, call intake section job_settings with pm "${near[0]!.name}".`,
      ],
    };
  const ask = s.pm
    ? `${s.pm} is saved as a contact with no email. Ask whether they're one of these teammates (${nameList(team)}) or for their email, then call intake section job_settings with pm set to the teammate's name, or with pm_email.`
    : `Ask who the PM is${team.length ? `, offering these teammates: ${nameList(team)}` : ""}, then call intake section job_settings with pm (a teammate's name, or a name and pm_email).`;
  return { lines, guidance: [ask] };
}

/** The company's teammates, for the PM question. Empty when the list can't be read. */
export async function readTeammates(sb: Sb, companyId: string): Promise<Teammate[]> {
  const { data, error } = await sb
    .from("mcp_company_members")
    .select("display_name, role")
    .eq("company_id", companyId);
  if (error || !Array.isArray(data)) return [];
  return (data as { display_name?: string | null; role?: string | null }[])
    .filter((m) => m.display_name?.trim())
    .map((m) => ({ name: m.display_name!.trim(), role: m.role ?? "" }));
}
