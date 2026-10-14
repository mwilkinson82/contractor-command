import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { membershipDb } from "@/lib/membership/circle.server";
import { sessionInputSchema, localToInstant, summary, type SessionRow } from "./model";
import { assertSessionAdmin, assertSessionMember, revealMeeting } from "./store.server";

export const listCircleSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSessionMember(supabaseAdmin, context.userId);
    const { data, error } = await membershipDb(supabaseAdmin)
      .from("circle_sessions")
      .select("*")
      .eq("status", "scheduled")
      .order("starts_at");
    if (error) throw new Error("Could not load the call schedule");
    return (data as SessionRow[])
      .filter((s) => Date.parse(s.starts_at) + s.duration_min * 60_000 > Date.now())
      .map(summary);
  });
export const adminCircleSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSessionAdmin(supabaseAdmin, context.userId);
    const { data, error } = await membershipDb(supabaseAdmin)
      .from("circle_sessions")
      .select("*")
      .order("starts_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Could not load sessions. Check the sessions migration.");
    return data as SessionRow[];
  });
export const saveCircleSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => sessionInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await assertSessionAdmin(supabaseAdmin, context.userId);
    const starts_at = localToInstant(data.localStart, data.timeZone);
    if (Date.parse(starts_at) <= Date.now()) throw new Error("Enter a future session");
    const values = {
      title: data.title,
      starts_at,
      time_zone: data.timeZone,
      duration_min: data.durationMin,
      meeting_url: data.meetingUrl,
      description: data.description,
      kind: data.kind,
    };
    const table = membershipDb(supabaseAdmin).from("circle_sessions");
    if (data.id && !data.expectedVersion) throw new Error("Refresh the session before editing");
    const query = data.id
      ? table
          .update(values)
          .eq("id", data.id)
          .eq("version", data.expectedVersion!)
          .is("calendar_event_id", null)
          .eq("status", "scheduled")
      : table.insert(values);
    const { data: saved, error } = await query.select("*").single();
    if (error)
      throw new Error(
        "Could not save. Refresh changed sessions; Calendar-managed sessions must be edited in Calendar. Each call needs a unique Meet URL.",
      );
    return saved as SessionRow;
  });
export const cancelCircleSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ id: z.string().uuid(), version: z.number().int().positive() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertSessionAdmin(supabaseAdmin, context.userId);
    const { error, data: row } = await membershipDb(supabaseAdmin)
      .from("circle_sessions")
      .update({ status: "canceled", rollover_enabled: false })
      .eq("id", data.id)
      .eq("version", data.version)
      .select("id")
      .single();
    if (error || !row) throw new Error("Session changed. Refresh before canceling.");
    return { ok: true };
  });
export const getCircleMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(({ context, data }) => revealMeeting(supabaseAdmin, context.userId, data.id));
