// PostgREST runs a STABLE RPC in a READ ONLY transaction, even for POST. A reader that goes through
// mcp_assert_active (whose Circle sync locks and can update rows) must be VOLATILE, or it fails for
// every Contractor Circle member (support ticket ATH-0008). This keeps new readers from repeating it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20261106200000_athena_member_read_transactions.sql";
const sqlFiles = [
  ...readdirSync("drizzle/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join("drizzle/migrations", f)),
  ...readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join("supabase/migrations", f)),
  ...readdirSync("release-proposals")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join("release-proposals", f)),
];
const supabaseOrder = (f: string) => f.split("/").pop()!;

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

/** Latest supabase definition of each public function: volatility and whether it goes through the gate. */
function latestDefinitions() {
  const defs = new Map<string, { stable: boolean; gated: boolean; file: string }>();
  const files = sqlFiles
    .filter((f) => f.startsWith("supabase/"))
    .sort((a, b) => supabaseOrder(a).localeCompare(supabaseOrder(b)));
  const create =
    /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_0-9]+)\(([^)]*)\)([\s\S]*?)AS \$([a-z_]*)\$([\s\S]*?)\$\4\$/gi;
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(create))
      defs.set(m[1], {
        stable: /\b(STABLE|IMMUTABLE)\b/i.test(m[3]),
        gated: /mcp_assert_active\s*\(/.test(m[5]),
        file: f,
      });
  }
  return defs;
}

function madeVolatile(): Set<string> {
  const out = new Set<string>();
  for (const f of sqlFiles)
    for (const m of readFileSync(f, "utf8").matchAll(
      /ALTER FUNCTION public\.([a-z_0-9]+)\([^)]*\)\s+VOLATILE/gi,
    ))
      out.add(m[1]);
  return out;
}

describe("member readers called through PostgREST", () => {
  it("makes every gated STABLE reader the app calls by RPC volatile", () => {
    const defs = latestDefinitions();
    const fixed = madeVolatile();
    const called = new Set<string>();
    for (const f of srcFiles("src"))
      for (const m of readFileSync(f, "utf8").matchAll(/(?<!\.from\(\s*)["'](mcp_[a-z_0-9]+)["']/g))
        called.add(m[1]); // .from() is a table read, not an RPC
    const missing = [...defs]
      .filter(([name, d]) => d.stable && d.gated && called.has(name) && !fixed.has(name))
      .map(([name]) => name)
      .sort();
    expect(missing).toEqual([]);
  });

  it("changes only volatility, for the readers ATH-0008 found", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const code = sql.replace(/--.*$/gm, "");
    const alters = [...code.matchAll(/ALTER FUNCTION public\.([a-z_0-9]+)\(([^)]*)\) VOLATILE;/g)]
      .map((m) => m[1])
      .sort();
    expect(alters).toEqual(
      [
        "mcp_change_order_pricing_list",
        "mcp_client_payments_get",
        "mcp_job_contract_rows",
        "mcp_job_import_context",
        "mcp_job_log_rows",
        "mcp_job_terms",
        "mcp_project_record_feed",
        "mcp_push_test_targets",
        "mcp_service_calls_list",
        "mcp_service_rates_get",
      ].sort(),
    );
    expect(code).not.toMatch(/\b(GRANT|REVOKE|CREATE|DROP|DELETE|INSERT|UPDATE)\b/i);
    const defs = latestDefinitions();
    for (const name of alters) expect(defs.get(name), name).toMatchObject({ gated: true });
  });
});
