// Warranty register, populated from the JOB SETUP warranty answers (intake section "warranty").
// Pure functions: dates are YYYY-MM-DD strings.

export const WARRANTY_TRIGGERS = ["substantial_completion", "final_acceptance", "other"] as const;
export type WarrantyTrigger = (typeof WARRANTY_TRIGGERS)[number];

/** Setup questions, in the order Athena asks them. Keys are mcp_job_facts keys under module "warranty". */
export const WARRANTY_SETUP_QUESTIONS = [
  { key: "workmanship_warranty", label: "Workmanship warranty", ask: "Is there a workmanship warranty on this job (yes / no)?" },
  { key: "workmanship_warranty_months", label: "Workmanship warranty duration", ask: "How long is it (months)?" },
  { key: "warranty_start_trigger", label: "Warranty start trigger", ask: "When does it start: substantial completion, final acceptance, or other (describe)?" },
  { key: "warranty_start_basis", label: "Warranty start date basis", ask: "What sets the warranty start date (the contract clause or document that fixes it)?" },
  { key: "closeout_documents", label: "Required closeout documents", ask: "Which closeout documents are required (O&M manuals, as-builts, attic stock, training, lien releases, etc.)?" },
  { key: "punch_final_acceptance", label: "Punch list and final acceptance", ask: "What are the punch list and final acceptance requirements?" },
  { key: "manufacturer_warranties", label: "Manufacturer warranties to collect", ask: "Which manufacturer warranties do we have to collect and turn over?" },
  { key: "closeout_expectations", label: "Other closeout expectations", ask: "Any other closeout expectations from the owner or GC: training, commissioning, final cleaning, lien waivers, a warranty walk, or a turnover meeting? Say none if there aren't any." },
] as const;
export type WarrantyKey = (typeof WARRANTY_SETUP_QUESTIONS)[number]["key"];

type Fact = { key: string; value: unknown; status: string; source?: string };

const TRIGGER_LABEL: Record<WarrantyTrigger, string> = {
  substantial_completion: "substantial completion",
  final_acceptance: "final acceptance",
  other: "other",
};

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const isKnown = (f?: Fact) => !!f && f.status === "known" && f.value !== null && f.value !== undefined && f.value !== "";
const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Required closeout documents taken from (or matching) the contract's closeout clause carry the contract's source,
 * so every view tags them the same way. Returns a new list; nothing is written. */
export function alignCloseoutSource<F extends Fact>(w: F[], contractCloseout?: F | null): F[] {
  if (!contractCloseout || contractCloseout.status !== "known" || !isKnown(contractCloseout)) return w;
  const i = w.findIndex((f) => f.key === "closeout_documents" && f.status === "known");
  if (i < 0) return [...w.filter((f) => f.key !== "closeout_documents"), { ...contractCloseout, key: "closeout_documents" }];
  if (str(w[i].value).trim() !== str(contractCloseout.value).trim()) return w;
  const out = [...w];
  out[i] = { ...w[i], source: contractCloseout.source };
  return out;
}

/** Same tag as contract summary fields (contract-clauses LEGACY_SUMMARY_TAG). */
export const CLOSEOUT_SUMMARY_TAG = "summary, not verified against the contract text";

/** Synthetic fact key carrying the contract's warranty clause text into the warranty checks (never stored). */
export const CONTRACT_WARRANTY_KEY = "contract_warranty_clauses";

const triggerIn = (t: string): WarrantyTrigger | null => {
  const fa = /final acceptance|owner'?s? acceptance|acceptance by (the )?owner|accepted by (the )?owner/i.test(t);
  const sc = /substantial(ly)? complet/i.test(t);
  return fa === sc ? null : fa ? "final_acceptance" : "substantial_completion";
};

/** Where the warranty start is stated, and what each source says. A conflict when two sources name different triggers. Nothing is picked. */
export function warrantyStartConflict(facts: Fact[]): { sources: { where: string; says: WarrantyTrigger }[] } | null {
  const by = new Map(facts.map((f) => [f.key, f]));
  const sources: { where: string; says: WarrantyTrigger }[] = [];
  const trig = by.get("warranty_start_trigger");
  if (isKnown(trig) && trig!.value !== "other") sources.push({ where: "warranty start trigger answer", says: trig!.value as WarrantyTrigger });
  else if (isKnown(trig) && isKnown(by.get("warranty_start_trigger_other"))) {
    const t = triggerIn(str(by.get("warranty_start_trigger_other")!.value));
    if (t) sources.push({ where: "warranty start trigger answer", says: t });
  }
  const basis = by.get("warranty_start_basis");
  if (isKnown(basis)) { const t = triggerIn(str(basis!.value)); if (t) sources.push({ where: "warranty start date basis answer", says: t }); }
  const cw = by.get(CONTRACT_WARRANTY_KEY);
  if (isKnown(cw)) { const t = triggerIn(str(cw!.value)); if (t) sources.push({ where: "contract warranty clause", says: t }); }
  return new Set(sources.map((x) => x.says)).size > 1 ? { sources } : null;
}

const conflictText = (c: NonNullable<ReturnType<typeof warrantyStartConflict>>) =>
  c.sources.map((x) => `${x.where}: ${TRIGGER_LABEL[x.says]}`).join("; ");

/** Lines for the WARRANTY REGISTER section. "Not started" only when nothing was recorded at setup. */
export function renderWarrantyRegister(facts: Fact[], today: string): string[] {
  const by = new Map(facts.map((f) => [f.key, f]));
  if (!WARRANTY_SETUP_QUESTIONS.some((q) => by.has(q.key)) && !by.has("warranty_trigger_date")) return ["   Not set up yet. Athena asks the workmanship warranty and closeout questions in job setup."];
  const out: string[] = [];
  // Warranty values read from the contract (closeout documents copied from its closeout summary, or warranty answers saved
  // with the contract document named) are a summary, not exact contract text — never "manual".
  const src = (f?: Fact) => (isKnown(f) && f?.source ? ` (${f.source === "document" ? CLOSEOUT_SUMMARY_TAG : f.source === "member_answer" ? "manual" : f.source.replace(/_/g, " ")})` : "");
  const has = by.get("workmanship_warranty");
  const months = by.get("workmanship_warranty_months");
  const trig = by.get("warranty_start_trigger");
  const trigOther = by.get("warranty_start_trigger_other");
  const trigDate = by.get("warranty_trigger_date");
  // The trigger label and the member's own words are kept apart: template sentences use only the label.
  const trigLabel = isKnown(trig) ? (trig!.value === "other" ? "other" : TRIGGER_LABEL[trig!.value as WarrantyTrigger] ?? str(trig!.value)) : null;
  const trigNote = isKnown(trigOther) ? str(trigOther!.value).trim().replace(/\s+/g, " ") : null;
  const trigText = !trigLabel ? "unknown" : trigLabel === "other" ? `other: ${trigNote ?? "not described"}` : trigLabel;
  const event = trigLabel && trigLabel !== "other" ? trigLabel : trigLabel === "other" && trigNote ? "start trigger" : null;

  if (!isKnown(has)) out.push(`   - Workmanship warranty: unknown${src(has)}`);
  else if (has!.value === "no") out.push(`   - Workmanship warranty: none${src(has)}`);
  else {
    const n = isKnown(months) ? Number(months!.value) : null;
    const start = isKnown(trigDate) ? str(trigDate!.value) : null;
    const end = start && n !== null ? addMonths(start, n) : null;
    let status: string;
    if (!start) status = `Pending ${event ?? "start trigger"} date`;
    else if (today < start) status = "Not yet started";
    else if (end && today > end) status = "Expired";
    else status = end ? "In warranty" : "In warranty (end date pending duration)";
    out.push(
      `   - Workmanship warranty: yes${src(has)}`,
      `     Status: ${status}`,
      `     Duration: ${n !== null ? `${n} months` : "unknown"}`,
      `     Starts at: ${trigText}`,
      ...(trigNote && trigLabel !== "other" ? [`     Trigger note: ${trigNote}`] : []),
      `     Start date: ${start ?? `pending ${event ?? "trigger"} date`}`,
      `     End date: ${end ?? (start ? "pending duration" : "pending trigger date")}`,
    );
  }
  const conflict = warrantyStartConflict(facts);
  if (conflict) out.push(`   - Warranty start conflict (not resolved; Athena does not pick one): ${conflictText(conflict)}. Confirm which governs.`);
  for (const q of WARRANTY_SETUP_QUESTIONS.slice(3)) {
    const f = by.get(q.key);
    out.push(`   - ${q.label}: ${isKnown(f) ? str(f!.value) : f?.status === "na" ? "n/a" : "unknown"}${src(f)}`);
  }
  return out;
}

/** Open items owed by the warranty setup answers. "no" and unknown answers each become one item (deduped by check_key). */
export function warrantyOpenItems(facts: Fact[]): { check_key: string; action: string; item_type: "no" | "unknown"; recommendation?: string; why?: string }[] {
  const by = new Map(facts.map((f) => [f.key, f]));
  const items: ReturnType<typeof warrantyOpenItems> = [];
  const has = by.get("workmanship_warranty");
  if (!isKnown(has)) items.push({ check_key: "warranty:workmanship_warranty", action: "Confirm whether the contract requires a workmanship warranty", item_type: "unknown" });
  else if (has!.value === "no")
    items.push({
      check_key: "warranty:workmanship_warranty", action: "Confirm in the contract that no workmanship warranty is owed", item_type: "no",
      recommendation: "Read the warranty and closeout clauses and confirm in writing that no workmanship warranty is owed.",
      why: "Most contracts carry a one-year workmanship warranty, even when nobody mentions it.",
    });
  if (isKnown(has) && has!.value === "yes") {
    if (!isKnown(by.get("workmanship_warranty_months"))) items.push({ check_key: "warranty:workmanship_warranty_months", action: "Confirm how long the workmanship warranty runs", item_type: "unknown" });
    const trig = by.get("warranty_start_trigger");
    if (!isKnown(trig) || (trig!.value === "other" && !isKnown(by.get("warranty_start_trigger_other"))))
      items.push({ check_key: "warranty:warranty_start_trigger", action: "Confirm what starts the workmanship warranty (substantial completion, final acceptance or other)", item_type: "unknown" });
  }
  const conflict = warrantyStartConflict(facts);
  if (conflict)
    items.push({
      check_key: "warranty:start_conflict", action: `Resolve the warranty start conflict (${conflictText(conflict)})`, item_type: "unknown",
      recommendation: "Read the contract warranty clause and confirm in writing which event starts the warranty, then correct the other answer.",
      why: "The answers name different warranty start events; the warranty end date can't be relied on until one is confirmed.",
    });
  for (const q of WARRANTY_SETUP_QUESTIONS.slice(3)) {
    const f = by.get(q.key);
    if (f?.status === "na") continue;
    if (!isKnown(f)) items.push({ check_key: `warranty:${q.key}`, action: `Confirm ${q.label.toLowerCase()}`, item_type: "unknown" });
    else if (/^(no|none)\.?$/i.test(str(f!.value)) && q.key !== "manufacturer_warranties" && q.key !== "closeout_expectations")
      items.push({ check_key: `warranty:${q.key}`, action: `${q.label}: answered "no" — confirm against the contract`, item_type: "no",
        recommendation: `Read the closeout section and write down the ${q.label.toLowerCase()} now, so closeout isn't a surprise.`, why: "Closeout requirements left undefined at setup hold up final payment and retainage." });
  }
  return items;
}

// ---------- JOB SETUP flow: asked one at a time by next_question, up front ----------
export const WARRANTY_CHECK_PREFIX = "warranty:";

/** The next unanswered warranty/closeout question, and how many remain after it. Duration and trigger are skipped when there is no warranty (or it is unknown). */
export function nextWarrantyQuestion(facts: Fact[]): { key: WarrantyKey; label: string; ask: string; index: number; total: number; remaining_after: number } | null {
  const by = new Map(facts.map((f) => [f.key, f]));
  const has = by.get("workmanship_warranty");
  const noWarranty = !!has && (has.status !== "known" || has.value === "no");
  const qs = WARRANTY_SETUP_QUESTIONS.filter((q) => !(noWarranty && (q.key === "workmanship_warranty_months" || q.key === "warranty_start_trigger")));
  const open = qs.filter((q) => !by.has(q.key));
  if (!open.length) return null;
  const q = open[0];
  return { key: q.key, label: q.label, ask: q.ask, index: qs.indexOf(q) + 1, total: qs.length, remaining_after: open.length - 1 };
}

export function warrantyHow(key: WarrantyKey): string {
  if (key === "workmanship_warranty") return 'Answer with response "yes", "no" or "unknown".';
  if (key === "workmanship_warranty_months") return 'Answer with detail giving the length (e.g. "12 months" or "2 years"), or response "unknown".';
  if (key === "warranty_start_trigger") return 'Answer with detail "substantial completion", "final acceptance", or describe the other trigger. Use response "unknown" if you don\'t know.';
  return 'Answer with detail (the requirement as written), detail "none", or response "unknown". Response "na" if it doesn\'t apply.';
}

/** Turn an answer to a warranty setup question into warranty facts. Throws a plain message when the answer doesn't fit. */
export function warrantyAnswerFacts(key: WarrantyKey, response: string | undefined, detail: string | undefined): Record<string, unknown> {
  const d = detail?.trim() || "";
  if (response === "unknown") return { [key]: null };
  if (key === "workmanship_warranty") {
    const r = response ?? (/^(yes|y)\b/i.test(d) ? "yes" : /^(no|none|n)\b/i.test(d) ? "no" : undefined);
    if (r !== "yes" && r !== "no") throw new Error('This question needs response "yes", "no" or "unknown".');
    return { workmanship_warranty: r };
  }
  if (key === "workmanship_warranty_months") {
    const m = d.match(/(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)?/i);
    if (!m) throw new Error('Give the length in detail, e.g. "12 months" or "2 years", or response "unknown".');
    const n = Number(m[1]) * (m[2] && /^y/i.test(m[2]) ? 12 : 1);
    return { workmanship_warranty_months: Math.round(n) };
  }
  if (key === "warranty_start_trigger") {
    if (!d) throw new Error('Give the start trigger in detail: "substantial completion", "final acceptance", or describe the other trigger.');
    return mapTrigger(d);
  }
  if (response === "na") return { [key]: "n/a" };
  if (!d && response === "no") return { [key]: "none" };
  if (!d) throw new Error('This question needs detail (the requirement, or "none"), or response "unknown".');
  return { [key]: d.slice(0, 2000) };
}

/** Map the member's words for what starts the warranty. Owner acceptance is final acceptance; the words are kept. */
export function mapTrigger(text: string): { warranty_start_trigger: WarrantyTrigger; warranty_start_trigger_other: string | null } {
  const d = text.trim().slice(0, 500);
  if (/\b(owner'?s?|client'?s?) (final )?acceptance|acceptance by (the )?(owner|client)|final acceptance|final completion|accepted by (the )?owner/i.test(d))
    return { warranty_start_trigger: "final_acceptance", warranty_start_trigger_other: /^final acceptance\.?$/i.test(d) ? null : d };
  if (/substantial(ly)? complet/i.test(d)) return { warranty_start_trigger: "substantial_completion", warranty_start_trigger_other: /^substantial completion\.?$/i.test(d) ? null : d };
  return { warranty_start_trigger: "other", warranty_start_trigger_other: d };
}
