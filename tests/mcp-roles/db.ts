// TEST-only in-process Postgres (PGlite) with Supabase-style auth stubs, loaded with the real drizzle/migrations.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BOOT = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
-- Stand-in for the live entitlement check: active members are listed in this TEST table.
CREATE TABLE public.test_active_members (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.get_circle_entitlement(_uid uuid, _email text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT jsonb_build_object('hasAccess', EXISTS (SELECT 1 FROM public.test_active_members WHERE user_id = _uid)) $$;
`;

export async function makeDb() {
  const db = new PGlite({ parsers: Object.fromEntries([1082, 1114, 1184, 1700].map((t) => [t, (v: string) => v])) });
  await db.exec(BOOT);
  const dir = join(process.cwd(), "drizzle/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/--> statement-breakpoint/g, "");
    try { await db.exec(sql); } catch (e) { throw new Error(`${f}: ${(e as Error).message}`); }
  }
  return db;
}
