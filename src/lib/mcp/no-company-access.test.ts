import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "@lovable.dev/mcp-js";
import {
  COMPANY_SETUP_GUIDANCE,
  CONFIRMING_MESSAGE,
  companySetupCard,
  confirmingCard,
  decideAccess,
  type AthenaAccess,
  type PaidPeriod,
} from "./access";
import { paletteViolations } from "./cards/palette";
import { renderHtml } from "./cards/html";
import { checkAthenaEntitlement, type RpcClient } from "./entitlement";
import { CompanySetupRequired, INACTIVE_MESSAGE, guard, run } from "./guard";
import { visibleProblems } from "./visible";
import { athenaHello, morningBrief } from "./tools/morning-brief-tools";
import { gettingStarted } from "./tools/getting-started-tool";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({
  supabaseForUser: () => ({ rpc, from }),
  supabaseForToken: () => ({ rpc, from }),
}));

const ctx = { isAuthenticated: () => true, getToken: () => "t" } as never;

function access(over: Partial<AthenaAccess> = {}): AthenaAccess {
  return {
    state: "eligible",
    reason: "paid_period",
    has_access: true,
    circle_active: true,
    has_company: false,
    company_seat: false,
    paid_period: "current",
    past_due: false,
    ...over,
  };
}

function client(row: AthenaAccess | null, gate = false): RpcClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (fn: string) => {
      calls.push(fn);
      if (fn === "mcp_gate") return { data: gate, error: null };
      if (fn === "mcp_athena_access") return row ? { data: row, error: null } : { data: null, error: { message: "missing" } };
      return { data: null, error: { message: "unexpected" } };
    },
  };
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  from.mockImplementation(() => {
    throw new Error("company lookup");
  });
});

function script(payload: AthenaAccess) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "mcp_abuse_cap_check") return { data: { ok: true }, error: null };
    if (fn === "mcp_gate") return { data: payload.circle_active || payload.has_access, error: null };
    if (fn === "mcp_athena_access") return { data: payload, error: null };
    if (fn === "mcp_security_touch") return { data: { ok: true, canary: null }, error: null };
    if (fn === "mcp_session_touch") return { data: false, error: null };
    return { data: null, error: null };
  });
}

type Reply = {
  content: { text: string }[];
  structuredContent?: { card?: { title: string }; assistant_guidance?: string[]; company_setup?: boolean; membership_confirming?: boolean };
};

function textOf(result: Reply): string {
  return result.content.map((c) => c.text).join("\n");
}

describe("decideAccess", () => {
  it("sends an active Circle member with no company into setup", () => {
    expect(decideAccess(access())).toEqual({ kind: "setup" });
  });

  it("leaves an active member who already has a company alone", () => {
    expect(decideAccess(access({ has_company: true }))).toEqual({ kind: "allow" });
  });

  it("keeps a past_due member with a current paid period allowed", () => {
    expect(
      decideAccess(access({ state: "eligible", reason: "paid_period", paid_period: "current", has_company: true, past_due: true })),
    ).toEqual({ kind: "allow" });
  });

  it("past_due with a stale paid period stays allowed", () => {
    const pastDueStale = access({
      state: "review",
      reason: "membership_review_required",
      has_access: false,
      circle_active: false,
      has_company: true,
      paid_period: "stale",
      past_due: true,
    });
    expect(decideAccess(pastDueStale)).toEqual({ kind: "allow" });
    expect(decideAccess({ ...pastDueStale, has_company: false }).kind).toBe("setup");
    expect(
      decideAccess(access({ state: "ineligible", has_access: false, circle_active: false, has_company: true, paid_period: "stale", past_due: false })).kind,
    ).toBe("confirming");
  });

  it("shows the confirming message for review, stale, and missing paid periods", () => {
    const blocked = { has_access: false, circle_active: false, has_company: false, company_seat: false };
    expect(decideAccess(access({ ...blocked, state: "review", reason: "membership_review_required", paid_period: "missing" }))).toEqual({
      kind: "confirming",
      reason: "membership_review_required",
      paidPeriod: "missing",
    });
    expect(decideAccess(access({ ...blocked, state: "ineligible", reason: "no_current_entitlement", paid_period: "stale" })).kind).toBe("confirming");
    expect(decideAccess(access({ ...blocked, state: "ineligible", reason: "no_current_entitlement", paid_period: "none" }))).toEqual({ kind: "paused" });
  });
});

describe("checkAthenaEntitlement detail", () => {
  it("does not call a Circle member with no company unentitled", async () => {
    const sb = client(access(), true);
    expect(await checkAthenaEntitlement(sb)).toEqual({ allowed: true, source: "circle", needsCompany: true });
  });

  it("company seat on a plan mcp_gate denies stays denied", async () => {
    const sb = client(
      access({
        state: "ineligible",
        reason: "no_current_entitlement",
        has_access: true,
        circle_active: false,
        has_company: true,
        company_seat: true,
        past_due: false,
        paid_period: "none",
      }),
      false,
    );
    expect(await checkAthenaEntitlement(sb)).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("returns confirming instead of the paused reason", async () => {
    const sb = client(
      access({
        state: "review",
        reason: "membership_review_required",
        has_access: false,
        circle_active: false,
        paid_period: "missing",
      }),
      false,
    );
    expect(await checkAthenaEntitlement(sb)).toEqual({
      allowed: false,
      reason: "confirming",
      confirmReason: "membership_review_required",
      paidPeriod: "missing" satisfies PaidPeriod,
    });
  });

  it("keeps a non-member on no_entitlement when the detail says so", async () => {
    const sb = client(
      access({
        state: "ineligible",
        reason: "no_current_entitlement",
        has_access: false,
        circle_active: false,
        paid_period: "none",
      }),
      false,
    );
    expect(await checkAthenaEntitlement(sb)).toEqual({ allowed: false, reason: "no_entitlement" });
  });
});

describe("no-company tool path", () => {
  const noCompany = access();

  beforeEach(() => script(noCompany));

  it("routes a plain greeting into company setup before any company lookup", async () => {
    const result = (await athenaHello.handler({}, ctx)) as Reply;
    const shown = textOf(result);
    expect(result.structuredContent?.company_setup).toBe(true);
    expect(result.structuredContent?.card?.title).toBe("Welcome. Let's set up your company");
    expect(shown).toContain("What is the company name?");
    expect(shown).toContain("Circle includes 5 seats");
    expect(shown).not.toMatch(/MCP_NO_COMPANY|no seat|isn't active|lovable/i);
    expect(shown).not.toMatch(/save_company/);
    expect(result.structuredContent?.assistant_guidance?.join("\n")).toContain(COMPANY_SETUP_GUIDANCE);
    expect(visibleProblems(shown)).toEqual([]);
    expect(paletteViolations(shown, false)).toEqual([]);
    expect(shown).toContain("#1E5FED");
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("mcp_security_touch");
  });

  it("routes a morning brief task ask into company setup", async () => {
    const result = (await morningBrief.handler({}, ctx)) as Reply;
    expect(result.structuredContent?.company_setup).toBe(true);
    expect(textOf(result)).toContain("Welcome. Let's set up your company");
    expect(from).not.toHaveBeenCalled();
  });

  it("routes let's get started into company setup", async () => {
    const result = (await gettingStarted.handler({}, ctx)) as Reply;
    expect(result.structuredContent?.company_setup).toBe(true);
    expect(textOf(result)).toContain("What is the company name?");
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("mcp_getting_started_claim");
    expect(from).not.toHaveBeenCalled();
  });

  it("turns an onboarding company miss into the same setup card", async () => {
    const fn = vi.fn(async () => {
      throw new ToolError("MCP_NO_COMPANY");
    });
    const result = (await run("onboarding", ctx, undefined, fn)) as Reply;
    expect(fn).toHaveBeenCalled();
    expect(result.structuredContent?.company_setup).toBe(true);
    expect(textOf(result)).toContain("Welcome. Let's set up your company");
  });
});

describe("membership messages", () => {
  it("review state shows the confirming message and logs the reason", async () => {
    const inserts: { table: string; row: { error_code?: string } }[] = [];
    from.mockImplementation((table: string) => ({
      insert: async (row: { error_code?: string }) => {
        inserts.push({ table, row });
        return { error: null };
      },
    }));
    script(
      access({
        state: "review",
        reason: "membership_review_required",
        has_access: false,
        circle_active: false,
        paid_period: "missing",
      }),
    );
    const fn = vi.fn();
    const result = (await run("morning_brief", ctx, {}, fn)) as Reply;
    expect(fn).not.toHaveBeenCalled();
    const shown = textOf(result);
    expect(shown).toContain(CONFIRMING_MESSAGE);
    expect(shown).not.toContain(INACTIVE_MESSAGE);
    expect(shown).not.toMatch(/lovable/i);
    expect(paletteViolations(renderHtml(confirmingCard()), false)).toEqual([]);
    expect(inserts).toEqual([
      {
        table: "mcp_workflow_log",
        row: expect.objectContaining({ error_code: "confirming:membership_review_required:missing" }),
      },
    ]);
  });

  it("a stale paid period uses the confirming message, not the paused one", async () => {
    from.mockImplementation(() => ({ insert: async () => ({ error: null }) }));
    script(
      access({
        state: "ineligible",
        reason: "no_current_entitlement",
        has_access: false,
        circle_active: false,
        paid_period: "stale",
      }),
    );
    const result = (await run("report", ctx, {}, vi.fn())) as Reply;
    expect(textOf(result)).toContain(CONFIRMING_MESSAGE);
    expect(textOf(result)).not.toContain("paused");
  });

  it("a non-member still gets the paused message", async () => {
    from.mockImplementation(() => ({ insert: async () => ({ error: null }) }));
    script(
      access({
        state: "ineligible",
        reason: "no_current_entitlement",
        has_access: false,
        circle_active: false,
        paid_period: "none",
      }),
    );
    await expect(run("report", ctx, {}, vi.fn())).rejects.toThrow(INACTIVE_MESSAGE);
  });

  it("an existing company member still runs the tool", async () => {
    script(access({ has_company: true }));
    const fn = vi.fn(async () => ({ content: [{ type: "text" as const, text: "Harbor Point schedule" }] }));
    const result = (await run("report", ctx, {}, fn)) as Reply;
    expect(fn).toHaveBeenCalled();
    expect(textOf(result)).toContain("Harbor Point schedule");
    expect(textOf(result)).not.toContain("Let's set up your company");
  });

  it("past_due with a stale paid period runs the tool and does not confirm membership", async () => {
    script(
      access({
        state: "review",
        reason: "membership_review_required",
        has_access: false,
        circle_active: false,
        has_company: true,
        paid_period: "stale",
        past_due: true,
      }),
    );
    const fn = vi.fn(async () => ({ content: [{ type: "text" as const, text: "Still on the job" }] }));
    const result = (await run("report", ctx, {}, fn)) as Reply;
    expect(fn).toHaveBeenCalled();
    expect(textOf(result)).toContain("Still on the job");
    expect(textOf(result)).not.toContain(CONFIRMING_MESSAGE);
    expect(textOf(result)).not.toContain(INACTIVE_MESSAGE);
  });

  it("a past_due member with a current paid period and a company still runs the tool", async () => {
    script(access({ has_company: true, state: "eligible", reason: "paid_period", paid_period: "current" }));
    const fn = vi.fn(async () => ({ content: [{ type: "text" as const, text: "Still on the job" }] }));
    const result = (await run("report", ctx, {}, fn)) as Reply;
    expect(fn).toHaveBeenCalled();
    expect(textOf(result)).toContain("Still on the job");
  });
});

describe("guard() itself", () => {
  it("refuses a confirming member before any job read", async () => {
    const tables: string[] = [];
    from.mockImplementation((table: string) => {
      tables.push(table);
      return { insert: async () => ({ error: null }), select: () => { throw new Error("job read"); } };
    });
    script(
      access({
        state: "review",
        reason: "membership_review_required",
        has_access: false,
        circle_active: false,
        has_company: true,
        paid_period: "missing",
        past_due: false,
      }),
    );
    await expect(guard(ctx)).rejects.toThrow(CONFIRMING_MESSAGE);
    expect(tables).toEqual(["mcp_workflow_log"]);
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("mcp_security_touch");
  });

  it("refuses a circle member with no company before any job read", async () => {
    const tables: string[] = [];
    from.mockImplementation((table: string) => {
      tables.push(table);
      return { select: () => { throw new Error("job read"); } };
    });
    script(access());
    await expect(guard(ctx)).rejects.toBeInstanceOf(CompanySetupRequired);
    expect(tables).toEqual([]);
  });
});

function productionSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...productionSources(path));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("direct guard() callers", () => {
  it("run() is the only production caller", () => {
    const callers = productionSources("src").filter((file) => {
      const text = readFileSync(file, "utf8");
      return /\bawait guard\(/.test(text) || /\bguard\(ctx\b/.test(text);
    });
    expect(callers).toEqual(["src/lib/mcp/guard.ts"]);
  });
});

describe("access migration", () => {
  const sql = readFileSync("supabase/migrations/20261026140000_athena_circle_access_detail.sql", "utf8");

  it("only adds mcp_athena_access", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.mcp_athena_access()");
    expect(sql).toContain("circle_active := circle_active OR past_due");
    const cache = readFileSync("supabase/migrations/20261026160000_athena_access_cache.sql", "utf8");
    expect(cache).toContain("interval '5 minutes'");
    expect(cache).toContain("mcp_gate_cache");
    expect(cache).toContain("user_id");
    expect(cache).not.toMatch(/ALTER TABLE public\.mcp_gate_cache/);
    expect(sql).not.toMatch(/ALTER TABLE|UPDATE public\.|DELETE FROM|DROP TABLE|DROP FUNCTION/i);
    expect(renderHtml(companySetupCard())).toContain("#1E5FED");
    expect(companySetupCard().title).not.toMatch(/lovable/i);
  });
});
