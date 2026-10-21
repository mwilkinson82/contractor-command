// 0.8.12: the ONE alert color. Used only for delay callouts, risk flags and overdue items; everything else is
// navy, blue #2563EB and gray. To switch to charcoal, change this one line to: "charcoal #374151".
export const ALERT_COLOR = "red #DC2626";

/** The hex part of ALERT_COLOR, e.g. "#DC2626". */
export const ALERT_HEX = ALERT_COLOR.slice(ALERT_COLOR.indexOf("#"));
/** The color word, e.g. "red". */
export const ALERT_NAME = ALERT_COLOR.slice(0, ALERT_COLOR.indexOf("#")).trim();

/** Shared palette sentence: server instructions, house style and every view spec quote this, so they never conflict. */
export const ALERT_PALETTE_RULE = `Colors: navy, blue #2563EB and gray only, except ${ALERT_COLOR} (the alert color), used only for delays, risks and overdue items.`;
