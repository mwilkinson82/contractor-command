import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000901";
const outsider = "00000000-0000-4000-8000-000000000902";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
let db: PGlite;
const rpc = (name: string, args: unknown[], user = owner) =>
  asUser(
    db,
    { sub: user, email: "fixture@example.com", role: "authenticated" },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
          args,
        )
      ).rows[0].data,
  );
const board = () => ({
  currency: "USD",
  selections: [
    {
      id: "72087ad6-fc97-4938-97b3-802803bf49c5",
      title: "LED fixture",
      decision_due: null,
      allowance_cents: 50000,
      options: {
        good: {
          description: "Standard",
          cost_cents: 40000,
          price_cents: 40000,
          specifications: "",
          source_url: null,
          photo_url: null,
        },
        better: {
          description: "Premium",
          cost_cents: 60000,
          price_cents: 60000,
          specifications: "",
          source_url: null,
          photo_url: null,
        },
        best: {
          description: "High performance",
          cost_cents: null,
          price_cents: null,
          specifications: "",
          source_url: null,
          photo_url: null,
        },
      },
      selected: null,
      notes: "Sample only",
    },
  ],
});

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec("ALTER FUNCTION public.mcp_estimate_guard(uuid) VOLATILE");
  await db.exec(readFileSync("release-proposals/residential-selections.sql", "utf8"));
  for (const id of [owner, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.com')", [id]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [id]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Test',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Member')",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Test','LOCAL',$3)",
    [job, owner, company],
  );
});
afterAll(async () => db?.close());

describe.sequential("private selection storage proposal", () => {
  it("saves and reads exact data, and rejects stale versions", async () => {
    expect(await rpc("mcp_residential_selections_get", [job])).toMatchObject({
      version: 0,
      board: { currency: null, selections: [] },
    });
    expect(
      await rpc("mcp_residential_selections_save", [job, 0, JSON.stringify(board())]),
    ).toMatchObject({ version: 1, board: board() });
    await expect(
      rpc("mcp_residential_selections_save", [job, 0, JSON.stringify(board())]),
    ).rejects.toThrow(/changed/i);
    expect(await rpc("mcp_residential_selections_get", [job])).toMatchObject({
      version: 1,
      board: board(),
    });
  });
  it("refuses another company and direct authenticated access to the private table", async () => {
    await expect(rpc("mcp_residential_selections_get", [job], outsider)).rejects.toThrow();
    await expect(
      rpc("mcp_residential_selections_save", [job, 1, JSON.stringify(board())], outsider),
    ).rejects.toThrow();
    const result = await db.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('authenticated','mcp_private.residential_selection_boards','SELECT') AS allowed",
    );
    expect(result.rows[0].allowed).toBe(false);
  });
  it("validates direct RPC input and does not change the saved board on failure", async () => {
    const invalid = board();
    invalid.selections[0].allowance_cents = -1;
    await expect(
      rpc("mcp_residential_selections_save", [job, 1, JSON.stringify(invalid)]),
    ).rejects.toThrow(/allowance/i);
    const invalidDate = board();
    invalidDate.selections[0].decision_due = "2026-02-30" as never;
    await expect(
      rpc("mcp_residential_selections_save", [job, 1, JSON.stringify(invalidDate)]),
    ).rejects.toThrow(/date/i);
    expect(await rpc("mcp_residential_selections_get", [job])).toMatchObject({
      version: 1,
      board: board(),
    });
  });
});
