import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSov,
  SovMismatch,
  sovItemProblems,
  sovLineRows,
  sovTotalChangeRefusal,
  SOV_TOTAL_REFUSAL,
} from "./sov";
import { buildFieldPayApp } from "./superintendent";
import {
  completionDate,
  pickContractValue,
  setupContractValue,
  sovContractValue,
} from "./contract-value";

const lines = [
  ["01", "Mobilization and project management", 30_000, "26.01"],
  ["02", "Raceways and rough-in", 220_000, "26.04"],
  ["03", "Switchgear and distribution", 150_000, "26.05"],
  ["04", "Lighting and devices", 60_000, "26.09"],
  ["05", "Testing and closeout", 20_000, "26.11"],
].map(([item_no, description, scheduled_value, code]) => ({
  item_no: item_no as string,
  description: description as string,
  scheduled_value: scheduled_value as number,
  cost_codes: [code as string],
}));

const db = vi.hoisted(() => ({
  facts: [] as Record<string, unknown>[],
  fee: null as number | null,
  writes: [] as string[],
}));
const job = {
  job_id: "job-2810",
  company_id: "company-1",
  job_number: "2810",
  name: "Willow Creek Community Center",
  scope: "full",
};

// Local orchestration test: no network/database. Existing gate and role tests
// remain responsible for authorization; this exercises the actual two handlers.
vi.mock("./guard", () => ({
  run: async (_tool: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn(fakeSb()),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jobs")>()),
  resolveJob: async () => job,
  prefix: () => "2810 · ",
  named: () => "2810 · Willow Creek Community Center",
  audit: async () => {},
}));
vi.mock("./board-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./board-url")>()),
  signedJobPages: async () => ({ payapp: "https://app.meetathena.io/r/job/job-2810/payapp" }),
}));

function query(table: string) {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const rows = () => {
    const all: Record<string, unknown>[] =
      table === "mcp_job_facts"
        ? db.facts
        : table === "mcp_jobs"
          ? [{ id: job.job_id, sov_fee_pct: db.fee, sov_basis: "Contract includes all fee" }]
          : table === "mcp_daily_reports"
            ? [
                { id: "day-28", job_id: job.job_id, report_date: "2026-10-28" },
                { id: "day-29", job_id: job.job_id, report_date: "2026-10-29" },
              ]
            : table === "mcp_daily_work_lines"
              ? [
                  { daily_id: "day-28", job_id: job.job_id, sov_item: "01", pct_complete: 20 },
                  { daily_id: "day-28", job_id: job.job_id, sov_item: "02", pct_complete: 10 },
                  { daily_id: "day-29", job_id: job.job_id, sov_item: "01", pct_complete: 50 },
                  { daily_id: "day-29", job_id: job.job_id, sov_item: "02", pct_complete: 20 },
                ]
              : [];
    return all.filter((row) => filters.every((test) => test(row)));
  };
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => {
      filters.push((row) => row[key] === value);
      return builder;
    },
    in: (key: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[key]));
      return builder;
    },
    order: () => builder,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return builder;
}
function fakeSb() {
  return {
    from: query,
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.writes.push(name);
      if (name === "mcp_set_facts") {
        for (const [key, value] of Object.entries(args._facts as Record<string, unknown>)) {
          const old = db.facts.findIndex((row) => row.module === args._module && row.key === key);
          const row = { job_id: job.job_id, module: args._module, key, value, status: "known" };
          if (old < 0) db.facts.push(row);
          else db.facts[old] = row;
        }
      } else if (name === "mcp_job_sov_terms") db.fee = args._fee_pct as number;
      else throw new Error(`Unexpected write: ${name}`);
      return { data: null, error: null };
    },
  };
}

// SDK handler arguments model optional properties as required-with-undefined;
// this direct-handler harness supplies the same sparse objects as its HTTP input.
function invoke(tool: unknown, args: Record<string, unknown>) {
  return (
    tool as {
      handler: (
        args: unknown,
        ctx: unknown,
      ) => Promise<{ structuredContent?: Record<string, unknown> }>;
    }
  ).handler(args, {});
}

describe("saved sequential SOV keys", () => {
  beforeEach(() => {
    db.facts = [];
    db.fee = null;
    db.writes = [];
  });

  it("reads the five accepted keys and exact $480,000 without renumbering or inventing divisions", () => {
    const before = structuredClone(lines);
    const sov = buildSov(lines, 0, 10);
    expect(sov.summary.contract_total).toBe(480_000);
    expect(sovLineRows(sov).map((row) => row.item_no)).toEqual(["01", "02", "03", "04", "05"]);
    expect(sov.divisions).toHaveLength(1);
    expect(sov.divisions[0]).toMatchObject({
      division: "",
      title: "Division not specified",
      subtotal: 480_000,
    });
    expect(sov.divisions[0].lines.every((row) => row.g === null)).toBe(true);
    expect(lines).toEqual(before);
  });

  it("keeps sequential and hierarchical identities distinct and historical progress exact", () => {
    const mixed = ["1", "01", "01.01"].map((item_no) => ({
      item_no,
      description: item_no,
      scheduled_value: 100,
    }));
    const sov = buildSov(mixed, 0, null, { "1": { d: 10 }, "01": { d: 20 }, "01.01": { d: 30 } });
    expect(sov.summary.contract_total).toBe(300);
    expect(
      Object.fromEntries(
        sov.divisions.flatMap((d) => d.lines.map((line) => [line.item_no, line.d])),
      ),
    ).toEqual({ "1": 10, "01": 20, "01.01": 30 });
    const forecast = buildFieldPayApp(
      lines,
      0,
      10,
      [
        { item_no: "01", pct: 50 },
        { item_no: "02", pct: 20 },
      ],
      [
        { item_no: "01", pct: 20 },
        { item_no: "02", pct: 10 },
      ],
    );
    expect(forecast).toMatchObject({
      contract_sum: 480_000,
      completed_and_stored: 59_000,
      previous_certificates: 28_000,
      current_payment_due: 25_100,
      retainage: 5_900,
      balance_to_finish: 421_000,
    });
    expect(forecast.rows.find((row) => row.item_no === "03")?.total_completed).toBeNull();
    expect(
      forecast.current_payment_due +
        forecast.previous_certificates +
        (forecast.retainage ?? Number.NaN) +
        forecast.balance_to_finish,
    ).toBe(480_000);
  });

  it("runs actual intake to pay-app handlers with the original keys, without billing writes", async () => {
    const { intake } = await import("./tools/workflow-tools");
    const { fieldPayApp } = await import("./tools/superintendent-tools");
    await invoke(intake, {
      section: "budget",
      job_number: "2810",
      fee_pct: 0,
      sov_basis: "Contract includes all fee",
      sov_lines: lines.map((line) => ({
        line: line.item_no,
        description: line.description,
        billable_value: line.scheduled_value,
        cost_codes: line.cost_codes,
      })),
      budget_lines: lines.map((line, index) => ({
        cost_code: line.cost_codes[0],
        amount: [24_000, 172_000, 118_000, 46_000, 15_000][index],
      })),
    });
    expect(db.facts.filter((row) => row.module === "sov").map((row) => row.key)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
    ]);
    const saved = structuredClone(db.facts);
    expect(
      saved
        .filter((row) => row.module === "budget")
        .reduce((sum, row) => sum + (row.value as { amount: number }).amount, 0),
    ).toBe(375_000);
    db.writes = [];
    const result = await invoke(fieldPayApp, { job_number: "2810", period_to: "2026-10-29" });
    expect(result.structuredContent).toMatchObject({
      ties: true,
      pay_app: {
        contract_sum: 480_000,
        previous_certificates: null,
        current_payment_due: null,
        prior_reported_progress: 28_000,
      },
    });
    expect(db.facts).toEqual(saved);
    expect(db.writes).toEqual([]);
  });

  it.each([{ keys: ["bad"] }, { keys: ["01", "01"] }])(
    "refuses unreadable or duplicate keys before any budget/SOV write: $keys",
    async ({ keys }) => {
      const { intake } = await import("./tools/workflow-tools");
      await expect(
        invoke(intake, {
          section: "budget",
          job_number: "2810",
          budget_lines: [{ cost_code: "26.01", amount: 100 }],
          sov_lines: keys.map((line) => ({ line, billable_value: 100 })),
        }),
      ).rejects.toThrow("Nothing was saved");
      expect(db.writes).toEqual([]);
      expect(db.facts).toEqual([]);
      expect(() =>
        buildSov(
          keys.map((item_no) => ({ item_no, description: "work", scheduled_value: 100 })),
          0,
          null,
        ),
      ).toThrow(SovMismatch);
    },
  );

  it("retains official amount locks and keeps SOV fallback separate from recorded original contract facts", () => {
    const facts = lines.map((line) => ({
      key: line.item_no,
      value: { billable_value: line.scheduled_value },
    }));
    expect(sovTotalChangeRefusal(facts, 0, { "01": { billable_value: 40_000 } }, undefined)).toBe(
      SOV_TOTAL_REFUSAL,
    );
    expect(sovItemProblems(["01", "02", "26.01", "26.100"])).toEqual([]);
    expect(setupContractValue([])).toBeNull();
    expect(
      pickContractValue({ setup: null, sov: sovContractValue(lines, 0, null), ior: null }),
    ).toEqual({ amount: 480_000, source: "SOV" });
    expect(completionDate(null, [])).toBeNull();
  });
});