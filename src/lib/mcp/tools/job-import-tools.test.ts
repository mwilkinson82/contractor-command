import { describe, expect, it } from "vitest";
import { drawingFileMeta } from "../drawing-file-input";
import {
  JOB_IMPORT_RULE,
  OVERWATCH_EXPORT_HOW,
  destinationChecks,
  overwatchJobNumber,
  readExport,
} from "./job-import-tools";

describe("job import tool: the member path", () => {
  it("takes the export as an attached file in ChatGPT", () => {
    expect(drawingFileMeta("job_import")).toEqual({ "openai/fileParams": ["file"] });
    expect(JOB_IMPORT_RULE).toMatch(/attached file as file/);
  });

  it("tells a member with no file how to export one from Overwatch", () => {
    expect(() => readExport({ source: "overwatch" })).toThrow(/Export for Athena/);
    expect(JOB_IMPORT_RULE).toContain(OVERWATCH_EXPORT_HOW);
  });

  it("reads the export's own job number", () => {
    expect(overwatchJobNumber('{"project":{"job_number":" 2712 "}}')).toBe("2712");
    expect(overwatchJobNumber('{"project":{"job_number":""}}')).toBeNull();
    expect(overwatchJobNumber("not json")).toBeNull();
  });

  it("flags an export headed to a different job number", () => {
    const base = { source: "overwatch", exportNumber: "2712", exportName: "Harbor Residence" };
    expect(
      destinationChecks({
        ...base,
        target: "2717",
        context: { job_exists: true, name: "Harbor Residence" },
      }),
    ).toEqual([
      "This export is job 2712 (Harbor Residence) in Overwatch, going onto Athena job 2717, Harbor Residence. Say yes only if that's the right job.",
    ]);
    expect(
      destinationChecks({ ...base, target: "2771", context: { job_exists: false } })[0],
    ).toMatch(/There is no job 2771 in Athena yet, so this makes a new job 2771/);
    expect(destinationChecks({ ...base, target: "2712", context: { job_exists: false } })).toEqual(
      [],
    );
  });

  it("flags an existing job whose name doesn't match the export", () => {
    expect(
      destinationChecks({
        source: "overwatch",
        exportNumber: "2810",
        exportName: "Harbor Residence",
        target: "2810",
        context: { job_exists: true, name: "Lakeway Clinic" },
      }),
    ).toEqual([
      "Athena's job 2810 is named Lakeway Clinic, and this export is Harbor Residence. Say yes only if they're the same job.",
    ]);
    expect(
      destinationChecks({
        source: "overwatch",
        exportNumber: "2717",
        exportName: "Harbor Residence",
        target: "2717",
        context: { job_exists: true, name: "Harbor Residence (test)" },
      }),
    ).toEqual([]);
  });
});
