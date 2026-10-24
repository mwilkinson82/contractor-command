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
  boardFor: async () =>
    `https://app.meetathena.io/r/job/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/submittals?t=${"x".repeat(43)}`,
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
import { runInNewContext } from "node:vm";
import { attachAthenaCard } from "./cards/attach";
import { sealCardReply } from "./cards/silence";
import { nativeCardPayload, nativeCardVisit } from "./native-card-transport";
import { cardWidgetHtml } from "./cards/widget";
import { renderHtml } from "./cards/html";
import type { CardModel, CardRow } from "./cards/model";
import { finalizeVisible } from "./visible";
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
        content: { type: string; text?: string }[];
        structuredContent: {
          ready?: boolean;
          sent?: boolean;
          send_confirmed?: boolean;
          already_approved?: boolean;
          send_allowed?: boolean;
          package?: { id: string; download_url: string; page_count: number; approved: boolean };
          card: CardModel & { sections: { rows: CardRow[] }[] };
          delivery_id?: string;
          draft_key?: string | null;
          draft?: { to: string; cc: string[]; subject: string; body: string };
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
  it("attaches a named piece from an approved host using the edge-safe download mode and refuses redirects", async () => {
    const sid = await create("INTEGRATION-NAMED-ATTACHMENT");
    const original = await PDFDocument.create();
    original.addPage();
    const bytes = await original.save();
    const url = "https://oaisdmntprbrazilsouth.blob.core.windows.net/fictional/source.pdf";
    const fetchFile = vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect(options?.redirect).toBe("manual");
      return new Response(bytes as BodyInit);
    });
    vi.stubGlobal("fetch", fetchFile);
    try {
      await call(submittalPackage, {
        action: "upload_piece",
        job_number: "2701",
        submittal_id: sid,
        package_item: "P1",
        filename: "cut.pdf",
        file: { download_url: url },
      });
      expect(fetchFile).toHaveBeenCalledTimes(1);
      const c = await saved(sid);
      expect(c.items[0].status).toBe("received");
      const path = c.items[0].file_ref.replace("athena-submittals/", "");
      expect(await sha256Hex(blobs.get(path)!)).toBe(await sha256Hex(bytes));
      const before = blobs.size;
      fetchFile.mockImplementation(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://untrusted.example/source.pdf" },
          }),
      );
      await expect(
        call(submittalPackage, {
          action: "upload_piece",
          job_number: "2701",
          submittal_id: sid,
          package_item: "P2",
          filename: "shop.pdf",
          file: { download_url: url },
        }),
      ).rejects.toThrow(/could not be read/);
      expect(fetchFile).toHaveBeenCalledTimes(2);
      expect(blobs.size).toBe(before);
      expect((await saved(sid)).items[1].status).toBe("needed");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("preserves the exact saved draft through ChatGPT, Claude and text-only rendering without sending", async () => {
    const sid = await create("INTEGRATION-EXACT-DRAFT"),
      ctx = await saved(sid);
    const body = [
      "  Fictional Supplier,",
      "",
      "",
      "Spec 26 24 16 | cut and shop drawing",
      "Reference #1234 / aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "````text",
      "literal | columns",
      "````",
      "<!doctype html><html><body>Literal email example</body></html>",
      "REQUIRED VIEW: quoted email text",
      "Card shown. Do not add text.",
      "Please quote this wording verbatim.",
      "Keep  double spaces.  ",
    ].join("\r\n");
    const draft = {
      to: "supplier@example.com",
      cc: ["copy@example.com"],
      subject: "2701 | fictional cut / revision 0",
      body,
      link: null,
    };
    const output = await call(submittalDelivery, {
      action: "draft",
      kind: "chase",
      job_number: "2701",
      submittal_id: sid,
      package_item_id: ctx.items.find((i: { kind: string }) => i.kind === "product_cut").id,
      draft,
    });
    const assertRendering = async (value: Awaited<ReturnType<typeof call>>) => {
      const presented = sealCardReply(
        "submittal_delivery",
        attachAthenaCard("submittal_delivery", finalizeVisible(value)),
      );
      for (const name of ["ChatGPT", "claude-ai", "Grok Bot"]) {
        const request = new Request("https://app.meetathena.io/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 73,
            method: "tools/call",
            params: {
              name: "submittal_delivery",
              arguments: {},
              _meta: { "io.modelcontextprotocol/clientInfo": { name, version: "fixture" } },
            },
          }),
        });
        const visit = await nativeCardVisit(request);
        expect(visit).not.toBeNull();
        const envelope = { jsonrpc: "2.0", id: 73, result: presented };
        const returned = nativeCardPayload(envelope, visit).value as typeof envelope;
        expect(returned.result.structuredContent.draft).toEqual(draft);
        const text = returned.result.content.map((c) => c.text ?? "").join("\n");
        const literal = [...text.matchAll(/(?:^|\n)(`{3,})text\n([\s\S]*?)\n\1(?=\n|$)/g)].find(
          (m) => m[2].startsWith("To:"),
        )?.[2];
        expect(literal).toBe(
          [
            `To: ${draft.to}`,
            `CC: ${draft.cc.join(", ")}`,
            `Subject: ${draft.subject}`,
            "",
            body,
          ].join("\n"),
        );
      }
      const node = { dataset: {}, innerHTML: "" };
      runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
        window: { openai: { toolOutput: presented.structuredContent } },
        document: { getElementById: () => node },
      });
      const encoded = body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      for (const html of [renderHtml(presented.structuredContent.card), node.innerHTML]) {
        expect(html).toContain('class="tone-literal"');
        expect(html).toContain(encoded);
        expect(html).toContain(draft.subject);
      }
    };
    await assertRendering(output);
    const savedDraft = (
      await query("SELECT draft, approved_at, sent_at FROM mcp_submittal_mail WHERE id=$1", [
        output.structuredContent.delivery_id,
      ])
    )[0];
    expect(savedDraft.draft).toEqual(draft);
    expect(savedDraft.approved_at).toBeNull();
    expect(savedDraft.sent_at).toBeNull();
    const approved = await call(submittalDelivery, {
      action: "approve",
      job_number: "2701",
      submittal_id: sid,
      delivery_id: output.structuredContent.delivery_id,
      draft_key: output.structuredContent.draft_key,
      confirmed: true,
    });
    await assertRendering(approved);
    expect(approved.structuredContent).toMatchObject({
      send_confirmed: true,
      already_approved: false,
      sent: false,
    });
    const repeated = await call(submittalDelivery, {
      action: "approve",
      job_number: "2701",
      submittal_id: sid,
      delivery_id: output.structuredContent.delivery_id,
      draft_key: output.structuredContent.draft_key,
      confirmed: true,
    });
    expect(repeated.structuredContent).toMatchObject({
      send_confirmed: false,
      already_approved: true,
      sent: false,
    });
    const afterApproval = (
      await query("SELECT draft, approved_at, sent_at FROM mcp_submittal_mail WHERE id=$1", [
        output.structuredContent.delivery_id,
      ])
    )[0];
    expect(afterApproval.draft).toEqual(draft);
    expect(afterApproval.approved_at).toBeTruthy();
    expect(afterApproval.sent_at).toBeNull();
  });
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
      build.structuredContent.card.sections[0].rows.some((r) =>
        r.href?.includes("/r/submittal-preview/"),
      ),
    ).toBe(true);
    await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    expect(blobs.size).toBe(originalCount + 3);
    for (const item of received.items) {
      const path = item.file_ref.replace("athena-submittals/", "");
      expect(await sha256Hex(blobs.get(path)!)).toBe(hash);
    }
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
