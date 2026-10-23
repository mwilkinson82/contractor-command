import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobCreatedText } from "./tools/workflow-tools";

const calls = vi.hoisted(() => [] as [string, Record<string, unknown>][]);

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message?: string }) => {
    throw new Error(e.message ?? "database error");
  },
  isMissingFunction: () => false,
}));

function query(table: string) {
  const rows =
    table === "mcp_companies"
      ? [{ id: "c1", name: "AOP Construction" }]
      : table === "mcp_user_settings"
        ? [{ current_company: "c1" }]
        : [];
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  (b as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows, error: null });
  return b;
}

function fakeSb() {
  return {
    from: (table: string) => query(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "mcp_job_create") return { data: { duplicate: false, job_id: "job-1" }, error: null };
      if (fn === "mcp_job_settings") return { data: { pm: args._pm_name, time_zone: args._time_zone ?? null }, error: null };
      return { data: null, error: null };
    },
  };
}

describe("PM set at job create", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("names the PM in the create reply when one was sent", () => {
    const named = jobCreatedText({
      jobNumber: "QA1022",
      companyName: "AOP Construction",
      jobName: "Crystal Car Wash",
      pm: "Jordan Test",
    });
    expect(named).toContain("PM: Jordan Test");
    expect(named).not.toContain("not set");
    const open = jobCreatedText({
      jobNumber: "QA1022",
      companyName: "AOP Construction",
      jobName: "Crystal Car Wash",
    });
    expect(open).toContain("PM: not set yet");
  });

  it("saves the PM from create_job instead of leaving it unset", async () => {
    const { intake } = await import("./tools/workflow-tools");
    const result = await (intake as { handler: (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[] }> }).handler(
      { section: "create_job", job_number: "QA1022", job_name: "Crystal Car Wash", pm: "Jordan Test" },
      {},
    );
    const text = result.content.map((c) => c.text).join("\n");
    expect(text).toContain("PM: Jordan Test");
    expect(text).not.toContain("not set");
    expect(calls.map((c) => c[0])).toContain("mcp_job_settings");
    const settings = calls.find((c) => c[0] === "mcp_job_settings")?.[1];
    expect(settings?._pm_name).toBe("Jordan Test");
    expect(settings?._job).toBe("job-1");
  });
});
