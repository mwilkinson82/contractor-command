import type { CardModel, CardRow, CardSection } from "./cards/model";
import type { AlertLevel } from "./cards/palette";
import { isOwnerFurnished } from "./living";
import { money } from "./sov";
import { payModel, shortDate, type Billing } from "./styled-views";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

export const G703_HEADERS = ["Item", "Description", "Scheduled value", "Previous", "This period", "Completed", "%", "Balance", "Retainage"];

export type G703Cells = {
  item_no: string;
  description: string;
  scheduled_value: number | null;
  previous: number | null;
  this_period: number | null;
  total_completed: number | null;
  pct_complete: number | null;
  balance: number | null;
  retainage: number | null;
  note?: string | null;
};

const shown = (n: number | null | undefined) => (n == null ? "blank" : money(n));

export function g703Cells(row: G703Cells): string[] {
  const description = row.note ? `${row.description} (${row.note})` : row.description;
  return [
    row.item_no,
    description,
    shown(row.scheduled_value),
    shown(row.previous),
    shown(row.this_period),
    shown(row.total_completed),
    row.pct_complete == null ? "percent needed" : `${row.pct_complete}%`,
    shown(row.balance),
    shown(row.retainage),
  ];
}

export function g703Section(rows: string[][]): CardSection {
  return {
    heading: "G703",
    kind: "table",
    columns: G703_HEADERS,
    rows: rows.map((cells) => ({ cells })),
  };
}

function monthLabel(month: string): string {
  const n = Number(month.slice(5, 7));
  return Number.isFinite(n) && n >= 1 && n <= 12 ? `${MONTHS[n - 1]} ${month.slice(0, 4)}` : month;
}

export type ForecastActivity = {
  id: string;
  name: string;
  value?: number | null;
  pct_complete?: number | null;
  sov_line?: string | null;
  owner_furnished?: boolean;
};

/** Completed and balance stay in integer cents. Previous and this period stay blank when the forecast has neither. */
export function g703FromActivities(activities: ForecastActivity[]): string[][] {
  return activities.map((activity) => {
    const scheduled = isOwnerFurnished(activity) ? 0 : (activity.value ?? null);
    const pct = activity.pct_complete ?? null;
    const completed = scheduled == null || pct == null ? null : fromCents(Math.round((cents(scheduled) * pct) / 100));
    const balance = scheduled == null || completed == null ? null : fromCents(cents(scheduled) - cents(completed));
    return g703Cells({
      item_no: activity.sov_line?.trim() || activity.id,
      description: activity.name,
      scheduled_value: scheduled,
      previous: null,
      this_period: null,
      total_completed: completed,
      pct_complete: pct,
      balance,
      retainage: null,
    });
  });
}

function tieRow(line: string): CardRow {
  const risk = line.includes("Doesn't tie");
  return { cells: [line], raw: true, flag: risk ? "risk" : null };
}

/**
 * Billing forecast as the same pay app card: G702 tiles, G703 rows when the schedule of values is on the report,
 * and the tie line exactly as tieCheck or payModel wrote it.
 */
export function billingForecastCard(v: {
  title: string;
  version?: number | null;
  dataDate?: string | null;
  billing: Billing | null | undefined;
  contract: number | null;
  tieLine?: string | null;
  activities?: ForecastActivity[];
  pageUrl?: string | null;
  stamp?: string | null;
  changeLog?: string[];
}): CardModel {
  const model = payModel(v.billing, v.contract);
  const contract = model.contract === null ? "Needed" : money(model.contract);
  const left = model.left === null ? "Needed" : money(model.left);
  const summary = [
    `Billed to date: ${money(model.billed)}`,
    `Forecast remaining: ${money(model.forecast)}`,
    `Contract: ${contract}`,
    `Left to bill: ${left}`,
  ];
  const tieLines: string[] = [];
  const addTie = (line: string | null | undefined) => {
    if (!line || tieLines.includes(line)) return;
    tieLines.push(line);
  };
  addTie(v.tieLine);
  if (v.tieLine) addTie(`Tie: ${v.tieLine}`);
  addTie(model.tie);
  const lines = g703FromActivities(v.activities ?? []);
  const job = [v.title, v.version ? `v${v.version}` : "", v.dataDate ? `Data date ${shortDate(v.dataDate)}` : ""].filter(Boolean).join(" · ");
  const alerts = tieLines.filter((line) => line.includes("Doesn't tie")).map((text) => ({ level: "risk" as AlertLevel, text }));
  const log = v.changeLog ?? [];
  const sections: CardSection[] = [
    ...(v.pageUrl ? [{ heading: "Page", kind: "list" as const, rows: [{ cells: ["Pay app"], href: v.pageUrl }] }] : []),
    { heading: "G702", kind: "list", rows: summary.map((line) => ({ cells: [line], raw: true })) },
    ...(lines.length ? [g703Section(lines)] : []),
    {
      heading: "Monthly billing",
      kind: "table",
      columns: ["Month", "Type", "Amount", "Cumulative"],
      rows: model.months.map((row) => ({
        cells: [monthLabel(row.month), row.kind === "actual" ? "Billed" : "Forecast", money(row.amount), money(row.cum)],
      })),
    },
    { heading: "Tie", kind: "list", rows: tieLines.map(tieRow) },
    ...(v.stamp ? [{ heading: "Saved", kind: "list" as const, rows: [{ cells: [v.stamp], raw: true }] }] : []),
    {
      heading: "Change log",
      kind: "list",
      rows: (log.length ? log : ["- None yet."]).map((line) => ({ cells: [line], raw: true })),
    },
  ];
  return {
    state: "result",
    title: "Pay app",
    show_state: false,
    job,
    kpis: [
      { label: "Billed to date", value: money(model.billed) },
      { label: "Forecast remaining", value: money(model.forecast) },
      { label: "Contract", value: contract },
      { label: "Left to bill", value: left },
    ],
    sections,
    alerts,
    next_move: "Want it as Excel or PDF?",
  };
}
