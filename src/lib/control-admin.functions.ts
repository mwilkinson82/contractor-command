import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  controlPlanProgress,
  controlPlanState,
  isControlPlanReviewDue,
  isWeeklyControlReviewCurrent,
  latestWeeklyControlReview,
  type ConstraintTrend,
  type ControlPlan,
} from "@/lib/control-plan";
import {
  isBaselineOutreachAttentionStatus,
  latestBaselineOutreachByEmail,
  type BaselineOutreachStatus,
  type CampaignSendLog,
} from "@/lib/control-admin-campaigns";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(roles ?? []).some((row) => row.role === "admin")) throw new Error("Forbidden");
}

export type MemberControlRow = {
  userId: string;
  email: string;
  fullName: string | null;
  tier: string;
  orientationOpenedAt: string | null;
  assessmentStartedAt: string | null;
  baselineSavedAt: string | null;
  latestBaselineId: string | null;
  baselineState: "missing" | "needs_refresh" | "current";
  score: number | null;
  primaryCategory: string | null;
  primaryConstraint: string | null;
  planStartedAt: string | null;
  planUpdatedAt: string | null;
  planCompletedAt: string | null;
  planPercent: number;
  planState: "not_started" | "in_progress" | "blocked" | "complete";
  planActionsCompleted: number;
  planActionsTotal: number;
  reviewDate: string | null;
  reassessmentDue: boolean;
  weeklyReviewedAt: string | null;
  weeklyCurrent: boolean;
  constraintTrend: ConstraintTrend | null;
  weeklyBlocked: boolean;
  weeklyBlocker: string | null;
  weeklyNextAction: string | null;
  weeklyNextOwner: string | null;
  weeklyNeedsPressure: boolean;
  weeklyPressureNote: string | null;
  baselineOutreachStatus: BaselineOutreachStatus | null;
  baselineOutreachAt: string | null;
};

const tierRank: Record<string, number> = {
  aos_only: 0,
  book_buyer: 1,
  intensive: 2,
  power_hour: 3,
  sm_school: 3,
  contractor_school: 3,
  circle: 4,
  hardcore: 5,
};

function isLiveSubscription(row: { status: string; is_comped: boolean }) {
  return (
    row.is_comped || row.status === "active" || row.status === "trialing" || row.status === "comped"
  );
}

export async function loadMemberControlRowsForAdmin(userId: string): Promise<MemberControlRow[]> {
  await assertAdmin(userId);
  const [
    profilesResult,
    subscriptionsResult,
    progressResult,
    packetsResult,
    baselineCampaignsResult,
  ] = await Promise.all([
    supabaseAdmin.from("profiles").select("id,email,full_name"),
    supabaseAdmin.from("subscriptions").select("user_id,email,tier,status,is_comped"),
    supabaseAdmin.from("member_control_progress").select("*"),
    supabaseAdmin
      .from("vault_packets")
      .select("id,user_id,created_at,payload")
      .eq("source", "COS Navigator")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("member_announcements")
      .select("announcement_id,created_at")
      .eq("audience", "control_baseline")
      .eq("was_test", false)
      .not("announcement_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const failedQuery = [
    profilesResult.error,
    subscriptionsResult.error,
    progressResult.error,
    packetsResult.error,
    baselineCampaignsResult.error,
  ].find(Boolean);
  if (failedQuery) throw failedQuery;

  const profiles = profilesResult.data;
  const subscriptions = subscriptionsResult.data;
  const progressRows = progressResult.data;
  const packets = packetsResult.data;
  const baselineCampaigns = baselineCampaignsResult.data ?? [];

  const baselineAnnouncementIds = new Set(
    baselineCampaigns
      .map((campaign) => campaign.announcement_id)
      .filter((announcementId): announcementId is string => Boolean(announcementId)),
  );
  const campaignLogs: CampaignSendLog[] = [];
  const oldestCampaignAt = baselineCampaigns.at(-1)?.created_at;
  if (baselineAnnouncementIds.size && oldestCampaignAt) {
    const pageSize = 1_000;
    const maxPages = 10;
    for (let page = 0; page < maxPages; page += 1) {
      const from = page * pageSize;
      const { data, error } = await supabaseAdmin
        .from("email_send_log")
        .select("message_id,recipient_email,status,created_at,metadata")
        .eq("template_name", "member-announcement")
        .gte("created_at", oldestCampaignAt)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      campaignLogs.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
  }
  const baselineOutreachByEmail = latestBaselineOutreachByEmail(
    campaignLogs,
    baselineAnnouncementIds,
  );

  const bestTierByUser = new Map<string, string>();
  const bestTierByEmail = new Map<string, string>();
  for (const sub of subscriptions ?? []) {
    if (!isLiveSubscription(sub)) continue;
    const tier = sub.tier ?? "book_buyer";
    if (sub.user_id) {
      const current = bestTierByUser.get(sub.user_id);
      if (!current || (tierRank[tier] ?? -1) > (tierRank[current] ?? -1)) {
        bestTierByUser.set(sub.user_id, tier);
      }
    }
    const emailKey = sub.email.toLowerCase();
    const current = bestTierByEmail.get(emailKey);
    if (!current || (tierRank[tier] ?? -1) > (tierRank[current] ?? -1)) {
      bestTierByEmail.set(emailKey, tier);
    }
  }

  const progressByUser = new Map((progressRows ?? []).map((row) => [row.user_id, row]));
  const latestPacketByUser = new Map<string, NonNullable<typeof packets>[number]>();
  for (const packet of packets ?? []) {
    if (!latestPacketByUser.has(packet.user_id)) latestPacketByUser.set(packet.user_id, packet);
  }
  const now = new Date();

  return (profiles ?? [])
    .map((profile) => {
      const tier =
        bestTierByUser.get(profile.id) ?? bestTierByEmail.get(profile.email.toLowerCase()) ?? "";
      if ((tierRank[tier] ?? -1) < tierRank.book_buyer) return null;
      const progress = progressByUser.get(profile.id);
      const packet = latestPacketByUser.get(profile.id);
      const payload = (packet?.payload ?? {}) as Record<string, unknown>;
      const inputs = (payload.inputs ?? {}) as Record<string, unknown>;
      const plan = payload.controlPlan as ControlPlan | undefined;
      const baselineState: MemberControlRow["baselineState"] = plan
        ? "current"
        : packet || progress?.baseline_saved_at
          ? "needs_refresh"
          : "missing";
      const planProgress = controlPlanProgress(plan);
      const weeklyReview = latestWeeklyControlReview(plan);
      const planStartedAt = progress?.plan_started_at ?? null;
      const baselineOutreach = baselineOutreachByEmail.get(profile.email.toLowerCase());
      return {
        userId: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        tier,
        orientationOpenedAt: progress?.orientation_opened_at ?? null,
        assessmentStartedAt: progress?.assessment_started_at ?? null,
        baselineSavedAt: progress?.baseline_saved_at ?? packet?.created_at ?? null,
        latestBaselineId: progress?.latest_baseline_id ?? packet?.id ?? null,
        baselineState,
        score:
          progress?.latest_score ??
          (typeof inputs.totalScore === "number" ? inputs.totalScore : null),
        primaryCategory:
          progress?.primary_category ??
          (typeof inputs.primaryCategory === "string" ? inputs.primaryCategory : null),
        primaryConstraint:
          progress?.primary_constraint ??
          (typeof payload.primaryConstraint === "string" ? payload.primaryConstraint : null),
        planStartedAt,
        planUpdatedAt: progress?.plan_updated_at ?? null,
        planCompletedAt: progress?.plan_completed_at ?? null,
        planPercent: planProgress.percent,
        planState: controlPlanState(plan),
        planActionsCompleted: planProgress.completed,
        planActionsTotal: planProgress.total,
        reviewDate: plan?.reviewDate ?? null,
        reassessmentDue: Boolean(planStartedAt && isControlPlanReviewDue(plan?.reviewDate, now)),
        weeklyReviewedAt: weeklyReview?.reviewedAt ?? null,
        weeklyCurrent: Boolean(planStartedAt && isWeeklyControlReviewCurrent(weeklyReview, now)),
        constraintTrend: weeklyReview?.constraintTrend ?? null,
        weeklyBlocked: weeklyReview?.blocked ?? false,
        weeklyBlocker: weeklyReview?.blocker || null,
        weeklyNextAction: weeklyReview?.nextAction || null,
        weeklyNextOwner: weeklyReview?.nextOwner || null,
        weeklyNeedsPressure: weeklyReview?.needsPressure ?? false,
        weeklyPressureNote: weeklyReview?.pressureNote || null,
        baselineOutreachStatus: baselineOutreach?.status ?? null,
        baselineOutreachAt: baselineOutreach?.createdAt ?? null,
      } satisfies MemberControlRow;
    })
    .filter((row): row is MemberControlRow => row !== null)
    .sort((left, right) => {
      const leftAttention =
        Number(isBaselineOutreachAttentionStatus(left.baselineOutreachStatus)) * 9 +
        Number(left.weeklyNeedsPressure) * 8 +
        Number(left.weeklyBlocked) * 7 +
        Number(left.reassessmentDue) * 6 +
        Number(Boolean(left.planStartedAt) && !left.weeklyCurrent) * 5 +
        Number(left.baselineState !== "current") * 4 +
        Number(left.baselineState === "current" && !left.planStartedAt) * 3;
      const rightAttention =
        Number(isBaselineOutreachAttentionStatus(right.baselineOutreachStatus)) * 9 +
        Number(right.weeklyNeedsPressure) * 8 +
        Number(right.weeklyBlocked) * 7 +
        Number(right.reassessmentDue) * 6 +
        Number(Boolean(right.planStartedAt) && !right.weeklyCurrent) * 5 +
        Number(right.baselineState !== "current") * 4 +
        Number(right.baselineState === "current" && !right.planStartedAt) * 3;
      if (leftAttention !== rightAttention) return rightAttention - leftAttention;
      const leftAt = left.planUpdatedAt ?? left.baselineSavedAt ?? left.assessmentStartedAt ?? "";
      const rightAt =
        right.planUpdatedAt ?? right.baselineSavedAt ?? right.assessmentStartedAt ?? "";
      return rightAt.localeCompare(leftAt);
    });
}

export const listMemberControl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MemberControlRow[]> =>
    loadMemberControlRowsForAdmin(context.userId),
  );
