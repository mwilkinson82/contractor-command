// The company board's content (Nov 5 2026), built from the company record members already read under RLS.
// Pure so it can be tested: no reads, no invented values. Anything not saved shows as "Not saved yet".
import {
  MARKET_LABEL,
  OPEN_SHOP_WAGES,
  PRICING_LABEL,
  SHOP_LABEL,
  UNION_RATES,
  WAGE_LABEL,
  WORK_QUESTION_KEYS,
  jobLaborAsk,
  readWorkProfile,
  workQuestions,
  workQuestionsLeft,
  type WorkProfile,
  type WorkQuestionKey,
} from "@/lib/mcp/work-profile";

export type CompanyBoardRow = {
  id: string;
  name?: string | null;
  agent_name?: string | null;
  company_role?: string | null;
  work_types?: string[] | null;
  trades?: string[] | null;
  tool_stack?: unknown;
  decision_rights?: unknown;
  time_zone?: string | null;
  work_profile?: unknown;
};

export const NOT_SAVED = "Not saved yet";

export type Fact = { label: string; value: string; note?: string };
export type WorkAnswer = { number: number; key: WorkQuestionKey; label: string; value: string | string[]; state: "answered" | "skipped" | "open" };
export type LaborRow = { work: string; rules: string };

const WORK_LABEL: Record<WorkQuestionKey, string> = {
  markets: "Markets",
  pricing: "Pricing",
  regions: "Where you work",
  shop: "Shop",
  wage_rules: "Wage rules",
  unit_price: "Unit price items",
  preconstruction: "Pre-con with owners",
  service_calls: "Service calls",
};

const RIGHTS_LABEL: Record<string, string> = {
  buyout: "Buyout",
  change_orders: "Change orders",
  claims: "Claims",
  write_offs: "Write-offs",
  waive_items: "Waiving items",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  pm: "PM",
  all_access: "All access",
  ap: "AP",
  super: "Superintendent",
  superintendent: "Superintendent",
  estimator: "Estimator",
};

const words = (s: string) => {
  const t = s.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

const yesNo = (v: string | undefined) => (v === "yes" ? "Yes" : v === "no" ? "No" : "");

/** Time zone in words, with the IANA name kept so it can be checked. */
export function timeZoneLabel(tz: string | null | undefined): string {
  const z = (tz ?? "").trim();
  if (!z) return NOT_SAVED;
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "long" })
      .formatToParts(new Date(Date.UTC(2026, 0, 15)))
      .find((p) => p.type === "timeZoneName")?.value;
    return name ? `${name.replace(/ Standard Time$/, " Time")} (${z})` : z;
  } catch {
    return z;
  }
}

export function profileFacts(c: CompanyBoardRow): Fact[] {
  const types = (c.work_types ?? []).filter(Boolean).map(words);
  const trades = (c.trades ?? []).filter(Boolean);
  return [
    { label: "What you do", value: c.company_role?.trim() || NOT_SAVED },
    { label: "Trades", value: trades.length ? trades.join(", ") : NOT_SAVED },
    { label: "Work types", value: types.length ? types.join(", ") : NOT_SAVED },
    { label: "Company time zone", value: timeZoneLabel(c.time_zone), note: c.time_zone ? "Jobs can set their own" : undefined },
    { label: "Athena's name for you", value: c.agent_name?.trim() || "Athena" },
  ];
}

function answerValue(p: WorkProfile, key: WorkQuestionKey): string | string[] | null {
  switch (key) {
    case "markets":
      return p.markets ? (p.markets.length ? p.markets.map((m) => MARKET_LABEL[m]) : "None picked") : null;
    case "pricing":
      return p.pricing ? (p.pricing.length ? p.pricing.map((x) => PRICING_LABEL[x]) : "None picked") : null;
    case "regions":
      return p.regions ? (p.regions.length ? p.regions : "None typed") : null;
    case "shop":
      return p.shop ? (p.shop === "both" ? "Union and open shop" : SHOP_LABEL[p.shop]) : null;
    case "wage_rules": {
      if (!p.wage_rules) return null;
      const base = [
        ...(p.shop === "union_shop" || p.shop === "both" ? [UNION_RATES] : []),
        ...(p.shop === "open_shop" || p.shop === "both" ? [OPEN_SHOP_WAGES] : []),
      ];
      const all = [...p.wage_rules.map((w) => WAGE_LABEL[w]), ...base];
      return all.length ? all.join(", ") : "Neither prevailing wage nor PLA";
    }
    default:
      return yesNo(p[key]) || null;
  }
}

/** The 8 kinds-of-work answers in question order. */
export function workAnswers(raw: unknown): { answers: WorkAnswer[]; answered: number; total: number } {
  const p = readWorkProfile(raw);
  const answers = workQuestions(p).map((q): WorkAnswer => {
    const v = answerValue(p, q.key);
    if (v !== null) return { number: q.number, key: q.key, label: WORK_LABEL[q.key], value: v, state: "answered" };
    if (p.skipped?.includes(q.key)) return { number: q.number, key: q.key, label: WORK_LABEL[q.key], value: "Skipped", state: "skipped" };
    return { number: q.number, key: q.key, label: WORK_LABEL[q.key], value: NOT_SAVED, state: "open" };
  });
  const total = WORK_QUESTION_KEYS.length;
  return { answers, answered: total - workQuestionsLeft(p), total };
}

/** One row per kind of shop the company runs, with the wage rules Athena checks on that work. */
export function laborRows(raw: unknown): { rows: LaborRow[]; askedOnEachJob: string } {
  const p = readWorkProfile(raw);
  const rules = (kind: "union" | "open") => {
    if (!p.wage_rules) return "Wage rules not answered yet";
    const out = p.wage_rules.filter((w) => kind === "union" || w === "prevailing_wage").map((w) => WAGE_LABEL[w]);
    out.push(kind === "union" ? UNION_RATES : OPEN_SHOP_WAGES);
    return out.join(", ");
  };
  const rows: LaborRow[] = [];
  if (p.shop === "union_shop" || p.shop === "both") rows.push({ work: "Union jobs", rules: rules("union") });
  if (p.shop === "open_shop" || p.shop === "both") rows.push({ work: "Open shop jobs", rules: rules("open") });
  const ask = jobLaborAsk(p).replace(/^For labor: /, "");
  return { rows, askedOnEachJob: ask ? `${ask.charAt(0).toUpperCase()}${ask.slice(1)}` : "Nothing extra; your answers settle it" };
}

export function decisionFacts(raw: unknown): Fact[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => Array.isArray(v) && v.length)
    .map(([k, v]) => ({
      label: RIGHTS_LABEL[k] ?? words(k),
      value: (v as unknown[]).filter((x): x is string => typeof x === "string").map((r) => ROLE_LABEL[r] ?? words(r)).join(", "),
    }))
    .filter((f) => f.value);
}

export function toolFacts(raw: unknown): Fact[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => ({ label: words(k), value: (v as string).trim() }));
}

export function shopTile(raw: unknown): string {
  const p = readWorkProfile(raw);
  return p.shop ? (p.shop === "both" ? "Union + open" : SHOP_LABEL[p.shop]) : NOT_SAVED;
}
