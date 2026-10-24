import type { CardModel } from "./cards/model";
import { renderHtml } from "./cards/html";
import { htmlBlock, renderMarkdown } from "./cards/markdown";
import { applyCardClosing } from "./cards/silence";
import { cardWidgetMeta } from "./cards/widget";
import { money } from "./sov";
import type { G702 } from "./superintendent";
import type { PayModel } from "./styled-views";

/** Presentation only: all amounts come from the checked, cent-based certificate. */
export function fieldPayAppCardModel(
  job: string,
  period: string,
  app: G702,
  pageUrl?: string | null,
): CardModel {
  const amount = (value: number | null) => (value === null ? "Needed" : money(value));
  return {
    state: "result",
    show_state: false,
    title: `G702 · Pay app through ${period}`,
    job,
    kpis: [
      { label: "Contract sum · Reported", value: money(app.contract_sum) },
      { label: "Completed and stored · Reported", value: money(app.completed_and_stored) },
      { label: "Retainage", value: amount(app.retainage) },
      { label: "Earned less retainage", value: money(app.earned_less_retainage) },
      { label: "Previous certificates", value: money(app.previous_certificates) },
      { label: "Current payment due · Calculated", value: money(app.current_payment_due) },
      { label: "Balance to finish", value: money(app.balance_to_finish) },
    ],
    sections: [
      { heading: "Reported vs verified", kind: "list", rows: [{ cells: ["Amounts: reported from saved job records. Verified: arithmetic tie checks only. Work in place, invoices and payment certification have not been independently verified."] }] },
      ...(pageUrl
        ? [
            {
              heading: "Live board",
              kind: "list" as const,
              rows: [{ cells: ["Open pay app"], href: pageUrl }],
            },
          ]
        : []),
      {
        heading: "G703 continuation",
        kind: "table",
        scroll: true,
        columns: [
          "Item",
          "Scheduled value",
          "Previous",
          "This period",
          "Completed",
          "%",
          "Balance",
          "Retainage",
          "Note",
        ],
        rows: app.rows.map((row) => ({
          cells: [
            `${row.item_no} ${row.description}`,
            money(row.scheduled_value),
            amount(row.previous),
            amount(row.this_period),
            amount(row.total_completed),
            row.pct_complete === null ? "Needed" : `${row.pct_complete}%`,
            amount(row.balance),
            amount(row.retainage),
            row.note ?? "None",
          ],
        })),
      },
      {
        heading: "G702 tie checks",
        kind: "list",
        rows: app.checks.map((check) => ({ cells: [check] })),
      },
      ...(app.retainage_note
        ? [
            {
              heading: "Retainage needed",
              kind: "list" as const,
              rows: [{ cells: [app.retainage_note] }],
            },
          ]
        : []),
    ],
  };
}

export type BillingForecastOptions = {
  /** Unsaved forecast. Labels the card Draft: not saved and shows the retainage step-down. */
  draft?: boolean;
  /** Retainage step-down lines. Empty shows Needed. Used only when draft is set. */
  retainageLines?: string[] | null;
};

/** Monthly forecast data is not a G703: never invent continuation lines from monthly totals. */
export function billingForecastCardModel(
  job: string,
  model: PayModel,
  pageUrl?: string | null,
  options?: BillingForecastOptions,
): CardModel {
  const mismatch =
    model.contract !== null && Math.round(model.total * 100) !== Math.round(model.contract * 100);
  const draft = options?.draft === true;
  const retainage = options?.retainageLines?.filter((line) => line.trim()) ?? [];
  return {
    state: "result",
    show_state: false,
    title: "Pay App & Billing Forecast",
    job,
    kpis: [
      { label: "Billed to date", value: money(model.billed) },
      { label: "Forecast remaining", value: money(model.forecast) },
      { label: "Contract", value: model.contract === null ? "Needed" : money(model.contract) },
      { label: "Left to bill", value: model.left === null ? "Needed" : money(model.left) },
    ],
    sections: [
      { heading: "Reported vs verified", kind: "list", rows: [{ cells: ["Billed amounts and contract: reported. Forecast: calculated from the saved schedule. Verified: arithmetic tie checks only; receipts and future billings are not independently verified."] }] },
      ...(draft
        ? [
            {
              heading: "Draft: not saved",
              kind: "list" as const,
              rows: [{ cells: ["Nothing is stored until you say yes."] }],
            },
          ]
        : []),
      ...(pageUrl
        ? [
            {
              heading: "Live board",
              kind: "list" as const,
              rows: [{ cells: ["Open pay app"], href: pageUrl }],
            },
          ]
        : []),
      {
        heading: "Tie check",
        kind: "list",
        rows: [
          {
            cells: [model.tie ?? "Contract value Needed; tie not verified."],
            flag: mismatch ? "risk" : null,
          },
        ],
      },
      ...(draft
        ? [
            {
              heading: "Retainage step-down",
              kind: "list" as const,
              rows: (retainage.length ? retainage : ["Needed"]).map((line) => ({
                cells: [line],
                ...(line === "Needed" ? { tone: "unknown" as const } : {}),
              })),
            },
          ]
        : []),
      ...(model.contract !== null && !mismatch
        ? [
            {
              heading: "Monthly billing",
              kind: "table" as const,
              columns: ["Month", "Type", "Amount", "Cumulative"],
              rows: [
                ...model.months.map((row) => ({
                  cells: [
                    new Date(`${row.month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    }),
                    row.kind === "actual" ? "Billed" : "Forecast",
                    money(row.amount),
                    money(row.cum),
                  ],
                })),
                { cells: ["Total", "All months", money(model.total), money(model.total)] },
              ],
            },
          ]
        : []),
    ],
    next_move: mismatch
      ? "Correct the forecast so it ties to the contract before drawing the billing schedule."
      : draft
        ? "Say yes to save this forecast."
        : null,
  };
}

/** Same result contract as the morning brief: Claude HTML and ChatGPT widget metadata. */
export function presentPayApp(card: CardModel) {
  const html = renderHtml(card);
  return {
    content: [
      {
        type: "text" as const,
        text: applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false),
        _meta: { ...cardWidgetMeta },
      },
    ],
    structuredContent: { card, html },
    _meta: { ...cardWidgetMeta },
  };
}
