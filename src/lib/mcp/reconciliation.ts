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

// Provisional PR351 interface. No writes, posting inference, payee matching or extra cost effects.
const costSchema = z.object({
  records: z.array(
    z.object({
      id,
      kind: z.enum(["supplier_bill", "company_paid_expense", "reimbursable_expense"]),
      versions: z
        .array(
          z.object({
            record_id: id,
            version,
            reason: z.string().nullable(),
            facts: z.object({
              kind: z.string(),
              amount_cents: cents,
              counterparty_name: z.string(),
              document_reference: z.string().nullable().optional(),
              original: z.literal("missing"),
              allocations: z
                .array(z.object({ job_id: id, amount_cents: cents, cost_code: z.string() }))
                .min(1),
            }),
          }),
        )
        .min(1),
      posted_version: version.nullable(),
      approved_versions: z.array(version),
      payments: z.array(
        z.object({
          id,
          record_id: id,
          amount_cents: cents,
          reference: z.string(),
          shared: z.boolean(),
          corrected: z.boolean(),
          correction: z.object({ reason: z.string().min(1) }).nullable(),
        }),
      ),
      active_settlement_cents: cents,
    }),
  ),
  originals_available: z.literal(false),
  posting_available: z.boolean(),
});

export function reconcileCosts(raw: unknown, scope: Scope): Reconciliation {
  const parsed = costSchema.safeParse(raw);
  if (!parsed.success)
    return unavailable(
      "AP settlement coverage is unavailable: the provisional PR351 read contract is absent or unsupported.",
    );
  const findings: Finding[] = [];
  const rows = parsed.data.records;
  // RPC is responsible for company and every affected-job authorization; here reject unrelated rows.
  if (
    rows.some(
      (r) =>
        r.versions.some((v) => v.record_id !== r.id) ||
        !r.versions.some((v) => v.facts.allocations.some((a) => a.job_id === scope.job_id)),
    )
  )
    return unavailable("AP evidence scope could not be verified.");
  duplicates(
    rows,
    (r) => r.id,
    (r) => r.id,
    "duplicate_ap_identifier",
    findings,
  );
  if (findings.length) return { ...unavailable("AP identifiers are ambiguous."), findings };
  duplicates(
    rows,
    (r) => {
      const v = [...r.versions].sort((a, b) => b.version - a.version)[0];
      return v.facts.document_reference
        ? JSON.stringify([
            r.kind,
            norm(v.facts.counterparty_name),
            norm(v.facts.document_reference),
          ])
        : "";
    },
    (r) => r.id,
    "duplicate_ap_reference",
    findings,
  );
  const paymentRefs = new Map<string, Set<string>>();
  const paymentEvidence = new Map<string, (typeof rows)[number]["payments"]>();
  for (const r of rows)
    for (const p of r.payments)
      paymentEvidence.set(p.id, [...(paymentEvidence.get(p.id) ?? []), p]);
  const ambiguousPayments = new Set<string>();
  for (const [key, evidence] of paymentEvidence)
    if (
      evidence.length > 1 &&
      (evidence.some((p) => !p.shared) ||
        new Set(
          evidence.map((p) =>
            JSON.stringify([norm(p.reference), p.corrected, p.correction?.reason]),
          ),
        ).size !== 1)
    ) {
      ambiguousPayments.add(key);
      findings.push({
        code: "ap_payment_identity_gap",
        severity: "attention",
        record_ids: evidence.map((p) => p.record_id),
        message:
          "Repeated payment identity has inconsistent shared-payment or correction evidence; related balances are withheld.",
      });
    }
  for (const r of rows) {
    const add = (
      code: string,
      message: string,
      amount?: bigint,
      severity: Finding["severity"] = "attention",
    ) =>
      findings.push({
        code,
        message,
        severity,
        record_ids: [r.id],
        ...(amount === undefined ? {} : { amount_cents: amount.toString() }),
      });
    const versions = [...r.versions].sort((a, b) => a.version - b.version);
    const posted = versions.find((v) => v.version === r.posted_version);
    const latest = versions[versions.length - 1];
    let valid = !r.payments.some((p) => ambiguousPayments.has(p.id));
    if (
      versions.some(
        (v, n) =>
          v.version !== n + 1 ||
          (v.version > 1 && !v.reason?.trim()) ||
          v.facts.kind !== r.kind ||
          sum(v.facts.allocations.map((a) => a.amount_cents)) !== BigInt(v.facts.amount_cents),
      )
    ) {
      add(
        "ap_version_lineage_gap",
        "AP versions, correction reason or cost allocations are inconsistent.",
      );
      valid = false;
    }
    if (r.posted_version !== null && (!posted || !r.approved_versions.includes(r.posted_version))) {
      add(
        "ap_posting_lineage_gap",
        "Posted cost lacks the corresponding approved immutable version.",
      );
      valid = false;
    }
    if (posted && posted.version < latest.version)
      add(
        "ap_pending_correction",
        "A later unposted correction exists; the earlier posted version remains effective.",
        undefined,
        "review",
      );
    const paymentIds = new Set<string>();
    for (const p of r.payments) {
      if (
        paymentIds.has(p.id) ||
        p.record_id !== r.id ||
        p.corrected !== (p.correction !== null) ||
        p.amount_cents === 0
      ) {
        add(
          "ap_payment_lineage_gap",
          "Payment evidence or its correction lineage is inconsistent.",
        );
        valid = false;
      }
      paymentIds.add(p.id);
      if (!p.corrected) {
        const key = norm(p.reference);
        if (!key) add("ap_payment_reference_gap", "Recorded payment has no reference.");
        else paymentRefs.set(key, new Set([...(paymentRefs.get(key) ?? []), p.id]));
      }
    }
    const paid = sum(r.payments.filter((p) => !p.corrected).map((p) => p.amount_cents));
    if (paid !== BigInt(r.active_settlement_cents)) {
      add(
        "ap_settlement_total_gap",
        "Active recorded settlement disagrees with uncorrected payment evidence.",
      );
      valid = false;
    }
    if (valid && r.kind === "company_paid_expense" && paid > 0n)
      add(
        "ap_expense_has_settlement",
        "Company-paid expense has payable settlement evidence; it should not create a reimbursement payable.",
      );
    else if (valid && r.kind !== "company_paid_expense") {
      if (!posted && paid > 0n)
        add("ap_unposted_settlement", "Recorded payment exists without a posted payable.", paid);
      if (posted) {
        const remaining = BigInt(posted.facts.amount_cents) - paid;
        if (remaining < 0n)
          add(
            "ap_over_settled",
            "Recorded settlement exceeds the effective posted payable.",
            -remaining,
          );
        if (remaining > 0n)
          add(
            "ap_unmatched",
            "Posted payable has an unmatched recorded amount; no bank transfer is verified.",
            remaining,
            "review",
          );
      }
    }
    add(
      "ap_original_gap",
      "AP originals are unavailable in the provisional cost contract.",
      undefined,
      "review",
    );
  }
  for (const ids of paymentRefs.values())
    if (ids.size > 1)
      findings.push({
        code: "duplicate_payment_reference",
        severity: "attention",
        record_ids: [...ids],
        message: "Different recorded payments repeat a reference; review before any correction.",
      });
  return {
    coverage: {
      state: "checked",
      reason:
        "Provisional PR351 visible records only; split records hidden by its all-jobs gate are unknown. Recorded payment is not proof of money transferred. Shared-payment header conservation, PM approval timing, actual refunds and originals are unavailable.",
    },
    findings,
  };
}
