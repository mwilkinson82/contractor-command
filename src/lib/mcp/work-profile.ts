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
    { key: "wage_rules", number: 5, answer: "several", ...wageQuestion(profile?.shop) },
    { key: "unit_price", number: 6, answer: "yes_no", ask: "Do you ever do unit price work, even once a year? That includes a unit price change order on a lump sum job.", choices: ["Yes", "No", "Skip"] },
    { key: "preconstruction", number: 7, answer: "yes_no", ask: "Are you involved in pre-construction with owners, beyond the estimate, like a pre-con agreement?", choices: ["Yes", "No", "Skip"] },
    { key: "service_calls", number: 8, answer: "yes_no", ask: "Do you run service calls?", choices: ["Yes", "No", "Skip"] },
  ];
}

export const UNION_RATES = "Union rates";
export const OPEN_SHOP_WAGES = "Open-shop wages";

/**
 * Question 5 follows question 4 (Marshall, Nov 5): union work can be PLA, prevailing wage or union rates;
 * open shop work is open-shop wages, or prevailing wage on public jobs. Union rates and open-shop wages
 * are what the shop answer already means, so they save no value of their own: only PLA and prevailing
 * wage go in wage_rules, and picking only those base rates saves an empty list.
 */
export function wageQuestion(shop: Shop | undefined): { ask: string; choices: string[] } {
  if (shop === "union_shop")
    return { ask: "On your union work, which wage rules apply? Pick all that fit.", choices: ["PLA", "Prevailing wage", UNION_RATES, "Skip"] };
  if (shop === "open_shop")
    return { ask: "On your open shop work, which wage rules apply? Pick all that fit.", choices: ["Prevailing wage", OPEN_SHOP_WAGES, "Skip"] };
  return {
    ask: "Which wage rules apply to your work? Pick all that fit. Union work can be PLA, prevailing wage or union rates; open shop work is usually open-shop wages.",
    choices: ["PLA", "Prevailing wage", UNION_RATES, OPEN_SHOP_WAGES, "Skip"],
  };
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

/**
 * Choices the company profile already answers, to show pre-checked. Only markets has a source today: the older
 * work_types (public, commercial). Residential could be renovation or custom homes, so it pre-checks neither.
 */
export function workPrechecked(q: WorkQuestion, workTypes: readonly string[] | null | undefined): string[] {
  if (q.key !== "markets" || !workTypes?.length) return [];
  const out: string[] = [];
  if (workTypes.includes("public")) out.push(MARKET_LABEL.public_low_bid);
  if (workTypes.includes("commercial")) out.push(MARKET_LABEL.private_commercial);
  return out;
}

/** What the connected AI does with an open question. Written for hosts whose saved tool list may be out of date. */
/** A ready-to-send save call for each question, so the connected AI copies its shape. */
export const WORK_SAVE_EXAMPLE: Record<WorkQuestionKey, string> = {
  markets: '{"action":"save_work_profile","work_markets":["public_low_bid","private_commercial"]}',
  pricing: '{"action":"save_work_profile","work_pricing":["lump_sum","cost_plus"]}',
  regions: '{"action":"save_work_profile","work_regions":["New York","New Jersey"]}',
  shop: '{"action":"save_work_profile","work_shop":"open_shop"}',
  wage_rules: '{"action":"save_work_profile","work_wage_rules":["pla","prevailing_wage"]}',
  unit_price: '{"action":"save_work_profile","work_unit_price":"yes"}',
  preconstruction: '{"action":"save_work_profile","work_preconstruction":"no"}',
  service_calls: '{"action":"save_work_profile","work_service_calls":"yes"}',
};

/**
 * What the connected AI does with an open question. ChatGPT (Nov 5, after a tools refresh) still told the
 * member the save "isn't exposed": a line here that said what to do if the action were missing made it doubt
 * a tool it had, and pre-checked choices read as already saved. So this says plainly that the action is
 * there and that a pre-check is not an answer.
 */
export function workQuestionGuidance(q: WorkQuestion, prechecked: readonly string[]): string {
  return [
    `Next: ask the member only this question, in these plain words, with its choices${prechecked.length ? `. Show ${prechecked.join(" and ")} pre-checked as a suggestion from the company's older profile; that is not a saved answer, and the member can change it` : ""}.`,
    `When the member answers (typed, tapped, or a confirm or "save and continue" on those choices), call the onboarding tool now with action "save_work_profile", which this tool has: ${WORK_ANSWER_FIELD[q.key]}. For example ${WORK_SAVE_EXAMPLE[q.key]}. If they skip it, send {"action":"save_work_profile","work_skip":["${q.key}"]}; if they say to skip all of it or do it later, send work_skip with every key still open.`,
    "Map their words to those values yourself. Never tell the member to refresh or reconnect Athena for this, and never say Athena can't save it: make the call.",
    "Say it is saved only after save_work_profile answers Saved. Then ask the next question it returns, one per reply, before the first job.",
    "To change an earlier answer when the member asks, send save_work_profile with that question's field again; the new answer replaces the old one.",
  ].join(" ");
}

export function workQuestionText(q: WorkQuestion, left: number, prechecked: readonly string[] = []): string {
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
    ...(prechecked.length ? [`Suggested from your profile (not saved until you answer): ${prechecked.join(", ")}`] : []),
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
  if (p.wage_rules) {
    const base = [
      ...(p.shop === "union_shop" || p.shop === "both" ? [UNION_RATES] : []),
      ...(p.shop === "open_shop" || p.shop === "both" ? [OPEN_SHOP_WAGES] : []),
    ];
    const rules = [...p.wage_rules.map((w) => WAGE_LABEL[w]), ...base];
    lines.push(`Wage rules: ${rules.length ? rules.join(", ") : "Neither prevailing wage nor PLA"}`);
  }
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
  wage_rules: 'work_wage_rules: "PLA" is pla and "Prevailing wage" is prevailing_wage. "Union rates" and "Open-shop wages" save no value (the shop answer covers them), so send only pla and prevailing_wage among the picks, or [] when they picked only union rates or open-shop wages',
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
