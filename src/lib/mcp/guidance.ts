// What Athena says after a setup "no": always a recommendation, why it matters, and an offer to help.
// Recommendations are checked against the member's earlier answers so they never contradict them.

export const DEFAULT_HELP = "Athena can help you close this gap — ask it to draft the next step.";
export const DEFAULT_WHY = "This is a best-practice setup step; skipping it is how cost, time and cash problems start.";

export const BILLING_FORECAST_REC =
  "Build a monthly billing forecast from the budget, SOV and schedule: spread each SOV line over the months the schedule says that work happens. I can help you build it. Why: a monthly billing forecast tells you whether you're hitting your revenue target, shows you how to make it up if delays hit, and helps you sequence the work to capture revenue. Without it, you find out you're behind on billing after the month is gone.";

type Flags = Record<string, string | undefined>;

/** Replace a recommendation that contradicts an earlier answer. */
export function reconcileRecommendation(checkKey: string, rec: string | null, flags: Flags): string | null {
  if (!rec) return rec;
  if (flags.cost_loaded === "no" && /cost-loaded/i.test(rec)) return checkKey === "bss_billing_forecast" ? BILLING_FORECAST_REC : rec.replace(/[^.]*cost-loaded[^.]*\.\s*/gi, "").trim() || null;
  return rec;
}

/** Split a stored recommendation into recommend / why / help, filling any missing part. */
export function noGuidance(rec: string | null, why?: string | null, help?: string | null) {
  let r = (rec ?? "").trim();
  let w: string | null = null;
  let h: string | null = null;
  const wm = r.match(/\s*(?:Here's why|Why):\s*([\s\S]*)$/i);
  if (wm) { w = wm[1].trim(); r = r.slice(0, wm.index).trim(); }
  const hm = r.match(/(?:^|(?<=\.)\s+)((?:I|Athena(?: by ALP)?) can help[^.]*\.)/i);
  if (hm) { h = hm[1].trim(); r = (r.slice(0, hm.index) + r.slice((hm.index ?? 0) + hm[0].length)).replace(/\s{2,}/g, " ").trim(); }
  return {
    recommendation: r || "Close this gap before the job moves on.",
    why: w || (why && !/^Answered no on a best-practice check/i.test(why) ? why : DEFAULT_WHY),
    help: h || help || DEFAULT_HELP,
  };
}

export function noGuidanceText(g: ReturnType<typeof noGuidance>): string {
  return `\n\nRecommendation: ${g.recommendation}\nWhy it matters: ${g.why}\nHow I can help: ${g.help}`;
}

/** Applicability flags a setup question or a later intake section asks for directly; scoping leaves them alone when unknown. */
export const FLAGS_ASKED_LATER = new Set(["self_perform", "has_retainage", "beneficial_use", "has_lds", "notice_requirements"]);
