import { z } from "zod";

export const LIMIT = 9_000_000_000_000;
const money = z.number().int().min(0).max(LIMIT);
const signed = z.number().int().min(-LIMIT).max(LIMIT);
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v &&
      !v.startsWith("0000"),
    "Use a valid calendar date",
  );
export const snapshotSchema = z
  .object({
    fingerprint: z.string().min(1),
    contract_cents: money,
    lines: z
      .array(
        z
          .object({
            item: z.string().min(1).max(40),
            description: z.string().max(500),
            scheduled_cents: signed,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const lineSchema = z
  .object({
    item: z.string().min(1).max(40),
    prior_work_cents: signed.nullable(),
    prior_stored_cents: money.nullable(),
    prior_retained_cents: signed.nullable(),
    work_cents: signed.nullable(),
    stored_cents: money.nullable(),
    stored_to_work_cents: money.nullable(),
    work_retainage_bps: z.number().int().min(0).max(10000).nullable(),
    stored_retainage_bps: z.number().int().min(0).max(10000).nullable(),
    release_cents: money.nullable(),
    stored_basis: z.string().max(2000),
    release_basis: z.string().max(2000),
  })
  .strict();
export const applicationSchema = z
  .object({
    number: z.string().trim().min(1).max(120),
    period_start: day,
    period_end: day,
    prior_cutoff: day,
    state: z.enum(["draft", "ready", "submitted", "certified"]),
    source: z.string().trim().min(1).max(2000),
    reason: z.string().max(2000),
    retainage_basis: z.string().max(2000),
    prior_mode: z.enum(["first", "external", "saved"]),
    prior_application: z
      .object({ id: z.string().uuid(), version: z.number().int().positive() })
      .strict()
      .nullable(),
    prior_certified_net_cents: money.nullable(),
    prior_basis: z.string().max(2000),
    certification: z
      .object({ amount_cents: money, date: day, source: z.string().trim().min(1).max(2000) })
      .strict()
      .nullable(),
    evidence: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            version: z.number().int().positive(),
            treatment: z.enum(["prior_billing", "separate"]),
            reason: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(200),
    lines: z.array(lineSchema).min(1).max(100),
    snapshot: snapshotSchema,
  })
  .strict();
export type Application = z.infer<typeof applicationSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type AppLine = z.infer<typeof lineSchema>;
export type Evidence = {
  id: string;
  version: number;
  number: string;
  kind: string;
  status: string;
  invoice_date: string;
  gross_cents: number | null;
  net_due_cents: number;
  certified_cents: number | null;
  credit_for: string | null;
};
export type Row = AppLine & {
  description: string;
  scheduled_cents: number;
  this_period_work_cents: number | null;
  gross_cents: number | null;
  retained_cents: number | null;
  earned_net_cents: number | null;
  balance_cents: number | null;
};
export type Calculation = {
  evidence: Evidence[];
  complete: boolean;
  issues: string[];
  rows: Row[];
  contract_cents: number;
  prior_gross_cents: number | null;
  prior_retained_cents: number | null;
  prior_certified_net_cents: number | null;
  gross_cents: number | null;
  retained_cents: number | null;
  earned_net_cents: number | null;
  payment_due_cents: number | null;
  unearned_cents: number | null;
  balance_including_retainage_cents: number | null;
  billing_gross_cents: number | null;
  billing_withheld_cents: number | null;
  billing_released_cents: number | null;
};
const sum = (values: (number | null)[]) =>
  values.some((v) => v === null) ? null : values.reduce<number>((n, v) => n + v!, 0);
const plus = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
const minus = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
const ratio = (n: number, bps: number) => {
  const p = BigInt(Math.abs(n)) * BigInt(bps);
  return Number((p + 5000n) / 10000n) * (n < 0 ? -1 : 1);
};
export function calculateApplication(input: Application): Calculation {
  const a = applicationSchema.parse(input),
    issues: string[] = [];
  if (a.period_start > a.period_end) issues.push("The application period ends before it starts.");
  if (a.prior_cutoff >= a.period_start)
    issues.push("The prior certificate cutoff must precede this period.");
  if (a.prior_mode === "saved" && !a.prior_application)
    issues.push("Choose the exact prior certified application.");
  if (a.prior_mode !== "saved" && a.prior_application)
    issues.push("The prior application reference conflicts with its basis.");
  if (!a.prior_basis.trim())
    issues.push(
      "Record the prior certificate basis, including an explicit first-application declaration where applicable.",
    );
  if (!a.retainage_basis.trim())
    issues.push(
      "Record the applicable retainage terms, including an explicit zero rate where applicable.",
    );
  if (a.prior_certified_net_cents === null)
    issues.push(
      "Prior certified net amount is needed; cash and credits do not supply it automatically.",
    );
  const items = a.lines.map((l) => l.item),
    source = a.snapshot.lines.map((l) => l.item);
  if (
    new Set(items).size !== items.length ||
    new Set(source).size !== source.length ||
    items.length !== source.length ||
    source.some((k) => !items.includes(k))
  )
    issues.push(
      "Application lines must match the exact saved SOV without duplicates or omissions.",
    );
  if (sum(a.snapshot.lines.map((l) => l.scheduled_cents)) !== a.snapshot.contract_cents)
    issues.push("The SOV does not tie to its contract total.");
  const rows = a.lines.map((l) => {
    const s = a.snapshot.lines.find((s) => s.item === l.item),
      c = s?.scheduled_cents ?? 0;
    const label = s?.description || l.item;
    const prior = plus(l.prior_work_cents, l.prior_stored_cents),
      gross = plus(l.work_cents, l.stored_cents);
    const values = [
      l.prior_work_cents,
      l.prior_stored_cents,
      l.prior_retained_cents,
      l.work_cents,
      l.stored_cents,
      l.stored_to_work_cents,
      l.work_retainage_bps,
      l.stored_retainage_bps,
      l.release_cents,
    ];
    if (values.some((v) => v === null))
      issues.push(
        `${label}: current work, stored materials, prior values and retainage inputs are needed.`,
      );
    if (
      [l.prior_work_cents, l.work_cents].some(
        (v) => v !== null && (v < Math.min(0, c) || v > Math.max(0, c)),
      )
    )
      issues.push(`${label}: work is outside its SOV scope.`);
    if (prior !== null && (prior < Math.min(0, c) || prior > Math.max(0, c)))
      issues.push(`${label}: prior completed and stored amount exceeds its SOV scope.`);
    if (gross !== null && (gross < Math.min(0, c) || gross > Math.max(0, c)))
      issues.push(`${label}: completed and stored amount exceeds its SOV scope.`);
    if (
      l.prior_work_cents !== null &&
      l.work_cents !== null &&
      (c >= 0 ? l.work_cents < l.prior_work_cents : l.work_cents > l.prior_work_cents)
    )
      issues.push(`${label}: reconcile a work reduction through its reviewed correction basis.`);
    if (prior !== null && gross !== null && (c >= 0 ? gross < prior : gross > prior))
      issues.push(
        `${label}: reconcile the prior certificate before reducing cumulative earned work.`,
      );
    if (
      l.stored_to_work_cents !== null &&
      l.prior_stored_cents !== null &&
      l.prior_work_cents !== null &&
      l.work_cents !== null &&
      l.stored_cents !== null &&
      (l.stored_to_work_cents > l.prior_stored_cents ||
        l.stored_to_work_cents > Math.max(0, l.work_cents - l.prior_work_cents) ||
        l.stored_cents - l.prior_stored_cents + l.stored_to_work_cents < 0)
    )
      issues.push(
        `${label}: reconcile the explicit stored-to-installed transfer and new eligible stored materials.`,
      );
    if (
      c < 0 &&
      ((l.stored_cents ?? 0) !== 0 ||
        (l.prior_stored_cents ?? 0) !== 0 ||
        (l.release_cents ?? 0) !== 0)
    )
      issues.push(
        `${label}: a credit SOV line cannot contain stored materials or a positive retainage release.`,
      );
    if ((l.stored_cents ?? 0) > 0 && !l.stored_basis.trim())
      issues.push(`${label}: the stored-material source and eligibility basis are needed.`);
    if ((l.release_cents ?? 0) > 0 && !l.release_basis.trim())
      issues.push(`${label}: the retainage release source and approval basis are needed.`);
    if (
      prior !== null &&
      l.prior_retained_cents !== null &&
      (c >= 0
        ? l.prior_retained_cents < 0 || l.prior_retained_cents > prior
        : l.prior_retained_cents > 0 || l.prior_retained_cents < prior)
    )
      issues.push(`${label}: prior retainage is outside the prior earned amount.`);
    const base =
      l.work_cents === null ||
      l.stored_cents === null ||
      l.work_retainage_bps === null ||
      l.stored_retainage_bps === null
        ? null
        : ratio(l.work_cents, l.work_retainage_bps) + ratio(l.stored_cents, l.stored_retainage_bps);
    if (base !== null && l.release_cents !== null && l.release_cents > Math.max(0, base))
      issues.push(`${label}: retainage release exceeds calculated retainage.`);
    const retained = l.stored_to_work_cents === null ? null : minus(base, l.release_cents);
    return {
      ...l,
      description: label,
      scheduled_cents: c,
      this_period_work_cents: minus(l.work_cents, l.prior_work_cents),
      gross_cents: gross,
      retained_cents: retained,
      earned_net_cents: minus(gross, retained),
      balance_cents: minus(c, gross),
    };
  });
  const priorGross = sum(rows.map((l) => plus(l.prior_work_cents, l.prior_stored_cents))),
    priorHeld = sum(rows.map((l) => l.prior_retained_cents));
  const gross = sum(rows.map((l) => l.gross_cents)),
    held = sum(rows.map((l) => l.retained_cents)),
    earned = minus(gross, held),
    due = minus(earned, a.prior_certified_net_cents);
  if (
    a.prior_mode === "first" &&
    (priorGross !== 0 || priorHeld !== 0 || a.prior_certified_net_cents !== 0)
  )
    issues.push(
      "A first application requires explicitly confirmed zero prior work, storage, retainage and certification.",
    );
  const priorEarned = minus(priorGross, priorHeld);
  if (
    priorEarned !== null &&
    a.prior_certified_net_cents !== null &&
    a.prior_certified_net_cents > priorEarned
  )
    issues.push("Prior certification exceeds its reconciled prior earned net amount.");
  if (due !== null && due < 0)
    issues.push(
      "A negative application requires the separate reviewed credit/correction workflow.",
    );
  const delta = minus(held, priorHeld),
    withheld = delta === null ? null : Math.max(0, delta),
    released = delta === null ? null : Math.max(0, -delta);
  if (a.state === "certified" && !a.certification)
    issues.push(
      "Record the actual certificate amount, date and source before marking this application certified.",
    );
  if (a.state !== "certified" && a.certification)
    issues.push("Certification facts require the certified state.");
  if (a.certification && due !== null && a.certification.amount_cents > due)
    issues.push("Certification exceeds the requested amount.");
  if ([gross, held, priorGross, due].some((v) => v !== null && Math.abs(v) > LIMIT))
    issues.push("Application totals exceed the supported cent range.");
  return {
    evidence: [],
    complete: issues.length === 0,
    issues: [...new Set(issues)],
    rows,
    contract_cents: a.snapshot.contract_cents,
    prior_gross_cents: priorGross,
    prior_retained_cents: priorHeld,
    prior_certified_net_cents: a.prior_certified_net_cents,
    gross_cents: gross,
    retained_cents: held,
    earned_net_cents: earned,
    payment_due_cents: due,
    unearned_cents: minus(a.snapshot.contract_cents, gross),
    balance_including_retainage_cents: plus(minus(a.snapshot.contract_cents, gross), held),
    billing_gross_cents: minus(plus(due, withheld), released),
    billing_withheld_cents: withheld,
    billing_released_cents: released,
  };
}
export function reconcileEvidence(a: Application, evidence: Evidence[]): string[] {
  const issues: string[] = [];
  const choices = a.evidence;
  if (new Set(choices.map((e) => e.id)).size !== choices.length)
    issues.push("Billing evidence contains duplicate selections.");
  if (
    choices.some((c) => !evidence.some((e) => e.id === c.id && e.version === c.version)) ||
    evidence.some((e) => !choices.some((c) => c.id === e.id && c.version === e.version))
  )
    issues.push("Billing evidence changed or has not been explicitly reconciled.");
  let billed = 0;
  for (const e of evidence) {
    const choice = choices.find((c) => c.id === e.id && c.version === e.version);
    if (choice?.treatment !== "prior_billing") continue;
    if (e.invoice_date > a.prior_cutoff)
      issues.push(`${e.number}: evidence is later than the prior cutoff.`);
    if (e.kind === "credit") {
      if (!choices.some((c) => c.id === e.credit_for && c.treatment === "prior_billing"))
        issues.push(`${e.number}: reconcile its linked invoice before including the credit.`);
      billed -= e.net_due_cents;
    } else billed += e.net_due_cents;
  }
  if (a.prior_certified_net_cents !== null && billed > a.prior_certified_net_cents)
    issues.push(
      "Prior issued billing exceeds the stated previous certification. Reconcile it before adding another bill.",
    );
  return issues;
}
export const appMoney = (value: number | null | undefined) =>
  value == null
    ? "Needed"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
export function dollarsToCents(value: string): number | null {
  const v = value.trim().replaceAll(",", "");
  if (!v) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) throw Error("Use dollars with at most two decimal places.");
  const negative = v.startsWith("-"),
    [whole, fraction = ""] = v.replace("-", "").split(".");
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (n > BigInt(LIMIT)) throw Error("Amount exceeds the supported limit.");
  return Number(n) * (negative ? -1 : 1);
}
