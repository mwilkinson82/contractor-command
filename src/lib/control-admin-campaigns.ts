export const BASELINE_OUTREACH_STATUSES = [
  "pending",
  "sent",
  "suppressed",
  "failed",
  "bounced",
  "complained",
  "dlq",
] as const;

export type BaselineOutreachStatus = (typeof BASELINE_OUTREACH_STATUSES)[number];

export type CampaignSendLog = {
  message_id: string | null;
  recipient_email: string;
  status: string;
  created_at: string;
  metadata: unknown;
};

export type BaselineOutreachRecord = {
  status: BaselineOutreachStatus;
  createdAt: string;
};

const attentionStatuses = new Set<BaselineOutreachStatus>([
  "suppressed",
  "failed",
  "bounced",
  "complained",
  "dlq",
]);

const terminalStatusPriority: Record<BaselineOutreachStatus, number> = {
  pending: 0,
  sent: 1,
  suppressed: 2,
  failed: 3,
  bounced: 4,
  complained: 5,
  dlq: 6,
};

export function latestBaselineOutreachByEmail(
  logs: CampaignSendLog[],
  baselineAnnouncementIds: ReadonlySet<string>,
) {
  const campaignMessageIds = new Set<string>();
  for (const log of logs) {
    const announcementId = announcementIdFromMetadata(log.metadata);
    if (log.message_id && announcementId && baselineAnnouncementIds.has(announcementId)) {
      campaignMessageIds.add(log.message_id);
    }
  }

  const latestByEmail = new Map<string, BaselineOutreachRecord>();
  for (const log of logs) {
    if (!log.message_id || !campaignMessageIds.has(log.message_id)) continue;
    if (!isBaselineOutreachStatus(log.status)) continue;

    const email = log.recipient_email.trim().toLowerCase();
    if (!email) continue;
    const current = latestByEmail.get(email);
    if (
      !current ||
      log.created_at > current.createdAt ||
      (log.created_at === current.createdAt &&
        terminalStatusPriority[log.status] > terminalStatusPriority[current.status])
    ) {
      latestByEmail.set(email, { status: log.status, createdAt: log.created_at });
    }
  }

  return latestByEmail;
}

export function isBaselineOutreachAttentionStatus(status: BaselineOutreachStatus | null) {
  return status ? attentionStatuses.has(status) : false;
}

function announcementIdFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const announcementId = (metadata as Record<string, unknown>).announcement_id;
  return typeof announcementId === "string" ? announcementId : null;
}

function isBaselineOutreachStatus(status: string): status is BaselineOutreachStatus {
  return BASELINE_OUTREACH_STATUSES.some((candidate) => candidate === status);
}
