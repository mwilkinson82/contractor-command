/**
 * Local domain foundation only. Not wired to an MCP tool or durable store.
 * A caller MUST authorize every affected job and persist each operation atomically.
 */
export type CostKind = "supplier_bill" | "company_paid_expense" | "reimbursable_expense";
export type CostStatus = "submitted" | "approved" | "posted";
export type Allocation = { jobId: string; costCode: string; amountCents: number };
export type CostFacts = {
  kind: CostKind;
  description: string;
  incurredOn: string;
  amountCents: number;
  allocations: Allocation[];
  /** A human-supplied reference, not proof that an original is stored. */
  documentReference?: string;
  counterpartyName: string;
  /** Opaque integration references; ownership/existence is not verified here. */
  counterpartyId?: string;
  purchaseOrderId?: string;
  original: "missing";
};
export type Version = {
  version: number;
  status: CostStatus;
  facts: CostFacts;
  actor: string;
  reason?: string;
};
export type CostRecord = {
  id: string;
  companyId: string;
  versions: Version[];
  postedVersion?: number;
};
export type PaymentEvidence = {
  id: string;
  recordId: string;
  amountCents: number;
  paidOn: string;
  reference: string;
  actor: string;
};
export type Operation = { requestId: string; actor: string; signature: string; result: Result };
export type Ledger = {
  records: CostRecord[];
  payments: PaymentEvidence[];
  operations: Operation[];
};
export type Result = {
  recordId: string;
  version?: number;
  paymentId?: string;
  alreadyApplied: boolean;
};
export type Access = {
  companyId: string;
  actor: string;
  canAccessFullJob: (jobId: string) => boolean;
};
export type Command =
  | { type: "submit"; id: string; facts: CostFacts }
  | { type: "correct"; id: string; expectedVersion: number; facts: CostFacts; reason: string }
  | { type: "approve" | "post"; id: string; expectedVersion: number }
  | {
      type: "payment";
      id: string;
      paymentId: string;
      amountCents: number;
      paidOn: string;
      reference: string;
    };

const MAX = 9_000_000_000_000;
const norm = (s: string) => s.trim().toLocaleLowerCase("en-US");
const nonblank = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0 && s.length <= 200;
function money(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && n <= MAX;
}
function date(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function checkFacts(f: CostFacts, access: Access) {
  demand(
    ["supplier_bill", "company_paid_expense", "reimbursable_expense"].includes(f.kind),
    "Invalid cost kind.",
  );
  demand(
    nonblank(f.description) && nonblank(f.counterpartyName),
    "Description and counterparty are required.",
  );
  demand(
    date(f.incurredOn) && money(f.amountCents),
    "Valid date and positive integer cents are required.",
  );
  demand(f.original === "missing", "Original attachment storage is not available.");
  demand(
    f.documentReference === undefined || nonblank(f.documentReference),
    "Invalid document reference.",
  );
  demand(
    f.counterpartyId === undefined || nonblank(f.counterpartyId),
    "Invalid counterparty reference.",
  );
  demand(
    f.purchaseOrderId === undefined || (f.kind === "supplier_bill" && nonblank(f.purchaseOrderId)),
    "PO references apply only to supplier bills.",
  );
  demand(
    Array.isArray(f.allocations) && f.allocations.length > 0 && f.allocations.length <= 100,
    "At least one allocation is required.",
  );
  let total = 0;
  const pairs = new Set<string>();
  for (const a of f.allocations) {
    demand(
      nonblank(a.jobId) && nonblank(a.costCode) && money(a.amountCents),
      "Each allocation needs a job, cost code and positive integer cents.",
    );
    demand(access.canAccessFullJob(a.jobId), "Full access to every allocated job is required.");
    const pair = canonical([a.jobId, norm(a.costCode)]);
    demand(!pairs.has(pair), "Duplicate job and cost code allocation.");
    pairs.add(pair);
    total += a.amountCents;
    demand(
      Number.isSafeInteger(total) && total <= MAX,
      "Allocation total exceeds the allowed amount.",
    );
  }
  demand(total === f.amountCents, "Allocations must equal the cost amount exactly.");
}
function checkRecordAccess(record: CostRecord, access: Access) {
  demand(record.companyId === access.companyId, "Cost record unavailable.");
  for (const v of record.versions)
    for (const a of v.facts.allocations)
      demand(access.canAccessFullJob(a.jobId), "Cost record unavailable.");
}
function checkDuplicate(ledger: Ledger, companyId: string, id: string, f: CostFacts) {
  if (!f.documentReference) return;
  // Compare all historical references, even after correction, to avoid re-entering an original.
  const duplicate = ledger.records.some(
    (r) =>
      r.companyId === companyId &&
      r.id !== id &&
      r.versions.some(
        (v) =>
          v.facts.kind === f.kind &&
          norm(v.facts.counterpartyName) === norm(f.counterpartyName) &&
          v.facts.documentReference &&
          norm(v.facts.documentReference) === norm(f.documentReference!),
      ),
  );
  demand(!duplicate, "A record with this counterparty and document reference already exists.");
}
/** Pure operation; the production adapter must lock the company and commit ledger plus operation together. */
export function applyCostCommand(
  input: Ledger,
  access: Access,
  requestId: string,
  command: Command,
): { ledger: Ledger; result: Result } {
  demand(
    nonblank(access.companyId) && nonblank(access.actor) && nonblank(requestId),
    "Company, actor and request ID are required.",
  );
  const signature = canonical(command);
  const prior = input.operations.find((o) => o.requestId === requestId);
  if (prior) {
    demand(
      prior.actor === access.actor && prior.signature === signature,
      "Request ID belongs to different content or actor.",
    );
    const existing = input.records.find((r) => r.id === prior.result.recordId);
    demand(existing, "Cost record unavailable.");
    checkRecordAccess(existing, access);
    return { ledger: input, result: { ...prior.result, alreadyApplied: true } };
  }
  const ledger = structuredClone(input);
  let record = ledger.records.find((r) => r.id === command.id);
  let result: Result;
  if (command.type === "submit") {
    demand(nonblank(command.id) && !record, "Record ID already exists or is invalid.");
    checkFacts(command.facts, access);
    checkDuplicate(ledger, access.companyId, command.id, command.facts);
    record = {
      id: command.id,
      companyId: access.companyId,
      versions: [
        {
          version: 1,
          status: "submitted",
          facts: structuredClone(command.facts),
          actor: access.actor,
        },
      ],
    };
    ledger.records.push(record);
    result = { recordId: record.id, version: 1, alreadyApplied: false };
  } else {
    demand(record, "Cost record unavailable.");
    checkRecordAccess(record, access);
    const current = record.versions.at(-1)!;
    if (command.type === "payment") {
      const posted = record.versions.find((v) => v.version === record!.postedVersion);
      demand(
        posted && posted.facts.kind !== "company_paid_expense",
        "No posted payable or reimbursement is available.",
      );
      demand(
        nonblank(command.paymentId) && !ledger.payments.some((p) => p.id === command.paymentId),
        "Payment evidence ID already exists or is invalid.",
      );
      demand(
        nonblank(command.reference) && money(command.amountCents) && date(command.paidOn),
        "Payment needs a reference, date and positive amount.",
      );
      demand(
        !ledger.payments.some(
          (p) => p.recordId === record!.id && norm(p.reference) === norm(command.reference),
        ),
        "Payment reference already recorded.",
      );
      const paid = ledger.payments
        .filter((p) => p.recordId === record!.id)
        .reduce((sum, p) => sum + p.amountCents, 0);
      demand(
        command.amountCents <= posted.facts.amountCents - paid,
        "Payment exceeds the recorded payable.",
      );
      ledger.payments.push({
        id: command.paymentId,
        recordId: record.id,
        amountCents: command.amountCents,
        paidOn: command.paidOn,
        reference: command.reference.trim(),
        actor: access.actor,
      });
      result = { recordId: record.id, paymentId: command.paymentId, alreadyApplied: false };
    } else {
      demand(command.expectedVersion === current.version, "Cost version changed; read it again.");
      if (command.type === "correct") {
        demand(nonblank(command.reason), "A correction reason is required.");
        checkFacts(command.facts, access);
        demand(
          command.facts.kind === current.facts.kind,
          "Cost kind cannot change in a correction.",
        );
        checkDuplicate(ledger, access.companyId, command.id, command.facts);
        record.versions.push({
          version: current.version + 1,
          status: "submitted",
          facts: structuredClone(command.facts),
          actor: access.actor,
          reason: command.reason.trim(),
        });
      } else if (command.type === "approve") {
        demand(current.status === "submitted", "Only submitted costs may be approved.");
        record.versions.push({
          ...structuredClone(current),
          version: current.version + 1,
          status: "approved",
          actor: access.actor,
        });
      } else {
        demand(current.status === "approved", "Approval is required before accounting posting.");
        const paid = ledger.payments
          .filter((p) => p.recordId === record!.id)
          .reduce((sum, p) => sum + p.amountCents, 0);
        demand(
          current.facts.amountCents >= paid,
          "Corrected cost cannot be posted below recorded payments.",
        );
        const previousPosting = record.versions.find((v) => v.version === record!.postedVersion);
        if (paid && previousPosting) {
          demand(
            norm(current.facts.counterpartyName) === norm(previousPosting.facts.counterpartyName) &&
              current.facts.counterpartyId === previousPosting.facts.counterpartyId,
            "Resolve recorded payments before changing the payee.",
          );
        }
        record.versions.push({
          ...structuredClone(current),
          version: current.version + 1,
          status: "posted",
          actor: access.actor,
        });
        record.postedVersion = current.version + 1;
      }
      result = {
        recordId: record.id,
        version: record.versions.at(-1)!.version,
        alreadyApplied: false,
      };
    }
  }
  ledger.operations.push({ requestId, actor: access.actor, signature, result });
  return { ledger, result };
}
/** Posted costs only; payments are evidence of settlement, never another cost. */
export function postedCosts(ledger: Ledger, access: Access, jobId: string): Allocation[] {
  demand(access.canAccessFullJob(jobId), "Full access to this job is required.");
  return ledger.records
    .filter(
      (r) =>
        r.companyId === access.companyId &&
        r.postedVersion !== undefined &&
        r.versions
          .find((v) => v.version === r.postedVersion)
          ?.facts.allocations.some((a) => a.jobId === jobId),
    )
    .flatMap((r) => {
      // A split record cannot be revealed to someone without access to all affected jobs.
      checkRecordAccess(r, access);
      return r.versions
        .find((v) => v.version === r.postedVersion)!
        .facts.allocations.filter((a) => a.jobId === jobId);
    });
}
/** Ask for only missing data; no PO or subcontract is required for an ad hoc expense. */
export function missingCostFacts(f: Partial<CostFacts>): string[] {
  const missing: string[] = [];
  if (!f.kind) missing.push("bill or expense type and who paid");
  if (!f.description) missing.push("description");
  if (!f.counterpartyName) missing.push("supplier or payee");
  if (!f.incurredOn) missing.push("date");
  if (f.amountCents === undefined) missing.push("amount");
  if (!f.allocations?.length) missing.push("job and cost code allocation");
  if (!f.original) missing.push("original attachment status");
  return missing;
}
