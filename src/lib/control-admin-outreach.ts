import type { MemberControlRow } from "@/lib/control-admin.functions";
import { isBaselineOutreachAttentionStatus } from "@/lib/control-admin-campaigns";

const CSV_COLUMNS = [
  "Name",
  "Email",
  "Tier",
  "Activation state",
  "Control score",
  "Primary constraint",
  "90-day plan",
  "Plan progress",
  "Weekly control",
  "Next action",
  "Next owner",
  "Baseline outreach",
  "Last outreach",
  "Suggested nudge",
] as const;

export type BaselineOutreachState =
  | "not_needed"
  | "not_contacted"
  | "queued"
  | "sent"
  | "activated"
  | "suppressed"
  | "failed"
  | "bounced"
  | "complained"
  | "dlq";

export function memberCountLabel(count: number) {
  return `${count} ${count === 1 ? "member" : "members"}`;
}

export function controlActivationState(row: MemberControlRow) {
  if (row.weeklyNeedsPressure) return "Needs pressure";
  if (row.weeklyBlocked || row.planState === "blocked") return "Blocked";
  if (row.reassessmentDue) return "Reassessment due";
  if (row.planStartedAt && !row.weeklyCurrent) return "Weekly review due";
  if (row.baselineState === "missing") return "Needs baseline";
  if (row.baselineState === "needs_refresh") return "Refresh baseline";
  if (!row.planStartedAt) return "Plan not started";
  return "Current";
}

export function baselineOutreachState(row: MemberControlRow): BaselineOutreachState {
  if (
    row.baselineState === "current" &&
    row.baselineSavedAt &&
    row.baselineOutreachAt &&
    row.baselineSavedAt >= row.baselineOutreachAt
  ) {
    return "activated";
  }
  if (!row.baselineOutreachStatus) {
    return row.baselineState === "current" ? "not_needed" : "not_contacted";
  }
  if (row.baselineOutreachStatus === "pending") return "queued";
  return row.baselineOutreachStatus;
}

export function baselineOutreachLabel(row: MemberControlRow) {
  const labels: Record<BaselineOutreachState, string> = {
    not_needed: "No outreach needed",
    not_contacted: "Not contacted",
    queued: "Queued",
    sent: "Sent",
    activated: "Activated",
    suppressed: "Suppressed",
    failed: "Failed",
    bounced: "Bounced",
    complained: "Complaint",
    dlq: "Dead letter",
  };
  return labels[baselineOutreachState(row)];
}

export function baselineOutreachNeedsAttention(row: MemberControlRow) {
  return isBaselineOutreachAttentionStatus(row.baselineOutreachStatus);
}

export function buildControlNudge(row: MemberControlRow) {
  const name = firstName(row);
  const next = row.weeklyNextAction
    ? ` Your next owned action is “${row.weeklyNextAction}”${row.weeklyNextOwner ? ` with ${row.weeklyNextOwner}` : ""}.`
    : "";
  if (row.weeklyNeedsPressure) {
    return `Hey ${name} — I saw your Weekly Control Review. You flagged: “${row.weeklyPressureNote || row.weeklyBlocker || row.primaryConstraint}.” Bring that into Discord or the next call and we’ll pressure-test it together.${next}`;
  }
  if (row.weeklyBlocked || row.planState === "blocked") {
    return `Hey ${name} — your control plan is showing a blocker: “${row.weeklyBlocker || row.primaryConstraint}.” Let’s get it into Discord or the next call before it costs another week.${next}`;
  }
  if (row.reassessmentDue) {
    return `Hey ${name} — your 90-day State of Control reassessment is due. Rerun it in the Hub so we can compare the new baseline, confirm what moved, and identify the next constraint.`;
  }
  if (row.planStartedAt && !row.weeklyCurrent) {
    return `Hey ${name} — your Weekly Control Review is due in the Hub. Take five minutes to record what moved, what is blocked, the next owned action, and any pressure you need from the group.`;
  }
  if (row.baselineState === "missing") {
    return `Hey ${name} — your State of Control baseline is still open. Run the assessment in Start Here so the Hub can build your personalized 90-day control plan.`;
  }
  if (row.baselineState === "needs_refresh") {
    return `Hey ${name} — your earlier State of Control baseline predates the live 90-day plan. Rerun the assessment in Start Here so the Hub can build your current implementation route.`;
  }
  if (!row.planStartedAt) {
    return `Hey ${name} — your 90-day control plan is ready in the Hub but has not been started. Open it, confirm the first owned action, and establish this week's control rhythm.`;
  }
  return `Hey ${name} — your Control Journey is current. Keep pressure on ${row.primaryConstraint || "the active constraint"} and update the next owned action in this week’s review.${next}`;
}

export function buildControlRoomCsv(rows: MemberControlRow[]) {
  const records = rows.map((row) => [
    row.fullName || row.email,
    row.email,
    row.tier.replaceAll("_", " "),
    controlActivationState(row),
    row.score ?? "",
    row.primaryConstraint ?? "",
    row.planState.replaceAll("_", " "),
    `${row.planPercent}%`,
    row.weeklyCurrent ? "Current" : row.planStartedAt ? "Due" : "Not started",
    row.weeklyNextAction ?? "",
    row.weeklyNextOwner ?? "",
    baselineOutreachLabel(row),
    row.baselineOutreachAt ?? "",
    buildControlNudge(row),
  ]);

  const csv = [CSV_COLUMNS, ...records]
    .map((record) => record.map((value) => csvCell(String(value))).join(","))
    .join("\n");
  return `\uFEFF${csv}`;
}

export function controlRoomExportFilename(segment: string, date = new Date()) {
  const slug = segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `control-room-${slug || "members"}-${day}.csv`;
}

function firstName(row: MemberControlRow) {
  return row.fullName?.trim().split(/\s+/)[0] || "there";
}

function csvCell(value: string) {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replaceAll('"', '""')}"` : safeValue;
}
