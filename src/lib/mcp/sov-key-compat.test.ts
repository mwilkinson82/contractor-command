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
  basis: "Contract includes all fee",
  draftFee: null as number | null,
  draftBasis: null as string | null,
  version: 0,
  storageAvailable: true,
  writes: [] as string[],
}));
const job = {
  job_id: "job-900071",
  company_id: "company-1",
  job_number: "900071",
  name: "Synthetic Example Community Center",
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
  isMissingFunction: (error: { code?: string }) => error.code === "PGRST202",
}));
vi.mock("./jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jobs")>()),
  resolveJob: async () => job,
  prefix: () => "900071 · ",
  named: () => "900071 · Synthetic Example Community Center",
  audit: async () => {},
}));
vi.mock("./board-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./board-url")>()),
  signedJobPages: async () => ({ payapp: "https://app.meetathena.io/r/job/job-900071/payapp" }),
}));

function query(table: string) {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const rows = () => {
    const all: Record<string, unknown>[] =
      table === "mcp_job_facts"
        ? db.facts
        : table === "mcp_jobs"
          ? [
              {
                id: job.job_id,
                sov_fee_pct: db.fee,
                sov_basis: db.basis,
              },
            ]
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
    select: (columns: string) => {
      if (table === "mcp_jobs") expect(columns).not.toContain("sov_draft");
      return builder;
    },
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
  const snapshot = () => ({
    company_id: job.company_id,
    job_id: job.job_id,
    version: db.version,
    budget: Object.fromEntries(
      db.facts.filter((row) => row.module === "budget").map((row) => [row.key, row.value]),
    ),
    sov: Object.fromEntries(
      db.facts.filter((row) => row.module === "sov").map((row) => [row.key, row.value]),
    ),
    sov_draft: Object.fromEntries(
      db.facts.filter((row) => row.module === "sov_draft").map((row) => [row.key, row.value]),
    ),
    terms: { fee_pct: db.fee, basis: db.basis },
    draft_terms: { fee_pct: db.draftFee, basis: db.draftBasis },
    capabilities: { destination_cas: true },
  });
  return {
    from: query,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "mcp_estimate_destination_snapshot")
        return db.storageAvailable
          ? { data: snapshot(), error: null }
          : { data: null, error: { code: "PGRST202", message: "Missing versioned storage" } };
      db.writes.push(name);
      if (name === "mcp_estimate_destination_save") {
        if (!db.storageAvailable)
          return { data: null, error: { code: "PGRST202", message: "Missing versioned storage" } };
        if (args._expected_version !== db.version)
          return { data: null, error: { message: "Destination changed" } };
        for (const [argument, module] of [
          ["_budget", "budget"],
          ["_sov", "sov"],
          ["_sov_draft", "sov_draft"],
        ]) {
          if (args[argument] == null) continue;
          for (const [key, value] of Object.entries(args[argument] as Record<string, unknown>)) {
            const old = db.facts.findIndex((row) => row.module === module && row.key === key);
            const row = { job_id: job.job_id, module, key, value, status: "known" };
            if (old < 0) db.facts.push(row);
            else db.facts[old] = row;
          }
        }
        if (args._fee_pct != null) db.fee = args._fee_pct as number;
        if (args._basis != null) db.basis = args._basis as string;
        if (args._draft_fee_pct != null) db.draftFee = args._draft_fee_pct as number;
        if (args._draft_basis != null) db.draftBasis = args._draft_basis as string;
        db.version++;
        return { data: snapshot(), error: null };
      } else throw new Error(`Unexpected write: ${name}`);
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
    db.basis = "Contract includes all fee";
    db.draftFee = null;
    db.draftBasis = null;
    db.version = 0;
    db.storageAvailable = true;
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
      completed_and_stored: null,
      previous_certificates: null,
      current_payment_due: null,
      retainage: null,
      balance_to_finish: null,
    });
    expect(forecast.rows.find((row) => row.item_no === "03")?.total_completed).toBeNull();
    expect(forecast.checks.some((check) => check.startsWith("Needed:"))).toBe(true);
  });

  it("runs actual intake to pay-app handlers with the original keys, without billing writes", async () => {
    const { intake } = await import("./tools/workflow-tools");
    const { fieldPayApp } = await import("./tools/superintendent-tools");
    await invoke(intake, {
      section: "budget",
      job_number: "900071",
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
    expect(db.writes).toEqual(["mcp_estimate_destination_save"]);
    expect(
      saved
        .filter((row) => row.module === "budget")
        .reduce((sum, row) => sum + (row.value as { amount: number }).amount, 0),
    ).toBe(375_000);
    db.writes = [];
    const result = await invoke(fieldPayApp, { job_number: "900071", period_to: "2026-10-29" });
    expect(result.structuredContent).toMatchObject({
      ties: false,
      pay_app: {
        contract_sum: 480_000,
        previous_certificates: null,
        current_payment_due: null,
        prior_reported_progress: null,
      },
    });
    expect(db.facts).toEqual(saved);
    expect(db.writes).toEqual([]);
  });
  it("fails closed on unavailable versioned writes and permits a read-only legacy view", async () => {
    const { intake } = await import("./tools/workflow-tools");
    db.storageAvailable = false;
    await expect(
      invoke(intake, {
        section: "budget",
        job_number: "900071",
        budget_lines: [{ cost_code: "26.01", amount: 1 }],
      }),
    ).rejects.toThrow(/unavailable/i);
    expect(db.writes).toEqual([]);
    expect(db.facts).toEqual([]);
    const loaded = await invoke(intake, { section: "budget", job_number: "900071" });
    expect(loaded.structuredContent).toMatchObject({ saved: false, destination_version: null });
    expect(db.writes).toEqual([]);
  });
  it("rejects an explicitly stale destination version before any save", async () => {
    const { intake } = await import("./tools/workflow-tools");
    await expect(
      invoke(intake, {
        section: "budget",
        job_number: "900071",
        destination_version: 1,
        budget_lines: [{ cost_code: "26.01", amount: 1 }],
      }),
    ).rejects.toThrow(/destination changed/i);
    expect(db.writes).toEqual([]);
    expect(db.facts).toEqual([]);
  });

  it.each([{ keys: ["bad"] }, { keys: ["01", "01"] }])(
    "refuses unreadable or duplicate keys before any budget/SOV write: $keys",
    async ({ keys }) => {
      const { intake } = await import("./tools/workflow-tools");
      await expect(
        invoke(intake, {
          section: "budget",
          job_number: "900071",
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
