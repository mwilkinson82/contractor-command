import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const OWNER = "00000000-0000-4000-8000-000000000010";
const ESTIMATING = "00000000-0000-4000-8000-000000000014";
const SUPER = "00000000-0000-4000-8000-000000000015";
const OUTSIDER = "00000000-0000-4000-8000-000000000019";
const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ITEM_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ITEM_B = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ITEM_C = "99999999-9999-4999-8999-999999999999";

const box = vi.hoisted(() => ({
  db: null as PGlite | null,
  claims: { sub: "00000000-0000-4000-8000-000000000010", email: "owner@pm-agent-roles.test.invalid", role: "authenticated" as const },
}));

vi.mock("./supabase", async () => {
  const { fakeClient } = await import("../../../tests/mcp-roles/fake-supabase");
  return {
    supabaseForUser() {
      if (!box.db) throw new Error("db not ready");
      return fakeClient(box.db, box.claims);
    },
  };
});

import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { resolveItem } from "./tools/workflow-tools";

type Reply = {
  content: { type: string; text?: string }[];
  structuredContent?: { reopened?: boolean; closed?: boolean; card?: { next_move?: string | null } };
};

const ctx = {
  isAuthenticated: () => true,
  getToken: () => "t",
  getUserId: () => box.claims.sub,
};

const call = (args: Record<string, unknown>) =>
  (resolveItem as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(args, ctx);

const textOf = (r: Reply) => r.content.map((c) => c.text ?? "").join("\n");

type ItemRow = {
  id: string;
  status: string;
  resolution: string | null;
  resolved_at: string | null;
  verified_at: string | null;
  verified_evidence: string | null;
  verify_state: string;
};

async function item(id: string): Promise<ItemRow> {
  const row = await box.db!.query<ItemRow>(
    `SELECT id, status, resolution, resolved_at::text, verified_at::text, verified_evidence, verify_state FROM public.mcp_open_items WHERE id = $1`,
    [id],
  );
  return row.rows[0];
}

describe.sequential("resolve_item reopen", () => {
  beforeAll(async () => {
    box.db = await makeDb();
    const db = box.db;
    for (const [id, email] of [
      [OWNER, "owner@pm-agent-roles.test.invalid"],
      [ESTIMATING, "estimating@pm-agent-roles.test.invalid"],
      [SUPER, "super@pm-agent-roles.test.invalid"],
      [OUTSIDER, "outsider@pm-agent-roles.test.invalid"],
    ] as const) {
      await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, email]);
      await db.query(`INSERT INTO public.test_active_members VALUES ($1)`, [id]);
    }
    await db.query(`INSERT INTO public.mcp_companies (id, name, created_by) VALUES ($1, 'TEST Reopen Co', $2)`, [COMPANY, OWNER]);
    await db.query(
      `INSERT INTO public.mcp_company_members (company_id, user_id, display_name, role) VALUES ($1, $2, 'Test Owner', 'owner'), ($1, $3, 'Test Estimating', 'estimating'), ($1, $4, 'Test Super', 'super')`,
      [COMPANY, OWNER, ESTIMATING, SUPER],
    );
    await db.query(
      `INSERT INTO public.mcp_jobs (id, user_id, name, job_number, company_id, time_zone) VALUES ($1, $2, 'Harbor Point', '2701', $3, 'America/Chicago')`,
      [JOB, OWNER, COMPANY],
    );
    await db.query(`INSERT INTO public.mcp_lookaheads (id, user_id, job_id) VALUES ($1, $2, $3)`, [LA, OWNER, JOB]);
    await db.query(
      `INSERT INTO public.mcp_job_access (job_id, user_id, granted_by) VALUES ($1, $2, $3)`,
      [JOB, SUPER, OWNER],
    );
    for (const [id, action, key] of [
      [ITEM_A, "Confirm fixture submittal", "general:a"],
      [ITEM_B, "Confirm panel schedule", "general:b"],
      [ITEM_C, "Confirm gear delivery", "general:c"],
    ] as const) {
      await db.query(
        `INSERT INTO public.mcp_open_items (id, user_id, job_id, lookahead_id, origin_lookahead_id, check_key, check_version, trade, category, severity, action, owner, company_id, job_number)
         VALUES ($1, $2, $3, $4, $4, $5, 1, 'general', 'General', 'medium', $6, 'Test Owner', $7, '2701')`,
        [id, OWNER, JOB, LA, key, action, COMPANY],
      );
    }
  }, 120_000);

  it("closes one item and leaves the others open", async () => {
    const closed = await call({
      job_number: "2701",
      item_id: ITEM_A,
      kind: "verified",
      evidence: "Approved submittal 014 dated 2026-10-19",
    });
    expect(textOf(closed)).toContain("Item closed:");
    expect(closed.structuredContent?.reopened).toBeUndefined();
    expect((await item(ITEM_A)).status).toBe("resolved");
    expect((await item(ITEM_B)).status).toBe("open");
    expect((await item(ITEM_C)).status).toBe("open");
    const events = await box.db!.query<{ item_id: string; event: string }>(
      `SELECT item_id, event FROM public.mcp_item_events WHERE event = 'resolved'`,
    );
    expect(events.rows.map((r) => r.item_id)).toEqual([ITEM_A]);
  }, 120_000);

  it("reopens only the named closed item and logs reopened", async () => {
    const also = await call({
      job_number: "2701",
      item_id: ITEM_C,
      kind: "verified",
      evidence: "Approved submittal 015 dated 2026-10-19",
    });
    expect(textOf(also)).toContain("Item closed:");
    const before = await item(ITEM_C);
    expect(before.resolution).toBe("verified");
    expect(before.verified_evidence).toBeTruthy();

    box.claims = { ...box.claims, sub: OWNER, email: "owner@pm-agent-roles.test.invalid" };
    const opened = await call({ job_number: "2701", item_id: ITEM_A, kind: "reopen" });
    expect(textOf(opened)).toContain("Item reopened: Confirm fixture submittal");
    expect(textOf(opened)).toContain("It is open again.");
    expect(opened.structuredContent?.reopened).toBe(true);
    expect(opened.structuredContent?.closed).toBe(false);
    expect(opened.structuredContent?.card?.next_move).toBe("The item is open again.");

    const again = await item(ITEM_A);
    expect(again.status).toBe("open");
    expect(again.resolution).toBeNull();
    expect(again.resolved_at).toBeNull();
    expect(again.verified_at).toBeNull();
    expect(again.verified_evidence).toBeNull();
    expect(again.verify_state).toBe("last_reported");

    const still = await item(ITEM_C);
    expect(still.status).toBe("resolved");
    expect(still.resolution).toBe("verified");
    expect(still.verified_evidence).toBe(before.verified_evidence);
    expect((await item(ITEM_B)).status).toBe("open");

    const events = await box.db!.query<{ item_id: string; event: string }>(
      `SELECT item_id, event FROM public.mcp_item_events WHERE event = 'reopened'`,
    );
    expect(events.rows).toEqual([{ item_id: ITEM_A, event: "reopened" }]);
  }, 120_000);

  it("refuses to reopen an item that is still open", async () => {
    await expect(call({ job_number: "2701", item_id: ITEM_B, kind: "reopen" })).rejects.toThrow(/No closed item/);
    expect((await item(ITEM_B)).status).toBe("open");
  }, 120_000);

  it("stays inside the caller's company and full job scope", async () => {
    const claims = (sub: string, email: string) => ({ sub, email, role: "authenticated" as const });
    const denied = async (sub: string, email: string) =>
      asUser(box.db!, claims(sub, email), async (tx) => {
        try {
          await tx.query(
            `SELECT public.mcp_resolve_item($1, 'reopen', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
            [ITEM_C],
          );
          return "reopened";
        } catch (error) {
          return (error as Error).message;
        }
      });
    expect(await denied(ESTIMATING, "estimating@pm-agent-roles.test.invalid")).toMatch(/MCP_NO_ITEM/);
    expect(await denied(OUTSIDER, "outsider@pm-agent-roles.test.invalid")).toMatch(/MCP_NO_ITEM/);
    expect((await item(ITEM_C)).status).toBe("resolved");

    box.claims = claims(SUPER, "super@pm-agent-roles.test.invalid");
    await expect(call({ job_number: "2701", item_id: ITEM_C, kind: "reopen" })).rejects.toThrow(/limited, read-only view/);
    expect((await item(ITEM_C)).status).toBe("resolved");
  }, 120_000);

  it("keeps the drizzle and supabase reopen statements in step", () => {
    const drizzle = readFileSync("drizzle/migrations/0024_athena_reopen_open_item.sql", "utf8");
    const supabase = readFileSync("supabase/migrations/20261025120000_athena_reopen_open_item.sql", "utf8");
    for (const sql of [drizzle, supabase]) {
      expect(sql).toContain("status = 'open'");
      expect(sql).toContain("resolution = NULL");
      expect(sql).toContain("resolved_at = NULL");
      expect(sql).toContain("verified_at = NULL");
      expect(sql).toContain("verified_evidence = NULL");
      expect(sql).toContain("verify_state = 'last_reported'");
      expect(sql).toContain("updated_at = now()");
      expect(sql).toContain("'reopened'");
      expect(sql).toContain("mcp_can_access_job(it.job_id)");
    }
  });
});
