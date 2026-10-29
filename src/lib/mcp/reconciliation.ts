import { z } from "zod";

// These schemas describe the existing gated RPCs, not a second accounting ledger.
const id = z.string().uuid();
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const version = z.number().int().positive();
const invoiceVersion = z.object({
  invoice_id: id,
  job_id: id,
  version,
  status: z.enum(["draft", "submitted", "certified", "posted", "void"]),
  net_due_cents: cents,
  source: z.string(),
  reason: z.string().nullable(),
});
export const billingSchema = z.object({
  currency: z.literal("USD"),
  invoices: z.array(
    z.object({
      id,
      job_id: id,
      company_id: id,
      document_number: z.string(),
      kind: z.enum(["invoice", "pay_application", "credit"]),
      credit_for: id.nullable(),
      versions: z.array(invoiceVersion).min(1),
    }),
  ),
  receipts: z.array(
    z.object({ id, job_id: id, company_id: id, amount_cents: cents, source: z.string() }),
  ),
  allocations: z.array(
    z.object({
      id,
      job_id: id,
      receipt_id: id,
      invoice_id: id,
      amount_cents: cents,
      reversal_of: id.nullable(),
      source: z.string(),
    }),
  ),
  receipt_reversals: z.array(
    z.object({ id, job_id: id, receipt_id: id, amount_cents: cents, source: z.string() }),
  ),
});
const documentsSchema = z.object({
  documents: z.array(z.object({ id, job_id: id, company_id: id })),
  links: z.array(
    z.object({
      document_id: id,
      job_id: id,
      invoice_id: id.nullable(),
      invoice_version: version.nullable(),
      receipt_id: id.nullable(),
    }),
  ),
});
export type Scope = { job_id: string; company_id: string };
export type Finding = {
  code: string;
  severity: "review" | "attention";
  record_ids: string[];
  message: string;
  amount_cents?: string;
  currency_code?: string;
  invoice_version?: number;
  source_url?: string;
};
export type Coverage = { state: "checked" | "unavailable"; reason: string };
export type Reconciliation = { coverage: Coverage; findings: Finding[] };
const unavailable = (reason: string): Reconciliation => ({
  coverage: { state: "unavailable", reason },
  findings: [],
});
const norm = (s: string) => s.trim().toLowerCase();
const sum = (values: number[]) => values.reduce((a, b) => a + BigInt(b), 0n);
export function dollars(value: string): string {
  const n = BigInt(value);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}$${(abs / 100n).toLocaleString("en-US")}.${(abs % 100n).toString().padStart(2, "0")}`;
}
function duplicates<T>(
  rows: T[],
  key: (r: T) => string,
  ident: (r: T) => string,
  code: string,
  findings: Finding[],
) {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const group of groups.values())
    if (group.length > 1)
      findings.push({
        code,
        severity: "attention",
        record_ids: group.map(ident),
        message:
          "Repeated reference or identifier needs review; similarity alone does not prove a duplicate transaction.",
      });
}

/** Accept only the resolved company/job; never return a foreign identifier in an error. */
export function reconcileBilling(
  raw: unknown,
  originals: unknown,
  scope: Scope,
): Reconciliation & { originals: Coverage } {
  const parsed = billingSchema.safeParse(raw);
  const noOriginals: Coverage = {
    state: "unavailable",
    reason: "Original-document linkage could not be checked.",
  };
  if (!parsed.success)
    return {
      ...unavailable(
        "Billing evidence is missing or has unsupported values or unsafe monetary precision.",
      ),
      originals: noOriginals,
    };
  const b = parsed.data;
  if (
    [...b.invoices, ...b.receipts].some(
      (r) => r.company_id !== scope.company_id || r.job_id !== scope.job_id,
    ) ||
    [...b.allocations, ...b.receipt_reversals].some((r) => r.job_id !== scope.job_id) ||
    b.invoices.some((i) =>
      i.versions.some((v) => v.job_id !== scope.job_id || v.invoice_id !== i.id),
    )
  )
    return { ...unavailable("Billing scope could not be verified."), originals: noOriginals };
  const findings: Finding[] = [];
  const add = (
    code: string,
    ids: string[],
    message: string,
    amount?: bigint,
    severity: Finding["severity"] = "attention",
  ) => {
    findings.push({
      code,
      record_ids: ids,
      message,
      severity,
      ...(amount === undefined ? {} : { amount_cents: amount.toString() }),
    });
  };
  duplicates(
    b.invoices,
    (r) => norm(r.document_number),
    (r) => r.id,
    "duplicate_invoice_reference",
    findings,
  );
  duplicates(
    b.receipts,
    (r) => norm(r.source),
    (r) => r.id,
    "duplicate_receipt_reference",
    findings,
  );
  for (const rows of [b.invoices, b.receipts, b.allocations, b.receipt_reversals])
    duplicates<{ id: string }>(
      rows,
      (r) => r.id,
      (r) => r.id,
      "duplicate_identifier",
      findings,
    );
  // Duplicate IDs are ambiguous evidence; do not calculate with them.
  if (findings.some((f) => f.code === "duplicate_identifier"))
    return {
      coverage: { state: "unavailable", reason: "Repeated identifiers make balances ambiguous." },
      findings,
      originals: noOriginals,
    };
  const invoices = new Map(b.invoices.map((i) => [i.id, i]));
  const receipts = new Map(b.receipts.map((r) => [r.id, r]));
  const allocations = new Map(b.allocations.map((a) => [a.id, a]));
  const current = (i: (typeof b.invoices)[number]) =>
    [...i.versions].sort((a, c) => c.version - a.version)[0];
  let broken = false;
  for (const i of b.invoices) {
    const versions = [...i.versions].sort((a, c) => a.version - c.version);
    if (versions.some((v, n) => v.version !== n + 1 || (v.version > 1 && !v.reason?.trim()))) {
      add(
        "invoice_correction_lineage",
        [i.id],
        "Invoice version history or correction reason is incomplete.",
      );
      broken = true;
    }
    if (
      (i.kind === "credit") !== (i.credit_for !== null) ||
      (i.credit_for &&
        (!invoices.has(i.credit_for) || invoices.get(i.credit_for)?.kind === "credit"))
    ) {
      add("credit_target_gap", [i.id], "Credit does not identify an available non-credit invoice.");
      broken = true;
    }
    if (!current(i).source.trim())
      add("source_reference_gap", [i.id], "Current invoice version has no source reference.");
  }
  for (const a of b.allocations) {
    const target = a.reversal_of ? allocations.get(a.reversal_of) : null;
    if (
      !receipts.has(a.receipt_id) ||
      !invoices.has(a.invoice_id) ||
      invoices.get(a.invoice_id)?.kind === "credit" ||
      (a.reversal_of &&
        (!target ||
          target.reversal_of ||
          target.invoice_id !== a.invoice_id ||
          target.receipt_id !== a.receipt_id))
    ) {
      add(
        "allocation_lineage_gap",
        [a.id],
        "Allocation or reversal target is unavailable or inconsistent.",
      );
      broken = true;
    }
    if (a.amount_cents === 0) {
      add("invalid_allocation_amount", [a.id], "Allocation evidence must be positive.");
      broken = true;
    }
    if (!a.source.trim())
      add("source_reference_gap", [a.id], "Allocation has no source reference.");
  }
  for (const a of b.allocations.filter((a) => !a.reversal_of)) {
    const reversed = sum(
      b.allocations.filter((r) => r.reversal_of === a.id).map((r) => r.amount_cents),
    );
    if (reversed > BigInt(a.amount_cents)) {
      add(
        "allocation_over_reversed",
        [a.id],
        "Reversal evidence exceeds the original allocation.",
        reversed - BigInt(a.amount_cents),
      );
      broken = true;
    }
  }
  for (const r of b.receipt_reversals) {
    if (!receipts.has(r.receipt_id) || r.amount_cents === 0) {
      add(
        "receipt_reversal_lineage_gap",
        [r.id],
        "Receipt reversal lacks valid positive evidence and an available receipt.",
      );
      broken = true;
    }
    if (!r.source.trim())
      add("source_reference_gap", [r.id], "Receipt reversal has no source reference.");
  }
  const netAllocated = (rows: typeof b.allocations) =>
    rows.reduce((n, a) => n + (a.reversal_of ? -1n : 1n) * BigInt(a.amount_cents), 0n);
  // A broken lineage makes every related balance unsafe. Surface evidence gaps, not invented totals.
  if (!broken) {
    for (const i of b.invoices.filter((i) => i.kind !== "credit")) {
      const v = current(i);
      const cash = netAllocated(b.allocations.filter((a) => a.invoice_id === i.id));
      const credits = sum(
        b.invoices
          .filter(
            (c) => c.kind === "credit" && c.credit_for === i.id && current(c).status === "posted",
          )
          .map((c) => current(c).net_due_cents),
      );
      const active = ["submitted", "certified"].includes(v.status);
      if (!active && (cash !== 0n || credits !== 0n))
        add(
          "inactive_invoice_applied",
          [i.id],
          "Draft or void invoice still has active allocation or posted credit evidence.",
        );
      if (!active) continue;
      const remaining = BigInt(v.net_due_cents) - cash - credits;
      if (remaining < 0n)
        add(
          "invoice_over_allocated",
          [i.id],
          "Cash allocations and posted credits exceed current invoice net due.",
          -remaining,
        );
      if (remaining > 0n)
        add(
          "invoice_unmatched",
          [i.id],
          "Recorded invoice balance remains unmatched; this alone does not mean it is overdue.",
          remaining,
          "review",
        );
    }
    for (const r of b.receipts) {
      const reversed = sum(
        b.receipt_reversals.filter((x) => x.receipt_id === r.id).map((x) => x.amount_cents),
      );
      const remaining =
        BigInt(r.amount_cents) -
        reversed -
        netAllocated(b.allocations.filter((a) => a.receipt_id === r.id));
      if (reversed > BigInt(r.amount_cents))
        add(
          "receipt_over_reversed",
          [r.id],
          "Receipt reversals exceed the recorded receipt.",
          reversed - BigInt(r.amount_cents),
        );
      if (remaining < 0n)
        add(
          "receipt_over_allocated",
          [r.id],
          "Allocations and reversals exceed the recorded receipt.",
          -remaining,
        );
      if (remaining > 0n)
        add(
          "receipt_unapplied",
          [r.id],
          "Recorded receipt has an unapplied amount.",
          remaining,
          "review",
        );
      if (!r.source.trim()) add("source_reference_gap", [r.id], "Receipt has no source reference.");
    }
  }
  const docs = documentsSchema.safeParse(originals);
  let documentCoverage = noOriginals;
  if (
    docs.success &&
    !docs.data.documents.some(
      (d) => d.job_id !== scope.job_id || d.company_id !== scope.company_id,
    ) &&
    !docs.data.links.some((l) => l.job_id !== scope.job_id)
  ) {
    documentCoverage = {
      state: "checked",
      reason:
        "Stored original associations only; file contents and authenticity were not verified.",
    };
    const available = new Set(docs.data.documents.map((d) => d.id));
    const valid = docs.data.links.filter(
      (l) =>
        available.has(l.document_id) &&
        ((l.invoice_id !== null &&
          l.invoice_version !== null &&
          l.receipt_id === null &&
          invoices.get(l.invoice_id)?.versions.some((v) => v.version === l.invoice_version)) ||
          (l.receipt_id !== null &&
            l.invoice_id === null &&
            l.invoice_version === null &&
            receipts.has(l.receipt_id))),
    );
    if (valid.length !== docs.data.links.length)
      add(
        "document_link_target_gap",
        [],
        "Some stored original associations have unavailable or inconsistent targets.",
      );
    for (const i of b.invoices)
      if (!valid.some((l) => l.invoice_id === i.id && l.invoice_version === current(i).version)) {
        add(
          "invoice_original_gap",
          [i.id],
          "Current invoice version has no linked original; a source reference alone is not a stored document.",
          undefined,
          "review",
        );
        findings[findings.length - 1].invoice_version = current(i).version;
      }
    for (const r of b.receipts)
      if (!valid.some((l) => l.receipt_id === r.id))
        add("receipt_original_gap", [r.id], "Receipt has no linked original.", undefined, "review");
    for (const d of docs.data.documents)
      if (!valid.some((l) => l.document_id === d.id))
        add(
          "unlinked_original",
          [d.id],
          "Stored original has no valid financial record association.",
          undefined,
          "review",
        );
  }
  return {
    coverage: {
      state: broken ? "unavailable" : "checked",
      reason: broken
        ? "Balance checks withheld because correction or allocation lineage is incomplete."
        : "Recorded project evidence only; missing history, bank settlement and actual refunds remain unknown.",
    },
    findings,
    originals: documentCoverage,
  };
}
