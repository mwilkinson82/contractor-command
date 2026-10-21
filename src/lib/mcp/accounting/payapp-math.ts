// Accounting phase 1 (D1): the pay app math in AIA G702/G703 format and the blocking checks that enforce the saved
// retainage rule. Pure functions on integer cents; the pay app tools (phase 2) call these and refuse to save on any failure.
// Not an AIA document: Athena's own labels and column letters only.
import { applyBp, fmt, fmtBp, pct2, sum } from "./cents";
import { computeRetainage, type RetainageRule, type RetResult } from "./retainage";

export type PayLine = {
  id: string; // "26.01" or "CO-001"
  co?: boolean; // an approved change order line
  c: number; // scheduled value
  d: number; // from previous application (D + E of the last certified app)
  e: number; // this period
  f: number; // materials presently stored
  prev_g: number; // G on the last certified app
  prev_i: number; // I (retainage) on the last certified app
  typed_i?: number; // retainage on this line as typed on the draft, when checking a typed app
};

export type PayAppIn = {
  original_contract: number;
  net_change_orders: number; // approved COs only
  previous_certificates: number; // line 6 of the last certified app (the certified record)
  lines: PayLine[];
  typed?: { line4?: number; line5?: number; line5a?: number; line5b?: number; line7?: number }; // a typed G702 to check
};

export type G702 = {
  l1: number; l2: number; l3: number; l4: number; l5a: number; l5b: number; l5: number; l6: number; l7: number; l8: number; l9: number;
};
export type Check = { key: "B1" | "B2" | "B3" | "B4" | "B5"; ok: boolean; message: string | null };

export type PayAppResult = {
  g702: G702;
  g703: { id: string; c: number; d: number; e: number; f: number; g: number; pct: string; h: number; i: number; period_retainage: number }[];
  retainage: RetResult;
  checks: Check[];
  ok: boolean;
};

/**
 * 3 = 1 + 2. Per line G = D + E + F, H = C − G, I from the saved rule. 4 = ΣG, 5 = ΣI.
 * 5b = retainage on stored materials still in F, at the line's period rate. Decision D2 (a separate stored-materials
 * rate) is still open with Marshall, so this uses the same rate as completed work and only splits 5 into 5a and 5b;
 * the total 5 never depends on D2. 6 = 4 − 5, 7 = the certified record, 8 = 6 − 7, 9 = 3 − 6.
 */
export function payAppMath(rule: RetainageRule, a: PayAppIn): PayAppResult {
  const l3 = a.original_contract + a.net_change_orders;
  const gs = a.lines.map((l) => l.d + l.e + l.f);
  const ret = computeRetainage(rule, a.lines.map((l, k) => ({ id: l.id, c: l.c, prev_g: l.prev_g, g: gs[k], f: l.f, prev_i: l.prev_i })), l3, a.original_contract);
  const g703 = a.lines.map((l, k) => {
    const r = ret.lines[k];
    return { id: l.id, c: l.c, d: l.d, e: l.e, f: l.f, g: gs[k], pct: pct2(gs[k], l.c), h: l.c - gs[k], i: r.i, period_retainage: r.period_retainage };
  });
  const l4 = sum(gs);
  const l5 = ret.total_retainage;
  const l5b = sum(a.lines.map((l, k) => (l.f && g703[k].g ? Math.min(g703[k].i, Math.round((g703[k].i * l.f) / g703[k].g)) : 0)));
  const l6 = l4 - l5;
  const l7 = a.previous_certificates;
  const g702: G702 = { l1: a.original_contract, l2: a.net_change_orders, l3, l4, l5a: l5 - l5b, l5b, l5, l6, l7, l8: l6 - l7, l9: l3 - l6 };
  const checks = [b1(a, l3), b2(a, g702), b3(a, gs), b4(rule, a, ret), b5(a)];
  return { g702, g703, retainage: ret, checks, ok: checks.every((c) => c.ok) };
}

const pass = (key: Check["key"]): Check => ({ key, ok: true, message: null });
const fail = (key: Check["key"], message: string): Check => ({ key, ok: false, message });

/** B1: SOV (original lines plus approved CO lines) = contract sum to date. */
function b1(a: PayAppIn, l3: number): Check {
  const sov = sum(a.lines.map((l) => l.c));
  if (sov === l3) return pass("B1");
  return fail("B1", sov < l3 ? `SOV is ${fmt(l3 - sov)} short of the contract sum to date. Add the approved change order as a line.` : `SOV is ${fmt(sov - l3)} more than the contract sum to date.`);
}

/** B2: G703 column totals = G702 lines (G = line 4, I = line 5, 5a + 5b = 5), checked against the typed G702. */
function b2(a: PayAppIn, g: G702): Check {
  const t = a.typed;
  if (!t) return pass("B2");
  if (t.line4 !== undefined && t.line4 !== g.l4) return fail("B2", `G702 line 4 is ${fmt(Math.abs(t.line4 - g.l4))} ${t.line4 > g.l4 ? "more" : "less"} than the G703 column G total.`);
  const typed5 = t.line5 ?? (t.line5a !== undefined && t.line5b !== undefined ? t.line5a + t.line5b : undefined);
  if (typed5 !== undefined && typed5 !== g.l5) return fail("B2", `G702 line 5 is ${fmt(Math.abs(typed5 - g.l5))} ${typed5 > g.l5 ? "more" : "less"} than the G703 column I total.`);
  if (t.line5 !== undefined && t.line5a !== undefined && t.line5b !== undefined && t.line5a + t.line5b !== t.line5) return fail("B2", `G702 lines 5a and 5b don't add up to line 5 (off by ${fmt(Math.abs(t.line5a + t.line5b - t.line5))}).`);
  return pass("B2");
}

/**
 * B3: G ≤ C on every line. Who may approve an overbill is decision D3, still open with Marshall, so phase 1 has no
 * approval path: any line over its scheduled value blocks.
 */
function b3(a: PayAppIn, gs: number[]): Check {
  const k = a.lines.findIndex((l, n) => gs[n] > l.c);
  if (k < 0) return pass("B3");
  return fail("B3", `Line ${a.lines[k].id} is ${fmt(gs[k] - a.lines[k].c)} over its scheduled value.`);
}

/** B4: retainage = the saved contract rule, to the cent, line by line and in total. */
function b4(rule: RetainageRule, a: PayAppIn, ret: RetResult): Check {
  const typedTotal = a.typed?.line5 ?? (a.lines.every((l) => l.typed_i !== undefined) ? sum(a.lines.map((l) => l.typed_i!)) : undefined);
  if (typedTotal !== undefined && typedTotal !== ret.total_retainage) {
    const off = typedTotal - ret.total_retainage;
    const reduced = rule.reduced_rate_bp;
    const flatOver = reduced !== null && rule.reduction === "prospective" && ret.above > 0 && off === applyBp(ret.above, rule.base_rate_bp - reduced);
    if (flatOver) return fail("B4", `Retainage is ${fmt(off)} too high on the ${fmtBp(reduced!)} part above ${fmt(ret.threshold_amount!)}.`);
    return fail("B4", `Retainage is ${fmt(Math.abs(off))} too ${off > 0 ? "high" : "low"} against the saved rule (should be ${fmt(ret.total_retainage)}).`);
  }
  for (let k = 0; k < a.lines.length; k++) {
    const t = a.lines[k].typed_i;
    if (t !== undefined && t !== ret.lines[k].i) return fail("B4", `Line ${a.lines[k].id} retainage is ${fmt(Math.abs(t - ret.lines[k].i))} too ${t > ret.lines[k].i ? "high" : "low"} against the saved rule.`);
  }
  return pass("B4");
}

/** B5: the previous application = the last certified app (D per line against the certified G, and line 7). */
function b5(a: PayAppIn): Check {
  if (a.typed?.line7 !== undefined && a.typed.line7 !== a.previous_certificates) {
    const off = a.typed.line7 - a.previous_certificates;
    return fail("B5", `Previous certificates are ${fmt(Math.abs(off))} ${off > 0 ? "higher" : "lower"} than the certified record.`);
  }
  return pass("B5");
}

/** The one-line retainage note for the pay app view. */
export const retainageNote = (r: PayAppResult) => r.retainage.note;
