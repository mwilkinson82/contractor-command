// TEST-only stand-in for supabase-js: every query runs in PGlite as role "authenticated" with the caller's JWT claims,
// so the real RLS policies and SECURITY DEFINER functions from drizzle/migrations decide what each role sees.
import type { PGlite } from "@electric-sql/pglite";

type Claims = { sub: string; email: string; role: "authenticated"; client_id?: string };
type Res = { data: any; error: { message: string } | null };

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

export async function asUser<T>(db: PGlite, claims: Claims, fn: (tx: any) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return fn(tx);
  });
}

let argTypes: Map<string, Map<string, string>> | null = null;
const retInfo = new Map<string, { ret: string; set: boolean }>();
async function loadArgTypes(db: PGlite) {
  if (argTypes) return argTypes;
  const r = await db.query<{ proname: string; names: string[]; types: string[]; ret: string; set: boolean }>(
    `SELECT p.proname, p.proargnames AS names, format_type(p.prorettype, NULL) AS ret, p.proretset AS set, ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) t) AS types
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'mcp_%'`,
  );
  argTypes = new Map(r.rows.map((x: any) => { retInfo.set(x.proname, { ret: x.ret, set: x.set }); return x; }).map((x) => [x.proname, new Map((x.names ?? []).map((n, i) => [n, x.types[i]]))]));
  return argTypes;
}

function enc(v: unknown, type: string | undefined) {
  if (v === null || v === undefined) return null;
  if (type === "jsonb" || type === "json") return JSON.stringify(v);
  if (Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

class Query implements PromiseLike<Res> {
  private cols = "*"; private where: string[] = []; private params: unknown[] = []; private ord = ""; private lim = "";
  private mode: "select" | "insert" | "update" = "select"; private rows: Record<string, unknown>[] = []; private patch: Record<string, unknown> = {};
  private one: "" | "single" | "maybe" = ""; private returning = false;
  constructor(private run: (sql: string, p: unknown[]) => Promise<any[]>, private table: string) {}
  private p(v: unknown) { this.params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) ? JSON.stringify(v) : v); return `$${this.params.length}`; }
  select(cols = "*") { if (this.mode === "select") this.cols = cols; else { this.returning = true; this.cols = cols; } return this; }
  eq(c: string, v: unknown) { this.where.push(`${q(c)} = ${this.p(v)}`); return this; }
  in(c: string, vs: unknown[]) { if (!vs.length) this.where.push("false"); else this.where.push(`${q(c)}::text IN (${vs.map((v) => this.p(String(v))).join(",")})`); return this; }
  not(c: string, op: string, v: unknown) { if (op === "is" && v === null) this.where.push(`${q(c)} IS NOT NULL`); else this.where.push(`NOT (${q(c)} = ${this.p(v)})`); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.ord = ` ORDER BY ${q(c)} ${o?.ascending === false ? "DESC" : "ASC"}`; return this; }
  limit(n: number) { this.lim = ` LIMIT ${Number(n)}`; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  insert(r: Record<string, unknown> | Record<string, unknown>[]) { this.mode = "insert"; this.rows = Array.isArray(r) ? r : [r]; return this; }
  update(r: Record<string, unknown>) { this.mode = "update"; this.patch = r; return this; }
  private cl(cols: string) { return cols.split(",").map((c) => c.trim()).filter(Boolean).map((c) => (c === "*" ? "*" : q(c))).join(", "); }
  private async exec(): Promise<Res> {
    try {
      let out: any[] = [];
      const w = this.where.length ? ` WHERE ${this.where.join(" AND ")}` : "";
      if (this.mode === "select") out = await this.run(`SELECT ${this.cl(this.cols)} FROM public.${q(this.table)}${w}${this.ord}${this.lim}`, this.params);
      else if (this.mode === "insert") {
        for (const r of this.rows) {
          const ks = Object.keys(r).filter((k) => r[k] !== undefined);
          const ret = this.returning ? ` RETURNING ${this.cl(this.cols)}` : "";
          // json_populate_record lets PG cast each value to the column type (jsonb, arrays, dates, uuids).
          const sql = `INSERT INTO public.${q(this.table)} (${ks.map(q).join(",")}) SELECT ${ks.map(q).join(",")} FROM json_populate_record(NULL::public.${q(this.table)}, $1::json)${ret}`;
          out.push(...(await this.run(sql, [JSON.stringify(Object.fromEntries(ks.map((k) => [k, r[k]])))])));
        }
      } else {
        const ks = Object.keys(this.patch);
        const base = this.params.length;
        const sets = ks.map((k, i) => `${q(k)} = (json_populate_record(NULL::public.${q(this.table)}, $${base + 1}::json)).${q(k)}`);
        out = await this.run(`UPDATE public.${q(this.table)} SET ${sets.join(", ")}${w}${this.returning ? ` RETURNING ${this.cl(this.cols)}` : ""}`, [...this.params, JSON.stringify(this.patch)]);
      }
      if (this.one) {
        if (out.length > 1 || (this.one === "single" && !out.length)) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
        return { data: out[0] ?? null, error: null };
      }
      return { data: this.mode === "select" || this.returning ? out : null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }
  then<A, B>(ok?: ((v: Res) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.exec().then(ok, bad); }
}

export function fakeClient(db: PGlite, claims: Claims) {
  const run = (sql: string, p: unknown[]) => asUser(db, claims, async (tx) => (await tx.query(sql, p)).rows);
  return {
    from: (t: string) => new Query(run, t),
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Res> {
      try {
        const types = (await loadArgTypes(db)).get(fn) ?? new Map();
        const ks = Object.keys(args).filter((k) => args[k] !== undefined);
        const call = `public.${q(fn)}(${ks.map((k, i) => `${q(k)} => $${i + 1}::${types.get(k) ?? "text"}`).join(", ")})`;
        const ri = retInfo.get(fn);
        const sql = ri?.ret === "void" ? `SELECT ${call}, NULL::jsonb AS r` : ri?.set ? `SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') AS r FROM ${call} t` : `SELECT to_jsonb(${call}) AS r`;
        const rows = await run(sql, ks.map((k) => enc(args[k], types.get(k))));
        return { data: rows[0]?.r ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
}
