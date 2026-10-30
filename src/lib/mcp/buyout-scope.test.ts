import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  companies: [
    { id: "company-a", name: "Alpha" },
    { id: "company-b", name: "Beta" },
  ],
  job: {
    job_id: "job-a",
    company_id: "company-a",
    job_number: "100",
    name: "Job A",
    scope: "full",
  },
}));
vi.mock("./jobs", () => ({
  memberCompanies: async () => f.companies,
  resolveCompany: async (s: unknown, c: string) => c,
  resolveJob: async () => f.job,
}));
vi.mock("./guard", () => ({ run: vi.fn(), text: vi.fn(), dbError: vi.fn() }));
import { buyoutTarget } from "./tools/buyout-tools";
import type { Sb } from "./guard";
beforeEach(() => {
  f.companies = [
    { id: "company-a", name: "Alpha" },
    { id: "company-b", name: "Beta" },
  ];
});
describe("buyout explicit company scope", () => {
  it("rejects resolveJob fallback into another explicitly selected company", async () => {
    await expect(buyoutTarget({} as Sb, { job_number: "100", company_id: "Beta" })).rejects.toThrow(
      "not in the selected company",
    );
  });
  it("accepts exact company ID or unique name", async () => {
    for (const company_id of ["Alpha", "company-a"])
      expect(await buyoutTarget({} as Sb, { job_number: "100", company_id })).toEqual({
        company: "company-a",
        job: "job-a",
      });
  });
  it("rejects ambiguous names and requires a job when scope is job", async () => {
    f.companies.push({ id: "company-c", name: "Alpha" });
    await expect(
      buyoutTarget({} as Sb, { job_number: "100", company_id: "Alpha" }),
    ).rejects.toThrow("exact company and job");
    await expect(buyoutTarget({} as Sb, {})).rejects.toThrow("Which job");
  });
});
