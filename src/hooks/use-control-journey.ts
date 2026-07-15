import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  buildControlJourney,
  type ControlJourney,
  type MemberControlProgress,
} from "@/lib/control-journey";
import { vault } from "@/lib/vault";

const CONTROL_PROGRESS_FIELDS = [
  "orientation_opened_at",
  "assessment_started_at",
  "baseline_saved_at",
  "latest_baseline_id",
  "latest_score",
  "primary_category",
  "primary_constraint",
  "plan_started_at",
  "plan_updated_at",
  "plan_completed_at",
].join(",");

export function useControlJourney(enabled = true) {
  const { user, loading: authLoading } = useAuth();

  return useQuery<ControlJourney>({
    queryKey: ["member-control-journey", user?.id],
    enabled: enabled && !authLoading && !!user,
    staleTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!user) return buildControlJourney(null, undefined);

      const { data, error } = await supabase
        .from("member_control_progress")
        .select(CONTROL_PROGRESS_FIELDS)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;

      const progress = data as MemberControlProgress | null;
      const packet = progress?.latest_baseline_id
        ? await vault.getById(progress.latest_baseline_id, { fresh: true })
        : undefined;
      const plan = packet?.kind === "command" ? packet.controlPlan : undefined;

      return buildControlJourney(progress, plan);
    },
  });
}
