import { supabase } from "@/integrations/supabase/client";

export type ControlProgressPatch = {
  orientation_opened_at?: string;
  assessment_started_at?: string;
  baseline_saved_at?: string;
  latest_baseline_id?: string | null;
  latest_score?: number | null;
  primary_category?: string | null;
  primary_constraint?: string | null;
  plan_started_at?: string;
  plan_updated_at?: string;
  plan_completed_at?: string | null;
};

export async function markControlProgress(patch: ControlProgressPatch) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from("member_control_progress").upsert(
    {
      user_id: user.id,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("[control-progress] update failed", error);
    return false;
  }
  return true;
}

export async function markControlPlanStarted() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("member_control_progress")
    .select("plan_started_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (data?.plan_started_at) return true;
  return markControlProgress({ plan_started_at: new Date().toISOString() });
}
