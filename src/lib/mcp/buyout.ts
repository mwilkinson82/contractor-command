import { z } from "zod";
import { extendedCents, sumCents } from "../accounting-report";

const label = z.string().trim().min(1).max(2000);
const date = z.iso.date();
const cents = z.number().int().min(0).max(9e12).nullable();
const contact = z
  .object({
    name: label,
    email: z.email().nullable(),
    phone: label.nullable(),
    role: label,
    authority: label.nullable(),
    source: label,
    verified_on: date.nullable(),
  })
  .strict();
export const directoryFacts = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["supplier", "subcontractor", "both"]),
    trade: label.nullable(),
    contacts: z.array(contact).max(30),
    source: label,
    verified_on: date.nullable(),
    status: z.enum(["active", "inactive"]),
  })
  .strict();
export const linkFacts = z
  .object({
    directory_id: z.uuid(),
    directory_version: z.number().int().positive(),
    party_id: z.uuid(),
    party_version: z.number().int().positive(),
    source: label,
  })
  .strict();
const candidate = z
  .object({
    party_id: z.uuid(),
    party_version: z.number().int().positive(),
    quote_cents: cents,
    scope: label,
    exclusions: label.nullable(),
    source: label,
    quoted_on: date.nullable(),
    expected_delivery_on: date.nullable(),
  })
  .strict();
export const packageFacts = z
  .object({
    code: z.string().trim().min(1).max(120),
    title: label,
    scope: label,
    budget_cents: cents,
    currency: z.literal("USD"),
    status: z.enum(["draft", "reviewed", "selected", "cancelled"]),
    candidates: z.array(candidate).max(50),
    selected_party_id: z.uuid().nullable(),
    commitment_refs: z
      .array(z.object({ po_id: z.uuid(), version: z.number().int().positive() }).strict())
      .max(50),
    expected_award_on: date.nullable(),
    needed_by: date.nullable(),
    submittal_ids: z.array(z.uuid()).max(50),
    schedule_ref: z
      .object({ report_version: z.number().int().positive(), activity_id: label })
      .strict()
      .nullable(),
    source: label,
  })
  .strict();
const requirement = z
  .object({
    key: z.string().trim().min(1).max(120),
    label,
    kind: z.enum(["agreement", "insurance", "waiver", "other"]),
    applicability: z.enum(["required", "not_applicable", "unknown"]),
    source: label,
    jurisdiction: label.nullable(),
    due_on: date.nullable(),
    document_id: z.uuid().nullable(),
    document_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    effective_on: date.nullable(),
    expires_on: date.nullable(),
    review: z.enum(["pending", "evidence_checked", "exception"]),
    review_note: label.nullable(),
    exception_expires_on: date.nullable(),
    bill_id: z.uuid().nullable(),
    bill_version: z.number().int().positive().nullable(),
  })
  .strict();
export const readinessFacts = z
  .object({
    party_id: z.uuid(),
    party_version: z.number().int().positive(),
    requirements: z.array(requirement).max(50),
    source: label,
  })
  .strict();
export const buyoutFacts = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("directory"), data: directoryFacts }).strict(),
  z.object({ kind: z.literal("party_link"), data: linkFacts }).strict(),
  z.object({ kind: z.literal("package"), data: packageFacts }).strict(),
  z.object({ kind: z.literal("readiness"), data: readinessFacts }).strict(),
]);
export type PackageFacts = z.infer<typeof packageFacts>;
export type ReadinessFacts = z.infer<typeof readinessFacts>;
export type BuyoutRecord = {
  id: string;
  kind: "directory" | "party_link" | "package" | "readiness";
  version: number;
  facts: unknown;
  versions: Array<{
    version: number;
    facts: unknown;
    reason: string;
    recorded_at: string;
    recorded_by: string;
  }>;
};
export type Po = {
  id: string;
  party_id: string;
  number: string;
  versions: Array<{
    version: number;
    status: string;
    lines: Array<{ quantity: number; unit_price_cents: number }>;
  }>;
};
export type BuyoutLedger = {
  company_id: string;
  company_name?: string;
  job_number?: string | null;
  job_name?: string | null;
  job_id: string | null;
  today: string;
  records: BuyoutRecord[];
  parties: Array<{ id: string; version: number; name: string }>;
  orders: Po[];
  documents: Array<{ id: string; filename: string; sha256: string }>;
  submittals: Array<{ id: string; number: string; revision: number }>;
  bills: Array<{ id: string; version: number; label: string; party_id: string | null }>;
  schedule_activities: Array<{ activity_id: string; label: string; report_version: number }>;
  can_manage_directory: boolean;
  can_record: boolean;
};

export function readinessChecks(facts: ReadinessFacts, today: string, ledger?: BuyoutLedger) {
  if (!facts.requirements.length)
    return [
      {
        key: "requirements",
        state: "unknown",
        message: "Payment requirements have not been recorded.",
      },
    ];
  return facts.requirements.map((r) => {
    const result = (state: string, message: string) => ({ key: r.key, state, message });
    if (
      r.bill_id &&
      ledger &&
      Math.max(...ledger.bills.filter((b) => b.id === r.bill_id).map((b) => b.version), 0) !==
        r.bill_version
    )
      return result(
        "blocked",
        `${r.label}: supplier bill changed or is unavailable; review the current bill version.`,
      );
    if (r.applicability === "unknown")
      return result("unknown", `${r.label}: applicability needs review against the source.`);
    if (r.applicability === "not_applicable")
      return result("not_applicable", `${r.label}: recorded not applicable; source retained.`);
    if (r.review === "exception") {
      if (!r.exception_expires_on || r.exception_expires_on < today)
        return result("blocked", `${r.label}: owner exception expired or has no expiry.`);
      return result(
        "exception",
        `${r.label}: owner exception through ${r.exception_expires_on}; requirement remains unmet.`,
      );
    }
    if (!r.document_id || !r.document_sha256)
      return result("blocked", `${r.label}: original missing.`);
    if (r.review !== "evidence_checked")
      return result("blocked", `${r.label}: original awaits evidence review.`);
    if (r.effective_on && r.effective_on > today)
      return result("blocked", `${r.label}: evidence is not effective until ${r.effective_on}.`);
    if (r.expires_on && r.expires_on < today)
      return result("blocked", `${r.label}: expired ${r.expires_on}.`);
    if (r.kind === "insurance" && (!r.effective_on || !r.expires_on))
      return result("unknown", `${r.label}: insurance dates missing.`);
    if (r.kind === "waiver" && (!r.bill_id || !r.bill_version))
      return result("unknown", `${r.label}: waiver payment/bill context missing.`);
    return result(
      "evidence_checked",
      `${r.label}: evidence checked; no coverage or legal certification implied.`,
    );
  });
}

/** v1 read-only projection. PO amounts are sourced once, never added to posted costs. */
export function buyoutProjection(ledger: BuyoutLedger) {
  const packages = ledger.records
    .filter((r) => r.kind === "package")
    .map((record) => {
      const facts = packageFacts.parse(record.facts);
      const sources = facts.commitment_refs.map((ref) => {
        const po = ledger.orders.find((p) => p.id === ref.po_id),
          v = po?.versions.find((v) => v.version === ref.version);
        const current = po?.versions.find((v) => v.status === "approved")?.version === ref.version;
        const approved = v?.status === "approved";
        const amount =
          v && approved && current
            ? sumCents(v.lines.map((l) => extendedCents(l.quantity, l.unit_price_cents)))
            : null;
        return {
          po_id: ref.po_id,
          version: ref.version,
          number: po?.number ?? null,
          party_id: po?.party_id ?? null,
          amount_cents: amount,
          current,
          internally_approved: approved,
          pending_revision:
            po?.versions[0]?.version !== po?.versions.find((v) => v.status === "approved")?.version,
        };
      });
      const committed = sources.length ? sumCents(sources.map((s) => s.amount_cents)) : 0;
      const remaining =
        facts.budget_cents === null || committed === null
          ? null
          : Math.max(0, facts.budget_cents - committed);
      const checks = facts.selected_party_id
        ? ledger.records
            .filter(
              (r) =>
                r.kind === "readiness" &&
                readinessFacts.parse(r.facts).party_id === facts.selected_party_id,
            )
            .flatMap((r) => readinessChecks(readinessFacts.parse(r.facts), ledger.today, ledger))
        : [];
      if (facts.selected_party_id && !checks.length)
        checks.push({
          key: "requirements",
          state: "unknown",
          message: "Payment requirements have not been recorded.",
        });
      if (facts.selected_party_id && !sources.length)
        checks.push({
          key: "commitment",
          state: "unknown",
          message:
            "No approved commitment is linked; confirm the applicable agreement or PO before payment review.",
        });
      const blockers = checks.filter((c) => ["unknown", "blocked", "exception"].includes(c.state));
      return {
        id: record.id,
        version: record.version,
        code: facts.code,
        title: facts.title,
        status: facts.status,
        currency: facts.currency,
        budget_cents: facts.budget_cents,
        committed_cents: committed,
        uncommitted_exposure_cents: remaining,
        over_budget_cents:
          facts.budget_cents === null || committed === null
            ? null
            : Math.max(0, committed - facts.budget_cents),
        commitment_sources: sources,
        readiness: blockers.length
          ? "review_required"
          : checks.length
            ? "evidence_checked"
            : "unknown",
        blockers,
        selected_party_id: facts.selected_party_id,
        selected_party_version:
          facts.candidates.find((c) => c.party_id === facts.selected_party_id)?.party_version ??
          null,
        expected_delivery_on:
          facts.candidates.find((c) => c.party_id === facts.selected_party_id)
            ?.expected_delivery_on ?? null,
        expected_award_on: facts.expected_award_on,
        needed_by: facts.needed_by,
        schedule_ref: facts.schedule_ref,
        submittal_ids: facts.submittal_ids,
        source_url: `https://app.meetathena.io/r/job/${ledger.job_id}/buyout#${record.id}`,
        cancelled: facts.status === "cancelled",
      };
    });
  const canonicalCommitments = ledger.orders
    .filter((p) => p.versions.some((v) => v.status === "approved"))
    .map((p) => {
      const current = p.versions.find((v) => v.status === "approved")!;
      const linked = packages.find((pkg) => pkg.commitment_sources.some((s) => s.po_id === p.id));
      return {
        po_id: p.id,
        version: current.version,
        number: p.number,
        party_id: p.party_id,
        amount_cents: sumCents(
          current.lines.map((l) => extendedCents(l.quantity, l.unit_price_cents)),
        ),
        package_id: linked?.id ?? null,
        package_cancelled: linked?.cancelled ?? false,
        pending_revision: p.versions[0]?.version !== current.version,
      };
    });
  return {
    contract_version: 1,
    company_id: ledger.company_id,
    job_id: ledger.job_id,
    as_of: ledger.today,
    packages,
    totals_include_cancelled: false,
    canonical_commitments: canonicalCommitments,
    canonical_committed_cents: sumCents(canonicalCommitments.map((c) => c.amount_cents)),
    cancellation_effect: "package_cancellation_does_not_cancel_a_PO_or_release_commitments",
    financial_effect: "read_only_no_posting_no_money_movement",
  };
}
export function buyoutSteps(ledger: BuyoutLedger) {
  const packages = ledger.records.filter((r) => r.kind === "package");
  return [
    {
      step: 1,
      title: "Choose a supplier or subcontractor",
      state: ledger.parties.length ? "available" : "missing",
      detail: ledger.parties.length
        ? "Select the exact project party. Company identity linking is owner managed."
        : "Add a project party through the existing supplier/PO workflow.",
    },
    {
      step: 2,
      title: "Compare scope and buyout",
      state: packages.length ? "started" : "missing",
      detail:
        "Record a scope package, budget (unknown stays blank), quotes, exclusions and expected dates.",
    },
    {
      step: 3,
      title: "Record an approved commitment",
      state: ledger.orders.some((p) => p.versions.some((v) => v.status === "approved"))
        ? "available"
        : "missing",
      detail:
        "Use the existing PO workflow for owner approval; link an exact version. Selection does not issue a contract.",
    },
    {
      step: 4,
      title: "Check originals and payment requirements",
      state: ledger.records.some((r) => r.kind === "readiness") ? "started" : "missing",
      detail:
        "Upload agreements, insurance and waivers with the existing document upload. Link their verified IDs and review each supplied requirement.",
    },
    {
      step: 5,
      title: "Continue to submittals and AP review",
      state: "separate_review",
      detail:
        "Document readiness does not approve or post a bill. Review the exact supplier bill and recorded payment separately.",
    },
  ];
}

/** Ordinary text review for every host; no raw JSON or inferred facts. */
export function buyoutReviewText(value: unknown, depth = 0): string {
  if (value === null) return "Unknown";
  if (Array.isArray(value))
    return value.length
      ? value
          .map((v, i) => `${"  ".repeat(depth)}${i + 1}. ${buyoutReviewText(v, depth + 1)}`)
          .join("\n")
      : "None recorded";
  if (typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(
        ([key, v]) =>
          `${"  ".repeat(depth)}${key.replace(/_/g, " ")}: ${key.endsWith("_cents") && typeof v === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v / 100) : buyoutReviewText(v, depth + 1)}`,
      )
      .join("\n");
  return String(value);
}
