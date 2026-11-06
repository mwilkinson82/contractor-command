import { describe, expect, it, vi } from "vitest";

// A tiny query recorder standing in for Supabase: enough for loadChecks, loadAnswers and the stale-skip delete.
const state = vi.hoisted(() => ({
  checks: [] as Record<string, unknown>[],
  answers: [] as Record<string, unknown>[],
  deleted: [] as string[],
}));

function query(table: string) {
  const filters: [string, string, unknown][] = [];
  let del = false;
  const q = {
    select: () => q,
    insert: (row: Record<string, unknown>) => {
      if (table === "mcp_answers") state.answers.push(row);
      return Promise.resolve({ error: null });
    },
    delete: () => ((del = true), q),
    eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
    in: (c: string, v: unknown) => (filters.push(["in", c, v]), q),
    then: (res: (v: { data: unknown; error: null }) => unknown) => {
      const match = (r: Record<string, unknown>) =>
        filters.every(([op, c, v]) => (op === "eq" ? r[c] === v : (v as unknown[]).includes(r[c])));
      if (table === "mcp_checklist_items") return Promise.resolve(res({ data: state.checks.filter(match), error: null }));
      if (del) {
        const gone = state.answers.filter(match);
        state.deleted.push(...gone.map((g) => String(g.check_key)));
        state.answers = state.answers.filter((r) => !match(r));
        return Promise.resolve(res({ data: null, error: null }));
      }
      if (table === "mcp_workflow_log") return Promise.resolve(res({ data: null, error: null }));
      return Promise.resolve(res({ data: state.answers.filter(match), error: null }));
    },
  };
  return q;
}
const client = { from: (t: string) => query(t), rpc: () => Promise.resolve({ data: null, error: null }) };

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: client }));
vi.mock("./guard", () => ({ logWorkflow: () => Promise.resolve() }));

import { currentCheck, type Lookahead } from "./workflow";

const check = (key: string, position: number, required_inputs: string[]) => ({
  module: "lookahead", active: true, key, version: 1, category: key, trade: "Electrical", prompt: key, rule_type: "list", required_inputs, severity: "medium", position,
});

describe("lookahead checks skipped for missing inputs", () => {
  it("asks them again once a revision supplies the inputs, and keeps real answers", async () => {
    state.checks = [check("la-inspections", 1, ["inspection_list"]), check("la-deliveries", 2, ["deliveries"]), check("la-rfis", 3, ["rfi_log"])];
    state.answers = [
      { lookahead_id: "la1", check_key: "la-inspections", status: "skipped_missing_inputs" },
      { lookahead_id: "la1", check_key: "la-deliveries", status: "answered" },
      { lookahead_id: "la1", check_key: "la-rfis", status: "skipped_missing_inputs" },
    ];
    state.deleted = [];
    const la: Lookahead = { id: "la1", job_id: "j1", start_date: null, end_date: null, provided_inputs: ["inspection_list", "deliveries"], missing_inputs: ["rfi_log"] };
    const r = await currentCheck(client as never, la, "next_question");
    expect(r.check?.key).toBe("la-inspections");
    // The RFI check still lacks its input, so its skip stays; the answered deliveries check is untouched.
    expect(state.deleted).toEqual(["la-inspections"]);
    expect(state.answers.map((a) => a.check_key).sort()).toEqual(["la-deliveries", "la-rfis"]);
  });
});
