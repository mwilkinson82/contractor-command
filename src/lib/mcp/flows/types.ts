export type FlowName = "pm_meeting" | "pm_morning" | "pm_evening";

export type FlowItem = {
  id: string;
  action: string;
  owner: string | null;
  due: string | null;
  kind: "risk" | "delay" | "change" | "crew" | "daily" | "photo" | "disruption" | "open";
  status: "open" | "closed";
};

export type IorRow = { id: string; title: string; due: string | null; state: "open" | "resolved" };

export type FlowMoney = {
  plan: number | null;
  realistic: number | null;
  billed: number | null;
  contract: number | null;
  remaining: number | null;
  retentionHeld: number | null;
  retentionReleasable: boolean | null;
};

export type FlowData = {
  jobNumber: string;
  jobName: string;
  selfPerform: boolean;
  lookaheadLocked: boolean | null;
  onSchedule: boolean | null;
  crewsConfirmed: boolean | null;
  superKnowsPlan: boolean | null;
  progressLabel: string | null;
  items: FlowItem[];
  money: FlowMoney;
  iorNow: IorRow[];
  iorPrevious: IorRow[];
  spillover: string[];
  dailies: string[];
  photos: string[];
  happened: string[];
  disruptions: string[];
  note: string | null;
  /** Open item filed and the IOR snapshot stored. */
  logged: boolean;
  /** Open item filed. The snapshot may still be missing. */
  itemFiled: boolean;
  sample: boolean;
  showMoney: boolean;
};

export const PM_MEETING_STAGES = ["schedule", "change_orders", "accounting", "ior"] as const;
export const MORNING_STAGES = ["schedule", "crews", "risks", "spillover", "log"] as const;
export const EVENING_STAGES = ["dailies", "photos", "risks", "happened", "disruptions", "log"] as const;

export type PmStage = (typeof PM_MEETING_STAGES)[number];
export type MorningStage = (typeof MORNING_STAGES)[number];
export type EveningStage = (typeof EVENING_STAGES)[number];
export type FlowStage = PmStage | MorningStage | EveningStage;

export const STAGE_LABEL: Record<string, string> = {
  schedule: "Schedule",
  change_orders: "Change orders",
  accounting: "Accounting",
  ior: "IOR",
  crews: "Crews",
  risks: "Risks",
  spillover: "Spillover",
  log: "Log",
  dailies: "Dailies",
  photos: "Progress photos",
  happened: "What happened",
  disruptions: "Schedule disruptions",
};

export function stagesFor(flow: FlowName): readonly string[] {
  if (flow === "pm_meeting") return PM_MEETING_STAGES;
  if (flow === "pm_morning") return MORNING_STAGES;
  return EVENING_STAGES;
}

export function emptyMoney(): FlowMoney {
  return { plan: null, realistic: null, billed: null, contract: null, remaining: null, retentionHeld: null, retentionReleasable: null };
}
