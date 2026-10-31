import { describe, expect, it, vi } from "vitest";
import { resolveCompany } from "./jobs";
import { discoveryCompanies } from "./tools/discovery-tools";
import { jobsResponseText } from "./jobs-response";

const companies = [
  { id: "00000000-0000-4000-8000-000000000711", name: "Fictional Builder" },
  { id: "00000000-0000-4000-8000-000000000712", name: "Fictional Builder" },
];

function db() {
  return {
    from: () => ({ select: async () => ({ data: companies, error: null }) }),
    rpc: vi.fn(async () => ({ error: null })),
  };
}

describe("same-name company choices", () => {
  it("reports ambiguity with exact member-visible IDs without writing a company selection", async () => {
    const sb = db();
    const result = resolveCompany(sb as never, "fictional builder");
    await expect(result).rejects.toThrow("More than one of your companies");
    for (const company of companies) await expect(result).rejects.toThrow(company.id);
    await expect(result).rejects.not.toThrow("aren't a member");
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it("uses the selected exact ID and preserves membership checks", async () => {
    const sb = db();
    expect(await resolveCompany(sb as never, companies[1].id)).toBe(companies[1].id);
    expect(sb.rpc).toHaveBeenCalledExactlyOnceWith("mcp_set_current_company", {
      _company: companies[1].id,
    });
    await expect(resolveCompany(db() as never, "unrelated-company")).rejects.toThrow(
      "aren't a member",
    );
  });

  it("distinguishes duplicate headings and supports filtering by their returned IDs", () => {
    const visible = jobsResponseText(
      companies.map((company) => ({ ...company, jobs: [] })),
      { companies: 2, jobs: 0 },
      false,
    );
    for (const company of companies) {
      expect(visible).toContain(company.id);
      expect(discoveryCompanies(companies, company.id)).toEqual([company]);
    }
    expect(() => discoveryCompanies(companies, "Fictional Builder")).toThrow(
      "More than one of your companies",
    );
  });
});
