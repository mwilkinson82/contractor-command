// The job board's commercial sections: the estimate, the proposal (including Good, Better,
// Best) and the contracts on a job. Pure functions over the saved reads, so they are tested
// without a database or a browser. The board never saves anything from here.
import { boardSchema, packageTerms, type Board, type OptionName } from "./selections/model";
import { timeLabel } from "./selections/change-terms";
import { extendedCents, sumCents } from "./accounting-report";
import { packageTotals, proposalBlockers } from "./selections/proposal";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() && Number.isFinite(Number(v))
      ? Number(v)
      : null;

export function usd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "Not set";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------- estimate

export type EstimateFile = {
  id: string;
  label: string;
  detail: string;
  path: string | null;
  createdAt: string | null;
};

export type EstimateOverview = {
  started: boolean;
  takeoffVersion: number | null;
  revision: string | null;
  role: string | null;
  trades: string[];
  bidDue: string | null;
  lines: number;
  withQuantity: number;
  missingInput: number;
  excluded: number;
  openQuestions: number;
  holdingBid: number;
  pricedLines: number;
  overheadPct: number | null;
  profitPct: number | null;
  inScope: string[];
  outScope: string[];
  assumptions: string[];
  drawings: string[];
  files: EstimateFile[];
  status: { label: string; tone: StatusTone };
};

export type StatusTone = "ok" | "warn" | "idle" | "info";

const ROLE: Record<string, string> = { gc: "General contractor", self_performer: "Self-perform" };

/**
 * `estimate` is mcp_estimate_get, `bid` is mcp_estimate_bid_get and `exports` is
 * mcp_takeoff_exports. Any of them can be null when the read failed or nothing is saved.
 */
export function estimateOverview(
  estimate: unknown,
  bid: unknown,
  exports: unknown,
): EstimateOverview {
  const e = obj(estimate) ?? {};
  const setup = obj(e.setup);
  const takeoff = obj(e.takeoff);
  const lines = arr(takeoff?.lines).map(obj).filter((l): l is Raw => !!l);
  const gaps = arr(e.gaps).map(obj).filter((g): g is Raw => !!g);
  const verdicts = arr(e.verdicts).map(obj).filter((v): v is Raw => !!v);
  const answered = new Set(
    verdicts.map((v) => str(v.gap_ref)).filter((r): r is string => !!r),
  );
  // A gap check answer settles a gap, except an RFI, which stays open until it's answered.
  const gapAnswer = (g: Raw) => str(obj(g.answer)?.answer);
  const open = gaps.filter((g) => {
    const a = gapAnswer(g);
    if (a) return a === "rfi";
    return !answered.has(String(g.ref ?? ""));
  });
  const b = obj(bid);
  const pricing = obj(b?.pricing);
  const priced = new Set<number>();
  for (const key of ["labor", "material"] as const)
    for (const row of arr(pricing?.[key])) {
      const ref = str(obj(row)?.ref);
      const n = ref && /^T-\d+$/.test(ref) ? Number(ref.slice(2)) : null;
      if (n !== null) priced.add(n);
    }
  const bidRow = obj(b?.bid);
  const docs = arr(setup?.documents)
    .map(obj)
    .map((d) => str(d?.name))
    .filter((d): d is string => !!d);
  const files: EstimateFile[] = arr(exports)
    .map(obj)
    .filter((x): x is Raw => !!x)
    .map((x) => ({
      id: String(x.id ?? ""),
      label: `${str(x.sheet) ?? `Page ${num(x.page) ?? "?"}`} measured takeoff`,
      detail: [str(x.source_filename), dateOnly(str(x.created_at))].filter(Boolean).join(" · "),
      path: str(x.rendered_pdf),
      createdAt: str(x.created_at),
    }))
    .filter((f) => f.id);
  const withQuantity = lines.filter((l) => num(l.qty) !== null).length;
  const missingInput = lines.filter((l) => str(l.missing_input)).length;
  const excluded = lines.filter((l) => str(l.exclusion)).length;
  const started = !!setup || lines.length > 0;
  const holdingBid = open.filter((g) => g.holds_bid === true || g.severity === "hard").length;
  let status: EstimateOverview["status"];
  if (!started) status = { label: "Not started", tone: "idle" };
  else if (lines.length === 0) status = { label: "Set up, no takeoff yet", tone: "warn" };
  else if (missingInput || holdingBid || priced.size < lines.length - excluded)
    status = { label: "In progress", tone: "warn" };
  else status = { label: "Priced", tone: "ok" };
  return {
    started,
    takeoffVersion: num(takeoff?.version),
    revision: str(takeoff?.revision),
    role: setup?.role ? (ROLE[String(setup.role)] ?? null) : null,
    trades: arr(setup?.trades).filter((t): t is string => typeof t === "string"),
    bidDue: str(setup?.bid_due),
    lines: lines.length,
    withQuantity,
    missingInput,
    excluded,
    openQuestions: open.length,
    holdingBid,
    pricedLines: priced.size,
    overheadPct: num(bidRow?.overhead_pct),
    profitPct: num(bidRow?.profit_pct),
    inScope: arr(setup?.in_scope).filter((t): t is string => typeof t === "string"),
    outScope: arr(setup?.out_scope).filter((t): t is string => typeof t === "string"),
    assumptions: arr(setup?.assumptions).filter((t): t is string => typeof t === "string"),
    drawings: docs,
    files,
    status,
  };
}

function dateOnly(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------- Good, Better, Best

/** Words a contractor uses for test data. The board never shows them to a member as a title. */
const TEST_LABEL = /\s*[([]\s*(test|qa|sample)\s*[)\]]\s*|\s+[-–—]\s*(test|qa)\s*$/gi;
export const cleanTitle = (t: string) => t.replace(TEST_LABEL, " ").replace(/\s+/g, " ").trim();

export type GbbOverview = {
  exists: boolean;
  title: string;
  version: number;
  selections: number;
  units: number;
  totals: Record<OptionName, number | null>;
  /** Added schedule time per package, as the client reads it ("No added time", "+2 days"). */
  time: Record<OptionName, string>;
  baseTier: OptionName | null;
  chosen: OptionName | null;
  chosenTotal: number | null;
  chosenOn: string | null;
  blockers: string[];
  status: { label: string; tone: StatusTone };
  /** Before a contract value is on file it is part of the proposal; after, picks become a change order. */
  underContract: boolean;
};

/** `raw` is mcp_residential_selections_get. Null when the read failed or the shape is unknown. */
export function gbbOverview(raw: unknown, underContract: boolean): GbbOverview | null {
  const r = obj(raw);
  if (!r) return null;
  const parsed = boardSchema.safeParse(r.board);
  if (!parsed.success) return null;
  const board: Board = parsed.data;
  const version = num(r.version) ?? 0;
  const exists = version > 0 && board.selections.length > 0;
  const t = packageTotals(board);
  const blockers = exists ? proposalBlockers(board) : [];
  const accepted = board.accepted;
  const units = board.selections.reduce((n, s) => n + s.quantity, 0);
  let status: GbbOverview["status"];
  if (!exists) status = { label: "None yet", tone: "idle" };
  else if (accepted) status = { label: `Client chose ${tierName(accepted.tier)}`, tone: "ok" };
  else if (blockers.length) status = { label: "Draft", tone: "warn" };
  else status = { label: "Ready, not chosen yet", tone: "info" };
  return {
    exists,
    title: cleanTitle(board.proposal.title) || "Good, Better, Best options",
    version,
    selections: board.selections.length,
    units,
    totals: {
      good: t.good.total_cents,
      better: t.better.total_cents,
      best: t.best.total_cents,
    },
    time: {
      good: timeLabel(packageTerms(board, "good").schedule_days),
      better: timeLabel(packageTerms(board, "better").schedule_days),
      best: timeLabel(packageTerms(board, "best").schedule_days),
    },
    baseTier: board.proposal.base_tier ?? null,
    chosen: accepted?.tier ?? null,
    chosenTotal: accepted?.total_cents ?? null,
    chosenOn: accepted?.recorded_on ?? null,
    blockers,
    status,
    underContract,
  };
}

export const tierName = (t: OptionName) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------- contracts

export type ContractKind = "prime" | "subcontract" | "supplier" | "other";
export type ContractRow = {
  key: string;
  kind: ContractKind;
  with: string;
  title: string | null;
  tag: string | null;
  valueCents: number | null;
  status: { label: string; tone: StatusTone };
  signedCopy: string;
  source: "contract" | "purchase_order" | "job_setup";
  number: string | null;
  contractId: string | null;
  poId: string | null;
  documentId: string | null;
  signedOn: string | null;
};

export type ContractsOverview = {
  /** False when the contracts record isn't on the database yet; POs and job setup still show. */
  recordAvailable: boolean;
  rows: ContractRow[];
  prime: ContractRow | null;
  counts: Record<ContractKind, number>;
  totals: Record<ContractKind, number>;
  outForSignature: number;
  draftPos: number;
};

const CONTRACT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "idle" },
  sent: { label: "Sent, waiting on signature", tone: "warn" },
  signed: { label: "Signed", tone: "ok" },
  void: { label: "Void", tone: "idle" },
};
const PO_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "idle" },
  reviewed: { label: "Reviewed", tone: "idle" },
  approved: { label: "Approved, not sent", tone: "info" },
  issued: { label: "Sent, waiting on supplier", tone: "warn" },
  accepted: { label: "Accepted by supplier", tone: "ok" },
};
const ORDER: Record<ContractKind, number> = { prime: 0, subcontract: 1, supplier: 2, other: 3 };

/**
 * `contracts` is mcp_job_contract_rows (null when unavailable), `pos` is
 * mcp_project_purchase_orders_get, `setupValue` is the contract value from job setup in
 * dollars (the board's existing reading), used only when no prime contract is recorded.
 */
export function contractsOverview(
  contracts: unknown,
  pos: unknown,
  setupValue: number | null,
): ContractsOverview {
  const recordAvailable = contracts !== null && contracts !== undefined;
  const rows: ContractRow[] = [];
  const linkedPos = new Set<string>();
  for (const c of arr(obj(contracts)?.contracts)
    .map(obj)
    .filter((x): x is Raw => !!x)) {
    const kind = (["prime", "subcontract", "supplier", "other"] as const).find(
      (k) => k === c.kind,
    );
    if (!kind) continue;
    const status = String(c.status ?? "draft");
    const po = str(c.po_id);
    if (po) linkedPos.add(po);
    rows.push({
      key: `c:${String(c.id)}`,
      kind,
      with: str(c.counterparty) ?? "Not named",
      title: str(c.title),
      tag: [str(c.tag), str(c.cost_code)].filter(Boolean).join(" · ") || null,
      valueCents: num(c.value_cents),
      status: CONTRACT_STATUS[status] ?? CONTRACT_STATUS.draft,
      signedCopy:
        status === "signed"
          ? str(c.document_id)
            ? "Signed copy saved"
            : "Signed, copy not uploaded"
          : str(c.document_id)
            ? "Unsigned copy saved"
            : "No copy saved",
      source: "contract",
      number: str(c.po_number),
      contractId: str(c.id),
      poId: po,
      documentId: str(c.document_id),
      signedOn: str(c.signed_on),
    });
  }
  const p = obj(pos);
  for (const o of arr(p?.orders)
    .map(obj)
    .filter((x): x is Raw => !!x)) {
    const id = String(o.id ?? "");
    if (!id || linkedPos.has(id)) continue;
    const versions = arr(o.versions)
      .map(obj)
      .filter((v): v is Raw => !!v)
      .sort((a, b) => (num(b.version) ?? 0) - (num(a.version) ?? 0));
    const v = versions[0];
    if (!v) continue;
    const party = obj(v.party_snapshot);
    const lineCents = arr(v.lines)
      .map(obj)
      .map((l) => {
        const q = num(l?.quantity);
        const u = num(l?.unit_price_cents);
        return q === null || u === null || !Number.isSafeInteger(u) ? null : extendedCents(q, u);
      });
    const value = sumCents(lineCents, 0);
    const st = String(v.status ?? "draft");
    rows.push({
      key: `po:${id}`,
      kind: party?.kind === "subcontractor" ? "subcontract" : "supplier",
      with: str(party?.name) ?? "Supplier not named",
      title: null,
      tag:
        [str(party?.trade), str(party?.contract_reference) && `ref ${party!.contract_reference}`]
          .filter(Boolean)
          .join(" · ") || null,
      valueCents: value,
      status: {
        ...(PO_STATUS[st] ?? PO_STATUS.draft),
        label: `${(PO_STATUS[st] ?? PO_STATUS.draft).label} · version ${num(v.version) ?? 1}`,
      },
      signedCopy: st === "accepted" ? "Accepted, copy not uploaded" : "Not sent yet",
      source: "purchase_order",
      number: str(o.number),
      contractId: null,
      poId: id,
      documentId: null,
      signedOn: null,
    });
  }
  if (!rows.some((r) => r.kind === "prime" && r.status.label !== "Void") && setupValue !== null)
    rows.push({
      key: "setup:prime",
      kind: "prime",
      with: "Your client",
      title: "Prime contract",
      tag: "Whole job · base contract",
      valueCents: Math.round(setupValue * 100),
      status: { label: "Value only, no signed copy", tone: "warn" },
      signedCopy: "Upload signed copy",
      source: "job_setup",
      number: null,
      contractId: null,
      poId: null,
      documentId: null,
      signedOn: null,
    });
  rows.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const counts = { prime: 0, subcontract: 0, supplier: 0, other: 0 };
  const totals = { prime: 0, subcontract: 0, supplier: 0, other: 0 };
  for (const r of rows) {
    if (r.status.label === "Void") continue;
    counts[r.kind]++;
    totals[r.kind] += r.valueCents ?? 0;
  }
  return {
    recordAvailable,
    rows,
    prime: rows.find((r) => r.kind === "prime" && r.status.label !== "Void") ?? null,
    counts,
    totals,
    outForSignature: rows.filter((r) => r.status.tone === "warn" && r.source !== "job_setup")
      .length,
    draftPos: rows.filter((r) => r.source === "purchase_order" && r.status.tone === "idle").length,
  };
}

// ---------------------------------------------------------------- stage and next step

export const STAGES = [
  ["Estimating", "Takeoff and pricing"],
  ["Proposal", "Sent to client"],
  ["Contracted", "Signed"],
  ["Building", "In the field"],
  ["Closeout", "Final billing"],
] as const;

/** Index into STAGES. Inferred from saved records; nothing is stored as a stage. */
export function jobStage(input: {
  contracted: boolean;
  fieldStarted: boolean;
  proposalReady: boolean;
}): number {
  if (input.contracted) return input.fieldStarted ? 3 : 2;
  return input.proposalReady ? 1 : 0;
}

export type NextStep = { title: string; detail: string; ask: string; href: string | null; label: string };

/** One step at a time, so the member is never left to work out what comes next. */
export function commercialNextStep(input: {
  jobNumber: string;
  estimate: EstimateOverview | null;
  gbb: GbbOverview | null;
  contracts: ContractsOverview | null;
  contracted: boolean;
}): NextStep | null {
  const { jobNumber: n, estimate: e, gbb: g, contracts: c, contracted } = input;
  if (!contracted) {
    if (e && !e.started)
      return {
        title: "Start the estimate: add the drawings",
        detail:
          "Athena sets up the estimate, reads the sheets and asks which trade and scope are yours. Everything you build saves on this board.",
        ask: `Hey Athena, start the estimate for job ${n} and add the drawings.`,
        href: null,
        label: "Copy the ask for Athena",
      };
    if (e && e.lines === 0)
      return {
        title: "Start the takeoff",
        detail: "The estimate is set up but has no quantities yet.",
        ask: `Hey Athena, start the takeoff for job ${n}.`,
        href: null,
        label: "Copy the ask for Athena",
      };
    if (e && (e.missingInput || e.holdingBid))
      return {
        title: `Settle the takeoff: ${e.missingInput + e.holdingBid} open ${e.missingInput + e.holdingBid === 1 ? "item" : "items"}`,
        detail: `${e.missingInput} ${e.missingInput === 1 ? "line needs" : "lines need"} a quantity and ${e.holdingBid} ${e.holdingBid === 1 ? "question holds" : "questions hold"} the bid.`,
        ask: `Hey Athena, walk me through the open takeoff items on job ${n}.`,
        href: null,
        label: "Copy the ask for Athena",
      };
    if (e && e.pricedLines < e.lines - e.excluded)
      return {
        title: "Price the estimate",
        detail: `${e.pricedLines} of ${e.lines - e.excluded} lines are priced.`,
        ask: `Hey Athena, price the estimate for job ${n}.`,
        href: null,
        label: "Copy the ask for Athena",
      };
    if (g?.exists && g.blockers.length)
      return {
        title: "Finish the Good, Better, Best proposal",
        detail: g.blockers[0],
        ask: `Hey Athena, finish the Good, Better, Best proposal for job ${n}.`,
        href: null,
        label: "Copy the ask for Athena",
      };
    if (g?.exists && !g.chosen)
      return {
        title: "Send the proposal to your client's page",
        detail: "They pick Good, Better or Best, type their name and confirm with an emailed code.",
        ask: `Hey Athena, send the Good, Better, Best proposal for job ${n} to my client's page.`,
        href: null,
        label: "Copy the ask for Athena",
      };
    return null;
  }
  if (c?.prime && c.prime.source === "job_setup")
    return {
      title: "Save the signed prime contract on this job",
      detail:
        "The contract value is on file, but no signed copy is saved. Drop the PDF into your Athena chat; Athena reads who, what and the dates for you to confirm.",
      ask: `Hey Athena, here's the signed prime contract for job ${n}. Save it to the job's contracts.`,
      href: null,
      label: "Copy the ask for Athena",
    };
  if (c && c.draftPos)
    return {
      title: `Send ${c.draftPos === 1 ? "the draft PO" : `${c.draftPos} draft POs`} to the supplier`,
      detail: "Review the lines, terms and needed-by date first.",
      ask: `Hey Athena, review the draft POs on job ${n} with me.`,
      href: "purchase-orders",
      label: "Review purchase orders",
    };
  if (g?.exists && !g.chosen && !g.blockers.length)
    return {
      title: "Offer the Good, Better, Best options to your client",
      detail: "When they pick, Athena drafts one change order for your review.",
      ask: `Hey Athena, send the Good, Better, Best options for job ${n} to my client's page.`,
      href: null,
      label: "Copy the ask for Athena",
    };
  return null;
}
