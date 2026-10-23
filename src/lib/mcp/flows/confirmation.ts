import { isAffirmativeConfirmation, meetingItem } from "../open-feed";

export type ReadinessAnswer = { crews_confirmed?: boolean; lookahead_locked?: boolean };
export type ReadinessRecord = ReadinessAnswer & { version: 1; context_key: string };

/** Only named checks are answers. A crew answer never locks a lookahead. */
export function readinessAnswer(note: string): ReadinessAnswer | null {
  const answer: ReadinessAnswer = {};
  if (meetingItem(note)?.key === "pm:crews") answer.crews_confirmed = isAffirmativeConfirmation(note);
  if (/\blookahead\b/i.test(note) && /\b(?:lock(?:ed)?|unlocked)\b/i.test(note)) {
    const request = /\?|\b(?:if|unless|once|please|confirm|lock|should|must|will|need|needs|waiting|awaiting)\b/i.test(note);
    if (!request) answer.lookahead_locked = /\blocked\b/i.test(note) && !/\b(?:not|never|unlocked|pending|awaiting)\b|n['’]t\b/i.test(note);
  }
  return Object.keys(answer).length ? answer : null;
}

type Result = { data: unknown; error: { message?: string } | null };
type Selection = PromiseLike<Result> & {
  eq: (column: string, value: unknown) => Selection;
  not: (column: string, operator: string, value: unknown) => Selection;
  order: (column: string, options: { ascending: boolean }) => Selection;
  limit: (count: number) => Selection;
};
export type ReadinessReader = { from: (table: string) => { select: (columns: string) => Selection } };

/** Existing full-scope RLS applies. Read each check independently so a later
 * accounting note or concurrent answer cannot erase the other confirmation. */
export async function readReadiness(sb: ReadinessReader, jobId: string, context: string): Promise<ReadinessAnswer> {
  const answer: ReadinessAnswer = {};
  await Promise.all((["crews_confirmed", "lookahead_locked"] as const).map(async (field) => {
    try {
      const { data, error } = await sb.from("mcp_guided_sessions").select("snapshot")
        .eq("job_id", jobId).eq("snapshot->readiness->>version", "1")
        .eq("snapshot->readiness->>context_key", context)
        .not(`snapshot->readiness->>${field}`, "is", null)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
      if (error || !Array.isArray(data)) return;
      const record = data[0]?.snapshot?.readiness;
      if (record?.version === 1 && record.context_key === context && typeof record[field] === "boolean") answer[field] = record[field];
    } catch { /* Missing/unreadable records remain unknown, never affirmative. */ }
  }));
  return answer;
}
