/**
 * How a package's extra time is worded for the customer. Every change order carries money and
 * time, and the customer reads the time plainly right before they sign: either that no added time
 * is needed, or how many days are.
 */
export const dayCount = (days: number) => `${days} ${days === 1 ? "day" : "days"}`;

/** The sentence the customer reads right before entering the code. */
export function timeSentence(days: number): string {
  return days > 0
    ? `The additional time necessary for this change is ${dayCount(days)}.`
    : "No additional time is necessary for this change.";
}

/** A short label for a package card or a summary row. */
export const timeLabel = (days: number) => (days > 0 ? `+${dayCount(days)}` : "No added time");
