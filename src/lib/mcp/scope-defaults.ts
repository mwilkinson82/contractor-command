// Step 0 scoping helpers (0.8.1): "use the defaults" and common wording for the enum fields.
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");
export const SECTOR_ALIASES: Record<string, string> = { commercial: "private_commercial", private: "private_commercial", private_commercial: "private_commercial", public: "public", public_sector: "public", government: "public", residential: "residential" };
export const PRICING_ALIASES: Record<string, string> = { lump_sum: "lump_sum", lumpsum: "lump_sum", stipulated_sum: "lump_sum", fixed_price: "lump_sum", unit_price: "unit_price", unit: "unit_price", cost_plus: "cost_plus", t_and_m: "cost_plus", gmp: "gmp", guaranteed_maximum_price: "gmp" };
export const POSITION_ALIASES: Record<string, string> = { prime: "prime", gc: "prime", general_contractor: "prime", prime_contractor: "prime", sub: "sub", subcontractor: "sub", specialty_sub: "sub", sub_sub: "sub_sub", sub_subcontractor: "sub_sub", second_tier: "sub_sub" };
/** Maps common wording ("commercial", "Lump sum", "subcontractor") to the enum value; unknown wording passes through (and fails validation as before). */
export function scopeAlias(map: Record<string, string>) {
  return (v: unknown) => (typeof v === "string" ? (map[norm(v)] ?? (v.trim() === "" || /^(unknown|default|defaults)$/i.test(v.trim()) ? undefined : v)) : v);
}
/** Scope defaults from the company profile. Only what the profile clearly says; never client type or pricing model. */
export function companyScopeDefaults(co: { company_role?: string | null; work_types?: string[] | null; trades?: string[] | null } | null): { job_type?: string; sector?: "public" | "private_commercial" | "residential"; position?: "prime" | "sub" | "sub_sub" } {
  if (!co) return {};
  const out: { job_type?: string; sector?: "public" | "private_commercial" | "residential"; position?: "prime" | "sub" | "sub_sub" } = {};
  if (co.trades?.length === 1) out.job_type = co.trades[0];
  const wt = co.work_types ?? [];
  if (wt.length === 1) out.sector = (SECTOR_ALIASES[norm(wt[0])] as typeof out.sector) ?? undefined;
  const role = (co.company_role ?? "").toLowerCase();
  if (/sub-?sub|second.tier/.test(role)) out.position = "sub_sub";
  else if (/\bsub(contractor)?\b|specialty/.test(role)) out.position = "sub";
  else if (/\bprime\b|general contractor|\bgc\b/.test(role)) out.position = "prime";
  for (const k of Object.keys(out) as (keyof typeof out)[]) if (out[k] === undefined) delete out[k];
  return out;
}

