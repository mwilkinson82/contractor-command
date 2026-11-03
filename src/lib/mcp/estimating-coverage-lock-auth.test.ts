/* eslint-disable @typescript-eslint/no-explicit-any -- SQL RPC responses have different JSON shapes, asserted below. */
/* Local PGlite integration tests: synthetic users and data only. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000901";
const outsider = "00000000-0000-4000-8000-000000000904";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
const req = (n: number) => `00000000-0000-4000-8001-${String(n).padStart(12, "0")}`;
let db: PGlite;
const rpc = async (name: string, args: unknown[], user = owner) =>
  asUser(
    db,
    { sub: user, email: "fixture@example.com", role: "authenticated" },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
          args,
        )
      ).rows[0].data as any,
  );
const snapshot = () => rpc("mcp_estimate_coverage_snapshot", [job]);
const decisions: Record<string, unknown>[] = [
  {
    quote_index: 0,
    decision: "carry",
    ref: "T-1",
    replace_labor_and_material: true,
    exclusive_to_line: true,
    source_note: "Written quotation",
    scope_note: "Complete line",
    exclusions_note: "None stated",
  },
  { quote_index: 1, decision: "compare", ref: "T-1" },
];
const review = (id: number, version: number, rows = decisions) =>
  rpc("mcp_estimate_coverage_review", [job, req(id), version, JSON.stringify(rows)]);
const save = (id: number, confirmed = true) =>
  rpc("mcp_estimate_coverage_save", [job, req(id), confirmed]);
const pricing = (version: number, quotes: unknown[] | null) =>
  rpc("mcp_estimate_pricing_save_versioned", [
    job,
    version,
    null,
    null,
    quotes === null ? null : JSON.stringify(quotes),
    null,
  ]);
const quotes = [
  { sub: "A", description: "Whole scope", amount: 1200, ref: "T-1" },
  { sub: "B", description: "Comparison", amount: 1300, ref: "T-1" },
];

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/20261022230000_athena_estimating_bid.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261023010000_athena_estimating_conventions.sql", "utf8"),
  );
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  for (const migration of [
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-member-read-transactions.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-quote-coverage.sql", "utf8"));
  for (const id of [owner, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.com')", [id]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [id]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Member')",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','COVERAGE',$3)",
    [job, owner, company],
  );
  await rpc("mcp_estimate_setup_save", [job, JSON.stringify({ role: "gc", trades: ["Finishes"] })]);
  await rpc("mcp_estimate_takeoff_save", [
    job,
    "A",
    "[]",
    JSON.stringify([
      {
        line_no: 1,
        item: "Paint",
        qty: 100,
        unit: "SF",
        sheet: "A1",
        basis: "measured",
        math: "100 SF",
      },
    ]),
  ]);
});
afterAll(async () => db.close());

describe.sequential("independent lock-boundary authorization", () => {
  it("advertises GC and requirements CAS only after its installation marker exists", async () => {
    expect((await snapshot()).capabilities).toEqual({ gc_requirements_cas: false });
    await db.exec(`CREATE FUNCTION mcp_private.estimate_gc_requirements_cas_marker() RETURNS boolean
      LANGUAGE sql IMMUTABLE AS 'SELECT true';
      REVOKE ALL ON FUNCTION mcp_private.estimate_gc_requirements_cas_marker() FROM PUBLIC,anon,authenticated;`);
    try {
      expect((await snapshot()).capabilities).toEqual({ gc_requirements_cas: true });
    } finally {
      await db.exec("DROP FUNCTION mcp_private.estimate_gc_requirements_cas_marker()");
    }
    expect((await snapshot()).capabilities).toEqual({ gc_requirements_cas: false });
  });
  const restore = async () => {
    await db.exec(
      `DROP FUNCTION mcp_private.estimate_lock(uuid); ALTER FUNCTION mcp_private.estimate_lock_original(uuid) RENAME TO estimate_lock;`,
    );
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Member') ON CONFLICT DO NOTHING",
      [company, owner],
    );
  };
  const hook = async () => {
    await db.exec(`ALTER FUNCTION mcp_private.estimate_lock(uuid) RENAME TO estimate_lock_original;
      CREATE FUNCTION mcp_private.estimate_lock(_job uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE v bigint; BEGIN v:=mcp_private.estimate_lock_original(_job);
        DELETE FROM public.mcp_company_members WHERE user_id=auth.uid() AND company_id=(SELECT company_id FROM public.mcp_jobs WHERE id=_job); RETURN v; END $$;
      REVOKE ALL ON FUNCTION mcp_private.estimate_lock(uuid) FROM PUBLIC,anon,authenticated;`);
  };
  it("must reject review after company membership disappears while acquiring the lock", async () => {
    await pricing((await snapshot()).version, quotes);
    const s = await snapshot();
    await hook();
    try {
      await expect(review(101, s.version)).rejects.toThrow();
    } finally {
      await restore();
    }
  });
  it("must reject save after company membership disappears while acquiring the lock", async () => {
    const s = await snapshot();
    await review(102, s.version);
    await hook();
    try {
      await expect(save(102)).rejects.toThrow();
    } finally {
      await restore();
    }
  });
  it("snapshot rechecks access through nested readers", async () => {
    await hook();
    try {
      await expect(snapshot()).rejects.toThrow();
    } finally {
      await restore();
    }
  });
  it("versioned pricing rejects revoked access without changing the stored version", async () => {
    const s = await snapshot();
    await hook();
    try {
      await expect(pricing(s.version, null)).rejects.toThrow();
    } finally {
      await restore();
    }
    const after = await snapshot();
    expect(after.version).toEqual(s.version);
    expect(after.bid).toEqual(s.bid);
  });

  it("legacy pricing must recheck membership after the new lock", async () => {
    await hook();
    try {
      await expect(
        rpc("mcp_estimate_pricing_save", [job, null, null, null, null]),
      ).rejects.toThrow();
    } finally {
      await restore();
    }
  });
  it("must recheck membership before returning an existing review", async () => {
    const s = await snapshot();
    await review(103, s.version);
    await hook();
    try {
      await expect(review(103, s.version)).rejects.toThrow();
    } finally {
      await restore();
    }
  });
  it("must recheck membership before returning a previously saved request", async () => {
    const s = await snapshot();
    await review(104, s.version);
    await save(104);
    await hook();
    try {
      await expect(save(104)).rejects.toThrow();
    } finally {
      await restore();
    }
    await hook();
    try {
      await expect(review(104, s.version)).rejects.toThrow();
    } finally {
      await restore();
    }
  });
  it("must recheck membership before changing bid markups", async () => {
    const s = await snapshot();
    await hook();
    try {
      await expect(
        rpc("mcp_estimate_bid_save_versioned", [job, s.version, 10, 15]),
      ).rejects.toThrow();
    } finally {
      await restore();
    }
  });
  it("must recheck job role after the lock, not merely membership", async () => {
    const s = await snapshot();
    await db.exec(`ALTER FUNCTION mcp_private.estimate_lock(uuid) RENAME TO estimate_lock_original;
      CREATE FUNCTION mcp_private.estimate_lock(_job uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE v bigint; BEGIN v:=mcp_private.estimate_lock_original(_job);
        UPDATE public.mcp_company_members SET role='super' WHERE user_id=auth.uid() AND company_id=(SELECT company_id FROM public.mcp_jobs WHERE id=_job); RETURN v; END $$;
      REVOKE ALL ON FUNCTION mcp_private.estimate_lock(uuid) FROM PUBLIC,anon,authenticated;`);
    try {
      await expect(pricing(s.version, null)).rejects.toThrow();
    } finally {
      await restore();
    }
  });
  it.each([false, true])(
    "uses the rechecked company after a job changes companies, versioned=%s",
    async (versioned) => {
      const company2 = "00000000-0000-4000-8000-000000000911";
      const otherJob = versioned
        ? "00000000-0000-4000-8000-000000000922"
        : "00000000-0000-4000-8000-000000000921";
      await db.query(
        "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder 2',$2) ON CONFLICT DO NOTHING",
        [company2, owner],
      );
      await db.query(
        "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Member') ON CONFLICT DO NOTHING",
        [company2, owner],
      );
      await db.query(
        "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job 2',$3,$4)",
        [otherJob, owner, versioned ? "MOVE-B" : "MOVE-A", company],
      );
      const current = await rpc("mcp_estimate_coverage_snapshot", [otherJob]);
      await db.exec(`ALTER FUNCTION mcp_private.estimate_lock(uuid) RENAME TO estimate_lock_original;
      CREATE FUNCTION mcp_private.estimate_lock(_job uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE v bigint; BEGIN v:=mcp_private.estimate_lock_original(_job);
        UPDATE public.mcp_jobs SET company_id='00000000-0000-4000-8000-000000000911' WHERE id=_job; RETURN v; END $$;
      REVOKE ALL ON FUNCTION mcp_private.estimate_lock(uuid) FROM PUBLIC,anon,authenticated;`);
      try {
        if (versioned)
          await rpc("mcp_estimate_pricing_save_versioned", [
            otherJob,
            current.version,
            JSON.stringify([{ ref: "T-1", hourly_rate: 10 }]),
            null,
            null,
            null,
          ]);
        else
          await rpc("mcp_estimate_pricing_save", [
            otherJob,
            JSON.stringify([{ ref: "T-1", hourly_rate: 10 }]),
            null,
            null,
            null,
          ]);
        expect(
          (
            await db.query("SELECT company_id FROM public.mcp_estimate_pricing WHERE job_id=$1", [
              otherJob,
            ])
          ).rows[0],
        ).toEqual({ company_id: company2 });
      } finally {
        await restore();
      }
    },
  );
});
