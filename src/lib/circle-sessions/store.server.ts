import { membershipDb, circleDecision } from "@/lib/membership/circle.server";
import { assertAnnounceable, type SessionRow } from "./model";

export async function assertSessionAdmin(db: unknown, userId: string) {
  const { data, error } = await membershipDb(db)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error || !data?.some((r) => r.role === "admin")) throw new Error("Forbidden");
}
export async function loadSession(db: unknown, id: string): Promise<SessionRow> {
  const { data, error } = await membershipDb(db)
    .from("circle_sessions")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Session unavailable. Refresh the schedule.");
  return data as SessionRow;
}
export async function assertSessionMember(db: unknown, userId: string) {
  // Current persisted identity, never a caller-supplied email or editable user_metadata.
  const { data, error } = await membershipDb(db)
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  if (error || !data?.email) throw new Error("Membership identity unavailable");
  const decision = await circleDecision(db, { userId, email: data.email });
  if (decision.state !== "eligible" || !decision.hasAccess)
    throw new Error("Current Circle membership required");
}
export async function revealMeeting(db: unknown, userId: string, id: string, now = Date.now()) {
  await assertSessionMember(db, userId);
  const row = await loadSession(db, id);
  if (row.status !== "scheduled" || Date.parse(row.starts_at) + row.duration_min * 60_000 <= now)
    throw new Error("This session is canceled or has ended");
  return { url: row.meeting_url };
}
export async function assertQueuedSessionCurrent(db: unknown, payload: Record<string, unknown>) {
  if (!payload.circle_session) return;
  const { sessionSelectionSchema } = await import("./model");
  const selection = sessionSelectionSchema.parse(payload.circle_session);
  assertAnnounceable(await loadSession(db, selection.id), selection.version);
}
