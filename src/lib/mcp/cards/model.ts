import { isAlertLevel, type AlertLevel } from "./palette";

export type CardState = "intake" | "progress" | "ask" | "result";

/** quote: exact contract wording, printed unchanged in a ruled panel. */
export type CardTone = "known" | "unknown" | "action" | "quote" | "literal";

export type CardRow = {
  cells: string[];
  flag?: AlertLevel | "callout" | null;
  tone?: CardTone | null;
  /** Print the line unchanged. The HTML still flags it when flag is set. */
  raw?: boolean;
  /** Hosted detail page. Rendered as a real anchor, never as the label. */
  href?: string | null;
  /** Table cell that carries href. Default 0. */
  linkCell?: number;
  /** Hidden id. Rendered as data-id, never as the label. */
  refId?: string | null;
};

export type CardSection = {
  heading: string;
  kind: "table" | "list" | "chips" | "timeline";
  columns?: string[];
  /** Wide financial continuations pan horizontally inside the card. */
  scroll?: boolean;
  rows: CardRow[];
  /** Host fills this block. Navy heading, blue rule, gray text. No alert red. */
  placeholder?: boolean;
  /** Its own bordered card, heading as the header (one contract clause). */
  framed?: boolean;
  /** A framed card for a delay, risk, or overdue clause: red border and red header. */
  flag?: AlertLevel | null;
};

export type CardKpi = {
  label: string;
  value: string;
  flag?: AlertLevel | null;
};

export type CardModel = {
  /** Presentation variant confined to the existing first-use surface. */
  presentation?: "onboarding";
  state: CardState;
  title: string;
  /** Omit the state pill (Result, Intake, Needed, What I have so far). */
  show_state?: boolean;
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
  if ((card.alerts ?? []).some((a) => isAlertLevel(a.level))) return true;
  if ((card.kpis ?? []).some((k) => isAlertLevel(k.flag))) return true;
  if ((card.sections ?? []).some((s) => isAlertLevel(s.flag))) return true;
  return (card.sections ?? []).some((s) => s.rows.some((r) => isAlertLevel(r.flag)));
}
