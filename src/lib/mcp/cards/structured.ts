// Cards built from structured rows rather than inferred from reply text.
// Contract terms: one framed card per clause, exact wording in a quote panel. SOV: every line in one table.
import { SUMMARY_OFFER, type ClauseRow } from "../contract-clauses";
import { lineAlert } from "./infer";
import type { CardModel, CardRow, CardSection } from "./model";

/** Markdown emphasis from extraction is formatting, not contract wording. */
export function clauseWording(text: string): string {
  return text.replace(/\*\*|__/g, "").replace(/[ \t]+/g, " ").trim();
}

function clockLine(c: Pick<ClauseRow, "n_days" | "day_type" | "trigger_desc">): string | null {
  const days = c.n_days != null ? `${c.n_days} ${c.day_type ? `${c.day_type} ` : ""}day${c.n_days === 1 ? "" : "s"}` : null;
  return [days, c.trigger_desc].filter(Boolean).join(" · ") || null;
}

export function clauseSection(c: ClauseRow): CardSection {
  const flag = lineAlert(`${c.heading ?? ""} ${c.verbatim_text}`);
  const clock = clockLine(c);
  const rows: CardRow[] = [
    ...(clock ? [{ cells: [clock], raw: true }] : []),
    { cells: [clauseWording(c.verbatim_text)], tone: "quote", raw: true },
    ...(c.source === "document" ? [] : [{ cells: ["Not found word for word in the contract text. Check it before relying on it."], tone: "unknown" as const, raw: true }]),
  ];
  return { heading: `§${c.section}${c.heading ? ` ${c.heading}` : ""}`, kind: "list", framed: true, flag, rows };
}

export function contractTermsCard(input: {
  job: string;
  clauses: ClauseRow[];
  valueDisplay: string | null;
  completion: string | null;
  missing: string[];
  flags: { flag: string; value: string }[];
  askSummary: boolean;
  boardLinks: { label: string; url: string }[];
}): CardModel {
  const sections = input.clauses.map(clauseSection);
  const risky = sections.filter((s) => s.flag).length;
  return {
    state: input.askSummary ? "ask" : "result",
    title: "Contract terms",
    show_state: false,
    job: input.job,
    kpis: [
      ...(input.valueDisplay ? [{ label: "Contract value", value: input.valueDisplay.replace(/^Contract value:\s*/i, "") }] : []),
      { label: "Substantial completion", value: input.completion ?? "Needed" },
      { label: "Clauses", value: String(sections.length) },
      { label: "Risk clauses", value: String(risky), flag: risky ? "risk" : null },
    ],
    sections: [
      ...(input.boardLinks.length
        ? [{ heading: "Job board", kind: "chips" as const, rows: input.boardLinks.map((l) => ({ cells: [l.label], href: l.url, tone: "action" as const })) }]
        : []),
      ...sections,
      ...(input.missing.length
        ? [{ heading: "Incomplete terms", kind: "list" as const, rows: input.missing.map((m) => ({ cells: [m], tone: "unknown" as const, raw: true })) }]
        : []),
      {
        heading: "Applicability",
        kind: "table",
        columns: ["Flag", "Value"],
        rows: input.flags.map((f) => ({ cells: [f.flag.replace(/_/g, " "), f.value] })),
      },
    ],
    ask: input.askSummary ? { prompt: SUMMARY_OFFER } : null,
    next_move: risky ? "Read the red clauses before you price or bill." : null,
  };
}

type SovRow = { item_no: string; cost_code: string | null; division: string; division_title: string; description: string; scheduled_value_display: string; pct_of_total: number };
type SovDivisionTotal = { division: string; title: string; scheduled_value_display: string; pct_of_contract: number };

/** Line-item view: every line, then the total that ties to the contract sum. Divisions view: the roll-up. */
export function sovCard(input: {
  job: string;
  rows: SovRow[];
  divisions: SovDivisionTotal[];
  fee: { display: string; pct: number } | null;
  totalDisplay: string;
  basis: string | null;
  audience: "internal" | "client";
  view: "lines" | "divisions";
}): CardModel {
  const pct = (n: number) => `${n.toFixed(2)}%`;
  const total: CardRow = { cells: ["Total", "", "", "Contract sum", input.totalDisplay, "100.00%"] };
  const table: CardSection =
    input.view === "divisions"
      ? {
          heading: "By division",
          kind: "table",
          columns: ["Division", "Scheduled value", "% of total"],
          rows: [...input.divisions.map((d) => ({ cells: [`${d.division} ${d.title}`, d.scheduled_value_display, pct(d.pct_of_contract)] })), { cells: ["Total", input.totalDisplay, "100.00%"] }],
        }
      : {
          heading: "Line items",
          kind: "table",
          columns: ["Line", "Cost code", "Division", "Description", "Scheduled value", "% of total"],
          rows: [
            ...input.rows.map((r) => ({ cells: [r.item_no, r.cost_code ?? "", `${r.division} ${r.division_title}`, r.description, r.scheduled_value_display, pct(r.pct_of_total)] })),
            ...(input.fee ? [{ cells: ["CF", "", "", "Contractor's fee", input.fee.display, pct(input.fee.pct)] }] : []),
            total,
          ],
        };
  return {
    state: "result",
    title: "Schedule of values",
    show_state: false,
    job: input.job,
    kpis: [
      { label: "Contract total", value: input.totalDisplay },
      { label: "Lines", value: String(input.rows.length) },
      { label: "Basis", value: input.basis ?? "Not recorded" },
      ...(input.audience === "client" ? [{ label: "For", value: "Owner" }] : []),
    ],
    sections: [table],
    next_move: null,
  };
}
