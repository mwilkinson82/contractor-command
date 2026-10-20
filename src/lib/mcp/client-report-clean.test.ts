import { describe, it, expect } from "vitest";
import { renderSetupReport } from "./jobs";

// Chainable fake: every query method returns the builder; awaiting it yields the table's rows.
function fakeSb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "is", "neq", "limit"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res, rej);
      return b;
    },
  } as never;
}

const base = { section: "contract", status: "open", reported_by: "Sam Ortiz (PM)", reported_at: "2026-10-20T12:00:00Z", source: "document", accountable: "Sam Ortiz (PM)", internal_only: false, category: "submittal", updated_at: "2026-10-20T12:00:00Z" };
const items = [
  { ...base, id: "i1", action: "2603 – Long-lead submittals", item_type: "deadline", needed_by: "2026-11-12", clause_source: "§5.2 (document)" },
  { ...base, id: "i2", action: "2603 – Confirm delivery method for: Long-lead submittals", item_type: "unknown", kind: "confirm_unknown" },
];
const clauses = [{ section: "5.2", heading: null, category: "submittal", verbatim_text: "Submit within ten (10) calendar days after Notice to Proceed.", n_days: 10, day_type: "calendar", trigger_desc: "NTP", source: "document" }];
const job = { job_id: "j1", company_id: "c1", job_number: "2603", name: "TEST", scope: "full" } as never;
const sb = () => fakeSb({ mcp_companies: [{ name: "ALP Construction", agent_name: "Athena" }], mcp_open_items: items, mcp_contract_clauses: clauses, mcp_jobs: [{ time_zone: "America/Chicago" }] });

describe("client report leaves out Accountable and to-confirm items", () => {
  it("client copy", async () => {
    const out = await renderSetupReport(sb(), job, "client");
    expect(out).toContain("Long-lead submittals");
    expect(out).toContain("Contract due date: 2026-11-12");
    expect(out).not.toMatch(/Accountable/);
    expect(out).not.toMatch(/\[To confirm\]/);
    expect(out).not.toMatch(/Confirm delivery method/);
    expect(out).not.toMatch(/\(to confirm\)/);
  });
  it("internal copy keeps them", async () => {
    const out = await renderSetupReport(sb(), job, "internal");
    expect(out).toMatch(/Accountable: Sam Ortiz/);
    expect(out).toMatch(/\[To confirm\] 2603 – Confirm delivery method/);
  });
});
