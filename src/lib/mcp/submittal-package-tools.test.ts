import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser, fakeClient } from "../../../tests/mcp-roles/fake-supabase";
const state = vi.hoisted(() => ({ sb: null as unknown }));
vi.mock("./guard", () => ({
  run: async (_t: unknown, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) => fn(state.sb),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./tools/submittal-tools", () => ({
  resolveSubmittalJob: async () => ({
    job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    job_number: "2701",
    scope: "full",
    name: "Fictional Integration Test",
  }),
}));
import { submittalPackage, submittalDelivery } from "./tools/submittal-package-tools";
import { sha256Hex } from "./file-share";
import { submittalChase } from "./tools/submittal-chase-tool";
const owner = "00000000-0000-4000-8000-000000000010",
  company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const claims = { sub: owner, email: "pm@example.com", role: "authenticated" as const };
let db: PGlite;
const blobs = new Map<string, Uint8Array>();
const query = async (sql: string, args: unknown[] = []) =>
  asUser(db, claims, async (tx) => (await tx.query(sql, args)).rows);
const call = async (tool: unknown, args: Record<string, unknown>) =>
  (
    tool as {
      handler: (
        a: unknown,
        c: unknown,
      ) => Promise<{
        structuredContent: {
          ready?: boolean;
          sent?: boolean;
          package?: { id: string; download_url: string; page_count: number; approved: boolean };
          card: { sections: { rows: { href?: string }[] }[] };
          delivery_id?: string;
          draft_key?: string | null;
          draft?: { to: string; body: string };
          preview_only?: boolean;
        };
      }>;
    }
  ).handler(args, {});
const saved = async (sid: string) =>
  (await query("SELECT mcp_submittal_package_context($1,$2) data", [job, sid]))[0].data;
async function create(number: string) {
  return (
    await query("SELECT mcp_submittal_log($1,$2,$3::jsonb) data", [
      job,
      "add",
      JSON.stringify({
        number,
        spec_section: "26 24 16",
        title: "Fictional switchgear",
        submittal_type: "product_data",
        status: "in_prep",
        ball_in_court: "gc",
        package_items: [
          {
            kind: "product_cut",
            source_party: "Example Manufacturer",
            required: true,
            chase_name: "Fictional Supplier",
            chase_email: "supplier@example.com",
          },
          { kind: "shop_drawing", source_party: "Example Sub", required: true },
        ],
      }),
    ])
  )[0].data.saved_id as string;
}
beforeAll(async () => {
  db = await makeDb();
  const sql = readFileSync("supabase/migrations/20261023220000_athena_submittal_log.sql", "utf8");
  await db.exec(sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.mcp_board_link_open")));
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
  await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'pm@example.com')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES ($1)", [owner]);
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Example Construction',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id,time_zone) VALUES ($1,$2,'Fictional Test','2701',$3,'America/Manaus')",
    [job, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','Fictional PM')",
    [company, owner],
  );
  const sb = fakeClient(db, claims);
  state.sb = {
    ...sb,
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, bytes: Uint8Array, options: { upsert: boolean }) {
            expect(bucket).toBe("athena-submittals");
            expect(options.upsert).toBe(false);
            if (blobs.has(path)) return { error: { message: "exists" } };
            await query("INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)", [
              bucket,
              path,
            ]);
            blobs.set(path, bytes.slice());
            return { error: null };
          },
          async download(path: string) {
            const bytes = blobs.get(path);
            return bytes
              ? { data: new Blob([bytes as BlobPart]), error: null }
              : { data: null, error: { message: "not found" } };
          },
          async createSignedUrl(path: string, seconds: number) {
            expect(seconds).toBeLessThanOrEqual(30 * 86400);
            return {
              data: {
                signedUrl: `https://fixture.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=local-fixture`,
              },
              error: null,
            };
          },
        };
      },
    },
  };
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("real package handlers with local DB and immutable storage", () => {
  it("previews without writing, then saves the exact chase draft before asking for approval", async () => {
    const sid = await create("INTEGRATION-CHASE"),
      ctx = await saved(sid);
    const args = {
      job_number: "2701",
      submittal_id: sid,
      package_item_id: ctx.items.find((item: { kind: string }) => item.kind === "product_cut").id,
    };
    const before = (await query("SELECT count(*)::int n FROM mcp_submittal_mail"))[0].n;
    const preview = await call(submittalChase, { ...args, preview_only: true });
    expect(preview.structuredContent.draft?.to).toBe("supplier@example.com");
    expect(preview.structuredContent.delivery_id).toBeNull();
    expect(preview.structuredContent.draft_key).toBeNull();
    expect(preview.structuredContent.preview_only).toBe(true);
    expect((await query("SELECT count(*)::int n FROM mcp_submittal_mail"))[0].n).toBe(before);
    const draft = await call(submittalChase, args);
    const data = draft.structuredContent;
    expect(data.delivery_id).toBeTruthy();
    expect(data.draft_key).toBeTruthy();
    const row = (
      await query("SELECT * FROM mcp_submittal_mail WHERE id=$1", [data.delivery_id])
    )[0];
    expect(row.draft).toEqual(data.draft);
    expect(row.approved_at).toBeNull();
    expect(row.sent_at).toBeNull();
    const repeated = await call(submittalChase, args);
    expect(repeated.structuredContent.delivery_id).toBe(data.delivery_id);
    expect((await query("SELECT count(*)::int n FROM mcp_submittal_mail"))[0].n).toBe(
      Number(before) + 1,
    );
  });
  it("collects files, builds once, retains original hashes and records delivery only after the receipt", async () => {
    const sid = await create("INTEGRATION-001"),
      ctx = await saved(sid);
    const source = await PDFDocument.create();
    source.addPage();
    source.addPage();
    const bytes = await source.save(),
      hash = await sha256Hex(bytes);
    const originalCount = blobs.size;
    const before = await call(submittalPackage, {
      action: "build",
      job_number: "2701",
      submittal_id: sid,
    });
    expect(before.structuredContent.ready).toBe(false);
    expect(blobs.size).toBe(originalCount);
    for (const item of ctx.items)
      await call(submittalPackage, {
        action: "upload_piece",
        job_number: "2701",
        submittal_id: sid,
        package_item_id: item.id,
        filename: `${item.kind}.pdf`,
        content_base64: Buffer.from(bytes).toString("base64"),
      });
    const received = await saved(sid);
    expect(received.items.every((i: { status: string }) => i.status === "received")).toBe(true);
    const build = await call(submittalPackage, {
      action: "build",
      job_number: "2701",
      submittal_id: sid,
    });
    const a = build.structuredContent.package!;
    expect(a.page_count).toBe(5);
    expect(a.approved).toBe(false);
    expect(build.structuredContent.sent).toBe(false);
    expect(JSON.stringify(build.structuredContent)).not.toContain("signed_url");
    expect(
      build.structuredContent.card.sections[0].rows.some((r: { href?: string }) =>
        r.href?.includes("/r/submittal-preview/"),
      ),
    ).toBe(true);
    await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    expect(blobs.size).toBe(originalCount + 3);
    for (const [path, data] of blobs)
      if (path.includes("/pieces/")) expect(await sha256Hex(data)).toBe(hash);
    const draft = await call(submittalDelivery, {
      action: "draft",
      job_number: "2701",
      submittal_id: sid,
      kind: "package",
      package_id: a.id,
      draft: {
        to: "reviewer@example.com",
        cc: [],
        subject: "Job 2701 fictional package",
        body: `Please review ${a.download_url}`,
        link: a.download_url,
      },
    });
    const d = draft.structuredContent;
    await call(submittalDelivery, {
      action: "approve",
      job_number: "2701",
      submittal_id: sid,
      delivery_id: d.delivery_id,
      draft_key: d.draft_key,
      confirmed: true,
    });
    expect((await saved(sid)).submittal.status).toBe("in_prep");
    await call(submittalDelivery, {
      action: "record_sent",
      job_number: "2701",
      submittal_id: sid,
      delivery_id: d.delivery_id,
      draft_key: d.draft_key,
      provider: "local-test-only",
      message_id: "synthetic-handler-receipt",
      sent_at: new Date().toISOString(),
    });
    const after = await call(submittalPackage, {
      action: "get",
      job_number: "2701",
      submittal_id: sid,
    });
    expect(after.structuredContent.sent).toBe(true);
    expect((await saved(sid)).submittal.status).toBe("submitted");
  });
  it("rejects a corrupt PDF without saving a partial package", async () => {
    const sid = await create("INTEGRATION-002"),
      ctx = await saved(sid);
    for (const item of ctx.items)
      await call(submittalPackage, {
        action: "upload_piece",
        job_number: "2701",
        submittal_id: sid,
        package_item_id: item.id,
        filename: "bad.pdf",
        content_base64: Buffer.from("not a PDF").toString("base64"),
      });
    const count = blobs.size;
    await expect(
      call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid }),
    ).rejects.toThrow("valid PDF");
    expect(blobs.size).toBe(count);
    expect((await saved(sid)).package).toBeNull();
  });
});
