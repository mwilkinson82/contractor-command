import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "@lovable.dev/mcp-js";

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({
    data: null,
    error: { code: "PGRST202", message: "Function not found" },
  })),
}));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn({ rpc: fixture.rpc }),
  isMissingFunction: (error: { code: string }) => error.code === "PGRST202",
  dbError: (error: { message: string }) => {
    throw new ToolError(error.message);
  },
  text: (text: string) => ({ content: [{ type: "text", text }] }),
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({
    job_id: "synthetic-job",
    company_id: "synthetic-company",
    job_number: "SYN-1",
    scope: "full",
  }),
  WhichCompanyAsk: class extends Error {},
}));

import { estimateIntake, estimateTakeoffSave } from "./tools/estimate-tools";
beforeEach(() => fixture.rpc.mockClear());

describe("estimating storage unavailable before intake or takeoff work", () => {
  it.each([estimateIntake, estimateTakeoffSave])(
    "returns an explanatory result for $name without later writes",
    async (tool) => {
      const result = await (
        tool as unknown as { handler: (args: unknown, ctx: unknown) => Promise<unknown> }
      ).handler(
        {
          job_number: "SYN-1",
          lines: [{ item: "Fictional footing", basis: "measured", sheet: "S1", value: 12 }],
        },
        {},
      );
      expect(JSON.stringify(result)).toContain("Estimating storage is not available yet");
      expect(JSON.stringify(result)).not.toContain("drawings are saved");
      expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("mcp_estimate_get", {
        _job: "synthetic-job",
      });
    },
  );
});
