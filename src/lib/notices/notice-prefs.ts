import { NOTICE_TOPICS, type NoticeTopic } from "./send";
import { rpcMessage, type NoticeRpc } from "./board-notices";

/** Who gets each kind of notice email on a job (mcp_job_notice_prefs_get / mcp_job_notice_prefs_set). */
export const NOTICE_ROLES = [
  "job_pm",
  "owner",
  "all_access",
  "pm",
  "super",
  "ap",
  "estimating",
  "contracts",
] as const;
export type NoticeRole = (typeof NOTICE_ROLES)[number];

export const ROLE_LABEL: Record<NoticeRole, string> = {
  job_pm: "Job PM",
  owner: "Owner",
  all_access: "All access",
  pm: "PM",
  super: "Super",
  ap: "AP",
  estimating: "Estimating",
  contracts: "Contracts",
};

/** Supers take field notices only: never money or the client conversation. */
export const FIELD_TOPICS: readonly NoticeTopic[] = ["submittal_reply", "field_confirm", "sub_contract"];

export type PrefCell = {
  role: NoticeRole;
  topic: NoticeTopic;
  email: boolean;
  /** False when this role can never take this topic (a super and money). */
  allowed: boolean;
  /** The job's PM always gets every email; the owner asked for that row to stay on. */
  locked: boolean;
};
export type PrefGrid = { canChange: boolean; rows: { role: NoticeRole; cells: PrefCell[] }[] };

export function prefGrid(data: unknown): PrefGrid | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { can_change?: unknown; prefs?: unknown };
  if (!Array.isArray(d.prefs)) return null;
  const found = new Map<string, boolean>();
  for (const p of d.prefs as Record<string, unknown>[])
    if (p && typeof p.role === "string" && typeof p.topic === "string")
      found.set(`${p.role}:${p.topic}`, p.email === true);
  return {
    canChange: d.can_change === true,
    rows: NOTICE_ROLES.map((role) => ({
      role,
      cells: NOTICE_TOPICS.map((topic) => {
        const allowed = role !== "super" || FIELD_TOPICS.includes(topic);
        const locked = role === "job_pm";
        return {
          role,
          topic,
          allowed,
          locked,
          email: locked ? true : allowed && (found.get(`${role}:${topic}`) ?? false),
        };
      }),
    })),
  };
}

export async function readNoticePrefs(rpc: NoticeRpc, jobId: string): Promise<PrefGrid> {
  const { data, error } = await rpc("mcp_job_notice_prefs_get", { _job: jobId });
  const grid = error ? null : prefGrid(data);
  if (!grid) throw new Error(rpcMessage(error, "Email choices are unavailable right now."));
  return grid;
}

export async function saveNoticePref(
  rpc: NoticeRpc,
  input: { jobId: string; role: NoticeRole; topic: NoticeTopic; email: boolean },
): Promise<PrefGrid> {
  if (input.role === "job_pm") throw new Error("The job's PM always gets these emails.");
  if (input.role === "super" && !FIELD_TOPICS.includes(input.topic))
    throw new Error("Supers get field notices only.");
  const { data, error } = await rpc("mcp_job_notice_prefs_set", {
    _job: input.jobId,
    _role: input.role,
    _topic: input.topic,
    _email: input.email,
  });
  const grid = error ? null : prefGrid(data);
  if (!grid) throw new Error(rpcMessage(error, "That choice was not saved. Try again."));
  return grid;
}
