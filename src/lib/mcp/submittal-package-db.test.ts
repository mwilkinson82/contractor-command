import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const owner = "00000000-0000-4000-8000-000000000010",
  outsider = "00000000-0000-4000-8000-000000000011",
  superId = "00000000-0000-4000-8000-000000000012",
  estimator = "00000000-0000-4000-8000-000000000013";
const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
const context = (sid: string, user = owner) =>
  rpc("mcp_submittal_package_context", [job, sid], user);
async function create(number: string) {
  const r = await rpc("mcp_submittal_log", [
    job,
    "add",
    JSON.stringify({
      number,
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
async function collect(sid: string) {
  const c = await context(sid);
  for (const item of c.items) {
    const path = `${company}/${job}/pieces/${crypto.randomUUID()}/cut.pdf`;
    await q("INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)", [
      "athena-submittals",
      path,
    ]);
    await write(sid, "attach", { item_id: item.id, path });
  }
  return context(sid);
}
async function save(sid: string) {
  const c = await collect(sid),
    id = crypto.randomUUID(),
    path = `${company}/${job}/packages/${id}/package.pdf`;
  await q("INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)", [
    "athena-submittals",
    path,
  ]);
  return write(sid, "save", {
    id,
    path,
    filename: "package.pdf",
    fingerprint: c.fingerprint,
    sha256: "a".repeat(64),
    size_bytes: 1200,
    page_count: 3,
    cover_date: c.today,
    manifest: c.items.map((p: { id: string }) => ({ item_id: p.id })),
    token_hash: ("0" + c.transmittal_number.toString(16)).slice(-2).repeat(32),
    download_url: `https://app.meetathena.io/f/${"a".repeat(43)}`,
    signed_url: `https://test.supabase.co/storage/v1/object/sign/athena-submittals/${path}?token=test`,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
}
beforeAll(async () => {
  db = await makeDb();
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
  for (const id of [owner, outsider, superId, estimator]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [id, claims(id).email]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [id]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Fictional Construction',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id,time_zone) VALUES ($1,$2,'Test Job','2701',$3,'America/Manaus')",
    [job, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','Test PM')",
    [company, owner],
  );
  for (const [id, role] of [
    [superId, "super"],
    [estimator, "estimating"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,$3,'Fictional Team')",
      [company, id, role],
    );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
    job,
    superId,
    owner,
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("receipt-backed submittal packages: real SQL and RLS", () => {
  it("chases each required source separately, all from the living log", async () => {
    const sid = await create("PKG-001");
    const c = await rpc("mcp_submittal_chase_rows", [job]);
    const rows = c.chases.filter((r: { submittal_id: string }) => r.submittal_id === sid);
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { chase_email: string }) => r.chase_email).sort()).toEqual([
      "pat@example.com",
      "sam@example.com",
    ]);
    const log = await rpc("mcp_submittal_rows", [job]);
    expect(
      c.chases.every((r: { submittal_id: string }) =>
        log.submittals.some((s: { id: string }) => s.id === r.submittal_id),
      ),
    ).toBe(true);
    expect(JSON.stringify(c)).not.toContain("A1020");
  });
  it("allocates a different transmittal to every revision, leaving the previous row intact", async () => {
    const sid = await create("PKG-002"),
      first = await context(sid);
    const r = await rpc("mcp_submittal_log", [
      job,
      "resubmit",
      JSON.stringify({ submittal_id: sid }),
    ]);
    const second = await context(r.saved_id);
    expect(second.submittal.revision).toBe(1);
    expect(second.transmittal_number).not.toBe(first.transmittal_number);
    expect(
      (
        await db.query<{ revision: number }>("SELECT revision FROM mcp_submittals WHERE id=$1", [
          sid,
        ])
      ).rows[0].revision,
    ).toBe(0);
    expect((await context(sid)).is_current).toBe(false);
    await expect(write(sid, "attach", {})).rejects.toThrow("latest revision");
  });
  it("requires the exact current package and keeps a draft/approval separate from a send", async () => {
    const sid = await create("PKG-003"),
      c = await save(sid),
      a = c.package;
    expect(a).toBeTruthy();
    const preview = await rpc("mcp_file_share_open", [a.token_hash, false]);
    expect(preview).toBeNull();
    const draft = {
      to: "reviewer@example.com",
      cc: [],
      subject: "Job 2701 T-" + c.transmittal_number,
      body: "Please review this package.\n" + a.download_url,
      link: a.download_url,
      attachment: null,
    };
    const mail = await delivery(sid, "draft", { kind: "package", package_id: a.id, draft });
    expect(mail.sent_at).toBeNull();
    await expect(
      delivery(sid, "record_sent", {
        delivery_id: mail.id,
        draft_key: mail.draft_key,
        provider: "test-provider",
        message_id: "test-001",
        sent_at: new Date().toISOString(),
      }),
    ).rejects.toThrow("not been approved");
    await expect(
      delivery(sid, "approve", { delivery_id: mail.id, draft_key: "bad", confirmed: true }),
    ).rejects.toThrow("exact saved draft");
    await delivery(sid, "approve", {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      confirmed: true,
    });
    const approved = await context(sid);
    expect(approved.submittal.status).toBe("in_prep");
    expect(approved.package.sent_at).toBeNull();
    expect(await rpc("mcp_file_share_open", [a.token_hash, false])).toHaveProperty(
      "filename",
      "package.pdf",
    );
    await expect(
      delivery(sid, "record_sent", { delivery_id: mail.id, draft_key: mail.draft_key }),
    ).rejects.toThrow("successful email provider receipt");
    const receipt = {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      provider: "local-fixture",
      message_id: "synthetic-2701-001",
      sent_at: new Date().toISOString(),
      recipient_name: "Fictional Reviewer",
    };
    const sent = await delivery(sid, "record_sent", receipt);
    expect(sent.sent_at).toBeTruthy();
    expect((await context(sid)).submittal.status).toBe("submitted");
    await delivery(sid, "record_sent", receipt);
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM mcp_project_record_events WHERE ref_id=$1 AND kind='submittal_sent'",
          [mail.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("does not count a chase until a successful send and stops chasing received pieces", async () => {
    const sid = await create("PKG-004"),
      c = await context(sid),
      piece = c.items[0];
    const draft = {
      to: piece.chase_email,
      cc: [],
      subject: "Fictional chase",
      body: `${piece.chase_name}, please send the cut for spec 26 24 16.`,
      link: null,
    };
    const mail = await delivery(sid, "draft", { kind: "chase", package_item_id: piece.id, draft });
    await delivery(sid, "approve", {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      confirmed: true,
    });
    expect((await context(sid)).items[0].chase_count).toBe(0);
    const receipt = {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      provider: "local-fixture",
      message_id: "synthetic-chase-001",
      sent_at: new Date().toISOString(),
    };
    await delivery(sid, "record_sent", receipt);
    await delivery(sid, "record_sent", receipt);
    expect((await context(sid)).items[0].chase_count).toBe(1);
    await collect(sid);
    const queue = await rpc("mcp_submittal_chase_rows", [job]);
    expect(
      queue.chases.filter((r: { submittal_id: string }) => r.submittal_id === sid),
    ).toHaveLength(0);
  });
  it("invalidates an approved package after any included piece changes", async () => {
    const sid = await create("PKG-005"),
      c = await save(sid),
      a = c.package;
    const mail = await delivery(sid, "draft", {
      kind: "package",
      package_id: a.id,
      draft: {
        to: "reviewer@example.com",
        cc: [],
        subject: "Review",
        body: a.download_url,
        link: a.download_url,
      },
    });
    await delivery(sid, "approve", {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      confirmed: true,
    });
    await collect(sid);
    await expect(
      delivery(sid, "record_sent", {
        delivery_id: mail.id,
        draft_key: mail.draft_key,
        provider: "test",
        message_id: "changed",
        sent_at: new Date().toISOString(),
      }),
    ).rejects.toThrow("changed or expired");
  });
  it("denies outsider, anonymous, inactive members and direct writes", async () => {
    const sid = await create("PKG-006");
    await expect(context(sid, outsider)).rejects.toThrow();
    await expect(q("UPDATE mcp_submittal_packages SET filename='changed'")).rejects.toThrow(
      "permission denied",
    );
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE anon");
        return tx.query("SELECT mcp_submittal_package_context($1,$2)", [job, sid]);
      }),
    ).rejects.toThrow("permission denied");
    await db.query("DELETE FROM test_active_members WHERE user_id=$1", [owner]);
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    await expect(context(sid)).rejects.toThrow();
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [owner]);
  });
  it("storage allows only scoped inserts and preserves originals from overwrite/deletion", async () => {
    const path = `${company}/${job}/pieces/${crypto.randomUUID()}/original.pdf`;
    await q("INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)", [
      "athena-submittals",
      path,
    ]);
    expect(await q("UPDATE storage.objects SET name=$1 WHERE name=$2", ["changed", path])).toEqual(
      [],
    );
    await q("DELETE FROM storage.objects WHERE name=$1", [path]);
    expect(await q("SELECT name FROM storage.objects WHERE name=$1", [path])).toHaveLength(1);
    await expect(
      q("INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)", [
        "athena-submittals",
        `${company}/00000000-0000-4000-8000-000000000999/pieces/${crypto.randomUUID()}/other.pdf`,
      ]),
    ).rejects.toThrow("row-level security");
  });
  it("lets a superintendent read while denying writes and excludes estimating access", async () => {
    const sid = await create("PKG-007");
    expect((await context(sid, superId)).submittal.id).toBe(sid);
    await expect(context(sid, estimator)).rejects.toThrow("MCP_NO_JOB");
    await expect(rpc("mcp_submittal_delivery", [job, sid, "draft", "{}"], superId)).rejects.toThrow(
      "Full job access",
    );
    await expect(
      rpc("mcp_submittal_package_write", [job, sid, "attach", "{}"], superId),
    ).rejects.toThrow("Full job access");
  });
  it("expires private previews, revokes links and requires fresh approval after renewal", async () => {
    const sid = await create("PKG-008"),
      c = await save(sid),
      a = c.package;
    const draft = {
      to: "reviewer@example.com",
      cc: [],
      subject: "Review fictional package",
      body: a.download_url,
      link: a.download_url,
    };
    const mail = await delivery(sid, "draft", { kind: "package", package_id: a.id, draft });
    await delivery(sid, "approve", {
      delivery_id: mail.id,
      draft_key: mail.draft_key,
      confirmed: true,
    });
    await rpc("mcp_submittal_preview", [job, a.id, "e".repeat(64), a.signed_url]);
    expect(await rpc("mcp_submittal_preview_open", ["e".repeat(64), false])).toHaveProperty(
      "filename",
      "package.pdf",
    );
    await db.query(
      "UPDATE mcp_submittal_packages SET preview_expires_at=now()-interval '1 second' WHERE id=$1",
      [a.id],
    );
    expect(await rpc("mcp_submittal_preview_open", ["e".repeat(64), false])).toBeNull();
    const renewed = {
      package_id: a.id,
      token_hash: "f".repeat(64),
      signed_url: a.signed_url,
      download_url: `https://app.meetathena.io/r/submittal-file/${"b".repeat(43)}`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
    const fresh = await write(sid, "renew", renewed);
    expect(fresh.package.approved_at).toBeNull();
    expect(await rpc("mcp_file_share_open", ["f".repeat(64), false])).toBeNull();
    expect(await rpc("mcp_file_share_open", [a.token_hash, false])).toBeNull();
    await expect(
      delivery(sid, "approve", {
        delivery_id: mail.id,
        draft_key: mail.draft_key,
        confirmed: true,
      }),
    ).rejects.toThrow("changed or expired");
    await write(sid, "revoke", { package_id: a.id });
    expect(
      (
        await db.query<{ n: number }>("SELECT count(*)::int n FROM storage.objects WHERE name=$1", [
          a.path,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
  it("never reuses approval for a changed recipient or changed email body", async () => {
    const sid = await create("PKG-009"),
      c = await save(sid),
      a = c.package;
    const draft = {
      to: "reviewer@example.com",
      cc: [],
      subject: "Review fictional package",
      body: a.download_url,
      link: a.download_url,
    };
    const first = await delivery(sid, "draft", { kind: "package", package_id: a.id, draft });
    await delivery(sid, "approve", {
      delivery_id: first.id,
      draft_key: first.draft_key,
      confirmed: true,
    });
    for (const changed of [
      { ...draft, to: "second@example.com" },
      { ...draft, body: "Different scope. " + draft.body },
    ]) {
      const next = await delivery(sid, "draft", {
        kind: "package",
        package_id: a.id,
        draft: changed,
      });
      expect(next.draft_key).not.toBe(first.draft_key);
      expect(next.approved_at).toBeNull();
    }
    const same = await delivery(sid, "draft", { kind: "package", package_id: a.id, draft });
    expect(same.id).toBe(first.id);
  });
});
