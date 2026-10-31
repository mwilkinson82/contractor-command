import { z } from "zod";
import { REPORT_TYPES, type ReportType } from "./accounting-readable";
import { accountingDate, validateAccountingDates } from "./accounting-report";

export const recordKind = z.enum([
  "invoice",
  "credit",
  "receipt",
  "allocation",
  "payable",
  "payment",
]);
export const accountingTarget = z
  .object({
    kind: recordKind,
    id: z.string().uuid(),
    version: z.number().int().positive().max(999999999).optional(),
    payableId: z.string().uuid().optional(),
  })
  .superRefine((t, ctx) => {
    if (t.version !== undefined && !["invoice", "credit", "payable"].includes(t.kind))
      ctx.addIssue({ code: "custom", message: "This record has no document version." });
    if ((t.kind === "payment") !== (t.payableId !== undefined))
      ctx.addIssue({ code: "custom", message: "Payment requires its original payable identity." });
  });
export type AccountingTarget = z.infer<typeof accountingTarget>;
export type RecordLink = { label: string; url: string; target: AccountingTarget };
export function accountingRecordUrl(
  job: string,
  input: AccountingTarget,
  dates: { from?: string; as_of?: string } = {},
) {
  z.string().uuid().parse(job);
  const t = accountingTarget.parse(input);
  const q = new URLSearchParams({ record_kind: t.kind, record_id: t.id });
  if (t.version !== undefined) q.set("version", String(t.version));
  if (t.payableId) q.set("payable_id", t.payableId);
  for (const [k, v] of Object.entries(dates)) if (v) q.set(k, accountingDate.parse(v));
  return `https://app.meetathena.io/r/job/${job}/accounting?${q}`;
}
export function accountingTargetFromSearch(search: Record<string, unknown>) {
  if (!["record_kind", "record_id", "version", "payable_id"].some((k) => search[k] !== undefined))
    return null;
  // Invalid or incomplete targets must stay targeted errors, never become a generic report.
  const v = search.version;
  return accountingTarget.parse({
    kind: search.record_kind,
    id: search.record_id,
    ...(v !== undefined
      ? { version: typeof v === "string" && /^[1-9]\d{0,8}$/.test(v) ? Number(v) : NaN }
      : {}),
    ...(search.payable_id !== undefined ? { payableId: search.payable_id } : {}),
  });
}
export function recordLink(job: string, label: string, target: AccountingTarget): RecordLink {
  return { label, target, url: accountingRecordUrl(job, target) };
}
type BillingLinksSource = {
  invoices: Array<{
    id: string;
    kind: string;
    document_number: string;
    versions: Array<{ version: number }>;
  }>;
  receipts: Array<{ id: string; source: string }>;
  allocations: Array<{ id: string }>;
};
export function billingRecordLinks(job: string, source: BillingLinksSource): RecordLink[] {
  const safe = (label: string, target: AccountingTarget): RecordLink[] =>
    accountingTarget.safeParse(target).success ? [recordLink(job, label, target)] : [];
  return [
    ...source.invoices.flatMap((i) =>
      i.versions.flatMap((v) =>
        safe(`${i.document_number} · v${v.version}`, {
          kind: i.kind === "credit" ? "credit" : "invoice",
          id: i.id,
          version: v.version,
        }),
      ),
    ),
    ...source.receipts.flatMap((r) => safe(r.source || "Receipt", { kind: "receipt", id: r.id })),
    ...source.allocations.flatMap((a) =>
      safe("Receipt allocation", { kind: "allocation", id: a.id }),
    ),
  ];
}
export function costRecordLinks(job: string, input: unknown): RecordLink[] {
  const schema = z.array(
    z.object({
      id: z.string().uuid(),
      versions: z.array(
        z.object({
          version: z.number().int().positive(),
          facts: z.object({
            document_reference: z.string().nullable().optional(),
            description: z.string().optional(),
          }),
        }),
      ),
      payments: z.array(z.object({ id: z.string().uuid(), reference: z.string() })).optional(),
    }),
  );
  const records = schema.safeParse(input);
  if (!records.success) return [];
  return records.data.flatMap((r) => [
    ...r.versions.map((v) =>
      recordLink(
        job,
        `${v.facts.document_reference || v.facts.description || "Cost record"} · v${v.version}`,
        { kind: "payable", id: r.id, version: v.version },
      ),
    ),
    ...(r.payments ?? []).map((p) =>
      recordLink(job, `Recorded payment ${p.reference}`, {
        kind: "payment",
        id: p.id,
        payableId: r.id,
      }),
    ),
  ]);
}
export function accountingReportUrl(
  job: string,
  type: ReportType = "summary",
  dates: { from?: string; as_of?: string } = {},
) {
  z.string().uuid().parse(job);
  if (!Object.hasOwn(REPORT_TYPES, type)) throw new Error("Unknown report mode.");
  const q = new URLSearchParams({ report_type: type });
  for (const [k, v] of Object.entries(dates)) if (v) q.set(k, accountingDate.parse(v));
  return `https://app.meetathena.io/r/job/${job}/accounting?${q}`;
}
export function ledgerRecordUrl(
  job: string,
  row: { id: string; kind: string; version: number | null },
  dates: { from?: string; as_of?: string } = {},
): string | null {
  const [prefix, id] = row.id.split(":");
  if (!z.string().uuid().safeParse(id).success) return null;
  if (prefix === "invoice")
    return accountingRecordUrl(
      job,
      {
        kind: row.kind === "credit" ? "credit" : "invoice",
        id,
        ...(row.version ? { version: row.version } : {}),
      },
      dates,
    );
  if (prefix === "receipt" || prefix === "allocation")
    return accountingRecordUrl(job, { kind: prefix, id }, dates);
  return null;
}

export function accountingModeLocation(current: string, mode: ReportType) {
  if (!Object.hasOwn(REPORT_TYPES, mode)) throw new Error("Unknown report mode.");
  const url = new URL(current);
  url.searchParams.set("report_type", mode);
  for (const key of [
    "ledger_page",
    "currency",
    "vendor",
    "cost_code",
    "record_kind",
    "record_id",
    "version",
    "payable_id",
  ])
    url.searchParams.delete(key);
  url.hash = "";
  return url.pathname + url.search;
}

export function accountingContextDates(search: Record<string, unknown>) {
  const from = search.from === undefined ? undefined : accountingDate.parse(search.from);
  const as_of = search.as_of === undefined ? undefined : accountingDate.parse(search.as_of);
  validateAccountingDates(
    { from, asOf: as_of ?? new Date().toISOString().slice(0, 10) },
    new Date().toISOString().slice(0, 10),
  );
  return { from, as_of };
}
