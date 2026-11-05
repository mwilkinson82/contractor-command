// Kinds of work a company does (Marshall, Nov 5 2026). Asked once at first run, one question at a time,
// each skippable, and saved on mcp_companies.work_profile. New-job setup then offers only what fits.
// Other features (pre-con phase, service calls, estimating labor) read the same keys; see the migration
// supabase/migrations/20261106100000_athena_company_work_profile.sql for the contract.

export const MARKETS = ["public_low_bid", "private_commercial", "residential_renovation", "custom_homes"] as const;
export const PRICING = ["lump_sum", "cost_plus", "gmp", "time_and_material"] as const;
export const SHOPS = ["open_shop", "union_shop", "both"] as const;
export const WAGE_RULES = ["prevailing_wage", "pla"] as const;
export const YES_NO = ["yes", "no"] as const;

export type Market = (typeof MARKETS)[number];
export type Pricing = (typeof PRICING)[number];
export type Shop = (typeof SHOPS)[number];
export type WageRule = (typeof WAGE_RULES)[number];
export type YesNo = (typeof YES_NO)[number];

export type WorkProfile = {
  markets?: Market[];
  pricing?: Pricing[];
  regions?: string[];
  shop?: Shop;
  wage_rules?: WageRule[];
  unit_price?: YesNo;
  preconstruction?: YesNo;
  service_calls?: YesNo;
  skipped?: WorkQuestionKey[];
  answered_at?: string;
};

export const WORK_QUESTION_KEYS = [
  "markets",
  "pricing",
  "regions",
  "shop",
  "wage_rules",
  "unit_price",
  "preconstruction",
  "service_calls",
] as const;
export type WorkQuestionKey = (typeof WORK_QUESTION_KEYS)[number];

export const MARKET_LABEL: Record<Market, string> = {
  public_low_bid: "Low-bid public work",
  private_commercial: "Private commercial",
  residential_renovation: "Residential renovation",
  custom_homes: "Custom homes",
};
export const PRICING_LABEL: Record<Pricing, string> = {
  lump_sum: "Lump sum",
  cost_plus: "Cost plus",
  gmp: "GMP",
  time_and_material: "Time and material",
};
export const SHOP_LABEL: Record<Shop, string> = {
  open_shop: "Open shop",
  union_shop: "Union shop",
  both: "Both",
};
export const WAGE_LABEL: Record<WageRule, string> = { prevailing_wage: "Prevailing wage", pla: "PLA" };

export type WorkQuestion = {
  key: WorkQuestionKey;
  number: number;
  ask: string;
  choices: string[];
  /** How the member answers: pick several, pick one, yes or no, or type it. */
  answer: "several" | "one" | "yes_no" | "typed";
};

/** Pricing choices in the order that fits the markets: custom home builders see cost plus and lump sum first. */
export function pricingChoices(profile: WorkProfile | null | undefined): Pricing[] {
  const custom = profile?.markets?.includes("custom_homes");
  return custom ? ["cost_plus", "lump_sum", "gmp", "time_and_material"] : [...PRICING];
}

export function workQuestions(profile?: WorkProfile | null): WorkQuestion[] {
  return [
    { key: "markets", number: 1, answer: "several", ask: "What kind of work does your company do? Pick all that fit.", choices: [...MARKETS.map((m) => MARKET_LABEL[m]), "Skip"] },
    { key: "pricing", number: 2, answer: "several", ask: "How are your jobs usually priced? Pick all that fit.", choices: [...pricingChoices(profile).map((p) => PRICING_LABEL[p]), "Skip"] },
    { key: "regions", number: 3, answer: "typed", ask: "Which states or areas do you usually work in? Just type them, like New York and New Jersey.", choices: ["Skip"] },
    { key: "shop", number: 4, answer: "one", ask: "Are you an open shop (non-union) or a union shop?", choices: ["Open shop", "Union shop", "Both", "Skip"] },
    { key: "wage_rules", number: 5, answer: "several", ask: "Do you take prevailing wage or PLA jobs?", choices: ["Prevailing wage", "PLA", "Both", "Neither", "Skip"] },
    { key: "unit_price", number: 6, answer: "yes_no", ask: "Do you ever do unit price work, even once a year? That includes a unit price change order on a lump sum job.", choices: ["Yes", "No", "Skip"] },
    { key: "preconstruction", number: 7, answer: "yes_no", ask: "Are you involved in pre-construction with owners, beyond the estimate, like a pre-con agreement?", choices: ["Yes", "No", "Skip"] },
    { key: "service_calls", number: 8, answer: "yes_no", ask: "Do you run service calls?", choices: ["Yes", "No", "Skip"] },
  ];
}

/** Reads a stored profile defensively: unknown keys and bad values are dropped. */
export function readWorkProfile(raw: unknown): WorkProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const list = <T extends string>(v: unknown, ok: readonly T[]): T[] | undefined =>
    Array.isArray(v) ? (v.filter((x) => typeof x === "string" && (ok as readonly string[]).includes(x)) as T[]) : undefined;
  const one = <T extends string>(v: unknown, ok: readonly T[]): T | undefined =>
    typeof v === "string" && (ok as readonly string[]).includes(v) ? (v as T) : undefined;
  const out: WorkProfile = {
    markets: list(r.markets, MARKETS),
    pricing: list(r.pricing, PRICING),
    regions: Array.isArray(r.regions) ? r.regions.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 20) : undefined,
    shop: one(r.shop, SHOPS),
    wage_rules: list(r.wage_rules, WAGE_RULES),
    unit_price: one(r.unit_price, YES_NO),
    preconstruction: one(r.preconstruction, YES_NO),
    service_calls: one(r.service_calls, YES_NO),
    skipped: list(r.skipped, WORK_QUESTION_KEYS),
    answered_at: typeof r.answered_at === "string" ? r.answered_at : undefined,
  };
  for (const k of Object.keys(out) as (keyof WorkProfile)[]) if (out[k] === undefined) delete out[k];
  return out;
}

const answered = (p: WorkProfile, k: WorkQuestionKey) => p[k] !== undefined || !!p.skipped?.includes(k);

/** The next question still open, or null when every one is answered or skipped. */
export function nextWorkQuestion(profile: WorkProfile | null | undefined): WorkQuestion | null {
  const p = profile ?? {};
  return workQuestions(p).find((q) => !answered(p, q.key)) ?? null;
}

export function workQuestionsLeft(profile: WorkProfile | null | undefined): number {
  const p = profile ?? {};
  return workQuestions(p).filter((q) => !answered(p, q.key)).length;
}

/** The first-run step is done once every question is answered or skipped. */
export function workProfileDone(profile: WorkProfile | null | undefined): boolean {
  return nextWorkQuestion(profile) === null;
}

export function workQuestionText(q: WorkQuestion, left: number): string {
  const how =
    q.answer === "several"
      ? "Pick all that fit, or skip."
      : q.answer === "typed"
        ? "Type them, or skip."
        : q.answer === "one"
          ? "Pick one, or skip."
          : "Yes or no, or skip.";
  return [
    `Kinds of work, question ${q.number} of 8${left > 1 ? ` (${left - 1} more after this)` : " (last one)"}`,
    "",
    q.ask,
    `Choices: ${q.choices.join(" · ")}`,
    how,
  ].join("\n");
}

/** One plain line per saved answer, for the profile read and the account page. */
export function workProfileSummary(profile: WorkProfile | null | undefined): string[] {
  const p = profile ?? {};
  const lines: string[] = [];
  if (p.markets?.length) lines.push(`Markets: ${p.markets.map((m) => MARKET_LABEL[m]).join(", ")}`);
  if (p.pricing?.length) lines.push(`Pricing: ${p.pricing.map((x) => PRICING_LABEL[x]).join(", ")}`);
  if (p.regions?.length) lines.push(`Works in: ${p.regions.join(", ")}`);
  if (p.shop) lines.push(`Shop: ${SHOP_LABEL[p.shop]}`);
  if (p.wage_rules) lines.push(`Prevailing wage or PLA: ${p.wage_rules.length ? p.wage_rules.map((w) => WAGE_LABEL[w]).join(" and ") : "Neither"}`);
  if (p.unit_price) lines.push(`Unit price work: ${p.unit_price === "yes" ? "Yes" : "No"}`);
  if (p.preconstruction) lines.push(`Pre-construction with owners: ${p.preconstruction === "yes" ? "Yes" : "No"}`);
  if (p.service_calls) lines.push(`Service calls: ${p.service_calls === "yes" ? "Yes" : "No"}`);
  return lines;
}

/** Job sector choices from the company's markets. Empty markets offer every sector. */
export function jobSectorChoices(p: WorkProfile): string[] {
  if (!p.markets?.length) return ["public", "private commercial", "residential"];
  const out = new Set<string>();
  for (const m of p.markets) out.add(m === "public_low_bid" ? "public" : m === "private_commercial" ? "private commercial" : "residential");
  return [...out];
}

const JOB_PRICING_WORDS: Record<Pricing, string> = { lump_sum: "lump sum", cost_plus: "cost plus", gmp: "GMP", time_and_material: "time and material" };

/** Job pricing choices: the company's own, with unit price added when they do unit price work. */
export function jobPricingChoices(p: WorkProfile): string[] {
  const base = p.pricing?.length ? pricingChoices(p).filter((x) => p.pricing!.includes(x)) : (["lump_sum", "cost_plus", "gmp"] as Pricing[]);
  const words = base.map((x) => JOB_PRICING_WORDS[x]);
  if (p.unit_price !== "no" && !words.includes("unit price")) words.splice(1, 0, "unit price");
  return words;
}

/** Labor questions for a new job, only the ones that fit the company. */
export function jobLaborAsk(p: WorkProfile): string {
  const parts: string[] = [];
  if (p.shop === "both" || !p.shop) parts.push("is it union or open shop");
  if (!p.wage_rules || p.wage_rules.includes("pla")) parts.push("is there a PLA");
  if (!p.wage_rules || p.wage_rules.includes("prevailing_wage")) parts.push("is it prevailing wage or plain private work");
  return parts.length ? `For labor: ${parts.join(", ")}?` : "";
}

/**
 * The new-job scoping question, built from the company's answers. It always asks the job type, client,
 * prime or sub and the job's city and state, then only the market, pricing and labor choices that fit.
 */
export function tailoredScopeAsk(raw: WorkProfile | null | undefined): string {
  const p = raw ?? {};
  const regions = p.regions?.length ? ` (you usually work in ${p.regions.join(", ")})` : "";
  const lines = [
    `Tell me about this job: the job type, who the client is, and whether you're the prime or a sub.`,
    `Where is it? City and state is enough${regions}.`,
    `Sector: ${jobSectorChoices(p).join(", ")}. Pricing: ${jobPricingChoices(p).join(", ")}.`,
  ];
  const labor = jobLaborAsk(p);
  if (labor) lines.push(labor);
  if (p.preconstruction === "yes") lines.push("Is there pre-construction work with the owner on this job?");
  if (p.unit_price === "yes") lines.push("Any unit price items or unit price change orders on this job?");
  lines.push(`Or say "use the defaults" and I'll fill what I can from your company profile and move on.`);
  return lines.join("\n");
}

/** Labor terms saved on a job, in words for estimating. Null when nothing is known. */
export function jobLaborTermsLine(facts: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const loc = typeof facts.job_location === "string" ? facts.job_location.trim() : "";
  const shop = facts.labor_shop;
  if (shop === "union") parts.push("union job (use the local's wage rates and labor rules)");
  else if (shop === "open_shop") parts.push("open shop");
  if (facts.prevailing_wage === "yes") parts.push(`prevailing wage${loc ? ` (${loc} rates by worker classification)` : " (the state's rates by worker classification)"}`);
  else if (facts.prevailing_wage === "no") parts.push("not prevailing wage");
  if (facts.pla === "yes") parts.push("PLA on the job");
  if (!parts.length && !loc) return null;
  return `Job labor terms: ${[loc ? `located in ${loc}` : "", ...parts].filter(Boolean).join("; ")}.`;
}

/** The onboarding field that saves each question's answer. */
export const WORK_ANSWER_FIELD: Record<WorkQuestionKey, string> = {
  markets: `work_markets: ${MARKETS.join(", ")}`,
  pricing: `work_pricing: ${PRICING.join(", ")}`,
  regions: "work_regions: the states or areas as typed",
  shop: `work_shop: ${SHOPS.join(", ")}`,
  wage_rules: "work_wage_rules: prevailing_wage, pla, both, or [] for neither",
  unit_price: "work_unit_price: yes or no",
  preconstruction: "work_preconstruction: yes or no",
  service_calls: "work_service_calls: yes or no",
};

type ProfileQuery = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message?: string } | null }> };
    };
  };
};

/**
 * Reads mcp_companies.work_profile. Before its migration runs the column does not exist; that read fails
 * and the step is treated as unavailable, so nothing else breaks.
 */
export async function readCompanyWorkProfile(sb: unknown, companyId: string): Promise<{ available: boolean; raw: unknown }> {
  try {
    const { data, error } = await (sb as ProfileQuery).from("mcp_companies").select("work_profile").eq("id", companyId).maybeSingle();
    if (error) return { available: false, raw: {} };
    return { available: true, raw: (data as { work_profile?: unknown } | null)?.work_profile ?? {} };
  } catch {
    return { available: false, raw: {} };
  }
}

const LABOR_FACT_KEYS = ["job_location", "labor_shop", "prevailing_wage", "pla"] as const;
type FactQuery = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          in: (c: string, v: readonly string[]) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
        };
      };
    };
  };
};

/** The job's location and labor terms in words, from its scope facts. Null when none are saved or the read fails. */
export async function jobLaborTerms(sb: unknown, jobId: string): Promise<string | null> {
  try {
    const { data, error } = await (sb as FactQuery)
      .from("mcp_job_facts")
      .select("key, value, status")
      .eq("job_id", jobId)
      .eq("module", "scope")
      .in("key", LABOR_FACT_KEYS);
    if (error || !Array.isArray(data)) return null;
    const facts: Record<string, unknown> = {};
    for (const f of data as { key: string; value: unknown; status: string }[]) if (f.status === "known") facts[f.key] = f.value;
    return jobLaborTermsLine(facts);
  } catch {
    return null;
  }
}
