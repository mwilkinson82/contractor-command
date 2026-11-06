import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOB_RECORD_LEAD, JOB_RECORD_RULE } from "./job-record-rule";
import { REFUSAL_RULE } from "./security";
import { ATHENA_TOOLS } from "./index";
import { JOB_SETUP_SOFTWARE_BLOCK, JOB_SOFTWARE_NONE_FOLLOWUP } from "./visible";

describe("job work reaches Athena without the trigger phrase", () => {
  it("sits among the first routing rules so a truncated instructions block keeps it", () => {
    const idx = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(idx).toContain("    GAP_CHECK_ROUTE_RULE +\n    JOB_RECORD_RULE +\n");
  });

  it("leads right after the refusal so it sits inside the first 512 characters", () => {
    // OpenAI's MCP server guide asks for the most important instructions in the first 512 characters.
    const idx = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(idx).toContain("    REFUSAL_RULE +\n    JOB_RECORD_LEAD +\n");
    expect(REFUSAL_RULE.length + JOB_RECORD_LEAD.length).toBeLessThan(512);
    expect(JOB_RECORD_LEAD).toContain("without waiting for them to say Athena or Hey Athena");
    expect(JOB_RECORD_LEAD).toContain("save the result to the job");
  });

  it("names only tools Athena really has", () => {
    const names = new Set(ATHENA_TOOLS.map((t) => t.name));
    const named = JOB_RECORD_RULE.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
    const tools = named.filter((n) => !["report_type"].includes(n));
    expect(tools.length).toBeGreaterThan(8);
    for (const n of tools) expect(names.has(n), n).toBe(true);
  });

  it("does not wait for Hey Athena and never leaves a job record only in chat", () => {
    expect(JOB_RECORD_RULE).toContain("without waiting for them to say Athena or Hey Athena");
    expect(JOB_RECORD_RULE).toContain("never leave a job record there without saving it to Athena");
  });

  it("a member with no project software gets the SOV and CPM saved to the job, not built only in chat", () => {
    expect(JOB_SOFTWARE_NONE_FOLLOWUP).toContain("save them to this job in Athena");
    expect(JOB_SETUP_SOFTWARE_BLOCK).toContain("living_report_save report_type cpm");
    expect(JOB_SETUP_SOFTWARE_BLOCK).not.toContain(
      "offer to build it in chat (tables and charts) or in Excel",
    );
  });
});
