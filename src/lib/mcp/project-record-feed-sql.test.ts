// Runs the project record feed migration against a small stand-in schema in PGlite:
// every source table it reads, with only the columns it reads.
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CO = "00000000-0000-0000-0000-0000000000c1";
const JOB = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000a2";
const PM = "00000000-0000-0000-0000-0000000000b1";
const SUPER = "00000000-0000-0000-0000-0000000000b2";

const STUB = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE TABLE test_scope (job_id uuid PRIMARY KEY, scope text);
CREATE FUNCTION mcp_assert_active() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION mcp_job_scope(_job uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT scope FROM test_scope WHERE job_id = _job $$;
CREATE TABLE mcp_companies (id uuid PRIMARY KEY, name text, time_zone text);
CREATE TABLE mcp_jobs (id uuid PRIMARY KEY, company_id uuid, name text, job_number text, time_zone text, pm_user_id uuid, pm_name text);
CREATE TABLE mcp_company_members (company_id uuid, user_id uuid, display_name text, role text);
CREATE TABLE mcp_project_record_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, job_id uuid, occurred_at timestamptz,
  actor text, actor_id uuid, kind text, title text, summary text, counterparty_name text, counterparty_email text, ref_table text, ref_id uuid);
CREATE TABLE mcp_daily_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, report_date date, manpower text, delays text,
  created_by uuid, created_at timestamptz, updated_at timestamptz);
CREATE TABLE mcp_living_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, report_type text, version int, data_date date,
  activity_count int, change_what text, change_why text, updated_by uuid, updated_by_name text, created_at timestamptz);
CREATE TABLE mcp_lookaheads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid);
CREATE TABLE mcp_lookahead_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lookahead_id uuid, rev int, start_date date, end_date date,
  user_id uuid, created_at timestamptz);
CREATE TABLE mcp_lookahead_confirms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, party_name text, what text, window_end date,
  status text, responder_name text, response_note text, responded_at timestamptz, email_status text, created_by uuid, created_at timestamptz);
CREATE TABLE mcp_delay_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, description text, activity text, start_date date,
  start_known bool, days int, cause text, created_by uuid, created_at timestamptz);
CREATE TABLE mcp_estimate_gap_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, ref text, title text, question text,
  spec_section text, sheet text, created_at timestamptz);
CREATE TABLE mcp_estimate_verdicts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, item_text text, mark text, note text,
  corrected_qty numeric, owner text, marked_by uuid, created_at timestamptz);
CREATE TABLE mcp_payment_applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text);
CREATE TABLE mcp_payment_application_versions (application_id uuid, job_id uuid, version int, recorded_at timestamptz, recorded_by uuid);
CREATE TABLE mcp_document_email_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, actor_id uuid, application_id uuid,
  application_version int, payload jsonb, state text, updated_at timestamptz);
CREATE TABLE mcp_recorded_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, method text, amount_cents bigint, received_on date,
  reference text, note text, recorded_by uuid, recorded_at timestamptz, voided_at timestamptz, voided_by uuid, void_reason text);
CREATE TABLE mcp_portal_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, amount_cents bigint, method text, paid_at timestamptz);
CREATE TABLE mcp_job_contracts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, counterparty text, title text, signed_on date);
CREATE TABLE mcp_job_contract_versions (contract_id uuid, version int, reason text, recorded_by uuid, recorded_at timestamptz);
CREATE TABLE mcp_drawing_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, kind text, filename text, page_count int,
  version int, created_by uuid, created_at timestamptz);
CREATE TABLE mcp_open_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, action text, resolution text);
CREATE TABLE mcp_item_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, item_id uuid, event text, note text, created_at timestamptz);
`;

const SEED = `
INSERT INTO mcp_companies VALUES ('${CO}', 'ALP Builders', 'America/New_York');
INSERT INTO mcp_jobs VALUES ('${JOB}', '${CO}', 'Harbor Clinic', '2717', 'America/New_York', '${PM}', 'Pat PM'),
  ('${OTHER}', '${CO}', 'Other', '2718', NULL, NULL, NULL);
INSERT INTO test_scope VALUES ('${JOB}', 'full'), ('${OTHER}', 'super');
INSERT INTO mcp_company_members VALUES ('${CO}', '${PM}', 'Pat PM', 'project_manager'), ('${CO}', '${SUPER}', 'Sam Super', 'superintendent');
INSERT INTO mcp_project_record_events (company_id, job_id, occurred_at, actor, actor_id, kind, title, summary, counterparty_name) VALUES
  ('${CO}', '${JOB}', '2026-10-01 14:00Z', 'user', '${PM}', 'submittal_sent', 'RFI 12 sent', 'Slab edge question', 'Arch Co'),
  ('${CO}', '${JOB}', '2026-10-02 15:00Z', 'athena', NULL, 'submittal_sent', 'Submittal 03 30 00-1 sent', NULL, 'Arch Co'),
  ('${CO}', '${JOB}', '2026-10-03 16:00Z', 'user', NULL, 'change_order_customer_approved', 'PCO 4 approved', NULL, 'Owner Olive'),
  ('${CO}', '${OTHER}', '2026-10-03 16:00Z', 'user', '${PM}', 'submittal_sent', 'Other job', NULL, NULL);
INSERT INTO mcp_daily_reports (job_id, report_date, manpower, delays, created_by, created_at, updated_at) VALUES
  ('${JOB}', '2026-10-04', '6 electricians', 'Rain', '${SUPER}', '2026-10-05 01:30Z', '2026-10-06 12:00Z');
INSERT INTO mcp_living_reports (job_id, report_type, version, data_date, activity_count, change_what, updated_by, updated_by_name, created_at) VALUES
  ('${JOB}', 'cpm', 1, '2026-10-01', 42, NULL, '${PM}', NULL, '2026-10-01 12:00Z'),
  ('${JOB}', 'cpm', 2, '2026-10-08', 43, 'Pushed roofing', '${PM}', NULL, '2026-10-08 12:00Z'),
  ('${JOB}', 'sov', 1, NULL, NULL, NULL, '${PM}', NULL, '2026-10-08 12:00Z');
INSERT INTO mcp_lookaheads (id, job_id) VALUES ('00000000-0000-0000-0000-00000000aaaa', '${JOB}');
INSERT INTO mcp_lookahead_revisions (lookahead_id, rev, start_date, end_date, user_id, created_at) VALUES
  ('00000000-0000-0000-0000-00000000aaaa', 1, '2026-10-12', '2026-10-25', '${SUPER}', '2026-10-09 13:00Z');
INSERT INTO mcp_lookahead_confirms (job_id, party_name, what, window_end, status, responder_name, response_note, responded_at, email_status, created_by, created_at) VALUES
  ('${JOB}', 'Spark Electric', 'Rough-in Oct 14', '2026-10-11', 'confirmed', 'Joe', 'We will be there', '2026-10-10 18:00Z', 'sent', '${SUPER}', '2026-10-09 14:00Z');
INSERT INTO mcp_delay_events (job_id, description, activity, start_date, start_known, days, cause, created_by, created_at) VALUES
  ('${JOB}', 'Owner held the slab pour', 'Slab on grade', '2026-10-02', true, 3, 'Owner', '${PM}', '2026-10-06 15:00Z');
INSERT INTO mcp_estimate_gap_items (job_id, ref, title, question, spec_section, sheet, created_at) VALUES
  ('${JOB}', 'G-1', 'Temporary power not shown', 'Who carries temp power?', '01 50 00', 'E-001', '2026-09-20 15:00Z');
INSERT INTO mcp_estimate_verdicts (job_id, item_text, mark, note, corrected_qty, owner, marked_by, created_at) VALUES
  ('${JOB}', 'Temporary power not shown', 'answered', 'GC carries it', NULL, NULL, '${PM}', '2026-09-21 15:00Z');
INSERT INTO mcp_payment_applications (id, number) VALUES ('00000000-0000-0000-0000-00000000bbbb', '3');
INSERT INTO mcp_payment_application_versions VALUES ('00000000-0000-0000-0000-00000000bbbb', '${JOB}', 1, '2026-10-20 15:00Z', '${PM}');
INSERT INTO mcp_document_email_deliveries (job_id, actor_id, application_id, application_version, payload, state, updated_at) VALUES
  ('${JOB}', '${PM}', '00000000-0000-0000-0000-00000000bbbb', 1, '{"email":{"to":"owner@example.com"}}', 'host_reported_provider_acceptance', '2026-10-20 16:00Z'),
  ('${JOB}', '${PM}', '00000000-0000-0000-0000-00000000bbbb', 1, '{}', 'draft', '2026-10-20 16:00Z');
INSERT INTO mcp_recorded_payments (job_id, method, amount_cents, received_on, reference, note, recorded_by, recorded_at, voided_at, voided_by, void_reason) VALUES
  ('${JOB}', 'check', 12345678, '2026-10-24', 'Check 1001', NULL, '${PM}', '2026-10-26 15:00Z', '2026-10-27 15:00Z', '${PM}', 'Wrong job');
INSERT INTO mcp_portal_payments (job_id, amount_cents, method, paid_at) VALUES ('${JOB}', 50000, 'us_bank_account', '2026-10-28 15:00Z'), ('${JOB}', 1000, 'card', NULL);
INSERT INTO mcp_job_contracts (id, job_id, counterparty, title, signed_on) VALUES ('00000000-0000-0000-0000-00000000cccc', '${JOB}', 'Owner LLC', 'Prime contract', '2026-09-30');
INSERT INTO mcp_job_contract_versions VALUES ('00000000-0000-0000-0000-00000000cccc', 1, 'Signed copy saved', '${PM}', '2026-09-30 20:00Z');
INSERT INTO mcp_drawing_versions (job_id, kind, filename, page_count, version, created_by, created_at) VALUES
  ('${JOB}', 'source', 'IFC set.pdf', 48, 1, '${PM}', '2026-09-15 15:00Z'), ('${JOB}', 'markup', 'mk.pdf', 1, 1, '${PM}', '2026-09-16 15:00Z');
INSERT INTO mcp_open_items (id, job_id, action, resolution) VALUES ('00000000-0000-0000-0000-00000000dddd', '${JOB}', 'Get door hardware schedule', 'Received');
INSERT INTO mcp_item_events (user_id, item_id, event, note, created_at) VALUES
  ('${PM}', '00000000-0000-0000-0000-00000000dddd', 'opened', NULL, '2026-10-01 15:00Z'),
  ('${PM}', '00000000-0000-0000-0000-00000000dddd', 'resolved', NULL, '2026-10-29 15:00Z');
`;

type Ev = {
  id: string;
  source: string;
  at: string;
  type: string;
  title: string;
  by: string;
  by_group: string;
  to?: string;
  how?: string;
  happened_on?: string;
  summary?: string;
  by_role?: string;
};
type Feed = {
  count: number;
  truncated: boolean;
  time_zone: string;
  job_number: string;
  company: string;
  events: Ev[];
  unavailable_sources: string[];
};

let db: PGlite;
const feed = async (job: string, from: string | null, to: string | null) =>
  (await db.query<{ f: Feed }>("SELECT mcp_project_record_feed($1, $2, $3) AS f", [job, from, to]))
    .rows[0].f;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(
    readFileSync(
      join(process.cwd(), "supabase/migrations/20261105230000_athena_project_record_feed.sql"),
      "utf8",
    ),
  );
  await db.exec(SEED);
});

describe("mcp_project_record_feed", () => {
  it("pulls every source for the job, newest first, and nothing from other jobs", async () => {
    const f = await feed(JOB, null, null);
    expect(f.unavailable_sources).toEqual([]);
    expect(f.job_number).toBe("2717");
    expect(f.company).toBe("ALP Builders");
    const sources = new Set(f.events.map((e) => e.source));
    for (const s of [
      "record",
      "daily",
      "daily_edit",
      "schedule",
      "lookahead",
      "confirm_ask",
      "confirm_answer",
      "delay",
      "gap",
      "gap_answer",
      "payapp",
      "payapp_email",
      "payment",
      "payment_void",
      "portal_payment",
      "contract",
      "drawings",
      "item",
    ])
      expect(sources).toContain(s);
    expect(f.events.some((e) => e.title === "Other job")).toBe(false);
    expect(f.count).toBe(f.events.length);
    expect(f.count).toBe(21);
    const at = f.events.map((e) => Date.parse(e.at));
    expect([...at].sort((a, b) => b - a)).toEqual(at);
  });

  it("labels types, who and how", async () => {
    const f = await feed(JOB, null, null);
    const by = (t: string) => f.events.find((e) => e.title === t)!;
    expect(by("RFI 12 sent")).toMatchObject({
      type: "rfi",
      by: "Pat PM",
      by_role: "Project Manager",
      to: "Arch Co",
      how: "Email",
      by_group: "team",
    });
    expect(by("Submittal 03 30 00-1 sent")).toMatchObject({
      type: "submittal",
      by: "Athena",
      by_group: "athena",
    });
    expect(by("PCO 4 approved")).toMatchObject({
      type: "change",
      by: "Owner Olive",
      by_group: "client",
      how: "Client page",
    });
    expect(by("Schedule saved (version 1)").type).toBe("schedule");
    expect(by("Schedule update saved (version 2)").summary).toContain("Pushed roofing");
    expect(f.events.filter((e) => e.source === "schedule")).toHaveLength(2);
    expect(by("Gap found: Temporary power not shown")).toMatchObject({
      type: "estimate",
      by: "Athena",
    });
    expect(by("Payment recorded: $123,456.78 by check")).toMatchObject({
      type: "billing",
      happened_on: "2026-10-24",
    });
    expect(by("Spark Electric answered: confirmed")).toMatchObject({ by: "Joe", by_group: "sub" });
    expect(by("Delay logged: Slab on grade")).toMatchObject({
      type: "notice",
      happened_on: "2026-10-02",
    });
    // Saved at 9:30 PM New York time on the report's own date, so there is no earlier "happened" date.
    expect(f.events.find((e) => e.source === "daily")).toMatchObject({
      by: "Sam Super",
      by_role: "Superintendent",
    });
    expect(f.events.find((e) => e.source === "daily")!.happened_on).toBeUndefined();
    expect(f.events.find((e) => e.source === "payapp_email")).toMatchObject({
      to: "owner@example.com",
      how: "Email",
    });
    expect(f.events.find((e) => e.source === "drawings")!.title).toContain("IFC set.pdf");
    expect(f.events.filter((e) => e.source === "drawings")).toHaveLength(1);
  });

  it("reads dates in the job's time zone", async () => {
    // The daily report was saved 2026-10-05 01:30Z, which is Oct 4, 9:30 PM in New York.
    const f = await feed(JOB, "2026-10-04", "2026-10-04");
    expect(f.events.map((e) => e.source)).toEqual(["daily"]);
    const g = await feed(JOB, "2026-10-05", "2026-10-05");
    expect(g.events).toHaveLength(0);
  });

  it("needs full access and a sensible range", async () => {
    await expect(feed(OTHER, null, null)).rejects.toThrow(/full access/);
    await expect(feed("00000000-0000-0000-0000-000000000999", null, null)).rejects.toThrow(
      /MCP_NO_JOB/,
    );
    await expect(feed(JOB, "2026-10-10", "2026-10-01")).rejects.toThrow(/start date/);
  });

  it("lists a missing source instead of failing", async () => {
    await db.exec("ALTER TABLE mcp_portal_payments RENAME TO mcp_portal_payments_x");
    try {
      const f = await feed(JOB, null, null);
      expect(f.unavailable_sources).toEqual(["online payments"]);
      expect(f.count).toBe(20);
    } finally {
      await db.exec("ALTER TABLE mcp_portal_payments_x RENAME TO mcp_portal_payments");
    }
  });

  it("is executable only by signed-in users, and the helpers by no one", async () => {
    const r = await db.query<{ p: string; a: boolean; anon: boolean; h: boolean }>(`SELECT
      has_function_privilege('authenticated', 'mcp_project_record_feed(uuid,date,date)', 'EXECUTE') AS a,
      has_function_privilege('anon', 'mcp_project_record_feed(uuid,date,date)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'mcp_record_who(uuid,uuid,uuid)', 'EXECUTE') AS h`);
    expect(r.rows[0]).toMatchObject({ a: true, anon: false, h: false });
  });
});

describe("client-page entries name the client (20261106170000)", () => {
  const ACCESS = "00000000-0000-0000-0000-0000000000e1";
  const DECISION = "00000000-0000-0000-0000-0000000000e2";
  let c: PGlite;
  const all = async () =>
    (await c.query<{ f: Feed }>("SELECT mcp_project_record_feed($1, NULL, NULL) AS f", [JOB]))
      .rows[0].f.events;

  beforeAll(async () => {
    c = new PGlite();
    await c.exec(STUB);
    await c.exec(`
      CREATE SCHEMA mcp_private;
      ALTER TABLE mcp_project_record_events ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;
      CREATE TABLE mcp_portal_access (id uuid PRIMARY KEY, name text);
      CREATE TABLE mcp_portal_decisions (id uuid PRIMARY KEY, access_id uuid);
      INSERT INTO mcp_portal_access VALUES ('${ACCESS}', 'Pat Rivera');
      INSERT INTO mcp_portal_decisions VALUES ('${DECISION}', '${ACCESS}');
    `);
    const sql = (f: string) =>
      readFileSync(join(process.cwd(), `supabase/migrations/${f}.sql`), "utf8");
    await c.exec(sql("20261105230000_athena_project_record_feed"));
    await c.exec(SEED);
    // Client-page actions run as the inviting member, so these carry the PM's id.
    await c.exec(`
      INSERT INTO mcp_project_record_events (company_id, job_id, occurred_at, actor, actor_id, kind, title, summary, counterparty_name, payload) VALUES
        ('${CO}', '${JOB}', '2026-11-06 00:46Z', 'user', '${PM}', 'precon_signed', 'Agreement signed on the client page', 's', 'Pat Rivera', '{}'),
        ('${CO}', '${JOB}', '2026-11-06 00:47Z', 'user', '${PM}', 'precon_check_request', 'Owner paying PC-1 by check', 's', 'Pat Rivera', '{}'),
        ('${CO}', '${JOB}', '2026-11-06 00:48Z', 'user', '${PM}', 'change_order_approve', 'PCO-9 approved on the page', 's', NULL, '{"portal_decision":"${DECISION}"}'),
        ('${CO}', '${JOB}', '2026-11-06 00:49Z', 'user', '${PM}', 'pay_application_customer_approve', 'Pay app 3 approved', 's', NULL, '{"portal_decision":"not-a-uuid"}'),
        ('${CO}', '${JOB}', '2026-11-06 00:50Z', 'user', '${PM}', 'precon_check_pickup', 'Check pickup set', 's', 'Pat Rivera', '{}'),
        ('${CO}', '${JOB}', '2026-11-06 00:51Z', 'user', '${PM}', 'change_order_approve', 'PCO-10 approved by the PM', 's', NULL, '{}');
    `);
    const before = (await all()).find((e) => e.title === "Agreement signed on the client page")!;
    expect(before).toMatchObject({ by: "Pat PM", by_group: "team" });
    await c.exec(sql("20261106170000_athena_record_client_actor"));
    // Running it again changes nothing.
    await c.exec(sql("20261106170000_athena_record_client_actor"));
  });

  it("credits the client for what they did on their page", async () => {
    const ev = await all();
    const by = (t: string) => ev.find((e) => e.title === t)!;
    for (const t of ["Agreement signed on the client page", "Owner paying PC-1 by check"])
      expect(by(t)).toMatchObject({
        by: "Pat Rivera",
        by_group: "client",
        by_role: "Client page",
        how: "Client page",
      });
    expect(by("Owner paying PC-1 by check").to).toBeUndefined();
    expect(by("PCO-9 approved on the page")).toMatchObject({
      by: "Pat Rivera",
      by_group: "client",
    });
    expect(by("Pay app 3 approved")).toMatchObject({ by: "Client", by_group: "client" });
  });

  it("keeps the contractor's own steps on the team", async () => {
    const ev = await all();
    const by = (t: string) => ev.find((e) => e.title === t)!;
    expect(by("Check pickup set")).toMatchObject({
      by: "Pat PM",
      by_group: "team",
      to: "Pat Rivera",
    });
    expect(by("PCO-10 approved by the PM")).toMatchObject({ by: "Pat PM", by_group: "team" });
    expect(by("RFI 12 sent")).toMatchObject({ by: "Pat PM", by_group: "team" });
    expect(by("Submittal 03 30 00-1 sent")).toMatchObject({ by: "Athena", by_group: "athena" });
    expect(by("PCO 4 approved")).toMatchObject({ by: "Owner Olive", by_group: "client" });
  });
});

describe("the pre-con bill issued at signing is Athena's (20261106190000)", () => {
  let c: PGlite;
  const sql = (f: string) =>
    readFileSync(join(process.cwd(), `supabase/migrations/${f}.sql`), "utf8");
  const all = async () =>
    (await c.query<{ f: Feed }>("SELECT mcp_project_record_feed($1, NULL, NULL) AS f", [JOB]))
      .rows[0].f.events;
  // The two lines the migration patches, exactly as the pre-con signing migration wrote them.
  const BILL_LINE = `PERFORM mcp_private.rec(j.id, jsonb_build_object('amount_cents', amt, 'portal_item', it.id, 'payment', idx), 'user', NULL, NULL);`;
  const SIGN_LINE = `bill := mcp_private.precon_bill_next(ag, j, NULL);`;

  beforeAll(async () => {
    c = new PGlite();
    await c.exec(STUB);
    await c.exec(`
      CREATE SCHEMA mcp_private;
      ALTER TABLE mcp_project_record_events ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE mcp_project_record_events ALTER COLUMN occurred_at SET DEFAULT now();
      CREATE TABLE mcp_portal_access (id uuid PRIMARY KEY, name text);
      CREATE TABLE mcp_portal_decisions (id uuid PRIMARY KEY, access_id uuid);
      CREATE TABLE mcp_precon_agreements (id uuid PRIMARY KEY, job_id uuid);
      -- Stand-in for mcp_project_record_add: stores the PM as the member, as auth.uid() does on the client page.
      CREATE FUNCTION mcp_private.rec(_job uuid, _payload jsonb, _actor text, _a text, _b text) RETURNS void LANGUAGE sql AS $$
        INSERT INTO mcp_project_record_events (company_id, job_id, actor, actor_id, kind, title, summary, payload)
        VALUES ('${CO}', _job, _actor, CASE WHEN _actor = 'user' THEN '${PM}'::uuid END, 'precon_invoice_share',
          'Pre-construction invoice PC-' || (_payload->>'payment'), 's', _payload) $$;
      CREATE FUNCTION mcp_private.precon_bill_next(_a mcp_precon_agreements, j mcp_jobs, _due date) RETURNS text
      LANGUAGE plpgsql AS $$
      DECLARE amt bigint := 500000; idx int := (SELECT count(*) + 1 FROM mcp_project_record_events WHERE kind = 'precon_invoice_share'); it record;
      BEGIN
        SELECT gen_random_uuid() AS id INTO it;
        ${BILL_LINE}
        RETURN 'ok';
      END $$;
      CREATE FUNCTION mcp_portal_precon_sign(_access uuid, _session_hash text, _item uuid, _decision text, _code_hash text, _typed_name text,
        _consent text, _statement text, _fingerprint text, _note text, _ip text, _user_agent text) RETURNS jsonb
      LANGUAGE plpgsql AS $$
      DECLARE ag mcp_precon_agreements; j mcp_jobs; bill text;
      BEGIN
        SELECT * INTO j FROM mcp_jobs WHERE id = '${JOB}';
        INSERT INTO mcp_project_record_events (company_id, job_id, actor, actor_id, kind, title, summary, counterparty_name)
        VALUES ('${CO}', j.id, 'user', '${PM}', 'precon_signed', 'Agreement signed', 's', _typed_name);
        BEGIN
          ${SIGN_LINE}
        EXCEPTION WHEN OTHERS THEN bill := NULL;
        END;
        RETURN jsonb_build_object('status', 'ok');
      END $$;
    `);
    await c.exec(sql("20261105230000_athena_project_record_feed"));
    await c.exec(SEED);
    // Already stored: a signature and its bill in one transaction, then a bill the PM sent later.
    await c.exec(`
      INSERT INTO mcp_project_record_events (company_id, job_id, occurred_at, actor, actor_id, kind, title, summary, counterparty_name) VALUES
        ('${CO}', '${JOB}', '2026-11-06 00:46:21Z', 'user', '${PM}', 'precon_signed', 'Old signing', 's', 'Pat Rivera'),
        ('${CO}', '${JOB}', '2026-11-06 00:46:21Z', 'user', '${PM}', 'precon_invoice_share', 'Old bill at signing', 's', NULL),
        ('${CO}', '${JOB}', '2026-11-07 15:00Z', 'user', '${PM}', 'precon_invoice_share', 'Bill the PM sent', 's', NULL);
    `);
    await c.exec(sql("20261106170000_athena_record_client_actor"));
    await c.exec(sql("20261106190000_athena_record_auto_bill"));
    // Running it again changes nothing.
    await c.exec(sql("20261106190000_athena_record_auto_bill"));
  });

  it("patches the lines the pre-con signing migration actually has", () => {
    const signing = sql("20261106130000_athena_precon_signing");
    expect(signing).toContain(SIGN_LINE);
    expect(signing).toContain(
      `jsonb_build_object('amount_cents', amt, 'portal_item', it.id, 'payment', idx), 'user', NULL, NULL);`,
    );
  });

  it("shows a bill already stored at signing as Athena's, and the PM's own bill as theirs", async () => {
    const ev = await all();
    const by = (t: string) => ev.find((e) => e.title === t)!;
    expect(by("Old bill at signing")).toMatchObject({ by: "Athena", by_group: "athena" });
    expect(by("Old signing")).toMatchObject({ by: "Pat Rivera", by_group: "client" });
    expect(by("Bill the PM sent")).toMatchObject({ by: "Pat PM", by_group: "team" });
  });

  it("stores the bill a signature issues as Athena's, and only that one", async () => {
    await c.exec(
      "SELECT mcp_portal_precon_sign(NULL, NULL, NULL, 'signed', NULL, 'Pat Rivera', NULL, NULL, NULL, NULL, NULL, NULL)",
    );
    const signed = await c.query<{ actor: string; actor_id: string | null }>(
      "SELECT actor, actor_id FROM mcp_project_record_events WHERE kind = 'precon_invoice_share' AND payload ? 'payment'",
    );
    expect(signed.rows).toEqual([{ actor: "athena", actor_id: null }]);
    // In the same session afterward, a bill the contractor sends is theirs again.
    await c.exec("SELECT mcp_private.precon_bill_next(NULL, NULL, NULL)");
    const later = await c.query<{ actor: string }>(
      "SELECT actor FROM mcp_project_record_events WHERE kind = 'precon_invoice_share' AND payload ? 'payment' ORDER BY payload->>'payment'",
    );
    expect(later.rows.map((r) => r.actor)).toEqual(["athena", "user"]);
  });
});
