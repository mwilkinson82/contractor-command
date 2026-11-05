// What the account page says about client payments. Plain functions so the words are tested.
import { money, type PayMode, type Readiness } from "./stripe";

export type ClientPaymentsState = {
  can_manage: boolean;
  mode: PayMode;
  test: { connected: boolean; status: Readiness };
  live: { connected: boolean; status: Readiness };
  ready: boolean;
  card_enabled: boolean;
  bank_enabled: boolean;
  card_max_cents: number;
};

export const READINESS: Record<
  Readiness,
  { label: string; tone: "ok" | "warn" | "blue" | "mute" }
> = {
  not_connected: { label: "Not set up", tone: "mute" },
  action_required: { label: "Stripe needs more from you", tone: "warn" },
  under_review: { label: "Stripe is reviewing", tone: "blue" },
  restricted: { label: "Paused by Stripe", tone: "warn" },
  ready: { label: "Ready", tone: "ok" },
};

export type ModeAction = {
  kind: "connect" | "continue" | "check" | "none" | "closed";
  label: string;
};

/** The one button a mode's row shows the owner. */
export function modeAction(status: Readiness, configured: boolean, mode: PayMode): ModeAction {
  if (!configured)
    return { kind: "closed", label: mode === "live" ? "Live payments open soon" : "Opens soon" };
  if (status === "not_connected")
    return {
      kind: "connect",
      label: mode === "live" ? "Set up live payments" : "Set up test payments",
    };
  if (status === "action_required" || status === "restricted")
    return { kind: "continue", label: "Continue in Stripe" };
  if (status === "under_review") return { kind: "check", label: "Check status" };
  return { kind: "none", label: "" };
}

/** One sentence on where payments stand, for the top of the section. */
export function headline(s: ClientPaymentsState | null): {
  text: string;
  tone: "ok" | "warn" | "blue" | "mute";
} {
  if (!s || (!s.test.connected && !s.live.connected))
    return { text: "Not set up yet", tone: "mute" };
  if (s.mode === "live" && s.ready) return { text: "Live: clients can pay", tone: "ok" };
  if (s.ready) return { text: "Test mode: no real money moves", tone: "blue" };
  return { text: READINESS[s.mode === "live" ? s.live.status : s.test.status].label, tone: "warn" };
}

/** Athena's fee, as the contractor reads it. */
export function feeText(fee: { bps: number; capCents: number }): string {
  if (fee.bps <= 0)
    return "Athena takes no fee on client payments right now. Stripe's own processing fee comes out of each payment.";
  const pct = `${Number((fee.bps / 100).toFixed(2))}%`;
  const cap = fee.capCents > 0 ? `, at most ${money(fee.capCents)}` : "";
  return `Athena's fee is ${pct} of each payment${cap}. It comes out of the payment along with Stripe's own processing fee.`;
}

/** Dollars typed by the owner to cents, or null when it isn't a whole amount between $1 and $1,000,000. */
export function dollarsToCents(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 1 || n > 1_000_000) return null;
  return Math.round(n * 100);
}
