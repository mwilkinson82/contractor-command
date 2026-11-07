import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import type { RequestRow } from "./request-log";
import type { PackageContext } from "./submittal-package";
import { tokenHash } from "./file-share";
import { buildSov, type SovLineIn } from "./sov";
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
  await load("20261025153000_athena_change_execution_tie");
  await load("20261030130000_athena_submittal_log_approval_only");
  await load("20261030140000_athena_sov_contract_total_guard");
  await load("20261030150000_athena_sov_official_lock");
  // Only the member-execution step of the client-approval migration; the client page isn't loaded here.
  const joins = readFileSync(
    "supabase/migrations/20261107010000_athena_client_approved_co_joins_contract.sql",
    "utf8",
  );
  await db.exec(
    joins.slice(
      joins.indexOf("-- A member's execution adds"),
      joins.indexOf("-- Change orders the client already approved"),
    ),
  );
  await db.exec(readFileSync("release-proposals/estimating-destination-versions.sql", "utf8"));
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
  it("keeps RFI, RFC, and change-order rows off the submittal log while their own logs stay", async () => {
    const before = (await rpc("mcp_submittal_rows", [job])) as unknown as { submittals: { number: string }[] };
    const rfi = await write("rfi", "create", content());
    const rfc = await write("rfc", "create", content());
    const pco = await change("create", coContent());
    const added = (await rpc("mcp_submittal_log", [job, "add", JSON.stringify({
      number: "26 05 00-009", title: "Fictional approval only", spec_section: "26 05 00", submittal_type: "product_data", status: "in_prep", ball_in_court: "gc",
    })])) as unknown as { submittals: { number: string; transmittal_number: number }[] };
    const numbers = (rows: { number: string }[]) => rows.map((row) => row.number).sort();
    expect(numbers(added.submittals)).toEqual(numbers([...before.submittals, { number: "26 05 00-009" }]));
    for (const hidden of [rfi.number, rfc.number, (await changes()).records.find((row) => row.id === pco.saved_id)!.number]) {
      expect(numbers(added.submittals)).not.toContain(hidden);
    }
    const page = (await rpc("mcp_submittal_page", [job])) as unknown as { submittals: { number: string }[]; page: string };
    expect(page.page).toBe("submittals");
    expect(numbers(page.submittals)).toEqual(numbers(added.submittals));
    expect((await list("rfi")).records.map((row) => row.number)).toContain(rfi.number);
    expect((await list("rfc")).records.map((row) => row.number)).toContain(rfc.number);
    expect((await changes()).records.map((row) => row.number)).toContain((await changes()).records.find((row) => row.id === pco.saved_id)!.number);
    const sequence = await db.query<{ number: number }>("SELECT number FROM mcp_transmittals WHERE job_id=$1 ORDER BY number", [job]);
    const issued = sequence.rows.map((row) => Number(row.number));
    expect(issued).toEqual([...issued].sort((a, b) => a - b));
    expect(new Set(issued).size).toBe(issued.length);
    expect(issued[issued.length - 1] - issued[0] + 1).toBe(issued.length);
    const guards = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
       WHERE ns.nspname='public' AND p.proname IN ('mcp_submittal_spec_required','mcp_submittal_package_write','mcp_submittal_delivery')
         AND position('NOT IN (''rfi'',''rfc'')' IN pg_get_functiondef(p.oid)) > 0
         AND position('NOT IN (''rfi'',''rfc'',''change_order'')' IN pg_get_functiondef(p.oid)) = 0`,
    );
    expect(guards.rows[0].n).toBe(0);
  });
  it("executes approved changes and compensating credits through the destination guards exactly once", async () => {
    const destination = async () =>
      (await query("SELECT mcp_estimate_destination_snapshot($1) AS data", [job])).rows[0]
        .data as { version: number; sov: Record<string, Record<string, unknown>> };
    const before = await destination();
    await query("SELECT mcp_estimate_destination_save($1,$2,NULL,$3,NULL,10,$4)", [
      job,
      before.version,
      JSON.stringify({
        "05.01": { description: "Base steel", billable_value: 900, cost_codes: [] },
      }),
      "Executed base agreement",
    ]);
    await query("SELECT mcp_set_facts($1,'contract',$2,'member_answer')", [
      job,
      JSON.stringify({ contract_value: 1000 }),
    ]);
    const evidence = async (reference: string) => ({
      by: "Fixture signing authority",
      at: (await db.query<{at:string}>("SELECT clock_timestamp()::text AS at")).rows[0].at,
      reference,
    });
    const approvedChange = async (credit: boolean) => {
      const saved = await change("create", {
        ...coContent(),
        title: credit ? "Approved compensating credit" : "Approved connection change",
      });
      await change("price", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 1,
        lines: credit
          ? [{
              category: "material",
              description: "Compensating connection credit",
              quantity: 1,
              unit: "LS",
              unit_rate_cents: -11000,
              source: "Separately approved credit agreement",
            }]
          : costs,
      });
      // A synthetic prior submission receipt supplies the delivery prerequisite.
      // No provider or external message is called; approval/execution use the real RPC.
      const packageId = crypto.randomUUID();
      const receiptId = crypto.randomUUID();
      const hash = crypto.randomUUID().replace(/-/g, "").repeat(2);
      await db.query(
        `INSERT INTO mcp_submittal_packages
         (id,company_id,job_id,submittal_id,fingerprint,path,filename,size_bytes,sha256,
          page_count,cover_date,manifest,token_hash,signed_url,download_url,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,'fixture.pdf',1,$7,1,current_date,'{}',$7,
          'https://fixture.invalid/signed','https://fixture.invalid/download',now()+interval '1 hour')`,
        [packageId, company, job, saved.saved_id, receiptId, `${packageId}/fixture.pdf`, hash],
      );
      await db.query(
        `INSERT INTO mcp_submittal_mail
         (company_id,job_id,submittal_id,package_id,kind,draft,draft_key,context_key,
          approved_at,sent_at,provider,message_id)
         VALUES($1,$2,$3,$4,'package','{}',$5,$5,now(),now(),'fixture',$5)`,
        [company, job, saved.saved_id, packageId, receiptId],
      );
      await change("approve", {
        request_id: crypto.randomUUID(),
        submittal_id: saved.saved_id,
        expected_version: 2,
        confirmed: true,
        evidence: await evidence(credit ? "Signed credit approval" : "Signed change approval"),
      });
      expect((await changes()).records.find((row) => row.id === saved.saved_id)!
        .change_order_details.state).toBe("approved");
      return saved.saved_id;
    };
    const execute = async (id: string) => {
      const payload = {
        request_id: crypto.randomUUID(),
        submittal_id: id,
        expected_version: 3,
        confirmed: true,
        sov_division: "05",
        evidence: await evidence("Signed execution authority"),
      };
      expect((await change("execute", payload)).already_applied).toBe(false);
      const applied = await destination();
      expect((await change("execute", payload)).already_applied).toBe(true);
      expect(await destination()).toEqual(applied);
      return applied;
    };
    const total = (sov: Record<string, Record<string, unknown>>) =>
      buildSov(Object.entries(sov).map(([key, value]) => ({
        item_no: key,
        description: value.description,
        scheduled_value: value.billable_value,
        executed_change_order: value.executed_change_order,
        fee_included: value.fee_included,
      })) as SovLineIn[], 10, null).summary.contract_total;

    const positiveId = await approvedChange(false);
    const positive = await execute(positiveId);
    expect(Object.values(positive.sov).filter((line) => line.executed_change_order === positiveId))
      .toEqual([expect.objectContaining({ billable_value: 110, fee_included: true })]);
    expect(total(positive.sov)).toBe(1110);
    await expect(change("reopen", {
      request_id: crypto.randomUUID(), submittal_id: positiveId, expected_version: 4, confirmed: true,
    })).rejects.toThrow("compensating change");

    const creditId = await approvedChange(true);
    const compensated = await execute(creditId);
    expect(Object.values(compensated.sov).filter((line) => line.executed_change_order === creditId))
      .toEqual([expect.objectContaining({ billable_value: -110, fee_included: true })]);
    expect(compensated.sov["05.01"]).toEqual(positive.sov["05.01"]);
    expect(Object.values(compensated.sov).filter((line) => line.executed_change_order === positiveId))
      .toEqual(Object.values(positive.sov).filter((line) => line.executed_change_order === positiveId));
    expect(total(compensated.sov)).toBe(1000);
    const contract = await db.query<{ key: string; value: number }>(
      "SELECT key,value FROM mcp_job_facts WHERE job_id=$1 AND module='contract' ORDER BY key", [job],
    );
    expect(contract.rows).toEqual([
      { key: "contract_value", value: 1000 },
      { key: "executed_change_orders", value: 0 },
    ]);
    for (const id of [positiveId, creditId])
      expect((await changes()).records.find((row) => row.id === id)!
        .change_order_details.state).toBe("executed");
  });
});
