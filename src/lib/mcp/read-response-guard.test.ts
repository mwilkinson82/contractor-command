import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const resolve = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabaseForUser: () => ({ rpc, from: () => ({ insert }) }) }));
vi.mock("./jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jobs")>()),
  resolveJob: resolve,
}));
import { run } from "./guard";
import { TEXT_READ_TOOLS } from "./read-response";
import { accountingReport } from "./tools/accounting-report-tools";
import { WhichCompanyAsk } from "./jobs";
const ctx = { isAuthenticated: () => true, getToken: () => "local-fixture" } as never;
beforeEach(() => {
  rpc.mockReset();
  insert.mockClear();
  resolve.mockClear();
  rpc.mockImplementation(async (name: string) => {
    if (name === "mcp_abuse_cap_check" || name === "mcp_security_touch")
      return { data: { ok: true }, error: null };
    if (name === "mcp_gate" || name === "mcp_session_touch") return { data: true, error: null };
    throw new Error(`Unexpected operation: ${name}`);
  });
});
describe("read results through the real guard", () => {
  it.each([...TEXT_READ_TOOLS])(
    "preserves text and security checks without injecting or silencing %s",
    async (tool) => {
      const result = {
        content: [{ type: "text", text: "Complete source facts: Unknown" }],
        structuredContent: { source: "fixture", html: "<div>legacy only</div>" },
      };
      const read = vi.fn(async () => result);
      const actual = await run(tool, ctx, {}, read);
      expect(actual.content).toEqual(result.content);
      expect(actual.structuredContent).toMatchObject(result.structuredContent);
      expect(JSON.stringify(actual)).not.toMatch(
        /resourceUri|outputTemplate|Card shown|getting_started|morning_card/,
      );
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "mcp_abuse_cap_check",
        "mcp_gate",
        "mcp_security_touch",
        "mcp_session_touch",
      ]);
      expect(read).toHaveBeenCalledOnce();
    },
  );
  it("returns actionable reversed-range validation through the actual accounting tool and guard", async () => {
    await expect(
      accountingReport.handler(
        {
          job_number: "2708",
          company_id: undefined,
          from: "2026-10-20",
          as_of: "2026-10-10",
          page: 1,
          report_type: undefined,
        },
        ctx,
      ),
    ).rejects.toThrow(/start date must be on or before/);
    expect(resolve).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("mcp_billing_evidence_get");
  });
  it("retains authentication denial before any read", async () => {
    const read = vi.fn();
    await expect(
      run("accounting_report", { isAuthenticated: () => false } as never, {}, read),
    ).rejects.toThrow("Not authenticated");
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps an ambiguous company question readable without choosing a tenant or requiring a viewer", async () => {
    const actual = (await run("report_page_link", ctx, {}, async () => {
      throw new WhichCompanyAsk("2708", [
        { company_id: "local-id", company_name: "Northline", job_name: "Library" },
      ]);
    })) as { content: { text: string }[]; structuredContent: { which_company: boolean } };
    expect(actual.content[0].text).toContain("Which company");
    expect(actual.content[0].text).toContain("Northline");
    expect(actual.content[0].text).not.toContain("<!doctype");
    expect(actual.structuredContent.which_company).toBe(true);
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("mcp_set_current_company");
  });
  it("does not expose arbitrary internal failures as input validation", async () => {
    await expect(
      run("accounting_report", ctx, {}, async () => {
        throw new Error("private backend detail");
      }),
    ).rejects.toThrow("Something went wrong. Try again in a moment.");
  });
});
