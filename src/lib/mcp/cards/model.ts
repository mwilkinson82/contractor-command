import type { AlertLevel } from "./palette";

export type CardState = "intake" | "progress" | "ask" | "result";

export type CardTone = "known" | "unknown" | "action";

export type CardRow = {
  cells: string[];
  flag?: AlertLevel | null;
  tone?: CardTone | null;
  /** Print the line unchanged. The HTML still flags it when flag is set. */
  raw?: boolean;
  /** Hosted detail page. Rendered as a real anchor, never as the label. */
  href?: string | null;
  /** Hidden id. Rendered as data-id, never as the label. */
  refId?: string | null;
};

export type CardSection = {
  heading: string;
  kind: "table" | "list" | "chips" | "timeline";
  columns?: string[];
  rows: CardRow[];
};

export type CardKpi = {
  label: string;
  value: string;
  flag?: AlertLevel | null;
};

export type CardModel = {
  state: CardState;
  title: string;
  job?: string | null;
  progress?: { done: number; total: number } | null;
  kpis?: CardKpi[];
  sections?: CardSection[];
  alerts?: { level: AlertLevel; text: string }[];
  ask?: { prompt: string } | null;
  next_move?: string | null;
};

export const STATE_LABEL: Record<CardState, string> = {
  intake: "Intake",
  progress: "What I have so far",
  ask: "Needed",
  result: "Result",
};

export function cardHasAlert(card: CardModel): boolean {
  if ((card.alerts ?? []).length) return true;
  if ((card.kpis ?? []).some((k) => k.flag)) return true;
  return (card.sections ?? []).some((s) => s.rows.some((r) => r.flag));
}
