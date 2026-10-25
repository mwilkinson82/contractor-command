import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import type { RequestRow } from "./request-log";
import type { PackageContext } from "./submittal-package";
import { tokenHash } from "./file-share";
type Reply = {
  id: string;
  draft_key: string;
  approved_at: string;
  saved_id: string;
  number: string;
  already_applied: boolean;
  records: RequestRow[];
  fingerprint: string;
  submittal: PackageContext["submittal"];
};

const owner = "00000000-0000-4000-8000-000000000091";
const outsider = "00000000-0000-4000-8000-000000000092";
const company = "00000000-0000-4000-8000-000000000093";
const job = "00000000-0000-4000-8000-000000000094";
let db: PGlite;
let legacy: { id: string; fingerprint: string; deliveryId: string; draftKey: string };
const query = (sql: string, values: unknown[] = [], user = owner) =>
  asUser(
    db,
    { sub: user, role: "authenticated", email: `${user.slice(-2)}@example.com` },
    (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const rpc = async (fn: string, values: unknown[], user = owner) =>
  (
    await query(
      `SELECT public.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
      values,
      user,
    )
  ).rows[0].data as Reply;
const write = (kind: string, action: string, p: Record<string, unknown>, user = owner) =>
  rpc("mcp_request_record", [job, kind, action, JSON.stringify(p)], user);
const list = (kind = "rfi") => rpc("mcp_request_rows", [job, kind]);
const content = (extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(),
  title: "Connection at grid B/3 #12",
  condition: "A101 detail conflicts with spec 05 12 00",
  question: "Which connection applies? Bulletin #4.",
  references: [{ kind: "drawing", citation: "A101 detail 4" }],
  recipient_name: "Pat Example",
  recipient_role: "construction_manager",
  recipient_email: "pat@example.com",
  ...extra,
});

beforeAll(async () => {
  db = await makeDb();
  const load = (f: string) => db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  const pages = readFileSync("supabase/migrations/20261021120000_athena_report_pages.sql", "utf8");
  const leaderStart = pages.indexOf("CREATE OR REPLACE FUNCTION public.mcp_is_company_leader");
  const leaderEnd = pages.indexOf("TO authenticated;", leaderStart) + "TO authenticated;".length;
  await db.exec(pages.slice(leaderStart, leaderEnd));
  await load("20261023070000_athena_board_links");
  const log = readFileSync("supabase/migrations/20261023220000_athena_submittal_log.sql", "utf8");
  await db.exec(log);
  await load("20261024010000_athena_submittal_chase");
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated;",
  );
  await load("20261021000000_athena_file_shares");
  await load("20261028120000_athena_submittal_packages");
  await load("20261029120000_athena_submittal_record_page");
  await load("20261030120000_athena_package_build_identity");
  const drawings = readFileSync(
    "supabase/migrations/20261027130000_athena_drawing_versions.sql",
    "utf8",
  );
  await db.exec(drawings.slice(0, drawings.indexOf("CREATE FUNCTION public.mcp_drawing_records")));
  // The plan decision is an external entitlement dependency, not a test-account bypass.
  // The real membership gate and company/job/role functions from the base migrations run unchanged.
  await db.exec(
    "CREATE TABLE test_company_plans(company_id uuid PRIMARY KEY,plan text); CREATE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT plan FROM test_company_plans WHERE company_id=_company $$;",
  );
  for (const user of [owner, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Fictional Construction',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','QA Owner')",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,'2701','Fictional Job','America/Chicago')",
    [job, owner, company],
  );
  await db.query("INSERT INTO test_company_plans VALUES($1,'circle')", [company]);
  const seed = await rpc("mcp_submittal_log", [
    job,
    "add",
    JSON.stringify({
      number: "LEGACY-APPROVAL",
      title: "Existing installation approval",
      spec_section: "05 12 00",
      submittal_type: "shop_drawing",
      status: "in_prep",
      ball_in_court: "gc",
    }),
  ]);
  await db.query(
    "UPDATE mcp_transmittals SET to_name='Pat Example',to_email='pat@example.com' WHERE id=(SELECT transmittal_id FROM mcp_submittals WHERE id=$1)",
    [seed.saved_id],
  );
  const ctx = await rpc("mcp_submittal_package_context", [job, seed.saved_id]);
  const draft = await rpc("mcp_submittal_delivery", [
    job,
    seed.saved_id,
    "draft",
    JSON.stringify({
      kind: "chase",
      draft: {
        to: "pat@example.com",
        cc: [],
        subject: "Existing draft",
        body: "Please provide the shop drawing.",
        link: null,
        attachment: null,
      },
    }),
  ]);
  legacy = {
    id: seed.saved_id,
    fingerprint: ctx.fingerprint,
    deliveryId: draft.id,
    draftKey: draft.draft_key,
  };
  await load("20261025140000_athena_request_package_records");
});
afterAll(async () => {
  await db?.close();
});

describe("Request records share the real submittal package storage", () => {
  it("preserves pre-migration approval fingerprints and pending exact chase approvals", async () => {
    expect((await rpc("mcp_submittal_package_context", [job, legacy.id])).fingerprint).toBe(
      legacy.fingerprint,
    );
    const approved = await rpc("mcp_submittal_delivery", [
      job,
      legacy.id,
      "approve",
      JSON.stringify({
        delivery_id: legacy.deliveryId,
        draft_key: legacy.draftKey,
        confirmed: true,
      }),
    ]);
    expect(approved.approved_at).toBeTruthy();
  });

  it("allocates RFI and RFC numbers separately but uses the common job transmittal sequence", async () => {
    const rfi = await write("rfi", "create", content());
    const rfc = await write("rfc", "create", content());
    expect(rfi.number).toBe("RFI-001");
    expect(rfc.number).toBe("RFC-001");
    const a = (await list()).records[0];
    const b = (await list("rfc")).records[0];
    expect(b.transmittal_number).toBe(a.transmittal_number + 1);
    expect(a.spec_section).toBe("");
    expect(a.state).toBe("draft");
    expect(a.request_details.question).toContain("#4");
    const ctx = await rpc("mcp_submittal_package_context", [job, rfi.saved_id]);
    expect(ctx.submittal.id).toBe(rfi.saved_id);
    expect(ctx.submittal.package_purpose).toBe("rfi");
    expect(ctx.submittal.request_details?.references[0].citation).toBe("A101 detail 4");
  });

  it("binds a stored drawing citation to this job and its actual hash, rejecting another job's source", async () => {
    const source = crypto.randomUUID();
    await db.query(
      "INSERT INTO mcp_drawing_versions(id,job_id,company_id,kind,source_key,content_hash,path,filename,sheets,version,created_by) VALUES($1,$2,$3,'source','a101',$4,'fixture/drawing.pdf','A101.pdf','[\"A101\"]',2,$5)",
      [source, job, company, "a".repeat(64), owner],
    );
    const p = content({
      references: [
        {
          kind: "drawing",
          citation: "A101 detail 4",
          source_id: source,
          source_binding: { content_hash: "forged" },
        },
      ],
    });
    const saved = await write("rfi", "create", p);
    const row = (await list()).records.find((r) => r.id === saved.saved_id)!;
    expect(row.request_details.references[0]).toMatchObject({
      source_id: source,
      source_binding: { content_hash: "a".repeat(64), storage_version: 2 },
    });
    await expect(
      write(
        "rfi",
        "create",
        content({
          references: [{ kind: "drawing", citation: "Other job", source_id: crypto.randomUUID() }],
        }),
      ),
    ).rejects.toThrow("not on this job");
  });

  it("deduplicates a retried create and refuses reused operation IDs with different content", async () => {
    const p = content();
    const a = await write("rfi", "create", p);
    const b = await write("rfi", "create", p);
    expect(b.saved_id).toBe(a.saved_id);
    expect(b.already_applied).toBe(true);
    await expect(write("rfi", "create", { ...p, title: "Different" })).rejects.toThrow(
      "different content",
    );
  });

  it("invalid content rolls back both the record and its transmittal", async () => {
    const before = (await list()).records.length;
    const transmittals = await db.query("SELECT count(*)::int AS n FROM mcp_transmittals");
    await expect(write("rfi", "create", content({ references: [] }))).rejects.toThrow();
    expect((await list()).records.length).toBe(before);
    expect((await db.query("SELECT count(*)::int AS n FROM mcp_transmittals")).rows).toEqual(
      transmittals.rows,
    );
  });

  it("uses a version check, preserves references and blocks injected lifecycle fields", async () => {
    const saved = await write("rfi", "create", content());
    await write("rfi", "edit", {
      request_id: crypto.randomUUID(),
      submittal_id: saved.saved_id,
      expected_version: 1,
      question: "Is CO #3 included?",
      state: "closed",
      answer: { text: "Forged" },
    });
    const row = (await list()).records.find((r) => r.id === saved.saved_id)!;
    expect(row.request_details.question).toBe("Is CO #3 included?");
    expect(row.request_details.state).toBe("draft");
    expect(row.request_details.answer).toBeUndefined();
    await expect(
      write("rfi", "edit", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 1,
        title: "Stale",
      }),
    ).rejects.toThrow("request changed");
  });

  it("invalidates a draft package snapshot when the question changes", async () => {
    const saved = await write("rfi", "create", content());
    const before = await rpc("mcp_submittal_package_context", [job, saved.saved_id]);
    await write("rfi", "edit", {
      request_id: crypto.randomUUID(),
      submittal_id: saved.saved_id,
      expected_version: 1,
      question: "New condition, RFI #12",
    });
    const after = await rpc("mcp_submittal_package_context", [job, saved.saved_id]);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it("never treats creation, a status request or a typed answer as a successful send", async () => {
    const saved = await write("rfi", "create", content());
    await expect(
      write("rfi", "answer", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 1,
        answer: {
          text: "Approved",
          received_from: "Pat Example",
          received_at: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow("sent request");
    await expect(
      query("UPDATE mcp_submittals SET status='submitted' WHERE id=$1", [saved.saved_id]),
    ).rejects.toThrow();
    await expect(
      write("rfi", "close", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 1,
        confirmed: true,
      }),
    ).rejects.toThrow("Review the answer");
  });

  it("reads do not build packages, allocate transmittals or write operation records", async () => {
    const counts = () =>
      db.query(
        "SELECT (SELECT count(*)::int FROM mcp_submittal_packages) AS builds,(SELECT count(*)::int FROM mcp_transmittals) AS transmittals,(SELECT count(*)::int FROM mcp_request_operations) AS operations",
      );
    const before = await counts();
    await list();
    await list();
    expect((await counts()).rows).toEqual(before.rows);
  });

  it("denies other-company records and keeps PM-only plans out of bid clarification writes", async () => {
    await expect(write("rfi", "create", content(), outsider)).rejects.toThrow("full access");
    await db.query("UPDATE test_company_plans SET plan='athena_pm' WHERE company_id=$1", [company]);
    await expect(write("rfc", "create", content())).rejects.toThrow("Athena Office");
    await db.query("UPDATE test_company_plans SET plan='circle' WHERE company_id=$1", [company]);
  });
  it("uses the existing job capability and restores the original caller after a log read", async () => {
    const hash = await tokenHash("x".repeat(43));
    await rpc("mcp_board_link_create", [job, hash, new Date(Date.now() + 86400000).toISOString()]);
    await asUser(
      db,
      { sub: outsider, email: "outside@example.com", role: "authenticated" },
      async (tx) => {
        const opened = await tx.query("SELECT public.mcp_request_log_open($1,$2,'rfi') data", [
          hash,
          job,
        ]);
        expect(opened.rows[0].data.status).toBe("ok");
        expect(opened.rows[0].data.payload.read_only).toBe(true);
        expect(
          opened.rows[0].data.payload.records.every(
            (row: { package_purpose: string }) => row.package_purpose === "rfi",
          ),
        ).toBe(true);
        const principal = await tx.query("SELECT auth.uid() uid");
        expect(principal.rows[0].uid).toBe(outsider);
      },
    );
    const wrong = await rpc("mcp_request_log_open", [
      hash,
      "00000000-0000-4000-8000-000000000095",
      "rfi",
    ]);
    expect(wrong).toMatchObject({ status: "wrong_job", payload: null });
    await rpc("mcp_board_link_revoke", [hash]);
    expect(await rpc("mcp_request_log_open", [hash, job, "rfi"])).toMatchObject({
      status: "revoked",
      payload: null,
    });
  });
});
