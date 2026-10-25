// The submittal record page readers, piece matching by kind and source, and the host on sent events,
// run through the real public RPCs on local PostgreSQL. All data is fictional and local.
import { readFileSync } from "node:fs";
import { beforeAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { tokenHash } from "./file-share";
import { submittalBuildTime } from "../submittal-build-time";

const owner = "00000000-0000-4000-8000-000000000020",
  teammate = "00000000-0000-4000-8000-000000000021",
  superId = "00000000-0000-4000-8000-000000000022",
  estimator = "00000000-0000-4000-8000-000000000023";
const company = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  job = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  otherJob = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const claims = (id = owner) => ({
  sub: id,
  email: `test-${id.slice(-2)}@example.com`,
  role: "authenticated" as const,
});
let db: PGlite;
const q = async (sql: string, args: unknown[] = [], user = owner) =>
  asUser(db, claims(user), async (tx) => (await tx.query(sql, args)).rows);
const rpc = async (fn: string, args: unknown[], user = owner) =>
  (
    await q(
      `SELECT public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(",")}) AS data`,
      args,
      user,
    )
  )[0].data;
const write = (sid: string, action: string, p: unknown) =>
  rpc("mcp_submittal_package_write", [job, sid, action, JSON.stringify(p)]);
const delivery = (sid: string, action: string, p: unknown) =>
  rpc("mcp_submittal_delivery", [job, sid, action, JSON.stringify(p)]);
const context = (sid: string) => rpc("mcp_submittal_package_context", [job, sid]);
const record = (number: string, user = owner) =>
  rpc("mcp_submittal_record_get", [job, number], user);

const NUMBER = "26 24 16-001";

async function create() {
  const r = await rpc("mcp_submittal_log", [
    job,
    "add",
    JSON.stringify({
      number: NUMBER,
      title: "Fictional switchgear",
      spec_section: "26 24 16",
      submittal_type: "product_data",
      status: "in_prep",
      ball_in_court: "gc",
      package_items: [
        {
          kind: "product_cut",
          source_party: "Fictional Manufacturer",
          status: "needed",
          required: true,
          chase_role: "manufacturer",
          chase_name: "Pat Sample",
          chase_email: "pat@example.com",
        },
        {
          kind: "shop_drawing",
          source_party: "Fictional Sub",
          status: "needed",
          required: true,
          chase_role: "sub",
          chase_name: "Sam Sample",
          chase_email: "sam@example.com",
        },
      ],
    }),
  ]);
  return r.saved_id as string;
}

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261023070000_athena_board_links.sql", "utf8"));
  const log = readFileSync("supabase/migrations/20261023220000_athena_submittal_log.sql", "utf8");
  await db.exec(log.slice(0, log.indexOf("CREATE OR REPLACE FUNCTION public.mcp_board_link_open")));
  await db.exec(
    readFileSync("supabase/migrations/20261024010000_athena_submittal_chase.sql", "utf8"),
  );
  await db.exec(
    `CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;`,
  );
  await db.exec(readFileSync("supabase/migrations/20261021000000_athena_file_shares.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/20261028120000_athena_submittal_packages.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261029120000_athena_submittal_record_page.sql", "utf8"),
  );
  for (const id of [owner, teammate, superId, estimator]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [id, claims(id).email]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [id]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Fictional Construction',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id,time_zone) VALUES ($1,$2,'Record Test','2701',$3,'America/Manaus')",
    [job, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id,time_zone) VALUES ($1,$2,'Other Job','2702',$3,'America/Manaus')",
    [otherJob, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','Fictional PM')",
    [company, owner],
  );
  for (const [id, role, name] of [
    [teammate, "all_access", "Fictional Teammate"],
    [superId, "super", "Fictional Super"],
    [estimator, "estimating", "Fictional Estimator"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,$3,$4)",
      [company, id, role, name],
    );
});

describe("submittal record page readers", () => {
  it("returns the record behind a log row: pieces, files, emails and events with the host that sent them", async () => {
    const sid = await create();
    let c = await context(sid);
    expect(c.items).toHaveLength(2);
    for (const item of c.items) {
      const path = `${company}/${job}/pieces/${crypto.randomUUID()}/${item.kind}.pdf`;
      await q("INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)", [
        "athena-submittals",
        path,
      ]);
      await write(sid, "attach", { item_id: item.id, path });
    }
    c = await context(sid);
    const pid = crypto.randomUUID();
    const path = `${company}/${job}/packages/${pid}/package.pdf`;
    await q("INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)", [
      "athena-submittals",
      path,
    ]);
    await write(sid, "save", {
      id: pid,
      path,
      filename: "package.pdf",
      fingerprint: c.fingerprint,
      sha256: "b".repeat(64),
      size_bytes: 1200,
      page_count: 3,
      cover_date: c.today,
      manifest: c.items.map((p: { id: string }) => ({ item_id: p.id })),
      token_hash: "c".repeat(64),
      download_url: `https://app.meetathena.io/r/submittal-file/${"a".repeat(43)}`,
      signed_url: `https://test.supabase.co/storage/v1/object/sign/athena-submittals/${path}?token=test`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    c = await context(sid);
    const a = c.package;
    const draft = {
      to: "reviewer@example.com",
      cc: [],
      subject: "Job 2701 T-" + c.transmittal_number,
      body: "Please review.\n" + a.download_url,
      link: a.download_url,
      attachment: null,
    };
    const mail = await delivery(sid, "draft", { kind: "package", package_id: a.id, draft });
    await delivery(sid, "approve", {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      confirmed: true,
    });
    await delivery(sid, "record_sent", {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      provider: "local-fixture",
      message_id: "synthetic-record-001",
      sent_at: new Date().toISOString(),
      recipient_name: "Fictional Reviewer",
      host: "claude",
      thread_ref: null,
    });

    const page = await record(NUMBER);
    expect(page.page).toBe("submittal");
    expect(page.number).toBe(NUMBER);
    expect(page.job_id).toBe(job);
    expect(page.company_id).toBe(company);
    expect(page.read_only).toBe(false);
    expect(page.current.id).toBe(sid);
    expect(page.current.status).toBe("submitted");
    expect(page.current.package_items).toHaveLength(2);
    expect(
      page.current.package_items.every((p: { file_ref: string }) =>
        p.file_ref.startsWith("athena-submittals/"),
      ),
    ).toBe(true);
    expect(page.packages).toHaveLength(1);
    expect(page.packages[0].download_url).toBe(a.download_url);
    expect(page.packages[0].path).toBe(path);
    expect(page.mail).toHaveLength(1);
    expect(page.mail[0].provider).toBe("local-fixture");
    expect(page.transmittals[0].to_email).toBe("reviewer@example.com");
    const sent = page.events.find((e: { kind: string }) => e.kind === "submittal_sent");
    expect(sent).toBeTruthy();
    expect(sent.host).toBe("claude");
    expect(sent.thread_ref).toBeNull();
    expect(sent.mine).toBe(true);
    expect(sent.actor_name).toBe("Fictional PM");
    expect(page.events.some((e: { kind: string }) => e.kind === "submittal_created")).toBe(true);

    // A teammate sees the same record; the conversation is not theirs.
    const theirs = await record(NUMBER, teammate);
    expect(theirs.events.find((e: { kind: string }) => e.kind === "submittal_sent").mine).toBe(
      false,
    );
    // A role without full job access cannot open it; a number not on the log is refused.
    await expect(record(NUMBER, estimator)).rejects.toThrow(/MCP_NO_JOB|full access/);
    await expect(record(NUMBER, superId)).rejects.toThrow(/MCP_NO_JOB|full access/);
    await expect(record("99 99 99-404")).rejects.toThrow("not on this job");
    expect(await rpc("mcp_submittal_record_stamp", [job, NUMBER])).toContain("|");
  });

  it("stores no host when a send receipt arrives without one, and the ten-argument record call still works", async () => {
    const sid = (
      await rpc("mcp_submittal_log", [
        job,
        "add",
        JSON.stringify({
          number: "26 24 16-002",
          title: "Fictional panel",
          spec_section: "26 24 16",
          submittal_type: "product_data",
          status: "in_prep",
          ball_in_court: "gc",
          package_items: [
            {
              kind: "product_cut",
              source_party: "Fictional Manufacturer",
              status: "needed",
              required: true,
              chase_role: "manufacturer",
              chase_name: "Pat Sample",
              chase_email: "pat@example.com",
            },
          ],
        }),
      ])
    ).saved_id as string;
    const c = await context(sid);
    const draft = {
      to: "pat@example.com",
      cc: [],
      subject: "Need the cut",
      body: "Please send the product cut.",
      link: null,
      attachment: null,
    };
    const mail = await delivery(sid, "draft", {
      kind: "chase",
      package_item_id: c.items[0].id,
      draft,
    });
    await delivery(sid, "approve", {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      confirmed: true,
    });
    await delivery(sid, "record_sent", {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      provider: "local-fixture",
      message_id: "synthetic-record-002",
      sent_at: new Date().toISOString(),
    });
    const page = await record("26 24 16-002");
    const chase = page.events.find((e: { kind: string }) => e.kind === "submittal_piece_chase");
    expect(chase.host).toBeNull();
    const id = await rpc("mcp_project_record_add", [
      job,
      "note",
      "Fictional note",
      "Written by the old call.",
      null,
      null,
      null,
      null,
      "{}",
      "user",
    ]);
    expect(typeof id).toBe("string");
    expect(
      (
        await db.query<{ host: string | null }>(
          "SELECT host FROM mcp_project_record_events WHERE id=$1",
          [id],
        )
      ).rows[0].host,
    ).toBeNull();
  });

  it("treats a piece sent again without its id as the same piece", async () => {
    const sid = (
      await rpc("mcp_submittal_log", [
        job,
        "add",
        JSON.stringify({
          number: "26 24 16-003",
          title: "Fictional lighting",
          spec_section: "26 51 00",
          submittal_type: "shop_drawing",
          status: "in_prep",
          ball_in_court: "sub",
          package_items: [
            {
              kind: "shop_drawing",
              source_party: "Fictional Sub",
              status: "needed",
              required: true,
            },
          ],
        }),
      ])
    ).saved_id as string;
    await rpc("mcp_submittal_log", [
      job,
      "update",
      JSON.stringify({
        submittal_id: sid,
        package_items: [
          {
            kind: "shop_drawing",
            source_party: "fictional sub",
            chase_role: "sub",
            chase_name: "Sam Sample",
            chase_email: "sam@example.com",
          },
        ],
      }),
    ]);
    const c = await context(sid);
    expect(c.items).toHaveLength(1);
    expect(c.items[0].chase_email).toBe("sam@example.com");
    expect(c.items[0].source_party).toBe("fictional sub");
    await rpc("mcp_submittal_log", [
      job,
      "update",
      JSON.stringify({
        submittal_id: sid,
        package_items: [
          { kind: "sample", source_party: "Fictional Sub", status: "needed", required: true },
        ],
      }),
    ]);
    expect((await context(sid)).items).toHaveLength(2);
  });

  it("opens the record with the job's board token and refuses other jobs and unknown numbers", async () => {
    const token = "r".repeat(43);
    const hash = await tokenHash(token);
    const minted = await rpc("mcp_board_link_create", [
      job,
      hash,
      new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    ]);
    expect(minted.id).toBeTruthy();
    const open = (j: string, n: string) =>
      asUser(
        db,
        { sub: "", email: "", role: "anon" as never },
        async (tx) =>
          (
            await tx.query("SELECT public.mcp_submittal_record_open($1,$2,$3) AS data", [
              hash,
              j,
              n,
            ])
          ).rows[0] as { data: { status: string; payload?: { page: string; number: string } } },
      );
    const ok = await open(job, NUMBER);
    expect(ok.data.status).toBe("ok");
    expect(ok.data.payload?.page).toBe("submittal");
    expect(ok.data.payload?.number).toBe(NUMBER);
    expect((await open(otherJob, NUMBER)).data.status).toBe("wrong_job");
    expect((await open(job, "99 99 99-404")).data.status).toBe("denied");
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM mcp_board_link_opens WHERE page='submittal'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe("browser POST RPC transaction mode", () => {
  it("allows the existing membership sync in record reads without changing function bodies, grants or package data", async () => {
    const number = "QA-280-READ";
    await rpc("mcp_submittal_log", [
      job,
      "add",
      JSON.stringify({
        number,
        title: "Fictional browser access check",
        spec_section: "26 24 16",
        submittal_type: "product_data",
        status: "in_prep",
        ball_in_court: "gc",
      }),
    ]);
    const names = ["mcp_submittal_record_get", "mcp_submittal_record_stamp"];
    const metadata = () =>
      db.query(
        `SELECT proname,prosrc,proacl::text,prosecdef,proconfig FROM pg_proc WHERE oid IN ('public.mcp_submittal_record_get(uuid,text)'::regprocedure,'public.mcp_submittal_record_stamp(uuid,text)'::regprocedure) ORDER BY proname`,
      );
    const before = (await metadata()).rows;
    const originalGate = (
      await db.query<{ definition: string }>(
        "SELECT pg_get_functiondef('public.mcp_gate()'::regprocedure) AS definition",
      )
    ).rows[0].definition;
    const counts = () =>
      db.query(
        `SELECT (SELECT count(*)::int FROM mcp_submittal_packages) AS packages,(SELECT count(*)::int FROM mcp_submittal_package_items) AS pieces,(SELECT count(*)::int FROM mcp_submittal_mail) AS mail`,
      );
    const beforeCounts = (await counts()).rows;
    // Production mcp_gate calls circle_sync_user, which SELECTs a provisioning
    // row FOR UPDATE even for a previously provisioned member. Keep the same
    // transaction requirement here, with fictional active-member rows only.
    await db.exec(
      `CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$ BEGIN PERFORM 1 FROM public.test_active_members WHERE user_id=auth.uid() FOR UPDATE; RETURN EXISTS(SELECT 1 FROM public.test_active_members WHERE user_id=auth.uid()); END $$;`,
    );
    const post = async (name: string, user = owner) => {
      const mode = (
        await db.query<{ volatility: string }>(
          "SELECT provolatile::text AS volatility FROM pg_proc WHERE oid=to_regprocedure($1)",
          [`public.${name}(uuid,text)`],
        )
      ).rows[0].volatility;
      // PostgREST POST: VOLATILE => READ WRITE, STABLE/IMMUTABLE => READ ONLY.
      return db.transaction(async (tx) => {
        await tx.exec(`SET TRANSACTION ${mode === "v" ? "READ WRITE" : "READ ONLY"}`);
        await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
          JSON.stringify(claims(user)),
        ]);
        await tx.exec("SET LOCAL ROLE authenticated");
        return (
          await tx.query<{ data: unknown }>(`SELECT public.${name}($1,$2) AS data`, [job, number])
        ).rows[0].data;
      });
    };
    try {
      for (const name of names) await expect(post(name)).rejects.toMatchObject({ code: "25006" });
      await db.exec(
        readFileSync(
          "drizzle/migrations/0025_athena_submittal_member_read_transaction.sql",
          "utf8",
        ),
      );
      expect((await metadata()).rows).toEqual(before);
      expect(await post(names[0])).toMatchObject({ read_only: false });
      expect(await post(names[1])).toContain("|");
      // The fixture's existing superintendent/estimator exclusions remain;
      // changing transaction mode never creates a job grant or broadens scope.
      await expect(post(names[0], superId)).rejects.toThrow(/MCP_NO_JOB|full access/);
      await expect(post(names[0], estimator)).rejects.toThrow(/MCP_NO_JOB|full access|role/i);
      await expect(post(names[0], "00000000-0000-4000-8000-000000000099")).rejects.toThrow(
        "MCP_INACTIVE",
      );
      expect((await counts()).rows).toEqual(beforeCounts);
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "SELECT has_function_privilege('anon','public.mcp_submittal_record_get(uuid,text)','execute') AS allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
    } finally {
      await db.exec(originalGate);
    }
  });
});

describe("submittal history time zone context", () => {
  beforeAll(async () => {
    await db.exec(readFileSync("supabase/migrations/20261023200000_athena_morning_brief.sql", "utf8"));
    const security = async () => (await db.query("SELECT proname,provolatile,prosecdef,proconfig,proacl::text FROM pg_proc WHERE oid IN ('public.mcp_company_save(uuid,jsonb)'::regprocedure,'public.mcp_submittal_record_get(uuid,text)'::regprocedure,'public.mcp_submittal_record_stamp(uuid,text)'::regprocedure) ORDER BY proname")).rows;
    const before = await security();
    await db.exec(readFileSync("supabase/migrations/20261025111504_athena_submittal_display_time_zone.sql", "utf8"));
    expect(await security()).toEqual(before);
  });
  it("reads job, company, then member zones and invalidates the stamp without altering package instants", async () => {
    const number = "TZ-HISTORY";
    await rpc("mcp_submittal_log", [job,"add",JSON.stringify({number,title:"Fictional history zone",spec_section:"26 24 16",submittal_type:"product_data",status:"in_prep",ball_in_court:"gc"})]);
    const packageSnapshot = async () => (await db.query("SELECT id,created_at,filename,path FROM mcp_submittal_packages ORDER BY id")).rows;
    const before = await packageSnapshot();
    await db.query("UPDATE mcp_jobs SET time_zone='America/Chicago' WHERE id=$1",[job]);
    await q("INSERT INTO mcp_morning_brief_settings(user_id,time_zone) VALUES ($1,'America/New_York')",[owner]);
    let page = await record(number);
    expect(page.time_zone_context).toEqual({job:"America/Chicago",company:null,member:"America/New_York"});
    const stamp = await rpc("mcp_submittal_record_stamp",[job,number]);
    await rpc("mcp_company_save",[company,JSON.stringify({time_zone:"America/Los_Angeles"})]);
    expect(await rpc("mcp_submittal_record_stamp",[job,number])).not.toBe(stamp);
    await db.query("UPDATE mcp_jobs SET time_zone=NULL WHERE id=$1",[job]);
    page = await record(number);
    expect(submittalBuildTime("2026-10-24T19:11:33Z",page.time_zone_context)).toContain("12:11 PM PDT (America/Los_Angeles)");
    await rpc("mcp_company_save",[company,JSON.stringify({time_zone:null})]);
    page = await record(number);
    expect(submittalBuildTime("2026-12-01T02:11:33Z",page.time_zone_context)).toContain("9:11 PM EST (America/New_York)");
    const memberStamp = await rpc("mcp_submittal_record_stamp",[job,number]);
    await q("UPDATE mcp_morning_brief_settings SET time_zone='Asia/Kolkata' WHERE user_id=$1",[owner]);
    expect(await rpc("mcp_submittal_record_stamp",[job,number])).not.toBe(memberStamp);
    expect(await packageSnapshot()).toEqual(before);
    expect((await record(number)).read_only).toBe(false);
  });
  it("preserves Owner-only profile changes and denied record access, and validates company zones", async () => {
    await expect(rpc("mcp_company_save",[company,JSON.stringify({time_zone:"America/Denver"})],teammate)).rejects.toThrow("Only a company Owner");
    await expect(rpc("mcp_company_save",[company,JSON.stringify({time_zone:"Bad/Zone"})])).rejects.toThrow("valid IANA");
    await expect(record("TZ-HISTORY",estimator)).rejects.toThrow(/MCP_NO_JOB|full access/);
    const meta = await db.query<{proname:string;provolatile:string;anon:boolean}>("SELECT proname,provolatile,has_function_privilege('anon',oid,'execute') AS anon FROM pg_proc WHERE oid IN ('public.mcp_submittal_record_get(uuid,text)'::regprocedure,'public.mcp_submittal_record_stamp(uuid,text)'::regprocedure)");
    expect(meta.rows.every(r=>r.provolatile==='v' && r.anon===false)).toBe(true);
  });
});
