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
  await load("20261025150000_athena_change_order_packages");
});
afterAll(async () => {
  await db?.close();
});

type CoReply = {
  saved_id: string;
  already_applied: boolean;
  records: import("./change-orders").ChangeRow[];
};
const change = (action: string, p: Record<string, unknown>, user = owner) =>
  rpc("mcp_change_record", [job, action, JSON.stringify(p)], user) as unknown as Promise<CoReply>;
const changes = () => rpc("mcp_change_rows", [job]) as unknown as Promise<CoReply>;
const coContent = () => ({
  request_id: crypto.randomUUID(),
  title: "Bulletin #4 connection change",
  condition: "A101 detail 4 revised",
  scope: "Revise steel connection at grid B/3",
  references: [{ kind: "drawing", citation: "A101 detail 4" }],
  recipient_name: "Pat Example",
  recipient_email: "pat@example.com",
  origin: "contractor",
});
const costs = [
  {
    category: "material",
    description: "Connection plates",
    quantity: 2,
    unit: "EA",
    unit_rate_cents: 5000,
    source: "Fictional supplier quote #12",
  },
  {
    category: "markup",
    description: "Agreed overhead",
    rate_basis_points: 1000,
    source: "Contract section 7",
  },
];
describe("commercial packages on the shared engine", () => {
  it("creates one retry-safe PCO, prices in cents and keeps pricing out of the shared parent", async () => {
    const p = coContent();
    const saved = await change("create", p);
    expect((await change("create", p)).already_applied).toBe(true);
    const row = (await changes()).records.find((r) => r.id === saved.saved_id)!;
    expect(row.number).toBe("PCO-001");
    expect(row.change_order_details.state).toBe("draft");
    await change("price", {
      request_id: crypto.randomUUID(),
      submittal_id: saved.saved_id,
      expected_version: 1,
      lines: costs,
    });
    const priced = (await changes()).records.find((r) => r.id === saved.saved_id)!;
    expect(priced.change_order_details.total_cents).toBe(11000);
    expect(priced.change_order_details.lines.map((l) => l.amount_cents)).toEqual([10000, 1000]);
    const parent = await db.query("SELECT request_details FROM mcp_submittals WHERE id=$1", [
      saved.saved_id,
    ]);
    expect((parent.rows[0] as { request_details: unknown }).request_details).toBeNull();
    const ctx = (await rpc("mcp_submittal_package_context", [job, saved.saved_id])) as unknown as {
      change_order_details: { total_cents: number };
    };
    expect(ctx.change_order_details.total_cents).toBe(11000);
  });
  it("refuses premature approval/execution and stale price edits without changing billing", async () => {
    const saved = await change("create", coContent());
    await expect(
      change("execute", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 1,
        confirmed: true,
      }),
    ).rejects.toThrow("Execution requires");
    await expect(
      change("approve", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 1,
        confirmed: true,
      }),
    ).rejects.toThrow("after submission");
    await change("price", {
      request_id: crypto.randomUUID(),
      submittal_id: saved.saved_id,
      expected_version: 1,
      lines: costs,
    });
    await expect(
      change("price", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 1,
        lines: costs,
      }),
    ).rejects.toThrow("read it again");
    expect(
      (await db.query("SELECT * FROM mcp_job_facts WHERE job_id=$1 AND module='sov'", [job])).rows,
    ).toHaveLength(0);
  });
  it("opens only the same full-job capability and restores the original reader identity", async () => {
    const hash = await tokenHash("y".repeat(43));
    await rpc("mcp_board_link_create", [job, hash, new Date(Date.now() + 86400000).toISOString()]);
    await asUser(
      db,
      { sub: outsider, email: "outsider@example.com", role: "authenticated" },
      async (tx) => {
        const result = await tx.query("SELECT mcp_change_log_open($1,$2) data", [hash, job]);
        expect(result.rows[0].data.status).toBe("ok");
        expect(result.rows[0].data.payload.read_only).toBe(true);
        expect((await tx.query("SELECT auth.uid() uid")).rows[0].uid).toBe(outsider);
      },
    );
    await rpc("mcp_board_link_revoke", [hash]);
    expect(await rpc("mcp_change_log_open", [hash, job])).toMatchObject({
      status: "denied",
      payload: null,
    });
  });
  it("denies outsiders and rejects incomplete rates rather than inventing amounts", async () => {
    await expect(change("create", coContent(), outsider)).rejects.toThrow("full job access");
    const saved = await change("create", coContent());
    await expect(
      change("price", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 1,
        lines: [{ category: "labor", description: "Crew", source: "Quote" }],
      }),
    ).rejects.toThrow("integer-cent rate");
  });
});
