import { describe, expect, it, vi } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { prepareLines } from "./estimating";
import { FIELD_BLUE } from "./superintendent";
import { VISIBLE_STYLE_LINE } from "./visible";

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn({}),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message?: string }) => {
    throw new Error(e.message ?? "database error");
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  prefix: (job: { job_number: string }) => `${job.job_number} – `,
  named: (job: { job_number: string; name?: string | null }) =>
    job.name && job.name.startsWith(job.job_number) ? job.name : `${job.job_number} – ${job.name ?? ""}`.trim(),
  audit: async () => {},
  resolveJob: async () => {
    throw new ToolError("No job 9999 in this company. Create it with intake section \"create_job\".");
  },
}));

import { TAKEOFF_MODES, estimateStatus, estimateTakeoffSave, takeoffMode } from "./tools/estimate-tools";

const saveSchema = z.object(estimateTakeoffSave.inputSchema).strict();
const oneLine = { item: "Continuous footing", basis: "measured" as const, sheet: "S1.1", value: 12 };

describe("estimate_takeoff_save mode", () => {
  it("defaults a one-line save when mode is omitted and accepts each value, any case", () => {
    const omitted = saveSchema.safeParse({ job_number: "2701", lines: [oneLine] });
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.mode).toBeUndefined();
    for (const mode of ["upsert", "replace", "Upsert", "REPLACE", " replace "]) {
      const parsed = saveSchema.safeParse({ job_number: "2701", mode, lines: [oneLine] });
      expect(parsed.success, mode).toBe(true);
      if (parsed.success) expect(parsed.data.mode).toBe(mode.trim().toLowerCase());
    }
    expect(takeoffMode.safeParse("MERGE").success).toBe(false);
    expect(estimateTakeoffSave.description).toContain("upsert");
    expect(estimateTakeoffSave.description).toContain("replace");
  });

  it("publishes the same mode enum as the zod schema, and mode is optional", async () => {
    const m = defineMcp({
      name: "athena",
      title: "A",
      version: "t",
      instructions: "i",
      tools: [estimateTakeoffSave],
      metrics: false,
    } as never);
    const h = createTanStackMcpHandler(m, { resourcePath: "/mcp" });
    const post = (b: unknown) =>
      h({
        request: new Request("https://x/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify(b),
        }),
      });
    await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    const raw = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).text();
    const json = JSON.parse(raw.trimStart().startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    const tool = json.result.tools[0] as { inputSchema: { properties: { mode: { enum: string[] } }; required?: string[] } };
    expect(tool.inputSchema.properties.mode.enum).toEqual([...TAKEOFF_MODES]);
    expect(tool.inputSchema.required ?? []).not.toContain("mode");
  });
});

describe("takeoff line errors name the line", () => {
  it("names the line, the description, and the allowed value", () => {
    const bad = saveSchema.safeParse({
      job_number: "2701",
      lines: [{ ...oneLine, line_no: 3, method: 12, missing_input: "x".repeat(121), value: -2, inputs: [{ name: "w".repeat(81), value: 1 }] }],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const messages = bad.error.issues.map((issue) => issue.message).join("\n");
      expect(messages).toContain("Line 3 (Continuous footing): method must be plain words, at most 200 characters, or leave it off.");
      expect(messages).toContain("Line 3 (Continuous footing): the missing input must be plain words naming that one input, at most 120 characters, or leave it off.");
      expect(messages).toContain("Line 3 (Continuous footing): quantity has to be zero or more.");
      expect(messages).toContain("Line 3 (Continuous footing): the input name is longer than 80 characters.");
    }
    expect(() =>
      prepareLines([{ item: "Continuous footing", sheet: "S1.1", basis: "measured", value: -4, line_no: 3 }]),
    ).toThrow(/Line 3 \(Continuous footing\): quantity has to be zero or more/);
    expect(() =>
      prepareLines([
        {
          item: "Continuous footing",
          sheet: "S1.1",
          basis: "measured",
          value: 1,
          line_no: 3,
          inputs: [{ name: "w".repeat(81), value: 1 }],
        },
      ]),
    ).toThrow(/Line 3 \(Continuous footing\): the input name is longer than 80 characters/);
  });
});

describe("estimate_takeoff_save without a job", () => {
  it("asks to create the job or pick one, and does not create it", async () => {
    const result = await (estimateTakeoffSave as unknown as { handler: (a: { job_number: string; lines: unknown[] }, c: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }).handler(
      { job_number: "CCW-005", lines: [oneLine] },
      {},
    );
    expect(result.isError).toBeUndefined();
    const body = result.content[0].text;
    expect(body).toContain("Create job CCW-005, or pick an existing job?");
    expect(body).toContain("Nothing was created");
    expect(body).toContain("This save did not create it");
    expect(body).not.toMatch(/create_job/);
  });
});

describe("estimate_status without a job", () => {
  it("returns a no-estimate card instead of a blank failure", async () => {
    const result = await (estimateStatus as unknown as { handler: (a: { job_number: string }, c: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }).handler(
      { job_number: "9999" },
      {},
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No estimate on this job yet");
    expect(result.content[0].text).toContain("## No estimate on this job yet");
  });
});

describe("superintendent accent", () => {
  it("uses brand blue #1E5FED on the field board and the style line", () => {
    expect(FIELD_BLUE).toBe("#1E5FED");
    expect(VISIBLE_STYLE_LINE).toContain("blue (#1E5FED) accent");
    expect(VISIBLE_STYLE_LINE).not.toContain("#2563EB");
  });
});
