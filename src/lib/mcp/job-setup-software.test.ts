import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JOB_SETUP_SOFTWARE_BLOCK, JOB_SOFTWARE_ASK, PROJECT_SOFTWARE_KEY, PROJECT_SOFTWARE_POSITION, splitGuidance } from "./visible";

describe("job setup: where this job lives (0.7.9, P6 in 0.8.0)", () => {
  it("uses the exact member-facing wording", () => {
    expect(JOB_SOFTWARE_ASK).toBe("Is this job already set up in your project software? Which one do you use: Overwatch, Buildertrend, Procore, Primavera P6, another web tool, or Excel?");
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain(JOB_SOFTWARE_ASK);
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain("setup question 2 (ref project-software), right after the job number check and before the gates");
  });
  it("never asks for a password and never says Athena builds", () => {
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain("never ask for or type a password");
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain("Never say Athena created, built or set up anything");
  });
  it("keeps the answer in the chat (no new field)", () => {
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain("keep it in this chat too");
  });
  it("is attached as hidden guidance on job-setup next_question results", () => {
    const src = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");
    expect(src.match(/JOB_SETUP_SOFTWARE_BLOCK\)/g)?.length).toBe(4);
    expect(splitGuidance("Setup question 3").guidance).toEqual([]);
  });
  it("offers an XER file or desktop build for Primavera P6", () => {
    expect(JOB_SOFTWARE_ASK).toContain("Primavera P6");
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain("XER file");
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain("desktop control");
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain("big contracts often require a P6 schedule");
  });
  it("is a real setup step pinned at question 2, before the gates and warranty", () => {
    expect(PROJECT_SOFTWARE_KEY).toBe("project_software");
    expect(PROJECT_SOFTWARE_POSITION).toBe(2);
    const src = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");
    const nq = src.slice(src.indexOf("export const nextQuestion"), src.indexOf("// ---------- answer ----------"));
    const auto = nq.indexOf('q?.key === "job_number_assigned"');
    const sw = nq.indexOf('.eq("key", PROJECT_SOFTWARE_KEY)');
    const warranty = nq.indexOf("nextWarrantyQuestion(await warrantyFacts");
    const gates = nq.indexOf("Setup question ${q.index}");
    expect(auto).toBeGreaterThan(0);
    expect(sw).toBeGreaterThan(auto);
    expect(sw).toBeLessThan(warranty);
    expect(sw).toBeLessThan(gates);
    expect(nq).toContain("Setup question ${PROJECT_SOFTWARE_POSITION}");
    expect(src).toContain("if (args.check_key === PROJECT_SOFTWARE_KEY)");
  });
});
