// Athena SOV lean v1 (sov-lean-v1.md). The server builds every number; the host only lays them out.
// Money is handled in integer cents so totals tie out to the cent.

export const CSI_DIVISIONS: Record<string, string> = {
  "00": "Procurement and Contracting Requirements", "01": "General Conditions", "02": "Existing Conditions", "03": "Concrete", "04": "Masonry",
  "05": "Metals", "06": "Wood, Plastics, and Composites", "07": "Thermal and Moisture Protection", "08": "Openings", "09": "Finishes",
  "10": "Specialties", "11": "Equipment", "12": "Furnishings", "13": "Special Construction", "14": "Conveying Equipment",
  "21": "Fire Suppression", "22": "Plumbing", "23": "Heating, Ventilating, and Air Conditioning (HVAC)", "25": "Integrated Automation",
  "26": "Electrical", "27": "Communications", "28": "Electronic Safety and Security", "31": "Earthwork", "32": "Exterior Improvements",
  "33": "Utilities", "34": "Transportation", "35": "Waterway and Marine Construction", "40": "Process Interconnections",
  "41": "Material Processing and Handling Equipment", "42": "Process Heating, Cooling, and Drying Equipment",
  "43": "Process Gas and Liquid Handling, Purification, and Storage Equipment", "44": "Pollution and Waste Control Equipment",
  "45": "Industry-Specific Manufacturing Equipment", "46": "Water and Wastewater Equipment", "48": "Electrical Power Generation",
};

export type SovLineIn = { item_no: string; description: string | null; scheduled_value: number | null };
export type Billing = { d: number | null; e: number | null; f: number | null; g: number | null; pct_complete: number | null; h: number | null; i: number | null };
export type SovLine = { item_no: string; description: string; scheduled_value: number } & Billing;
export type SovDivision = { division: string; title: string; header: string; lines: SovLine[]; subtotal: number; pct_of_contract: number; share_bar_pct: number };
export type Sov = {
  columns: typeof G703_COLUMNS;
  summary: {
    contract_total: number; cost_of_work_gc: number; cost_of_work_gc_pct: number; fee: number; fee_pct: number;
    divisions: { division: string; title: string; scheduled_value: number; pct_of_contract: number; share_bar_pct: number }[];
  };
  divisions: SovDivision[];
  end_rows: { subtotal: { label: string; value: number; pct: number }; fee: { label: string; item_no: "CF"; value: number; pct: number }; grand_total: { label: string; value: number; pct: 100 } };
  retainage_pct: number | null;
  pay_app: { application_no: null; application_date: null; period_to: null };
  tie_out: { ok: true; checks: string[] };
};

/** Fixed GC column set (lean v1): A, B, C, D, E, G, % Complete, H, I. */
export const G703_COLUMNS = [
  { key: "a", letter: "A", label: "Item No." },
  { key: "b", letter: "B", label: "Description of Work" },
  { key: "c", letter: "C", label: "Scheduled Value" },
  { key: "d", letter: "D", label: "From Previous Application", group: "Work Completed" },
  { key: "e", letter: "E", label: "This Period", group: "Work Completed" },
  { key: "g", letter: "G", label: "Total Completed & Stored to Date (D+E)" },
  { key: "pct_complete", letter: null, label: "% Complete (G÷C)" },
  { key: "h", letter: "H", label: "Balance to Finish (C−G)" },
  { key: "i", letter: "I", label: "Retainage" },
] as const;

export class SovMismatch extends Error {}

const ITEM = /^(\d{2})\.(\d{2,3})$/;
const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;
const pct2 = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 10000) / 100);

/** First percent in a contract retainage term ("§4.1 10% through 50%…" -> 10). null when none. */
export function retainagePct(term: unknown): number | null {
  const m = typeof term === "string" ? term.match(/(\d+(?:\.\d+)?)\s*%/) : null;
  return m ? Number(m[1]) : null;
}

/** Column math for one line. Blank (null) billing stays blank; any entered value fills G, % complete, H and I. F is not shown in v1 and is always 0. */
export function lineBilling(c: number, d: number | null, e: number | null, retPct: number | null): Billing {
  if (d === null && e === null) return { d: null, e: null, f: null, g: null, pct_complete: null, h: null, i: null };
  const gC = cents(d ?? 0) + cents(e ?? 0);
  return { d, e, f: 0, g: dollars(gC), pct_complete: pct2(gC, cents(c)), h: dollars(cents(c) - gC), i: retPct === null ? null : dollars(Math.round((gC * retPct) / 100)) };
}

/**
 * Build and tie out the SOV. The fee is a % of the contract total (reference method):
 * contract total = cost of work + GC ÷ (1 − fee %), rounded to the cent; fee = total − subtotal.
 * Throws SovMismatch (listing every problem) instead of returning numbers that don't tie.
 */
export function buildSov(lines: SovLineIn[], feePct: number | null, retPct: number | null, billing: Record<string, { d?: number | null; e?: number | null }> = {}): Sov {
  const problems: string[] = [];
  if (!lines.length) problems.push("No SOV lines are recorded.");
  if (feePct === null || feePct === undefined) problems.push("The fee percent isn't recorded.");
  else if (!(feePct >= 0 && feePct < 100)) problems.push("The fee percent must be at least 0 and under 100.");
  for (const l of lines) {
    if (!ITEM.test(l.item_no)) problems.push(`Line ${l.item_no}: item numbers use the 01.01 style (division, dot, line).`);
    if (typeof l.scheduled_value !== "number" || !Number.isFinite(l.scheduled_value)) problems.push(`Line ${l.item_no}: no scheduled value.`);
    else if (l.scheduled_value < 0) problems.push(`Line ${l.item_no}: scheduled value can't be negative.`);
    else if (Math.abs(cents(l.scheduled_value) - l.scheduled_value * 100) > 1e-6) problems.push(`Line ${l.item_no}: scheduled value has more than two decimals.`);
  }
  if (problems.length) throw new SovMismatch(problems.join("\n"));

  const byDiv = new Map<string, SovLineIn[]>();
  for (const l of [...lines].sort((a, b) => a.item_no.localeCompare(b.item_no, "en", { numeric: true }))) {
    const div = l.item_no.match(ITEM)![1];
    (byDiv.get(div) ?? byDiv.set(div, []).get(div)!).push(l);
  }
  const subC = lines.reduce((s, l) => s + cents(l.scheduled_value!), 0);
  const totalC = Math.round(subC / (1 - feePct! / 100));
  const feeC = totalC - subC;

  const divisions: SovDivision[] = [...byDiv.entries()].map(([division, ls]) => {
    const dC = ls.reduce((s, l) => s + cents(l.scheduled_value!), 0);
    const title = CSI_DIVISIONS[division] ?? `Division ${division}`;
    return {
      division, title, header: `${division} Division ${division} — ${title}`,
      lines: ls.map((l) => {
        const b = billing[l.item_no] ?? {};
        return { item_no: l.item_no, description: (l.description ?? "").trim() || `Item ${l.item_no}`, scheduled_value: l.scheduled_value!, ...lineBilling(l.scheduled_value!, b.d ?? null, b.e ?? null, retPct) };
      }),
      subtotal: dollars(dC), pct_of_contract: pct2(dC, totalC), share_bar_pct: pct2(dC, totalC),
    };
  });

  // Tie-out: recompute every total independently, in cents, and refuse on any mismatch.
  const checks: string[] = [];
  const fail: string[] = [];
  const divSum = divisions.reduce((s, d) => s + cents(d.subtotal), 0);
  (divSum === subC ? checks : fail).push(`Division subtotals ${dollars(divSum)} = cost of work + GC ${dollars(subC)}`);
  for (const d of divisions) {
    const s = d.lines.reduce((x, l) => x + cents(l.scheduled_value), 0);
    (s === cents(d.subtotal) ? checks : fail).push(`Division ${d.division} lines ${dollars(s)} = subtotal ${d.subtotal}`);
  }
  (subC + feeC === totalC ? checks : fail).push(`Cost of work + GC + fee = contract total ${dollars(totalC)}`);
  const impliedFee = totalC === 0 ? 0 : (feeC / totalC) * 100;
  (Math.abs(impliedFee - feePct!) <= 0.005 || totalC === 0 ? checks : fail).push(`Fee ${impliedFee.toFixed(4)}% of contract total matches ${feePct}%`);
  for (const d of divisions)
    for (const l of d.lines) {
      if (l.g === null) continue;
      const g = cents(l.d ?? 0) + cents(l.e ?? 0) + cents(l.f ?? 0);
      (g === cents(l.g) && cents(l.h!) === cents(l.scheduled_value) - g ? checks : fail).push(`Line ${l.item_no}: G = D + E + F and H = C − G`);
    }
  if (fail.length) throw new SovMismatch(`The SOV doesn't tie out:\n${fail.join("\n")}`);

  const subtotalPct = pct2(subC, totalC);
  const feePctShown = pct2(feeC, totalC);
  return {
    columns: G703_COLUMNS,
    summary: {
      contract_total: dollars(totalC), cost_of_work_gc: dollars(subC), cost_of_work_gc_pct: subtotalPct, fee: dollars(feeC), fee_pct: feePctShown,
      divisions: divisions.map((d) => ({ division: d.division, title: d.title, scheduled_value: d.subtotal, pct_of_contract: d.pct_of_contract, share_bar_pct: d.share_bar_pct })),
    },
    divisions,
    end_rows: {
      subtotal: { label: `Subtotal Cost of Work + GC (Divisions ${divisions[0].division}–${divisions[divisions.length - 1].division})`, value: dollars(subC), pct: subtotalPct },
      fee: { label: "Contractor's Fee", item_no: "CF", value: dollars(feeC), pct: feePctShown },
      grand_total: { label: "Grand Total — Contract Sum", value: dollars(totalC), pct: 100 },
    },
    retainage_pct: retPct,
    pay_app: { application_no: null, application_date: null, period_to: null },
    tie_out: { ok: true, checks },
  };
}

export type SovBrand = { company_name: string; logo_url: string | null; license_number: string | null; contact_name: string | null; contact_phone: string | null; website: string | null };

/** The Coryell reference layout (ref/beau-monde-sov-text.md) as a recipe the host follows exactly. */
export function sovLayout(brand: SovBrand) {
  return {
    orientation: "landscape", fit: "width",
    colors: { headings_totals: "#111111", body: "#2B2B2B", labels_rules_notes: "#8A8A8A", header_rows_division_rows_callouts: "#F5F1E8", accent: "#C8581E" },
    accent_use: ["contract total callout", "share bars", "one rule under the page header"],
    no_blue: true,
    fonts: { body_pt: "9-10", tabular_figures: true },
    formats: { money: "$#,##0.00", percent: "0.00%", date: "MMMM d, yyyy" },
    logo: brand.logo_url ? { url: brand.logo_url, position: "top-left, every page", width_in: 1.2, keep_aspect: true } : null,
    fallback_wordmark: brand.logo_url ? null : { text: brand.company_name, style: "bold", position: "top-left, every page" },
    pages: [
      {
        page: 1, title: "SCHEDULE OF VALUES · CONTRACT SUMMARY", title_style: "letter-spaced",
        fields: ["Project name (large)", "PREPARED", "CONTRACTOR", "BASIS"],
        callouts: ["CONTRACT TOTAL (orange, largest)", "COST OF WORK + GENERAL CONDITIONS (with % of contract)", "CONTRACTOR'S FEE (with % of contract)"],
        division_table: { columns: ["Div.", "Description", "Scheduled Value", "% of Contract", "Share of contract (orange bar)"], end_rows: ["Subtotal", "Contractor's Fee", "Contract Total 100.00%"] },
      },
      {
        page: "2+", title: "SCHEDULE OF VALUES · CONTINUATION SHEET (G703 FORMAT)", title_style: "letter-spaced",
        header_fields: ["Project", "APPLICATION NO.", "APPLICATION DATE", "PERIOD TO", "CONTRACT SUM"],
        columns: G703_COLUMNS.map((c) => (c.letter ? `${c.letter}: ${c.label}` : c.label)),
        division_header_rows: "cream, e.g. \"01 Division 01 — General Requirements\"",
        division_subtotal_rows: "Subtotal — Division NN",
        end_rows: ["Subtotal Cost of Work + GC, with %", "CF Contractor's Fee, with %", "Grand Total — Contract Sum, 100.00% (bold, top border, orange figure)"],
        billing_columns: "D, E, G, % Complete, H and I stay blank (not zero) until there is a pay app",
        repeat_header_rows: true,
      },
    ],
    footer: {
      separator: " · ", style: "8-9 pt gray, thin gray rule above",
      fields: [brand.company_name, brand.license_number, brand.contact_name && brand.contact_phone ? `${brand.contact_name} ${brand.contact_phone}` : brand.contact_name ?? brand.contact_phone, brand.website].filter(Boolean),
      website_is_plain_text: true, right: "Page X of Y (real total)",
    },
  };
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Short visible summary for the PM. The full data is in structured content. */
export function sovSummaryText(prefix: string, sov: Sov, brand: SovBrand, basis: string | null, missing: string[], audience: "internal" | "client" = "internal"): string {
  const s = sov.summary;
  return [
    `${prefix}SCHEDULE OF VALUES (${audience === "client" ? "for the owner" : "internal"}, ties out to the cent)`,
    `Contract total: ${money(s.contract_total)}`,
    `Cost of work + general conditions: ${money(s.cost_of_work_gc)} (${s.cost_of_work_gc_pct.toFixed(2)}%)`,
    `Contractor's fee: ${money(s.fee)} (${s.fee_pct.toFixed(2)}%)`,
    `Basis: ${basis ?? "not recorded"}`,
    "",
    "Scheduled value by division:",
    ...s.divisions.map((d) => `- ${d.division} ${d.title}: ${money(d.scheduled_value)} (${d.pct_of_contract.toFixed(2)}%)`),
    "",
    `Logo: ${brand.logo_url ? "link on file" : `none on file, so ${brand.company_name} prints in bold`}`,
    ...(missing.length ? [`Footer still missing: ${missing.join(", ")}`] : []),
    "Billing columns stay blank until there is a pay app.",
  ].join("\n");
}
