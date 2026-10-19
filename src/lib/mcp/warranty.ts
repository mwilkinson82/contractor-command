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

/** Lines for the WARRANTY REGISTER section. "Not started" only when nothing was recorded at setup. */
export function renderWarrantyRegister(facts: Fact[], today: string): string[] {
  const by = new Map(facts.map((f) => [f.key, f]));
  if (!WARRANTY_SETUP_QUESTIONS.some((q) => by.has(q.key)) && !by.has("warranty_trigger_date")) return ["   Not started."];
  const out: string[] = [];
  const src = (f?: Fact) => (f?.source ? ` (${f.source === "member_answer" ? "manual" : f.source.replace(/_/g, " ")})` : "");
  const has = by.get("workmanship_warranty");
  const months = by.get("workmanship_warranty_months");
  const trig = by.get("warranty_start_trigger");
  const trigOther = by.get("warranty_start_trigger_other");
  const trigDate = by.get("warranty_trigger_date");
  const trigText = isKnown(trig)
    ? trig!.value === "other" ? `other: ${isKnown(trigOther) ? str(trigOther!.value) : "not described"}` : TRIGGER_LABEL[trig!.value as WarrantyTrigger] ?? str(trig!.value)
    : "unknown";

  if (!isKnown(has)) out.push(`   - Workmanship warranty: unknown${src(has)}`);
  else if (has!.value === "no") out.push(`   - Workmanship warranty: none${src(has)}`);
  else {
    const n = isKnown(months) ? Number(months!.value) : null;
    const start = isKnown(trigDate) ? str(trigDate!.value) : null;
    const end = start && n !== null ? addMonths(start, n) : null;
    let status: string;
    if (!start) status = `Pending ${trigText === "unknown" ? "start trigger" : trigText} date`;
    else if (today < start) status = "Not yet started";
    else if (end && today > end) status = "Expired";
    else status = end ? "In warranty" : "In warranty (end date pending duration)";
    out.push(
      `   - Workmanship warranty: yes${src(has)}`,
      `     Status: ${status}`,
      `     Duration: ${n !== null ? `${n} months` : "unknown"}`,
      `     Starts at: ${trigText}`,
      `     Start date: ${start ?? `pending ${trigText === "unknown" ? "trigger" : trigText} date`}`,
      `     End date: ${end ?? (start ? "pending duration" : "pending trigger date")}`,
    );
  }
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
  for (const q of WARRANTY_SETUP_QUESTIONS.slice(3)) {
    const f = by.get(q.key);
    if (f?.status === "na") continue;
    if (!isKnown(f)) items.push({ check_key: `warranty:${q.key}`, action: `Confirm ${q.label.toLowerCase()}`, item_type: "unknown" });
    else if (/^(no|none)\.?$/i.test(str(f!.value)) && q.key !== "manufacturer_warranties")
      items.push({ check_key: `warranty:${q.key}`, action: `${q.label}: answered "no" — confirm against the contract`, item_type: "no",
        recommendation: `Read the closeout section and write down the ${q.label.toLowerCase()} now, so closeout isn't a surprise.`, why: "Closeout requirements left undefined at setup hold up final payment and retainage." });
  }
  return items;
}
