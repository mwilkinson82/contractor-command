import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "./mcp-roles/db";

/** Same role-aware suite against PGlite or an isolated native PG17 Unix socket.
 * Native server lifecycle belongs to scripts/test-scheduling-buyout-native.mjs.
 * No remote connection URL, password, existing database or live role is accepted.
 */
export async function schedulingBuyoutDb(): Promise<PGlite> {
  const socket = process.env.ATHENA_SCHED_BUYOUT_PG_SOCKET;
  if (!socket) return makeDb();
  if (!socket.startsWith("/tmp/athena-sched-buyout-pg-"))
    throw new Error("Only the disposable local scheduling/buyout database is allowed.");
  const require = createRequire(import.meta.url);
  const { Client, types } = require("/tmp/athena-accounting-pg17/node_modules/pg");
  for (const n of [1082, 1114, 1184, 1700, 20]) types.setTypeParser(n, (v: string) => v);
  const client = new Client({ host: socket, port: 65449, user: "postgres", database: "postgres" });
  await client.connect();
  const adapter = {
    query: (sql: string, args?: unknown[]) => client.query(sql, args),
    exec: (sql: string) => client.query(sql),
    transaction: async (fn: (tx: unknown) => unknown) => {
      await client.query("BEGIN");
      try {
        const out = await fn(adapter);
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
    close: () => client.end(),
  };
  const base = readFileSync("tests/mcp-roles/db.ts", "utf8");
  const boot = base.match(/const BOOT = `([\s\S]*?)`;/)?.[1];
  if (!boot) throw new Error("Role fixture bootstrap unavailable.");
  await client.query(boot);
  for (const f of readdirSync("drizzle/migrations")
    .filter((f) => f.endsWith(".sql") && f <= "0024_athena_reopen_open_item.sql")
    .sort())
    await client.query(
      readFileSync(`drizzle/migrations/${f}`, "utf8").replace(/--> statement-breakpoint/g, ""),
    );
  return adapter as unknown as PGlite;
}
