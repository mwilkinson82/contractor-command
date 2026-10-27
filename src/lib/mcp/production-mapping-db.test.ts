/* eslint-disable @typescript-eslint/no-explicit-any -- JSON returned by the database fixture is inspected by these tests. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000071";
const superUser = "00000000-0000-4000-8000-000000000070";
const stranger = "00000000-0000-4000-8000-000000000075";
const company = "00000000-0000-4000-8000-000000000072";
const job = "00000000-0000-4000-8000-000000000073";
const other = "00000000-0000-4000-8000-000000000074";
const fact = "00000000-0000-4000-8000-000000000076";
const cpm = "00000000-0000-4000-8000-000000000077";
const key = "00000000-0000-4000-8000-000000000078";
let db: PGlite;
const claims = (user = owner) => ({
  sub: user,
  email: "test@example.com",
  role: "authenticated" as const,
});
const call = (sql: string, values: unknown[] = [], user = owner) =>
  asUser(db, claims(user), (tx) => tx.query(sql, values) as Promise<{ rows: { result: any }[] }>);
const allocations = [
  {
    sov_fact_id: fact,
    activity_id: "E090",
    allocated_cents: 6000000,
    planned_quantity: 1000,
    unit: "LF",
    planned_man_hours: 250,
    planned_source: "field plan",
  },
  { sov_fact_id: fact, activity_id: "E100", allocated_cents: 4000000 },
];
const preview = async (a: unknown = allocations, j = job, user = owner, base = 0) =>
  (
    await call(
      "SELECT public.mcp_production_mapping_preview($1,$2,$4,'2026-10-26','initial',$3::jsonb) result",
      [j, cpm, JSON.stringify(a), base],
      user,
    )
  ).rows[0].result;
const approve = (p: unknown, req = key, base = 0, a: unknown = allocations) =>
  call(
    "SELECT public.mcp_production_mapping_approve($1,$2,$3,'2026-10-26','initial',$4,$5::jsonb,$6::jsonb,true) result",
    [job, cpm, base, req, JSON.stringify(p), JSON.stringify(a)],
  );
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    `CREATE TABLE public.mcp_living_reports(id uuid PRIMARY KEY,job_id uuid,report_type text,version integer,status text,data jsonb); CREATE TABLE public.mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb,updated_at timestamptz NOT NULL DEFAULT now());`,
  );
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE FUNCTION public.mcp_file_path_scope(text) RETURNS text LANGUAGE sql AS $$ SELECT 'full'::text $$;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/20261023020000_athena_superintendent.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261101120002_athena_approved_production_mapping.sql",
      "utf8",
    ),
  );
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES ($1,'owner@example.com'),($2,'test@example.com'),($3,'super@example.com')",
    [owner, stranger, superUser],
  );
  await db.query("INSERT INTO test_active_members VALUES ($1),($2),($3)", [
    owner,
    stranger,
    superUser,
  ]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'QA',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','QA'),($1,$3,'super','QA super')",
    [company, owner, superUser],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES ($1,$3,$4,'T1','QA'),($2,$3,$4,'T2','QA 2')",
    [job, other, owner, company],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
    job,
    superUser,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_job_facts(id,job_id,module,key,value,status,source,updated_by) VALUES ($1,$2,'sov','26.04',$3::jsonb,'known','member_answer',$4)",
    [fact, job, JSON.stringify({ billable_value: 100000 }), owner],
  );
  await db.query("INSERT INTO mcp_living_reports VALUES ($1,$2,'cpm',1,'approved',$3::jsonb)", [
    cpm,
    job,
    JSON.stringify({ activities: [{ id: "E090" }, { id: "E100" }] }),
  ]);
});
afterAll(async () => {
  await db?.close();
});
describe("database mapping approval", () => {
  it("requires source membership, conservation and unique pair", async () => {
    await expect(preview(allocations, job, stranger)).rejects.toThrow();
    await expect(preview(allocations, other)).rejects.toThrow();
    await expect(preview(null)).rejects.toThrow();
    await expect(preview([{ ...allocations[0], allocated_cents: 1 }])).rejects.toThrow(/reconcile/);
    await expect(preview([allocations[0], allocations[0]])).rejects.toThrow(/duplicated/);
  });
  it("approves once, deduplicates and rejects stale source or request reuse", async () => {
    const p = await preview();
    await db.query(
      'UPDATE mcp_job_facts SET value=value||\'{"description":"changed"}\'::jsonb WHERE id=$1',
      [fact],
    );
    await expect(approve(p)).rejects.toThrow(/changed after review/);
    const fresh = await preview();
    await expect(
      call(
        "SELECT public.mcp_production_mapping_approve($1,$2,0,'2026-10-27','initial',$3,$4::jsonb,$5::jsonb,true)",
        [
          job,
          cpm,
          "10000000-0000-4000-8000-000000000020",
          JSON.stringify(fresh),
          JSON.stringify(allocations),
        ],
      ),
    ).rejects.toThrow(/changed after review/);
    const first = (await approve(fresh)).rows[0].result;
    expect(first.version).toBe(1);
    expect((await approve(fresh)).rows[0].result).toMatchObject({ id: first.id, replayed: true });
    await expect(approve(fresh, key, 1)).rejects.toThrow(/different mapping/);
    await expect(approve(fresh, "00000000-0000-4000-8000-000000000079", 0)).rejects.toThrow(
      /changed/,
    );
  });
});

const request1 = "10000000-0000-4000-8000-000000000001";
const request2 = "10000000-0000-4000-8000-000000000002";
const request3 = "10000000-0000-4000-8000-000000000003";
const request4 = "10000000-0000-4000-8000-000000000004";
const photo = "10000000-0000-4000-8000-000000000005";
let allocation1: string;
const line = (allocationId: string, qty: number, crew: number, hours: number) => [
  {
    allocation_id: allocationId,
    work: "Conduit",
    sov_item: "26.04",
    activity_id: "E090",
    qty,
    unit: "LF",
    crew,
    hours,
    pct_complete: null,
  },
];
const save = (
  date: string,
  lines: unknown,
  expected: number,
  request: string,
  reason: string | null = null,
  j = job,
  user = owner,
) =>
  call(
    "SELECT public.mcp_daily_report_save_v2($1,$2,true,'clear','crew','none','none','none','none','none',NULL,$3::jsonb,$4,$5,$6) result",
    [j, date, JSON.stringify(lines), expected, request, reason],
    user,
  );
const weekly = async () =>
  (await call("SELECT public.mcp_weekly_production($1,'2026-10-26','2026-11-01') result", [job]))
    .rows[0].result;

describe("daily production persistence", () => {
  it("saves 1000 LF across two days and deduplicates retries", async () => {
    allocation1 = (
      await db.query<{ id: string }>(
        "SELECT id FROM mcp_production_allocations WHERE activity_id='E090' AND job_id=$1",
        [job],
      )
    ).rows[0].id;
    const a = (await save("2026-10-26", line(allocation1, 300, 4, 20), 0, request1)).rows[0].result;
    expect(a.revision).toBe(1);
    expect(
      (await save("2026-10-26", line(allocation1, 300, 4, 20), 0, request1)).rows[0].result,
    ).toMatchObject({ id: a.id, replayed: true });
    await expect(save("2026-10-26", line(allocation1, 301, 4, 20), 0, request1)).rejects.toThrow(
      /different daily/,
    );
    await save("2026-10-27", line(allocation1, 700, 5, 35), 0, request2);
    const w = await weekly();
    expect(w.rows).toHaveLength(1);
    expect(Number(w.rows[0].period_quantity)).toBe(1000);
    expect(Number(w.rows[0].period_man_hours)).toBe(255);
    expect(Number(w.rows[0].actual_rate)).toBeCloseTo(1000 / 255);
    expect(Number(w.rows[0].planned_rate)).toBe(4);
    expect(w.earned_value).toBeNull();
    expect(
      (await db.query("SELECT * FROM mcp_production_rates WHERE job_id=$1", [job])).rows,
    ).toHaveLength(2);
  });
  it("requires correction reason, checks concurrent versions and keeps old facts", async () => {
    await expect(save("2026-10-26", line(allocation1, 320, 4, 20), 1, request3)).rejects.toThrow(
      /reason/,
    );
    await expect(
      save("2026-10-26", line(allocation1, 320, 4, 20), 0, request3, "field correction"),
    ).rejects.toThrow(/changed/);
    const corrected = (
      await save("2026-10-26", line(allocation1, 320, 4, 20), 1, request3, "field correction")
    ).rows[0].result;
    expect(corrected.revision).toBe(2);
    const histories = await db.query<{ snapshot: any }>(
      "SELECT snapshot FROM mcp_daily_revisions WHERE daily_id=$1 ORDER BY revision",
      [corrected.id],
    );
    expect(histories.rows).toHaveLength(2);
    expect(Number(histories.rows[0].snapshot.lines[0].qty)).toBe(300);
    expect(Number(histories.rows[1].snapshot.lines[0].qty)).toBe(320);
    expect(Number((await weekly()).rows[0].period_quantity)).toBe(1020);
    await expect(
      save("2026-10-26", line(allocation1, 320, 4, 20), 1, request3, "changed reason"),
    ).rejects.toThrow(/different daily/);
  });
  it("does not allow cross-project or old RPC writes", async () => {
    await expect(
      save("2026-10-26", line(allocation1, 10, 1, 1), 0, request4, null, other),
    ).rejects.toThrow(/approved mapping/);
    await expect(
      save("2026-10-26", line(allocation1, 10, 1, 1), 0, request4, null, job, stranger),
    ).rejects.toThrow();
    await expect(
      call(
        "SELECT public.mcp_daily_report_save($1,'2026-10-28',true,'clear','crew','none','none','none','none','none',NULL,'[]'::jsonb)",
        [job],
      ),
    ).rejects.toThrow(/approved production save/);
  });
  it("pins photo to an approved work revision and rejects foreign project references", async () => {
    const r = await call("SELECT public.mcp_daily_revision_status($1,'2026-10-26') result", [job]);
    const revisionLine = r.rows[0].result.lines[0].revision_line_id;
    await db.query(
      "INSERT INTO mcp_progress_photos(id,job_id,company_id,taken_on,area,storage_path,mime_type,size_bytes) VALUES($1,$2,$3,'2026-10-26','QA','qa/path','image/jpeg',1)",
      [photo, job, company],
    );
    const p = await call("SELECT public.mcp_production_photo_associate($1,$2,$3,$4) result", [
      job,
      photo,
      revisionLine,
      request4,
    ]);
    expect(p.rows[0].result.replayed).toBe(false);
    expect(
      (
        await call("SELECT public.mcp_production_photo_associate($1,$2,$3,$4) result", [
          job,
          photo,
          revisionLine,
          request4,
        ])
      ).rows[0].result.replayed,
    ).toBe(true);
    await expect(
      call("SELECT public.mcp_production_photo_associate($1,$2,$3,$4) result", [
        other,
        photo,
        revisionLine,
        request4,
      ]),
    ).rejects.toThrow(/belong/);
  });
});

describe("historical and mapping revisions", () => {
  it("preserves an existing unmapped daily and its original rate before correction", async () => {
    const legacy = (
      await db.query<{ id: string }>(
        "INSERT INTO mcp_daily_reports(job_id,company_id,report_date,weather,manpower,subs_on_site,deliveries,issues,delays,safety) VALUES($1,$2,'2026-10-28','clear','crew','none','none','none','none','none') RETURNING id",
        [job, company],
      )
    ).rows[0].id;
    const oldLine = (
      await db.query<{ id: string }>(
        "INSERT INTO mcp_daily_work_lines(daily_id,job_id,company_id,line_no,work,sov_item,activity_id,qty,unit,crew,hours) VALUES($1,$2,$3,1,'Conduit','26.04','E090',40,'LF',2,4) RETURNING id",
        [legacy, job, company],
      )
    ).rows[0].id;
    const oldRate = (
      await db.query<{ id: string }>(
        "INSERT INTO mcp_production_rates(daily_id,job_id,company_id,work,sov_item,activity_id,qty,unit,crew,hours,man_hours,qty_per_man_hour) VALUES($1,$2,$3,'Conduit','26.04','E090',40,'LF',2,4,8,5) RETURNING id",
        [legacy, job, company],
      )
    ).rows[0].id;
    const result = (
      await save(
        "2026-10-28",
        line(allocation1, 42, 2, 4),
        0,
        "10000000-0000-4000-8000-000000000006",
        "correction",
      )
    ).rows[0].result;
    const old = (
      await db.query<{ snapshot: any }>(
        "SELECT snapshot FROM mcp_daily_revisions WHERE daily_id=$1 AND revision=0",
        [result.id],
      )
    ).rows[0].snapshot;
    expect(old.lines[0].id).toBe(oldLine);
    expect(old.lines[0].production_allocation_id).toBeNull();
    expect(old.rates[0].id).toBe(oldRate);
    const priorReplay = (await save("2026-10-26", line(allocation1, 300, 4, 20), 0, request1))
      .rows[0].result;
    expect(priorReplay).toMatchObject({ revision: 1, replayed: true, is_current: false });
  });
  it("keeps prior facts pinned when a mapping version changes", async () => {
    const p = await preview(allocations, job, owner, 1);
    const second = (await approve(p, "10000000-0000-4000-8000-000000000007", 1)).rows[0].result;
    expect(second.version).toBe(2);
    const original = (
      await db.query<{ request_payload: { preview: unknown } }>(
        "SELECT request_payload FROM mcp_production_mapping_versions WHERE job_id=$1 AND version=1",
        [job],
      )
    ).rows[0].request_payload.preview;
    expect((await approve(original)).rows[0].result).toMatchObject({
      version: 1,
      replayed: true,
      is_current: false,
    });
    const allocation2 = (
      await db.query<{ id: string }>(
        "SELECT id FROM mcp_production_allocations WHERE mapping_id=$1 AND activity_id='E090'",
        [second.id],
      )
    ).rows[0].id;
    const before = (
      await db.query<{ production_allocation_id: string }>(
        "SELECT production_allocation_id FROM mcp_daily_work_lines WHERE daily_id=(SELECT id FROM mcp_daily_reports WHERE job_id=$1 AND report_date='2026-10-27')",
        [job],
      )
    ).rows[0];
    expect(before.production_allocation_id).toBe(allocation1);
    await save(
      "2026-10-27",
      line(allocation2, 700, 5, 35),
      1,
      "10000000-0000-4000-8000-000000000008",
      "use revised mapping",
    );
    const old = (
      await db.query<{ allocation_id: string }>(
        "SELECT l.allocation_id FROM mcp_daily_revision_lines l JOIN mcp_daily_revisions r ON r.id=l.revision_id WHERE r.report_date='2026-10-27' AND r.job_id=$1 AND r.revision=1",
        [job],
      )
    ).rows[0];
    expect(old.allocation_id).toBe(allocation1);
    const rows = (await weekly()).rows;
    expect(rows.map((r: { mapping_version: number }) => r.mapping_version)).toEqual(
      expect.arrayContaining([1, 2]),
    );
  });
});

describe("missing planned basis", () => {
  it("reports actual rate without manufacturing a planned rate", async () => {
    const noPlan = (
      await db.query<{ id: string }>(
        "SELECT a.id FROM mcp_production_allocations a JOIN mcp_production_mapping_versions m ON m.id=a.mapping_id WHERE a.job_id=$1 AND a.activity_id='E100' ORDER BY m.version DESC LIMIT 1",
        [job],
      )
    ).rows[0].id;
    const work = [{ ...line(noPlan, 30, 2, 4)[0], activity_id: "E100" }];
    await save("2026-10-29", work, 0, "10000000-0000-4000-8000-000000000009");
    const row = (await weekly()).rows.find(
      (x: { allocation_id: string }) => x.allocation_id === noPlan,
    );
    expect(Number(row.actual_rate)).toBe(3.75);
    expect(row.planned_rate).toBeNull();
  });
});

describe("field authorization", () => {
  it("allows assigned field users references without exposing mapping money", async () => {
    const refs = (
      await call(
        "SELECT public.mcp_production_work_references($1,'2026-10-29') result",
        [job],
        superUser,
      )
    ).rows[0].result;
    expect(refs.length).toBe(2);
    expect(JSON.stringify(refs)).not.toMatch(/allocated_cents|billable_value/);
    const hidden = await asUser(
      db,
      claims(superUser),
      (tx) => tx.query("SELECT * FROM mcp_production_allocations") as Promise<{ rows: unknown[] }>,
    );
    expect(hidden.rows).toEqual([]);
    await expect(preview(allocations, job, superUser)).rejects.toThrow(/Full project access/);
    const w = [{ ...line(allocation1, 10, 1, 2)[0] }];
    expect(
      (await save("2026-10-30", w, 0, "10000000-0000-4000-8000-000000000010", null, job, superUser))
        .rows[0].result.revision,
    ).toBe(1);
  });
});

describe("USD contract credit allocation", () => {
  it("conserves a negative SOV credit without creating a billing or contract change", async () => {
    const credit = "10000000-0000-4000-8000-000000000030";
    await db.query(
      "INSERT INTO mcp_job_facts(id,job_id,module,key,value,status,source,updated_by) VALUES ($1,$2,'sov','26.05',$3::jsonb,'known','member_answer',$4)",
      [
        credit,
        job,
        JSON.stringify({
          description: "TEST executed credit",
          billable_value: -10000,
          executed_change_order: "10000000-0000-4000-8000-000000000040",
          fee_included: true,
        }),
        owner,
      ],
    );
    await db.query("UPDATE mcp_job_facts SET value=value-'executed_change_order' WHERE id=$1", [
      credit,
    ]);
    await expect(
      preview(
        [...allocations, { sov_fact_id: credit, activity_id: "E090", allocated_cents: -1000000 }],
        job,
        owner,
        2,
      ),
    ).rejects.toThrow(/executed credit change source/);
    await db.query("UPDATE mcp_job_facts SET value=value||$2::jsonb WHERE id=$1", [
      credit,
      JSON.stringify({ executed_change_order: "10000000-0000-4000-8000-000000000040" }),
    ]);
    await expect(
      preview(
        [...allocations, { sov_fact_id: credit, activity_id: "E090", allocated_cents: -1000000 }],
        job,
        owner,
        2,
      ),
    ).rejects.toThrow(/executed credit change source/);
    await db.query(
      "INSERT INTO mcp_change_orders(submittal_id,job_id,details) VALUES($1,$2,$3::jsonb)",
      [
        "10000000-0000-4000-8000-000000000040",
        job,
        JSON.stringify({
          state: "executed",
          total_cents: -1000000,
          execution: { sov_item: "26.05" },
        }),
      ],
    );
    const parts = [
      { sov_fact_id: credit, activity_id: "E090", allocated_cents: -600000 },
      { sov_fact_id: credit, activity_id: "E100", allocated_cents: -400000 },
    ];
    await expect(
      preview([...allocations, { ...parts[0], allocated_cents: 600000 }, parts[1]], job, owner, 2),
    ).rejects.toThrow(/sign/);
    await expect(preview(parts, job, owner, 2)).rejects.toThrow(/previously mapped/);
    const complete = [...allocations, ...parts];
    const reviewed = await preview(complete, job, owner, 2);
    expect(reviewed.currency).toBe("USD");
    await db.query(
      'UPDATE mcp_change_orders SET details=details||\'{"note":"changed"}\'::jsonb WHERE submittal_id=$1',
      ["10000000-0000-4000-8000-000000000040"],
    );
    await expect(
      approve(reviewed, "10000000-0000-4000-8000-000000000031", 2, complete),
    ).rejects.toThrow(/changed after review/);
    const refreshed = await preview(complete, job, owner, 2);
    const next = (await approve(refreshed, "10000000-0000-4000-8000-000000000031", 2, complete))
      .rows[0].result;
    expect(next.version).toBe(3);
    const record = (
      await db.query<{ currency: string; sum: string }>(
        "SELECT m.currency,sum(a.allocated_cents)::text AS sum FROM mcp_production_mapping_versions m JOIN mcp_production_allocations a ON a.mapping_id=m.id WHERE m.id=$1 AND a.sov_fact_id=$2 GROUP BY m.currency",
        [next.id, credit],
      )
    ).rows[0];
    expect(record).toEqual({ currency: "USD", sum: "-1000000" });
    const source = (
      await db.query<{ value: any }>("SELECT value FROM mcp_job_facts WHERE id=$1", [credit])
    ).rows[0].value;
    expect(source.billable_value).toBe(-10000);
  });
});
