import { renderHtml } from "./cards/html";
import type { CardModel } from "./cards/model";
import { ALERT, BLUE, isAlertLevel, type AlertLevel } from "./cards/palette";

export const DRAWING_MARKUP_REQUIRED =
  "REQUIRED: Ordinary drawing markup callouts use navy text with a blue #1E5FED line. Red #DC2626 is only for a recorded risk, delay or overdue item. Use the returned drawing page; do not invent a location or a finding.";

// Reuses #179's explicit alert gate without bringing back its synthetic drawing SVG.
export function drawingCalloutColor(flag?: AlertLevel | null): string {
  return isAlertLevel(flag) ? ALERT : BLUE;
}

/** A key to saved markup references, alongside the actual sheet image returned by #190.
 * No coordinates are stored here, so this never fabricates pins on a drawing. */
export function drawingMarkupCard(
  sheet: string,
  callouts: { label: string; flag?: AlertLevel | null }[],
) {
  const card: CardModel = {
    state: "result",
    show_state: false,
    title: `Drawing callouts · ${sheet}`,
    sections: [
      {
        heading: "Saved markup references",
        kind: "list",
        rows: callouts.map((c) => ({
          cells: [c.label],
          flag: isAlertLevel(c.flag) ? c.flag : "callout",
        })),
      },
    ],
  };
  return { card, html: renderHtml(card) };
}
