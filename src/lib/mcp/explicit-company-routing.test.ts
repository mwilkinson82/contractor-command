import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";

const fixture = vi.hoisted(() => ({ sb: null as unknown }));
// Only replace transport/auth setup: the real tools, resolver and plan checker run below.
// Membership/role authorization itself remains covered by the existing DB/role suites.
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn(fixture.sb),
  dbError: (error: { message: string }) => {
    throw new ToolError(error.message);
  },
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  isMissingFunction: () => false,
}));
import { resolveJob, WhichCompanyAsk } from "./jobs";
import { estimatingUpgrade } from "./estimating-plan";
import { drawingSetImport, estimateIntake, estimateTakeoffSave } from "./tools/estimate-tools";
import { fileUpload } from "./tools/file-upload-tool";
import { projectDocuments } from "./tools/document-read-tools";

const A = { id: "00000000-0000-4000-8000-000000000001", name: "Fictional Builder A" };
const B = { id: "00000000-0000-4000-8000-000000000002", name: "Fictional Builder B" };
function database(companies = [A, B], both = false) {
  return {
    from: vi.fn((table: string) => {
      if (table !== "mcp_companies") throw new Error(`Unexpected read: ${table}`);
      return { select: async () => ({ data: companies, error: null }) };
    }),
    rpc: vi.fn(async (name: string, args: Record<string, string>) => {
      if (name === "mcp_resolve_job")
        return {
          data:
            args._company === A.id || both
              ? {
                  job_id: `job-${args._company}`,
                  job_number: "SYN-7",
                  name: "Fictional job",
                  company_id: args._company,
                  scope: "full",
                }
              : { not_found: true, suggestions: [] },
          error: null,
        };
      if (name === "mcp_company_tier") return { data: "circle", error: null };
      throw new Error(`Unexpected operation: ${name}`);
    }),
  };
}
const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (args: unknown, ctx: unknown) => Promise<unknown> }).handler(args, {});
beforeEach(() => {
  fixture.sb = database();
});

describe("explicit company is a destination boundary", () => {
  it.each([drawingSetImport, estimateIntake, estimateTakeoffSave, fileUpload, projectDocuments])(
    "$name stops before storage when the sole matching job belongs to another accessible company",
    async (tool) => {
      const sb = database();
      fixture.sb = sb;
      const outcome = await call(tool, {
        job_number: "SYN-7",
        company_id: B.id,
        action: "begin",
        purpose: "spec",
        filename: "source.txt",
      }).then(
        (result) => JSON.stringify(result),
        (error: Error) => error.message,
      );
      // Estimating handlers render ToolError as an ask/error card; file handlers reject.
      expect(outcome).toContain("not in the company you named");
      expect(outcome).toContain("Nothing was changed");
      expect(sb.rpc).toHaveBeenCalledExactlyOnceWith("mcp_resolve_job", {
        _company: B.id,
        _job_number: "SYN-7",
      });
    },
  );
  it("does not check another company's estimating tier on a failed destination", async () => {
    const sb = database();
    await expect(estimatingUpgrade(sb as unknown as Sb, "SYN-7", B.id)).rejects.toThrow(
      "not in the company you named",
    );
    expect(sb.rpc.mock.calls.map(([name]) => name)).toEqual(["mcp_resolve_job"]);
  });
  it.each([B.id, B.name])(
    "uses only selected company %s when both companies have the job",
    async (company) => {
      const sb = database([A, B], true);
      expect(await resolveJob(sb as unknown as Sb, "SYN-7", company, "write")).toMatchObject({
        company_id: B.id,
      });
      expect(sb.rpc).toHaveBeenCalledExactlyOnceWith("mcp_resolve_job", {
        _company: B.id,
        _job_number: "SYN-7",
      });
    },
  );
  it("asks for duplicate company names before looking up any job", async () => {
    const sb = database([
      { ...A, name: "Same Builder" },
      { ...B, name: "Same Builder" },
    ]);
    await expect(resolveJob(sb as unknown as Sb, "SYN-7", "Same Builder")).rejects.toThrow(
      "More than one",
    );
    expect(sb.rpc).not.toHaveBeenCalled();
  });
  it.each(["inaccessible-company", "", "   "])(
    "rejects unknown or empty explicit company %j without a fallback",
    async (company) => {
      const sb = database();
      await expect(resolveJob(sb as unknown as Sb, "SYN-7", company)).rejects.toThrow(
        "aren't a member",
      );
      expect(sb.rpc).not.toHaveBeenCalled();
    },
  );
  it("preserves unique lookup and ambiguity when no company is supplied", async () => {
    expect(await resolveJob(database() as unknown as Sb, "SYN-7")).toMatchObject({
      company_id: A.id,
    });
    await expect(
      resolveJob(database([A, B], true) as unknown as Sb, "SYN-7"),
    ).rejects.toBeInstanceOf(WhichCompanyAsk);
  });
  it("limits typo suggestions to the explicitly selected company", async () => {
    const sb = database();
    sb.rpc.mockImplementation(
      async (_name, args) =>
        ({
          data: {
            not_found: true,
            suggestions: [{ job_number: "SYN-8", name: "Selected company job" }],
          },
          error: null,
        }) as never,
    );
    await expect(resolveJob(sb as unknown as Sb, "SYN-7", B.id)).rejects.toThrow(
      "Did you mean job SYN-8",
    );
    expect(sb.rpc).toHaveBeenCalledExactlyOnceWith("mcp_resolve_job", {
      _company: B.id,
      _job_number: "SYN-7",
    });
  });
});
