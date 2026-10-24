/* eslint-disable @typescript-eslint/no-explicit-any -- Real PostgreSQL RPC snapshots are checked at runtime. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { makeDb } from "../../../../tests/mcp-roles/db";
import { asUser } from "../../../../tests/mcp-roles/fake-supabase";

it("serializes two stale drawing reads under the existing lock and preserves same-pass resume, history and access", async () => {
  const db = await makeDb();
  const owner = "00000000-0000-4000-8000-000000000010",
    outsider = "00000000-0000-4000-8000-000000000011";
  const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const claims = (sub = owner) => ({
    sub,
    email: "qa-estimator@example.com",
    role: "authenticated" as const,
  });
  const rpc = async (name: string, args: unknown[], who = owner) =>
    asUser(
      db,
      claims(who),
      async (tx) =>
        (
          await tx.query(
            `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
            args,
          )
        ).rows[0].data,
    );
  try {
    await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
    await db.exec(
      "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
    );
    await db.exec(
      readFileSync("supabase/migrations/20261027130000_athena_drawing_versions.sql", "utf8"),
    );
    await db.exec(
      readFileSync("supabase/migrations/20261024005713_athena_takeoff_engine.sql", "utf8"),
    );
    for (const id of [owner, outsider]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,'qa-estimator@example.com')", [
        id,
      ]);
      await db.query("INSERT INTO public.test_active_members VALUES($1)", [id]);
    }
    await db.query(
      "INSERT INTO public.mcp_companies(id,name,created_by) VALUES($1,'Fictional Construction',$2)",
      [company, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','QA Estimator')",
      [company, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Fictional concurrency check','QA-ATOMIC',$3)",
      [job, owner, company],
    );
    const source = await rpc("mcp_drawing_source_save", [
      job,
      JSON.stringify({
        path: `${company}/${job}/drawing-fixture/source.pdf`,
        storage_bucket: "athena-drawings",
        filename: "Fictional.pdf",
        source_key: "file:fictional",
        content_hash: "a".repeat(64),
        sheets: ["E-100"],
      }),
    ]);
    await rpc("mcp_estimate_takeoff_save", [
      job,
      "QA",
      "[]",
      JSON.stringify([
        {
          line_no: 1,
          item: "Fictional fixtures",
          qty: 999,
          unit: "EA",
          measure_type: "count",
          basis: "measured",
          math: "Historical input",
          confidence: "low",
          sheet: "E-100",
          inputs: [],
        },
      ]),
    ]);
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    const record = (pid: string, x: number, cursor = 0) => ({
      source_id: source.id,
      page: 1,
      pass_summary: {
        pass_id: pid,
        line_no: 1,
        takeoff_version: 1,
        cursor,
        next_cursor: cursor + 1,
        order: [0, 1],
        complete: cursor === 1,
      },
      proposals: [
        {
          line_no: 1,
          takeoff_version: 1,
          source_id: source.id,
          page: 1,
          width: 720,
          height: 360,
          shape: { kind: "pins", points: [{ x, y: 0.5 }] },
          evidence: { pass_id: pid, confidence: 0.95 },
        },
      ],
    });
    // The serialized database phase of two in-flight inference requests is
    // exactly two stale payloads arriving successively under the same lock.
    // Reproduce the original double count, then roll back only this local repro.
    await asUser(db, claims(), async (tx) => {
      await tx.exec("SAVEPOINT before_guard");
      for (const input of [record(a, 0.4), record(b, 0.402)])
        await tx.query("SELECT public.mcp_takeoff_pass_save($1,$2)", [job, JSON.stringify(input)]);
      const old = (await tx.query("SELECT public.mcp_takeoff_get($1) AS data", [job])).rows[0].data;
      expect(old.geometry).toHaveLength(2);
      await tx.exec("ROLLBACK TO SAVEPOINT before_guard");
    });
    const metadata = async () =>
      (
        await db.query(
          "SELECT oid,proacl::text,provolatile,prosecdef,proconfig FROM pg_proc WHERE oid='public.mcp_takeoff_pass_save(uuid,jsonb)'::regprocedure",
        )
      ).rows;
    const beforeMetadata = await metadata();
    await db.exec(
      readFileSync("supabase/migrations/20261024060229_athena_takeoff_atomic_pass.sql", "utf8"),
    );
    expect(await metadata()).toEqual(beforeMetadata);
    const first = await rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record(a, 0.4))]);
    const before = await rpc("mcp_takeoff_get", [job]);
    await expect(
      rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record(b, 0.402))]),
    ).rejects.toThrow(/another read/);
    const after = await rpc("mcp_takeoff_get", [job]);
    expect(after.geometry).toEqual(before.geometry);
    expect(after.passes).toEqual(before.passes);
    expect(after.lines).toEqual(before.lines);
    expect(await rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record(a, 0.4))])).toEqual(
      first,
    );
    await rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record(a, 0.7, 1))]);
    const complete = await rpc("mcp_takeoff_get", [job]);
    expect(complete.geometry).toHaveLength(2);
    expect(complete.passes[0].pass_summary.complete).toBe(true);
    expect(complete.geometry.every((g: any) => g.evidence.pass_id === a)).toBe(true);
    await expect(
      rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record(b, 0.402))], outsider),
    ).rejects.toThrow();
    for (const g of complete.geometry)
      await rpc("mcp_takeoff_geometry_save", [
        job,
        "reject",
        JSON.stringify({
          line_no: 1,
          takeoff_version: 1,
          source_id: source.id,
          page: 1,
          geometry_id: g.geometry_id,
          reason: "Fictional QA superseded pass",
        }),
        g.version,
      ]);
    // Only the latest heads matter: historical rejected geometry must not make
    // an explicitly reviewed fresh read impossible.
    await rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record(b, 0.402))]);
    const fresh = await rpc("mcp_takeoff_get", [job]);
    expect(fresh.geometry.filter((g: any) => g.status !== "rejected")).toHaveLength(1);
    expect(fresh.geometry.filter((g: any) => g.status === "rejected")).toHaveLength(2);
    expect(fresh.lines[0].qty).toBe(999);
    const bGeometry = fresh.geometry.find((g: any) => g.status !== "rejected");
    await rpc("mcp_takeoff_geometry_save", [
      job,
      "reject",
      JSON.stringify({
        line_no: 1,
        takeoff_version: 1,
        source_id: source.id,
        page: 1,
        geometry_id: bGeometry.geometry_id,
        reason: "Fictional QA review before manual placement",
      }),
      bGeometry.version,
    ]);
    await rpc("mcp_takeoff_geometry_save", [
      job,
      "save",
      JSON.stringify({
        line_no: 1,
        takeoff_version: 1,
        source_id: source.id,
        page: 1,
        width: 720,
        height: 360,
        shape: { kind: "pins", points: [{ x: 0.8, y: 0.5 }] },
      }),
      0,
    ]);
    const manual = await rpc("mcp_takeoff_get", [job]);
    await expect(
      rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record(crypto.randomUUID(), 0.802))]),
    ).rejects.toThrow(/another read/);
    expect((await rpc("mcp_takeoff_get", [job])).geometry).toEqual(manual.geometry);
    expect(
      (
        await db.query<{ content_hash: string }>(
          "SELECT content_hash FROM public.mcp_drawing_versions WHERE id=$1",
          [source.id],
        )
      ).rows[0].content_hash,
    ).toBe(source.content_hash);
  } finally {
    await db.close();
  }
}, 30000);
