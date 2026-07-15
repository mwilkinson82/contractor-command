import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  buildControlJourney,
  type ControlJourney,
  type MemberControlProgress,
} from "@/lib/control-journey";
import { vault, type CommandPacket } from "@/lib/vault";

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

      let progress = data as MemberControlProgress | null;
      let packet = progress?.latest_baseline_id
        ? await vault.getById(progress.latest_baseline_id, { fresh: true })
        : undefined;
      let legacyBaselineAt: string | null = null;

      if (!progress?.latest_baseline_id) {
        const { data: historicalRow, error: historicalError } = await supabase
          .from("vault_packets")
          .select("id")
          .eq("user_id", user.id)
          .eq("kind", "command")
          .eq("source", "COS Navigator")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (historicalError) throw historicalError;

        const historicalPacket = historicalRow
          ? await vault.getById(historicalRow.id, { fresh: true })
          : undefined;
        if (historicalPacket?.kind === "command") {
          if (historicalPacket.controlPlan) {
            progress = recoverTrackedProgress(progress, historicalPacket);
            packet = historicalPacket;
          } else {
            legacyBaselineAt = historicalPacket.createdAt;
          }
        }
      }

      const plan = packet?.kind === "command" ? packet.controlPlan : undefined;

      return buildControlJourney(progress, plan, new Date(), legacyBaselineAt);
    },
  });
}

function recoverTrackedProgress(
  progress: MemberControlProgress | null,
  packet: CommandPacket,
): MemberControlProgress {
  const score = Number(packet.inputs.totalScore);
  return {
    orientation_opened_at: progress?.orientation_opened_at ?? null,
    assessment_started_at: progress?.assessment_started_at ?? packet.createdAt,
    baseline_saved_at: packet.createdAt,
    latest_baseline_id: packet.id,
    latest_score: Number.isFinite(score) ? score : null,
    primary_category:
      progress?.primary_category ?? String(packet.inputs.primaryCategory ?? "Operating control"),
    primary_constraint: progress?.primary_constraint ?? packet.primaryConstraint,
    plan_started_at: progress?.plan_started_at ?? null,
    plan_updated_at: progress?.plan_updated_at ?? null,
    plan_completed_at: progress?.plan_completed_at ?? null,
  };
}
