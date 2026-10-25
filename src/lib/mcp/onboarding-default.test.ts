import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { companyProjectSoftware } from "./scope-defaults";

const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");

describe("Athena onboarding copy", () => {
  it("has no consulting framing anywhere the client reads", () => {
    expect(index).not.toMatch(
      /consulting clients|Managing construction projects for my consulting/,
    );
    expect(tools).not.toMatch(/consulting clients/);
    expect(index).toContain("Do not offer a consulting option.");
  });
  it("tells the client never to assume job type, owner type or pricing model", () => {
    expect(index).toContain(
      "Do not assume the job type, owner, client type, sector, or pricing model.",
    );
  });
  it("job number: required for job tools, never called optional", () => {
    expect(index).toContain("The job number is required when creating a job.");
    expect(tools).toMatch(/const jobNumber = z\.string\(\)\.trim\(\)\.min\(1\)/);
    expect(tools).not.toMatch(/job_number: jobNumber\.optional\(\)/);
    // Only list_open_items may omit it (it then lists companies and jobs).
    expect(tools.match(/job_number: listJobNumber/g)?.length).toBe(1);
  });
  it("treats project software on the company profile as already answered", () => {
    expect(companyProjectSoftware({ project_software: "Procore" })).toBe("Procore");
    expect(companyProjectSoftware({ scheduling: "Primavera P6" })).toBe("Primavera P6");
    expect(companyProjectSoftware({ project_software: "Procore", scheduling: "P6" })).toBe("Procore");
    expect(companyProjectSoftware({ project_software: "  " })).toBeNull();
    expect(companyProjectSoftware({ project_software: "unknown" })).toBeNull();
    expect(companyProjectSoftware({ accounting: "Foundation" })).toBeNull();
    expect(companyProjectSoftware(null)).toBeNull();
    const nq = tools.slice(tools.indexOf("export const nextQuestion"), tools.indexOf("// ---------- answer ----------"));
    const profile = nq.indexOf("companyProjectSoftware");
    const ask = nq.indexOf("JOB_SOFTWARE_ASK");
    expect(profile).toBeGreaterThan(0);
    expect(profile).toBeLessThan(ask);
    expect(nq).toContain("from the company profile");
  });
  it("serverInfo name is a short slug and title is the full product line", () => {
    expect(index).toMatch(
      /name: "athena",\n {2}title: "Athena powered by ALP, construction agents",/,
    );
  });
});
