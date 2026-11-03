/* Actual intake handler + real guarded destination SQL; synthetic local rows. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient, asUser } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  sb: null as unknown,
  job: "",
  company: "",
  calls: [] as string[],
  unavailable: false,
  concurrentAppend: false,
  loseResponse: false,
  malformedSuccess: "" as "" | "null" | "wrong_identity",
}));
vi.mock("./guard", () => ({
  run: async (_n: unknown, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) => fn(state.sb),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
  isMissingFunction: (e: { code?: string; message?: string }) =>
    e.code === "PGRST202" || /does not exist/i.test(e.message ?? ""),
}));
vi.mock("./jobs", async (original) => ({
  ...(await original<typeof import("./jobs")>()),
  resolveJob: async () => ({
    job_id: state.job,
    company_id: state.company,
    job_number: "900071",
    name: "Synthetic Example",
    scope: "full",
  }),
  prefix: () => "900071 · ",
  audit: async () => {},
}));
import { intake } from "./tools/workflow-tools";

const owner = randomUUID(),
  company = randomUUID(),
  job = randomUUID(),
  legacy = randomUUID(),
  legacyBad = randomUUID(),
  fresh = randomUUID();
const co = randomUUID();
let db: PGlite;
let member: ReturnType<typeof fakeClient>;
const rpc = async (name: string, args: Record<string, unknown>) => {
  const result = await member.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as Record<string, unknown>;
};
const snapshot = (id = state.job) => rpc("mcp_estimate_destination_snapshot", { _job: id });
type Response = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const call = (args: Record<string, unknown> = {}) =>
  (intake as unknown as { handler: (a: unknown, c: unknown) => Promise<Response> }).handler(
    { section: "budget", job_number: "900071", ...args },
    {},
  );

beforeAll(async () => {
  db = await makeDb();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.invalid')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Fixture')",
    [company, owner],
  );
  for (const id of [job, legacy, legacyBad, fresh])
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1::uuid,$2,$3,($1::uuid)::text,'Synthetic Example')",
      [id, company, owner],
    );
  await db.exec(
    "CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261030150000_athena_sov_official_lock.sql", "utf8"),
  );
  member = fakeClient(db, { sub: owner, role: "authenticated", email: "fixture@example.invalid" });
  await asUser(
    db,
    { sub: owner, role: "authenticated", email: "fixture@example.invalid" },
    async (tx) => {
      await tx.query("SELECT mcp_set_facts($1::uuid,'sov',$2::jsonb,'member_answer')", [
        legacy,
        JSON.stringify({ "01": { description: "Original", billable_value: 100, cost_codes: [] } }),
      ]);
      await tx.query("SELECT mcp_job_sov_terms($1::uuid,10,'Legacy official basis')", [legacy]);
      await tx.query("SELECT mcp_set_facts($1::uuid,'sov_draft',$2::jsonb,'member_answer')", [
        legacy,
        JSON.stringify({
          "01": { description: "Legacy draft", billable_value: 120, cost_codes: [] },
        }),
      ]);
      await tx.query("SELECT mcp_set_facts($1::uuid,'sov',$2::jsonb,'member_answer')", [
        legacyBad,
        JSON.stringify({
          "01": {
            description: "Legacy malformed",
            billable_value: 100,
            executed_change_order: "co",
            fee_included: "false",
          },
        }),
      ]);
      await tx.query("SELECT mcp_job_sov_terms($1::uuid,10,'Legacy source')", [legacyBad]);
    },
  );
  await db.exec(readFileSync("release-proposals/estimating-destination-versions.sql", "utf8"));
  state.job = job;
  state.company = company;
  state.sb = {
    ...member,
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push(name);
      if (state.unavailable && name.startsWith("mcp_estimate_destination_"))
        return {
          data: null,
          error: { code: "PGRST202", message: "Versioned storage unavailable" },
        };
      if (name === "mcp_estimate_destination_save" && state.concurrentAppend) {
        state.concurrentAppend = false;
        await rpc("mcp_set_facts", {
          _job: state.job,
          _module: "budget",
          _facts: { "09-200": { description: "Concurrent row", amount: 12 } },
          _source: "member_answer",
        });
      }
      const result = await member.rpc(name, args);
      if (name === "mcp_estimate_destination_save" && state.malformedSuccess) {
        const kind = state.malformedSuccess;
        state.malformedSuccess = "";
        return {
          data: kind === "null" ? null : { ...(result.data as object), company_id: randomUUID() },
          error: null,
        };
      }
      if (name === "mcp_estimate_destination_save" && state.loseResponse) {
        state.loseResponse = false;
        return { data: null, error: { message: "Response interrupted after commit" } };
      }
      return result;
    },
  };
});
afterAll(async () => db.close());

describe.sequential("intake atomic destination client", () => {
  it("writes budget, official SOV and selected terms in exactly one CAS", async () => {
    state.calls = [];
    const result = await call({
      budget_lines: [{ cost_code: "09-100", description: "Paint", amount: 100 }],
      sov_lines: [
        {
          line: "01",
          description: "Paint",
          billable_value: 200,
          cost_codes: ["09-100"],
          spec_section: "09 90 00",
        },
      ],
      fee_pct: 10,
      sov_basis: "Executed base",
    });
    expect(state.calls.filter((c) => c === "mcp_estimate_destination_save")).toHaveLength(1);
    expect(state.calls).not.toContain("mcp_set_facts");
    expect(state.calls).not.toContain("mcp_job_sov_terms");
    expect(result.structuredContent).toMatchObject({ saved: true, sov_copy: "official" });
    expect(await snapshot()).toMatchObject({
      budget: { "09-100": { amount: 100 } },
      sov: { "01": { billable_value: 200 } },
      terms: { fee_pct: 10, basis: "Executed base" },
    });
  });
  it("rejects an explicitly stale version without issuing a save", async () => {
    const before = await snapshot();
    state.calls = [];
    await expect(
      call({ destination_version: 0, budget_lines: [{ cost_code: "09-100", amount: 0 }] }),
    ).rejects.toThrow(/destination changed/i);
    expect(state.calls).toEqual(["mcp_estimate_destination_snapshot"]);
    expect(await snapshot()).toEqual(before);
  });
  it("rejects an intervening update and retains concurrent data rather than overwriting it", async () => {
    const read = await call();
    state.concurrentAppend = true;
    await expect(
      call({
        destination_version: read.structuredContent.destination_version,
        budget_lines: [{ cost_code: "09-100", amount: 999 }],
      }),
    ).rejects.toThrow(/destination changed/i);
    expect((await snapshot()).budget).toMatchObject({
      "09-100": { amount: 100 },
      "09-200": { amount: 12 },
    });
  });
  it("leaves budget and official terms unchanged when official dollars are locked", async () => {
    const before = await snapshot();
    state.calls = [];
    await expect(
      call({
        budget_lines: [{ cost_code: "09-100", amount: 999 }],
        sov_lines: [{ line: "01", billable_value: 201 }],
      }),
    ).rejects.toThrow(/approved change order/i);
    expect(state.calls).not.toContain("mcp_estimate_destination_save");
    expect(await snapshot()).toEqual(before);
  });
  it("seeds the draft once and atomically combines edits with distinct zero fee/basis", async () => {
    // Synthetic executed-CO source rows use the existing writer's direct-insert
    // shape. No approval is inferred from intake or from this fixture.
    await db.query("INSERT INTO mcp_submittals(id,job_id,number,revision) VALUES($1,$2,'CO1',0)", [
      co,
      job,
    ]);
    await db.query(
      "INSERT INTO mcp_change_orders(submittal_id,job_id,details) VALUES($1,$2,$3::jsonb)",
      [co, job, JSON.stringify({ state: "executed", total_cents: 5000 })],
    );
    await db.query(
      "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,internal_only,updated_by) VALUES($1,'sov','02',$2::jsonb,'known','member_answer',true,$3)",
      [
        job,
        JSON.stringify({
          description: "Approved change",
          billable_value: 50,
          cost_codes: ["09-100"],
          executed_change_order: co,
          fee_included: true,
        }),
        owner,
      ],
    );
    state.calls = [];
    const result = await call({
      sov_copy: "draft",
      sov_lines: [{ line: "01", billable_value: 300 }],
      fee_pct: 0,
      sov_basis: "Draft basis",
    });
    expect(state.calls.filter((c) => c === "mcp_estimate_destination_save")).toHaveLength(1);
    const after = await snapshot();
    expect(after).toMatchObject({
      sov: { "01": { billable_value: 200 } },
      sov_draft: {
        "01": { description: "Paint", billable_value: 300, spec_section: "09 90 00" },
        "02": { billable_value: 50, executed_change_order: co, fee_included: true },
      },
      terms: { fee_pct: 10, basis: "Executed base" },
      draft_terms: { fee_pct: 0, basis: "Draft basis" },
    });
    expect(result.content[0].text).toContain("$350.00");
    expect(result.content[0].text).toContain("Draft basis");
  });
  it("reads existing draft terms without a write and never uses later official metadata", async () => {
    const current = await snapshot();
    await rpc("mcp_estimate_destination_save", {
      _job: job,
      _expected_version: current.version,
      _basis: "Later official basis",
    });
    state.calls = [];
    const result = await call({ sov_copy: "draft" });
    expect(result.structuredContent).toMatchObject({ saved: false, sov_copy: "draft" });
    expect(result.content[0].text).toContain("$350.00");
    expect(result.content[0].text).toContain("Draft basis");
    expect(result.content[0].text).not.toContain("Later official basis");
    expect(state.calls).not.toContain("mcp_estimate_destination_save");
  });
  it("falls back only for legacy draft terms, then freezes inheritance on its next write", async () => {
    state.job = legacy;
    try {
      const loaded = await call({ sov_copy: "draft" });
      expect(loaded.content[0].text).toContain("$133.33");
      expect(loaded.content[0].text).toContain("Legacy official basis");
      const inherited = await snapshot();
      for (const change of [{ fee_pct: 20 }, { sov_basis: "Unreviewed inherited basis" }]) {
        state.calls = [];
        await expect(call({ sov_copy: "draft", ...change })).rejects.toThrow(
          /before replacing saved values/i,
        );
        expect(state.calls).not.toContain("mcp_estimate_destination_save");
        expect(await snapshot()).toEqual(inherited);
      }
      await call({ sov_copy: "draft", fee_pct: 10 });
      const captured = await snapshot();
      expect(captured.draft_terms).toEqual({ fee_pct: 10, basis: "Legacy official basis" });
      state.calls = [];
      await call({ sov_copy: "draft", fee_pct: 10 });
      expect(state.calls).not.toContain("mcp_estimate_destination_save");
      expect(await snapshot()).toEqual(captured);
      const reviewed = await call({ sov_copy: "draft" });
      await call({
        sov_copy: "draft",
        destination_version: reviewed.structuredContent.destination_version,
        sov_lines: [{ line: "01", description: "Reviewed legacy draft" }],
      });
      const saved = await snapshot();
      expect(saved.draft_terms).toEqual({ fee_pct: 10, basis: "Legacy official basis" });
      await rpc("mcp_estimate_destination_save", {
        _job: legacy,
        _expected_version: saved.version,
        _basis: "Later official source",
      });
      const again = await call({ sov_copy: "draft" });
      expect(again.content[0].text).toContain("Legacy official basis");
      expect((await snapshot()).sov_draft).toMatchObject({
        "01": { description: "Reviewed legacy draft", billable_value: 120 },
      });
    } finally {
      state.job = job;
    }
  });
  it("fails closed on old storage for edits or draft seeding while allowing a read-only view", async () => {
    state.unavailable = true;
    state.calls = [];
    try {
      await expect(call({ budget_lines: [{ cost_code: "09-100", amount: 1 }] })).rejects.toThrow(
        /unavailable/i,
      );
      const read = await call({ sov_copy: "draft" });
      expect(read.structuredContent).toMatchObject({ saved: false, destination_version: null });
      state.job = fresh;
      await expect(
        call({ sov_copy: "draft", sov_lines: [{ line: "01", billable_value: 10 }] }),
      ).rejects.toThrow(/unavailable/i);
      expect(state.calls).not.toContain("mcp_set_facts");
    } finally {
      state.unavailable = false;
      state.job = job;
    }
  });
  it("preserves a later reviewed correction after response loss and exact stale retries", async () => {
    const before = await snapshot();
    state.loseResponse = true;
    const input = {
      destination_version: before.version,
      budget_lines: [{ cost_code: "09-100", amount: 101 }],
    };
    await expect(call(input)).rejects.toThrow(/after commit/i);
    expect((await snapshot()).budget).toMatchObject({ "09-100": { amount: 101 } });
    const committed = await snapshot();
    await rpc("mcp_estimate_destination_save", {
      _job: job,
      _expected_version: committed.version,
      _budget: { "09-100": { description: "Reviewed later correction", amount: 200 } },
    });
    const later = await snapshot();
    state.calls = [];
    await expect(call(input)).rejects.toThrow(/destination changed/i);
    await expect(call({ budget_lines: input.budget_lines })).rejects.toThrow(
      /read and review.*before replacing/i,
    );
    await expect(
      call({ ...input, budget_lines: [{ cost_code: "09-100", amount: 300 }] }),
    ).rejects.toThrow(/destination changed/i);
    expect(state.calls).not.toContain("mcp_estimate_destination_save");
    expect(await snapshot()).toEqual(later);
    const read = await call();
    expect(read.structuredContent.saved).toBe(false);
    expect(read.structuredContent.destination).toMatchObject({
      budget: { "09-100": { amount: 200 } },
    });
    expect((read.structuredContent.assistant_guidance as string[]).join(" ")).toMatch(
      /never automatically rebase/i,
    );
  });
  it("permits unversioned creates, no-ops and unique appends but rejects a mixed replacement atomically", async () => {
    const initial = await call({
      budget_lines: [{ cost_code: "NEW", description: "New scope", amount: 0 }],
    });
    const before = await snapshot();
    await call({ budget_lines: [{ cost_code: "NEW", amount: 0 }] });
    expect((await snapshot()).version).toBe(initial.structuredContent.destination_version);
    state.calls = [];
    await expect(
      call({
        budget_lines: [
          { cost_code: "NEW", amount: 1 },
          { cost_code: "ANOTHER", amount: 2 },
        ],
      }),
    ).rejects.toThrow(/before replacing saved values/i);
    expect(state.calls).not.toContain("mcp_estimate_destination_save");
    expect(await snapshot()).toEqual(before);
  });
  it("requires caller review for existing draft values and known terms, then permits the exact versioned correction", async () => {
    const before = await snapshot();
    for (const input of [
      { sov_basis: "Unreviewed official basis" },
      { sov_copy: "draft", fee_pct: 5 },
      { sov_copy: "draft", sov_basis: "Unreviewed draft basis" },
      { sov_copy: "draft", sov_lines: [{ line: "01", billable_value: 999 }] },
    ]) {
      state.calls = [];
      await expect(call(input)).rejects.toThrow(/before replacing saved values/i);
      expect(state.calls).not.toContain("mcp_estimate_destination_save");
      expect(await snapshot()).toEqual(before);
    }
    const observed = await call({ sov_copy: "draft" });
    const correction = {
      sov_copy: "draft",
      destination_version: observed.structuredContent.destination_version,
      sov_lines: [{ line: "01", billable_value: 0 }],
    };
    await call(correction);
    const changed = await snapshot();
    expect(changed.sov_draft).toMatchObject({ "01": { billable_value: 0 } });
    await expect(call(correction)).rejects.toThrow(/destination changed/i);
    expect(await snapshot()).toEqual(changed);
  });
  it("rejects duplicate cost codes, ambiguous draft/budget writes and unpersistable fee precision", async () => {
    state.calls = [];
    await expect(
      call({
        budget_lines: [
          { cost_code: "X", amount: 1 },
          { cost_code: "X", amount: 2 },
        ],
      }),
    ).rejects.toThrow(/occur once/i);
    await expect(
      call({ sov_copy: "draft", budget_lines: [{ cost_code: "X", amount: 1 }] }),
    ).rejects.toThrow(/save the intended budget separately/i);
    await expect(call({ sov_copy: "draft", fee_pct: 1.23456 })).rejects.toThrow(
      /four decimal places/i,
    );
    expect(state.calls).toEqual([]);
  });
  it.each(["null", "wrong_identity"] as const)(
    "reports an uncertain %s success response without claiming rollback",
    async (kind) => {
      const before = await snapshot();
      state.malformedSuccess = kind;
      const amount = kind === "null" ? 102 : 103;
      const input = {
        destination_version: before.version,
        budget_lines: [{ cost_code: "09-100", amount }],
      };
      await expect(call(input)).rejects.toThrow(
        /save result could not be verified.*read current destination state before retrying/i,
      );
      expect((await snapshot()).budget).toMatchObject({ "09-100": { amount } });
      await expect(call(input)).rejects.toThrow(/destination changed/i);
    },
  );
  it("holds malformed saved source flags before changing or rendering the draft", async () => {
    state.job = legacyBad;
    const sql = "SELECT to_jsonb(f) AS row FROM mcp_job_facts f WHERE job_id=$1 ORDER BY id";
    const before = (await db.query(sql, [legacyBad])).rows;
    state.calls = [];
    try {
      await expect(
        call({ sov_copy: "draft", sov_lines: [{ line: "01", description: "Would change" }] }),
      ).rejects.toThrow(/fee_included must be a boolean/i);
      expect(state.calls).not.toContain("mcp_estimate_destination_save");
      expect((await db.query(sql, [legacyBad])).rows).toEqual(before);
    } finally {
      state.job = job;
    }
  });
});
