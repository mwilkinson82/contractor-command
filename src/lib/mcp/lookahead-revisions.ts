// Lookahead revisions: running lookahead setup again for the same job and window adds Rev 1, Rev 2, ... to the SAME
// lookahead (same ref, history kept). Nothing is deleted or duplicated. mcp_lookaheads holds the current revision;
// mcp_lookahead_revisions holds every revision (append-only), each with its own inputs and source.
import type { Sb } from "./guard";

/** Where a revision's window came from: a connected schedule tool, or the PM. */
export type LookaheadSource = "schedule" | "pm";
/** Same values as the planned per-job job_settings.schedule_tool (schedule-location spec). */
export type ScheduleTool = "overwatch" | "buildertrend" | "procore" | "other" | "unknown";

export type Revision = {
  id: string; rev: number; parent_revision_id: string | null; source: LookaheadSource; schedule_tool: ScheduleTool | null;
  start_date: string | null; end_date: string | null; inputs: Record<string, unknown>; created_at: string;
};

type PgErr = { code?: string; message?: string } | null | undefined;
/** True while the revisions migration isn't applied yet: the code keeps working as before. */
export const isMissingSchema = (e: PgErr) => !!e && (["42P01", "42703", "PGRST204", "PGRST205"].includes(e.code ?? "") || /does not exist|schema cache/i.test(e.message ?? ""));

/**
 * HOOK: the source of a lookahead window.
 * Athena has no connected schedule source today (no mcp_jobs link to Overwatch schedules, Buildertrend or Procore),
 * so every revision is "pm" and the PM gives the window, as before.
 * When the schedule-location PR adds job_settings.schedule_tool, read it here: a connected tool that can produce
 * the window returns { source: "schedule", schedule_tool }, and intake builds the window from it. Anything else stays "pm".
 */
export async function lookaheadSourceFor(_sb: Sb, _jobId: string): Promise<{ source: LookaheadSource; schedule_tool: ScheduleTool | null }> {
  return { source: "pm", schedule_tool: null };
}

export async function loadRevisions(sb: Sb, lookaheadId: string): Promise<Revision[]> {
  const { data, error } = await sb.from("mcp_lookahead_revisions").select("id, rev, parent_revision_id, source, schedule_tool, start_date, end_date, inputs, created_at").eq("lookahead_id", lookaheadId).order("rev", { ascending: true });
  if (error) { if (isMissingSchema(error)) return []; throw new Error(error.message); }
  return (data ?? []) as Revision[];
}

export async function currentRev(sb: Sb, lookaheadId: string): Promise<number | null> {
  const { data, error } = await sb.from("mcp_lookaheads").select("current_rev").eq("id", lookaheadId).maybeSingle();
  if (error) { if (isMissingSchema(error)) return null; throw new Error(error.message); }
  return (data as { current_rev?: number } | null)?.current_rev ?? null;
}

/** Append the next revision (Rev 0 for a new lookahead) and make it current. Returns the rev, or null before the migration. */
export async function addRevision(
  sb: Sb,
  lookaheadId: string,
  f: { source: LookaheadSource; schedule_tool: ScheduleTool | null; start_date: string | null; end_date: string | null; inputs: Record<string, unknown>; effective_inputs: Record<string, unknown>; provided_inputs: string[]; missing_inputs: string[] },
): Promise<number | null> {
  const revs = await loadRevisions(sb, lookaheadId);
  const last = revs[revs.length - 1];
  const rev = last ? last.rev + 1 : 0;
  const { error } = await sb.from("mcp_lookahead_revisions").insert({
    lookahead_id: lookaheadId, rev, parent_revision_id: last?.id ?? null, source: f.source, schedule_tool: f.source === "schedule" ? f.schedule_tool : null,
    start_date: f.start_date, end_date: f.end_date, inputs: f.inputs, effective_inputs: f.effective_inputs, provided_inputs: f.provided_inputs, missing_inputs: f.missing_inputs,
  });
  if (error) { if (isMissingSchema(error)) return null; throw new Error(error.message); }
  const up = await sb.from("mcp_lookaheads").update({ current_rev: rev }).eq("id", lookaheadId);
  if (up.error && !isMissingSchema(up.error)) throw new Error(up.error.message);
  return rev;
}

/** Record on an item which revision of its lookahead added it. No-op before the migration. */
export async function stampItemRev(sb: Sb, itemId: string, lookaheadId: string) {
  const rev = await currentRev(sb, lookaheadId);
  if (rev === null) return;
  const up = await sb.from("mcp_open_items").update({ lookahead_rev: rev }).eq("id", itemId);
  if (up.error && !isMissingSchema(up.error)) throw new Error(up.error.message);
}

const sourceWord = (r: Pick<Revision, "source" | "schedule_tool">) => (r.source === "schedule" ? `schedule${r.schedule_tool ? ` (${r.schedule_tool})` : ""}` : "PM");
const inputKeys = (i: Record<string, unknown>) => Object.keys(i ?? {}).filter((k) => k !== "kind" && k !== "merged_into").join(", ") || "none";

/** Report lines: the current revision and every prior one (rev, source, date, window, inputs sent). Empty before the migration. */
export function revisionLines(revs: Revision[]): string[] {
  if (!revs.length) return [];
  const cur = revs[revs.length - 1];
  return [
    "REVISIONS",
    `   Current: Rev ${cur.rev} (source: ${sourceWord(cur)}, ${cur.created_at.slice(0, 10)})`,
    ...[...revs].reverse().map((r) => `   - Rev ${r.rev}${r === cur ? " (current)" : ""}: source ${sourceWord(r)} | ${r.created_at.slice(0, 10)} | window ${r.start_date ?? "?"} to ${r.end_date ?? "?"} | inputs sent: ${inputKeys(r.inputs)}`),
  ];
}
