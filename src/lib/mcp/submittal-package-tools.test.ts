import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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
vi.mock("./tools/submittal-tools", async (importOriginal) => ({
  ...await importOriginal<typeof import("./tools/submittal-tools")>(),
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
import { rfiRecord, rfiLog } from "./tools/request-tools";
import {changeOrderRecord,changeOrderLog} from "./tools/change-order-tools";
import {buildSov} from "./sov";
import {setupContractValue} from "./contract-value";
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
import { readSubmittalRows } from "./tools/submittal-tools";
import { presentSubmittalLog } from "./submittals";
import { renderMarkdown } from "./cards/markdown";
import { uploadSubmittalPiece, type PieceUploadClient } from "../submittal-piece-upload";
import type { Sb } from "./guard";
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
        isError?: boolean;
        structuredContent: {
          saved?: boolean;
          saved_id?: string;
          record_version?: number;
          counts?: {total:number;shown:number;overdue:number};
          ready?: boolean;
          sent?: boolean;
          send_confirmed?: boolean;
          already_approved?: boolean;
          send_allowed?: boolean;
          package?: { id: string; download_url: string; page_count: number; approved: boolean; filename: string };
          card: CardModel & { sections: { rows: CardRow[] }[] };
          delivery_id?: string;
          draft_key?: string | null;
          draft?: { to: string; cc: string[]; subject: string; body: string; link?: string | null };
          approved_at?: string | null;
          assistant_guidance?: string[];
          warning?: {
            flag: string;
            package_link_repeated: boolean;
            body_differs: boolean;
            message: string;
          } | null;
          preview_only?: boolean;
          build_result?: string;
          history?: { id: string; filename: string; current: boolean; open_url: string; transmittal_number: number }[];
          warnings?: { code: string; message: string; pieces: string[] }[];
        };
      }>;
    }
  ).handler(args, {});
const saved = async (sid: string) =>
  (await query("SELECT mcp_submittal_package_context($1,$2) data", [job, sid]))[0].data;
async function create(number: string, sourceParty = "Example Manufacturer") {
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
            source_party: sourceParty,
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
  await db.exec(readFileSync("supabase/migrations/20261023070000_athena_board_links.sql", "utf8"));
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
  await db.exec(readFileSync("supabase/migrations/20261029120000_athena_submittal_record_page.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261030120000_athena_package_build_identity.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261023200000_athena_morning_brief.sql", "utf8"));
  await db.exec(readFileSync("drizzle/migrations/0025_athena_submittal_member_read_transaction.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261025111504_athena_submittal_display_time_zone.sql", "utf8"));
  // Explicit local stand-in for the existing plan service; production uses its real function.
  await db.exec("CREATE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'circle'::text $$;");
  await db.exec(readFileSync("supabase/migrations/20261025140000_athena_request_package_records.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261025150000_athena_change_order_packages.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261025153000_athena_change_execution_tie.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261030130000_athena_submittal_log_approval_only.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261030160000_athena_submittal_package_delivery_link.sql", "utf8"));
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
          async upload(path: string, bytes: Uint8Array | Blob, options: { upsert: boolean }) {
            expect(bucket).toBe("athena-submittals");
            expect(options.upsert).toBe(false);
            if (blobs.has(path)) return { error: { message: "exists" } };
            await query("INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)", [
              bucket,
              path,
            ]);
            blobs.set(path, bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(await bytes.arrayBuffer()));
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
  it("preserves a saved piece source with numbered construction references across host displays", async () => {
    const source = "TEST upload #282, delete later; RFI #12 / CO #3 / Bulletin #4";
    const sid = await create("INTEGRATION-HASH-REFERENCES", source);
    const output = await call(submittalPackage, { action: "get", job_number: "2701", submittal_id: sid });
    const card = output.structuredContent.card;
    const node = { dataset: {}, innerHTML: "" };
    runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
      window: { openai: { toolOutput: { card } } }, document: { getElementById: () => node },
    });
    for (const rendered of [renderHtml(card), renderMarkdown(card), node.innerHTML]) {
      expect(rendered).toContain(source);
    }
    const ctx = await saved(sid);
    expect(ctx.items.find((item: { kind: string }) => item.kind === "product_cut").source_party).toBe(source);
    expect(output.structuredContent.package).toBeUndefined();
  });
  it("uploads an unlogged piece to an empty package and builds from the named sources", async () => {
    const added = (await query("SELECT mcp_submittal_log($1,$2,$3::jsonb) data", [job, "add", JSON.stringify({
      number: "INTEGRATION-NEW-PIECES", spec_section: "26 24 16", title: "Fictional unlogged pieces",
      submittal_type: "product_data", status: "in_prep", ball_in_court: "gc", package_items: [],
    })]))[0].data;
    const sid = added.saved_id as string;
    expect((await saved(sid)).items).toEqual([]);
    const original = await PDFDocument.create();
    original.addPage();
    const bytes = await original.save();
    const base64 = Buffer.from(bytes).toString("base64");
    for (const filename of ["shop-drawing.pdf", "supporting-calcs.pdf"]) {
      const uploaded = await call(submittalPackage, {
        action: "upload_piece", job_number: "2701", submittal_id: sid, filename,
        // Two deliberately distinct pieces may come from the same source and kind.
        new_piece: { kind: "other", source_party: "Fictional Supplier", required: true },
        content_base64: base64,
      });
      expect(uploaded.structuredContent.sent).toBeFalsy();
      expect(JSON.stringify(uploaded.structuredContent.card)).toContain(filename);
    }
    const ctx = await saved(sid);
    expect(ctx.items).toHaveLength(2);
    expect(new Set(ctx.items.map((p: { id: string }) => p.id)).size).toBe(2);
    expect(ctx.items.every((p: { status: string }) => p.status === "received")).toBe(true);
    const built = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    expect(built.structuredContent.ready).toBe(true);
    expect(built.structuredContent.package!.page_count).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(built.structuredContent.card)).toContain("Draft, not sent");
    expect(JSON.stringify(built.structuredContent.card)).toContain("Fictional Supplier");
    if (process.env.ATHENA_RENDER_PROOF_DIR) {
      mkdirSync(process.env.ATHENA_RENDER_PROOF_DIR, { recursive: true });
      writeFileSync(`${process.env.ATHENA_RENDER_PROOF_DIR}/new-piece-card.html`, renderHtml(built.structuredContent.card));
    }
    for (const item of ctx.items) {
      const path = item.file_ref.replace("athena-submittals/", "");
      expect(await sha256Hex(blobs.get(path)!)).toBe(await sha256Hex(bytes));
    }
    expect((await query("SELECT count(*)::int n FROM mcp_submittal_mail WHERE submittal_id=$1", [sid]))[0].n).toBe(0);
  });
  it("adds a received piece without replacing any existing log piece", async () => {
    const sid = await create("INTEGRATION-APPEND-PIECE"), before = await saved(sid);
    await call(submittalPackage, {
      action: "upload_piece", job_number: "2701", submittal_id: sid,
      new_piece: { kind: "calc", source_party: "Fictional Engineer", required: true },
      filename: "calculations.pdf", content_base64: Buffer.from("fictional fixture").toString("base64"),
    });
    const after = await saved(sid);
    expect(after.items).toHaveLength(3);
    for (const item of before.items) expect(after.items.find((p: { id: string }) => p.id === item.id)).toEqual(item);
    expect(after.items.find((p: { kind: string }) => p.kind === "calc")).toMatchObject({ status: "received", source_party: "Fictional Engineer" });
    const count = blobs.size;
    await expect(call(submittalPackage, {
      action: "upload_piece", job_number: "2701", submittal_id: sid, package_item: "P1",
      new_piece: { kind: "calc", source_party: "Fictional Engineer" }, filename: "no.pdf", content_base64: "YQ==",
    })).rejects.toThrow("not both");
    expect(blobs.size).toBe(count);
  });
  it("rolls back a new piece when storage or its metadata is invalid", async () => {
    const sid = await create("INTEGRATION-ATOMIC-NEW-PIECE"), before = await saved(sid);
    const id = crypto.randomUUID(), path = `${company}/${job}/pieces/${crypto.randomUUID()}/missing.pdf`;
    await expect(query("SELECT mcp_submittal_package_write($1,$2,'attach',$3::jsonb)", [job, sid, JSON.stringify({
      item_id: id, path, new_piece: { kind: "calc", source_party: "Fictional Engineer" },
    })])).rejects.toThrow("stored on this job");
    expect((await saved(sid)).items).toEqual(before.items);
    await query("INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-submittals',$1)", [path]);
    await expect(query("SELECT mcp_submittal_package_write($1,$2,'attach',$3::jsonb)", [job, sid, JSON.stringify({
      item_id: id, path, new_piece: { kind: "calc", source_party: "", required: true },
    })])).rejects.toThrow("new piece needs");
    expect((await saved(sid)).items).toEqual(before.items);
  });
  it("uses the host attachment filename for a new piece and refuses ambiguous file sources", async () => {
    const sid = await create("INTEGRATION-HOST-NEW-PIECE");
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
    const hostFile = { download_url: "https://files.oaiusercontent.com/fictional/calcs.pdf", file_id: "fictional-upload", file_name: "supplier-calcs.pdf", mime_type: "application/pdf" };
    const fetchFile = vi.fn(async () => new Response(bytes as BodyInit));
    vi.stubGlobal("fetch", fetchFile);
    try {
      const args = { action: "upload_piece", job_number: "2701", submittal_id: sid,
        new_piece: { kind: "calc", source_party: "Fictional Engineer", required: true }, file: hostFile };
      await call(submittalPackage, args);
      const c = await saved(sid);
      expect(c.items).toHaveLength(3);
      const piece = c.items.find((p: { kind: string }) => p.kind === "calc");
      expect(piece.file_ref).toMatch(/\/supplier-calcs\.pdf$/);
      expect(fetchFile).toHaveBeenCalledTimes(1);
      const count = blobs.size;
      await expect(call(submittalPackage, { ...args, content_base64: "YQ==" })).rejects.toThrow("one received file");
      expect(blobs.size).toBe(count);
      expect((await saved(sid)).items).toHaveLength(3);
    } finally { vi.unstubAllGlobals(); }
  });
  it("requires full job access before adding an unlogged piece", async () => {
    const sid = await create("INTEGRATION-NEW-PIECE-ACCESS"), before = await saved(sid);
    const path = `${company}/${job}/pieces/${crypto.randomUUID()}/source.pdf`;
    await query("INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-submittals',$1)", [path]);
    for (const [id, role] of [["00000000-0000-4000-8000-000000000070", null], ["00000000-0000-4000-8000-000000000071", "estimating"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [id, `fictional-${id.slice(-2)}@example.com`]);
      await db.query("INSERT INTO test_active_members VALUES ($1)", [id]);
      if (role) await db.query("INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,$3,'Fictional Estimator')", [company, id, role]);
      await expect(asUser(db, { ...claims, sub: id }, async (tx) => tx.query(
        "SELECT mcp_submittal_package_write($1,$2,'attach',$3::jsonb)", [job, sid, JSON.stringify({ item_id: crypto.randomUUID(), path,
          new_piece: { kind: "calc", source_party: "Fictional Engineer", required: true } })],
      ))).rejects.toThrow(/Full job access/);
    }
    expect((await saved(sid)).items).toEqual(before.items);
  });
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
  it("collects files, retrieves without rebuilding, retains originals and records delivery only after the receipt", async () => {
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
    for (const result of [before]) {
      const rendered = renderHtml(result.structuredContent.card);
      const markdown = renderMarkdown(result.structuredContent.card);
      expect(rendered).toContain("Draft, not sent");
      expect(markdown).toContain(`/r/job/${job}/submittal/INTEGRATION-001?t=`);
      expect(markdown).not.toMatch(/\/r\/job\/(?: |%20)\//);
      expect(rendered).not.toMatch(/\/r\/job\/(?: |%20)\//);
    }
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
    const packageCard = build.structuredContent.card;
    expect(packageCard.sections.map(s => s.heading)).toEqual(expect.arrayContaining(["Cover sheet", "Transmittal", "Items included"]));
    expect(packageCard.sections.find(s => s.heading === "Items included")?.columns).toContain("Source");
    expect(renderMarkdown(packageCard)).toContain("Example Manufacturer");
    expect(renderHtml(packageCard)).toContain("Draft, not sent");
    expect(renderHtml(packageCard)).toContain("Build 1 of 1");
    mkdirSync("artifacts/submittal-polish", { recursive: true });
    writeFileSync("artifacts/submittal-polish/package-card.html", renderHtml(packageCard));
    writeFileSync("artifacts/submittal-polish/collect-card.html", renderHtml(before.structuredContent.card));
    const widgetNode = { dataset: {}, innerHTML: "" };
    runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
      window: { openai: { toolOutput: { card: packageCard } } }, document: { getElementById: () => widgetNode },
    });
    expect(widgetNode.innerHTML).toContain(`/r/job/${job}/submittal/INTEGRATION-001?t=`);
    expect(widgetNode.innerHTML).not.toMatch(/\/r\/job\/(?: |%20)\//);
    const logRows = await readSubmittalRows(state.sb as Sb, job);
    const builtRow = logRows.find(r => r.id === sid)!;
    expect(builtRow.built_package?.id).toBe(a.id);
    expect(builtRow.status).toBe("in_prep"); // Building does not claim submission.
    const log = presentSubmittalLog({ jobNumber: "2701", jobName: "Fictional", rows: [builtRow], today: "2026-10-24", boardUrl: `https://app.meetathena.io/r/job/${job}/submittals?t=${"x".repeat(43)}` });
    const logRow = log.card.sections?.find(s => s.heading === "Log")?.rows[0];
    expect(logRow?.cells[5]).toBe("Ready for internal review · Draft, not sent");
    expect(log.card.sections?.find(s => s.heading === "Live log")?.rows[0].href).toBe(`https://app.meetathena.io/r/job/${job}/submittals?t=${"x".repeat(43)}`);
    expect(new URL(logRow!.href!).searchParams.get("package_id")).toBeNull();
    expect(new URL(logRow!.href!).searchParams.get("open")).toBeNull();
    expect(new URL(logRow!.href!).pathname).toBe(`/r/job/${job}/submittal/INTEGRATION-001`);
    expect(log.card.sections?.find(s => s.heading === "Package PDFs")?.rows[0].href).toContain(`open=package&package_id=${a.id}`);
    writeFileSync("artifacts/submittal-polish/log-card.html", renderHtml(log.card));
    expect(JSON.stringify(build.structuredContent)).not.toContain("signed_url");
    expect(
      build.structuredContent.card.sections[0].rows.some((r) =>
        r.href?.includes(`open=package&package_id=${a.id}`),
      ),
    ).toBe(true);
    const again = await call(submittalPackage, { action: "get", job_number: "2701", submittal_id: sid });
    expect(again.structuredContent.package?.id).toBe(a.id);
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
  async function ready(number: string) {
    const sid = await create(number), ctx = await saved(sid);
    const source = await PDFDocument.create(); source.addPage();
    const bytes = await source.save();
    for (const item of ctx.items) await call(submittalPackage, {
      action: "upload_piece", job_number: "2701", submittal_id: sid,
      package_item_id: item.id, filename: `${item.kind}.pdf`, content_base64: Buffer.from(bytes).toString("base64"),
    });
    return sid;
  }
  it("creates one package for repeat host build calls, never builds on get, and safely replays an explicit rebuild", async () => {
    const sid = await ready("ONE-REQUEST-ONE-BUILD");
    const initial = await call(submittalPackage, { action: "get", job_number: "2701", submittal_id: sid });
    expect(initial.structuredContent.ready).toBe(false);
    const count = async () => (await query("SELECT count(*)::int n FROM mcp_submittal_packages WHERE submittal_id=$1", [sid]))[0].n;
    expect(await count()).toBe(0);
    const first = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    const id = first.structuredContent.package!.id;
    const original = state.sb as Sb, methods: string[] = [];
    state.sb = { ...original, rpc: async (fn: string, args: Record<string, unknown>) => {
      methods.push(fn);
      return (original.rpc as unknown as ReturnType<typeof fakeClient>["rpc"])(fn, args);
    } };
    try {
      for (const action of ["get", "get", "build", "get", "build"]) {
        const reply = await call(submittalPackage, { action, job_number: "2701", submittal_id: sid });
        expect(reply.structuredContent.package!.id).toBe(id);
      }
      expect(methods).not.toContain("mcp_submittal_package_write");
      expect(methods).not.toContain("mcp_submittal_package_reserve");
      expect(await count()).toBe(1);
    } finally { state.sb = original; }
    const args = { action: "build", job_number: "2701", submittal_id: sid, rebuild_from_package_id: id };
    const rebuilt = await call(submittalPackage, args);
    expect(rebuilt.structuredContent.package!.id).not.toBe(id);
    expect(rebuilt.structuredContent.build_result).toBe("created");
    const replay = await call(submittalPackage, args);
    expect(replay.structuredContent.package!.id).toBe(rebuilt.structuredContent.package!.id);
    expect(replay.structuredContent.build_result).toBe("reused");
    expect(await count()).toBe(2);
    await expect(call(submittalPackage, { ...args, rebuild_from_package_id: crypto.randomUUID() })).rejects.toThrow("not in this submittal");
    expect(await count()).toBe(2);
  });
  it("returns every saved build and filename collision in Athena's own card and host facts", async () => {
    const sid = await ready("HISTORY-AND-DUPLICATES");
    const source = await PDFDocument.create(); source.addPage();
    for (let n = 0; n < 2; n++) await call(submittalPackage, {
      action: "upload_piece", job_number: "2701", submittal_id: sid, filename: "Repeated.pdf",
      content_base64: Buffer.from(await source.save()).toString("base64"),
      new_piece: { kind: "other", source_party: `Fictional Source ${n}`, required: true },
    });
    let prior: string | undefined;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const reply = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid, rebuild_from_package_id: prior });
      prior = reply.structuredContent.package!.id;
      ids.push(prior);
      expect(reply.structuredContent.history).toHaveLength(i + 1);
      expect(reply.structuredContent.warnings?.[0]).toMatchObject({ code: "DUPLICATE_FILENAME", pieces: ["P3", "P4"] });
      expect(JSON.stringify(reply.structuredContent.card)).toContain("Duplicate filename: Repeated.pdf");
      expect(JSON.stringify(reply.structuredContent.card)).toContain("Both copies are kept");
    }
    const got = await call(submittalPackage, { action: "get", job_number: "2701", submittal_id: sid });
    expect(got.structuredContent.history?.map((p) => p.id)).toEqual([...ids].reverse());
    expect(got.structuredContent.history?.filter((p) => p.current)).toHaveLength(1);
    const history = got.structuredContent.card.sections.find((s) => s.heading === "Package history")!;
    expect(history.rows).toHaveLength(4);
    expect(history.rows.filter((r) => r.cells.at(-1) === "Superseded")).toHaveLength(3);
    expect(history.rows.every((r) => r.href?.includes("open=package&package_id="))).toBe(true);
    expect(history.rows.every((r) => r.cells[0].includes("America/Manaus"))).toBe(true);
    expect(history.rows.every((r) => !/Built \d{4}-\d{2}-\d{2}T/.test(r.cells[0]))).toBe(true);
    try {
      await db.query("UPDATE mcp_jobs SET time_zone='America/Chicago' WHERE id=$1",[job]);
      const local = await call(submittalPackage,{action:"get",job_number:"2701",submittal_id:sid});
      const localHistory = local.structuredContent.card.sections.find(s=>s.heading==="Package history")!;
      expect(localHistory.rows.every(r=>r.cells[0].includes("America/Chicago"))).toBe(true);
      expect(JSON.stringify(localHistory)).not.toContain("Manaus");
      expect(local.structuredContent.history?.filter(p=>p.current)).toHaveLength(1);
    } finally {
      await db.query("UPDATE mcp_jobs SET time_zone='America/Manaus' WHERE id=$1",[job]);
    }
    if (process.env.ATHENA_RENDER_PROOF_DIR) {
      mkdirSync(process.env.ATHENA_RENDER_PROOF_DIR, { recursive: true });
      writeFileSync(`${process.env.ATHENA_RENDER_PROOF_DIR}/package-history-card.html`, renderHtml(got.structuredContent.card));
    }
    expect((await query("SELECT count(*)::int n FROM mcp_submittal_mail WHERE submittal_id=$1", [sid]))[0].n).toBe(0);
  });
  it("commits at most one package when two hosts race the same unchanged build", async () => {
    const sid = await ready("RACING-HOST-BUILD");
    const args = { action: "build", job_number: "2701", submittal_id: sid };
    const results = await Promise.allSettled([call(submittalPackage, args), call(submittalPackage, args)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect((await query("SELECT count(*)::int n FROM mcp_submittal_packages WHERE submittal_id=$1", [sid]))[0].n).toBe(1);
    const got = await call(submittalPackage, { ...args, action: "get" });
    expect(got.structuredContent.history).toHaveLength(1);
  });
  it("rebuilds three immutable PDFs with distinct transmittals, one current copy and two superseded copies", async () => {
    const sid = await ready("REBUILD-001"), versions = [], hashes = [];
    const sourcePaths = (await saved(sid)).items.map((p: { file_ref: string }) => p.file_ref.replace("athena-submittals/", ""));
    const sourceHashes = await Promise.all(sourcePaths.map((path: string) => sha256Hex(blobs.get(path)!)));
    for (let i = 0; i < 3; i++) {
      const result = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid, rebuild_from_package_id: versions.at(-1)?.id });
      versions.push((await saved(sid)).package);
      expect(result.structuredContent.package?.id).toBe(versions.at(-1).id);
      expect(result.structuredContent.package?.filename).toBe(versions.at(-1).filename);
      hashes.push(await sha256Hex(blobs.get(versions.at(-1).path)!));
      expect(result.structuredContent.sent).toBe(false);
    }
    expect(new Set(versions.map(p => p.id)).size).toBe(3);
    expect(new Set(versions.map(p => p.filename)).size).toBe(3);
    expect(new Set(versions.map(p => p.transmittal_id)).size).toBe(3);
    expect(await Promise.all(versions.map(p => sha256Hex(blobs.get(p.path)!)))).toEqual(hashes);
    expect(await Promise.all(sourcePaths.map((path: string) => sha256Hex(blobs.get(path)!)))).toEqual(sourceHashes);
    const payload = (await query("SELECT mcp_submittal_record_get($1,$2) data", [job, "REBUILD-001"]))[0].data;
    expect(payload.packages.filter((p: { is_current: boolean }) => p.is_current)).toHaveLength(1);
    expect(payload.packages.find((p: { is_current: boolean }) => p.is_current).id).toBe(versions[2].id);
    expect(payload.packages.filter((p: { is_current: boolean }) => !p.is_current)).toHaveLength(2);
    expect(new Set(payload.packages.map((p: { transmittal_number: number }) => p.transmittal_number)).size).toBe(3);
    expect(payload.transmittals).toHaveLength(3);
    const page = (await query("SELECT mcp_submittal_page($1) data",[job]))[0].data;
    const pageRow = page.submittals.find((r: { id: string }) => r.id === sid);
    expect(pageRow.built_package.id).toBe(versions[2].id);
    expect(pageRow.has_package).toBe(true);
    expect(pageRow.submission_sent_at).toBeNull();
    const { renderReportBody } = await import("../report-pages");
    const pageHtml = renderReportBody(page);
    expect(pageHtml).toContain(`open=package&amp;package_id=${versions[2].id}`);
    expect(pageHtml).toContain("Ready for internal review");
    expect((await saved(sid)).submittal.status).toBe("in_prep");
    await call(submittalPackage, { action: "get", job_number: "2701", submittal_id: sid });
    expect(await Promise.all(versions.map(p => sha256Hex(blobs.get(p.path)!)))).toEqual(hashes);
    const rows = await readSubmittalRows(state.sb as Sb, job);
    expect(rows.find(r => r.id === sid)?.built_package?.id).toBe(versions[2].id);
    if (process.env.ATHENA_RENDER_PROOF_DIR) {
      mkdirSync(process.env.ATHENA_RENDER_PROOF_DIR, { recursive: true });
      const { renderSubmittalRecordBody } = await import("../submittal-record-page");
      writeFileSync(`${process.env.ATHENA_RENDER_PROOF_DIR}/rebuild-history.html`, renderSubmittalRecordBody(payload));
      for (const [i,p] of versions.entries()) writeFileSync(`${process.env.ATHENA_RENDER_PROOF_DIR}/rebuild-${i+1}.pdf`,blobs.get(p.path)!);
    }
  });
  it("renders the committed build identity even when the writer returns its preceding snapshot", async () => {
    const sid = await ready("STALE-WRITE-REPLY");
    await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    const previous = await saved(sid), original = state.sb as Sb;
    state.sb = { ...original, rpc: async (fn: string, args: Record<string, unknown>) => {
      const result = await (original.rpc as unknown as ReturnType<typeof fakeClient>["rpc"])(fn, args);
      return fn === "mcp_submittal_package_write" ? { ...result, data: previous } : result;
    } };
    try {
      const rebuilt = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid, rebuild_from_package_id: previous.package.id });
      const current = await saved(sid);
      expect(current.package.id).not.toBe(previous.package.id);
      expect(rebuilt.structuredContent.package).toMatchObject({ id: current.package.id, filename: current.package.filename });
      expect(rebuilt.structuredContent.card.kpis?.[0].value).toBe(`T-${current.transmittal_number}`);
      expect(JSON.stringify(rebuilt.structuredContent.card.sections[0])).not.toContain(previous.package.filename);
    } finally { state.sb = original; }
  });
  it("keeps the first exact PDF link valid across subsequent host reads without rotating previews", async () => {
    const sid = await ready("MULTI-HOST-LINK");
    const built = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    const artifact = (await saved(sid)).package;
    const before = (await query("SELECT preview_hash,preview_expires_at FROM mcp_submittal_packages WHERE id=$1", [artifact.id]))[0];
    const open = built.structuredContent.card.sections[0].rows.find(r=>r.cells[0].startsWith("Open package PDF"))!.href!;
    for (const name of ["ChatGPT", "claude-ai", "Grok Bot"]) {
      const got = await call(submittalPackage, { action: "get", job_number: "2701", submittal_id: sid });
      const visit = await nativeCardVisit(new Request("https://app.meetathena.io/mcp", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({jsonrpc:"2.0",id:73,method:"tools/call",params:{name:"submittal_package",arguments:{},_meta:{"io.modelcontextprotocol/clientInfo":{name,version:"fixture"}}}}) }));
      const transformed = nativeCardPayload({jsonrpc:"2.0",id:73,result:got},visit).value as {result: typeof got};
      expect(transformed.result.structuredContent.package?.id).toBe(artifact.id);
      expect(JSON.stringify(transformed.result)).toContain(open);
      expect(transformed.result.structuredContent.card.kpis?.[0].value).toBe(`T-${(await saved(sid)).transmittal_number}`);
    }
    expect(new URL(open).searchParams.get("package_id")).toBe(artifact.id);
    expect((await query("SELECT preview_hash,preview_expires_at FROM mcp_submittal_packages WHERE id=$1", [artifact.id]))[0]).toEqual(before);
    const { submittalPackageTarget } = await import("../submittal-record-page");
    const record = (await query("SELECT mcp_submittal_record_get($1,$2) data",[job,"MULTI-HOST-LINK"]))[0].data;
    record.packages = record.packages.map((p:{path:string})=>({...p,url:`https://fixture.supabase.co/storage/v1/object/sign/athena-submittals/${p.path}?token=private-fixture`}));
    expect(submittalPackageTarget(record,artifact.id)).toContain(artifact.path);
  });
  it("does not label a mismatched historical artifact as current on get", async () => {
    const sid = await ready("HISTORICAL-GET");
    await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid});
    const previous = (await saved(sid)).package;
    await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid,rebuild_from_package_id:previous.id});
    const original = state.sb as Sb;
    state.sb = {...original,rpc:async(fn:string,args:Record<string,unknown>)=>{
      const result = await (original.rpc as unknown as ReturnType<typeof fakeClient>["rpc"])(fn,args);
      return fn === "mcp_submittal_package_context" ? {...result,data:{...result.data,package:previous}} : result;
    }};
    try {
      const got = await call(submittalPackage,{action:"get",job_number:"2701",submittal_id:sid});
      expect(got.structuredContent.package).toBeNull();
      expect(got.structuredContent.ready).toBe(false);
      expect(JSON.stringify(got.structuredContent.card.sections[0])).not.toContain(previous.filename);
    } finally { state.sb = original; }
  });
  it("uploads through the browser member flow, preserves pieces, verifies a lost write reply and builds the received PDFs", async () => {
    const sid = await ready("MEMBER-UPLOAD"), before = await saved(sid);
    const pdf = await PDFDocument.create(); pdf.addPage();
    const bytes = await pdf.save();
    const original = state.sb as Sb;
    const client = { ...original, rpc: async (fn: string, args: Record<string, unknown>) => {
      const result = await (original.rpc as unknown as ReturnType<typeof fakeClient>["rpc"])(fn,args);
      if (fn === "mcp_submittal_package_write") throw new Error("lost response after commit");
      return result;
    }} as unknown as PieceUploadClient;
    const stored = await uploadSubmittalPiece(client, { jobId: job, number: "MEMBER-UPLOAD",
      file: new File([bytes as BlobPart],"fictional-p3.pdf",{type:"application/pdf"}),
      newPiece: {kind:"other",source_party:"Example Steel Fabricators",required:true} });
    expect(stored.ref).toBe("P3");
    const after = await saved(sid);
    expect(after.items).toHaveLength(3);
    for (const p of before.items) expect(after.items.find((row:{id:string})=>row.id===p.id)).toEqual(p);
    expect(after.items[2]).toMatchObject({id:stored.pieceId,status:"received",source_party:"Example Steel Fabricators"});
    expect(await sha256Hex(blobs.get(after.items[2].file_ref.replace("athena-submittals/",""))!)).toBe(await sha256Hex(bytes));
    const built = await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid});
    expect(built.structuredContent.package?.page_count).toBe(4);
    expect((await query("SELECT count(*)::int n FROM mcp_submittal_mail WHERE submittal_id=$1",[sid]))[0].n).toBe(0);
  });
  it("reserves concurrent numbers without changing the current PDF, and rolls back a bad save", async () => {
    const sid = await ready("REBUILD-002");
    await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    const original = await saved(sid);
    const reserve = async () => (await query("SELECT mcp_submittal_package_reserve($1,$2,$3) data", [job,sid,original.fingerprint]))[0].data;
    const [a,b] = await Promise.all([reserve(),reserve()]);
    expect(a.transmittal_number).not.toBe(b.transmittal_number);
    expect((await saved(sid)).package.id).toBe(original.package.id);
    expect((await saved(sid)).submittal.transmittal_id).toBe(original.submittal.transmittal_id);
    await expect(query("SELECT mcp_submittal_package_write($1,$2,'save',$3::jsonb)", [job,sid,JSON.stringify({fingerprint:original.fingerprint,transmittal_id:a.build_transmittal_id,filename:'wrong.pdf'})])).rejects.toThrow("filename must match");
    expect((await saved(sid)).package.id).toBe(original.package.id);
    expect((await saved(sid)).submittal.transmittal_id).toBe(original.submittal.transmittal_id);
    await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid, rebuild_from_package_id: original.package.id });
    await expect(query("SELECT mcp_submittal_package_write($1,$2,'save',$3::jsonb)", [job,sid,JSON.stringify({fingerprint:original.fingerprint,transmittal_id:b.build_transmittal_id})])).rejects.toThrow("changed while building");
  });
  it("does not carry an old send receipt onto a rebuilt draft or allow delivery of its superseded copy", async () => {
    const sid = await ready("REBUILD-003");
    const first = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    const a = first.structuredContent.package!;
    const draft = await call(submittalDelivery, {action:"draft",job_number:"2701",submittal_id:sid,kind:"package",package_id:a.id,
      draft:{to:"reviewer@example.com",cc:[],subject:"Fictional rebuild check",body:`Please review ${a.download_url}`,link:a.download_url}});
    await call(submittalDelivery,{action:"approve",job_number:"2701",submittal_id:sid,delivery_id:draft.structuredContent.delivery_id,draft_key:draft.structuredContent.draft_key,confirmed:true});
    await call(submittalDelivery,{action:"record_sent",job_number:"2701",submittal_id:sid,delivery_id:draft.structuredContent.delivery_id,draft_key:draft.structuredContent.draft_key,provider:"local-test-only",message_id:"synthetic-rebuild-receipt",sent_at:new Date().toISOString()});
    const rebuilt = await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid,rebuild_from_package_id:a.id});
    expect(rebuilt.structuredContent.package!.id).not.toBe(a.id);
    const row = (await readSubmittalRows(state.sb as Sb,job)).find(r=>r.id===sid)!;
    expect(row.submission_sent_at).toBeNull();
    const view = presentSubmittalLog({jobNumber:"2701",jobName:"Fictional",rows:[row],today:"2026-10-24",boardUrl:null});
    expect(view.text).toContain("Ready for internal review · Draft, not sent");
    expect(view.text).toContain("Send receipt not recorded");
    await expect(call(submittalDelivery,{action:"draft",job_number:"2701",submittal_id:sid,kind:"package",package_id:a.id,
      draft:{to:"reviewer@example.com",cc:[],subject:"Old copy",body:`Old ${a.download_url}`,link:a.download_url}})).rejects.toThrow("current package");
  });
  it("keeps the deployed first-build contract working during release and refuses legacy rebuilds", async () => {
    const sid = await ready("REBUILD-LEGACY"), ctx = await saved(sid), id=crypto.randomUUID();
    const filename=`Submittal-REBUILD-LEGACY-R0-T${ctx.transmittal_number}-${ctx.today}.pdf`;
    const path=`${company}/${job}/packages/${id}/${filename}`;
    await query("INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-submittals',$1)",[path]);
    const p={id,path,filename,fingerprint:ctx.fingerprint,sha256:"a".repeat(64),size_bytes:100,page_count:3,cover_date:ctx.today,manifest:[],token_hash:await sha256Hex(new TextEncoder().encode(id)),download_url:`https://app.meetathena.io/r/submittal-file/${"b".repeat(43)}`,signed_url:`https://test.supabase.co/storage/v1/object/sign/athena-submittals/${path}?token=test`,expires_at:new Date(Date.now()+86400000).toISOString()};
    await query("SELECT mcp_submittal_package_write($1,$2,'save',$3::jsonb)",[job,sid,JSON.stringify(p)]);
    expect((await saved(sid)).package.transmittal_id).toBe(ctx.submittal.transmittal_id);
    await expect(query("SELECT mcp_submittal_package_write($1,$2,'save',$3::jsonb)",[job,sid,JSON.stringify(p)])).rejects.toThrow("updated package builder");
    expect((await saved(sid)).package.id).toBe(id);
  });
  it("refuses stale reservations and reserve attempts without full job access", async () => {
    const sid = await ready("REBUILD-004"), ctx = await saved(sid);
    await expect(query("SELECT mcp_submittal_package_reserve($1,$2,$3)",[job,sid,"stale"])).rejects.toThrow("changed");
    const user="00000000-0000-4000-8000-000000000099";
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'super@example.com')",[user]);
    await db.query("INSERT INTO test_active_members VALUES ($1)",[user]);
    await db.query("INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'super','Fictional Super')",[company,user]);
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)",[job,user,owner]);
    await expect(asUser(db,{sub:user,email:"super@example.com",role:"authenticated"},tx=>tx.query("SELECT mcp_submittal_package_reserve($1,$2,$3)",[job,sid,ctx.fingerprint]))).rejects.toThrow("Full job access");
    expect((await saved(sid)).package).toBeNull();
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


describe("RFI package uses the working submittal workflow end to end", () => {
  it("creates, builds, attaches a marked-up drawing, records delivery, captures an answer and reopens with originals intact", async () => {
    const created = await call(rfiRecord, {
      action: "create", job_number: "2701", request_id: crypto.randomUUID(),
      title: "Connection RFI #12", condition: "A101 detail 4 conflicts with the specification.",
      question: "Which connection applies? Bulletin #4 is referenced.",
      references: [{kind:"drawing",citation:"A101 detail 4, grid B/3"}],
      recipient_name: "Pat Example", recipient_role: "construction_manager", recipient_email: "pat@example.com",
    });
    const sid = created.structuredContent.saved_id!;
    expect(created.structuredContent.record_version).toBe(1);
    const questionOnly = await call(submittalPackage, {action:"build",job_number:"2701",submittal_id:sid});
    expect(questionOnly.structuredContent.package!.page_count).toBeGreaterThanOrEqual(1);
    const original = await PDFDocument.create(); original.addPage(); const bytes = await original.save();
    const originalHash = await sha256Hex(bytes);
    await call(submittalPackage, {action:"upload_piece",job_number:"2701",submittal_id:sid,
      new_piece:{kind:"shop_drawing",source_party:"Pat Example · RFI #12"},filename:"A101-markup.pdf",content_base64:Buffer.from(bytes).toString("base64")});
    const built = await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid});
    const artifact = built.structuredContent.package!;
    expect(artifact.page_count).toBeGreaterThan(questionOnly.structuredContent.package!.page_count);
    const snapshot = await saved(sid);
    const sourcePath = snapshot.items[0].file_ref.replace("athena-submittals/","");
    expect(await sha256Hex(blobs.get(sourcePath)!)).toBe(originalHash);
    const transmittals = (await query("SELECT count(*)::int n FROM mcp_transmittals WHERE job_id=$1",[job]))[0].n;
    await call(rfiLog,{job_number:"2701"});
    const read = await call(submittalPackage,{action:"get",job_number:"2701",submittal_id:sid});
    expect(read.structuredContent.package!.id).toBe(artifact.id);
    expect((await query("SELECT count(*)::int n FROM mcp_transmittals WHERE job_id=$1",[job]))[0].n).toBe(transmittals);
    const draft = await call(submittalDelivery,{action:"draft",job_number:"2701",submittal_id:sid,kind:"package",package_id:artifact.id,
      draft:{to:"pat@example.com",cc:[],subject:"Job 2701 · RFI clarification #12",body:`Please review the request and marked-up drawing. ${artifact.download_url}`,link:artifact.download_url}});
    const common={job_number:"2701",submittal_id:sid,delivery_id:draft.structuredContent.delivery_id,draft_key:draft.structuredContent.draft_key};
    await call(submittalDelivery,{...common,action:"approve",confirmed:true});
    await call(submittalDelivery,{...common,action:"record_sent",provider:"local-test-only",message_id:crypto.randomUUID(),sent_at:new Date().toISOString()});
    const sentRow = (await query("SELECT mcp_request_rows($1,'rfi') data",[job]))[0].data.records.find((r:{id:string})=>r.id===sid);
    expect(sentRow.state).toBe("sent"); expect(sentRow.due_back).toBeNull(); expect(sentRow.ball_in_court_name).toBe("Pat Example");
    const answer={text:"Use the connection in detail 4. RFI #12 answered; verify before closing.",received_from:"Pat Example",received_at:new Date().toISOString(),references:[]};
    await call(rfiRecord,{action:"answer",job_number:"2701",submittal_id:sid,request_id:crypto.randomUUID(),expected_version:1,answer});
    expect((await saved(sid)).package.id).toBe(artifact.id);
    await expect(call(rfiRecord,{action:"close",job_number:"2701",submittal_id:sid,request_id:crypto.randomUUID(),expected_version:2})).rejects.toThrow("explicitly confirm");
    await call(rfiRecord,{action:"close",job_number:"2701",submittal_id:sid,request_id:crypto.randomUUID(),expected_version:2,confirmed:true});
    const reopened=await call(rfiRecord,{action:"reopen",job_number:"2701",submittal_id:sid,request_id:crypto.randomUUID(),expected_version:3,confirmed:true});
    expect(reopened.structuredContent.saved_id).not.toBe(sid);
    expect((await saved(reopened.structuredContent.saved_id!)).submittal.revision).toBe(1);
    expect(await sha256Hex(blobs.get(sourcePath)!)).toBe(originalHash);
    expect(blobs.has(snapshot.package.path)).toBe(true);
  });
});

describe("change-order shared package and deterministic execution",()=>{
 it("prices, builds and submits once, separates approval from execution, and preserves prior billing",async()=>{
   await db.exec(readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"));
   const beforeMissing=(await query("SELECT count(*)::int n FROM mcp_transmittals WHERE job_id=$1",[job]))[0].n;
   const missing=await call(changeOrderRecord,{action:"create",job_number:"2701",request_id:crypto.randomUUID()});expect(missing.structuredContent.saved).toBe(false);
   expect((await query("SELECT count(*)::int n FROM mcp_transmittals WHERE job_id=$1",[job]))[0].n).toBe(beforeMissing);
   const created=await call(changeOrderRecord,{action:"create",job_number:"2701",request_id:crypto.randomUUID(),title:"Fictional Bulletin #4 connection",condition:"A101 detail 4 revised",scope:"Provide revised connections",references:[{kind:"drawing",citation:"A101 detail 4"}],recipient_name:"Pat Example",recipient_email:"pat@example.com"});
   const sid=created.structuredContent.saved_id!;
   expect((await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid})).structuredContent.ready).toBe(false);
   await call(changeOrderRecord,{action:"price",job_number:"2701",request_id:crypto.randomUUID(),submittal_id:sid,expected_version:1,lines:[{category:"material",description:"Plates",quantity:2,unit_rate_cents:5000,source:"Fictional quote #12"}]});
   const built=await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid});const artifact=built.structuredContent.package!;
   expect(artifact.page_count).toBeGreaterThan(0);expect((await saved(sid)).change_order_details.total_cents).toBe(10000);
   const recordNumber=(await saved(sid)).submittal.number;
   const ownerRecord=(await query("SELECT mcp_submittal_record_get($1,$2) data",[job,recordNumber]))[0].data;
   expect(ownerRecord.current.change_order_details.total_cents).toBe(10000);
   expect(ownerRecord.current.change_order_history.map((h:{action:string})=>h.action)).toEqual(["price","create"]);
   const superId="00000000-0000-4000-8000-000000000088";
   await db.query("INSERT INTO auth.users(id,email) VALUES($1,'super88@example.com')",[superId]);await db.query("INSERT INTO test_active_members VALUES($1)",[superId]);
   await db.query("INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'super','Fictional Super')",[company,superId]);await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)",[job,superId,owner]);
   const asSuper=(sql:string,params:unknown[]=[])=>asUser<{rows:Record<string,unknown>[]}>(db,{sub:superId,email:"super88@example.com",role:"authenticated"},tx=>tx.query(sql,params));
   expect((await asSuper("SELECT * FROM mcp_change_orders WHERE submittal_id=$1",[sid])).rows).toHaveLength(0);
   expect((await asSuper("SELECT * FROM mcp_change_history WHERE submittal_id=$1",[sid])).rows).toHaveLength(0);
   expect((await asSuper("SELECT * FROM mcp_submittal_packages WHERE id=$1",[artifact.id])).rows).toHaveLength(0);
   await expect(asSuper("SELECT mcp_submittal_record_get($1,$2)",[job,(await saved(sid)).submittal.number])).rejects.toThrow();
   await expect(asSuper("SELECT mcp_submittal_package_context($1,$2)",[job,sid])).rejects.toThrow("full job access");
   const packagePath=(await query("SELECT path FROM mcp_submittal_packages WHERE id=$1",[artifact.id]))[0].path;
   expect((await asSuper("SELECT mcp_submittal_path_scope($1) sc",[packagePath])).rows[0].sc).toBeNull();

   const draft=await call(submittalDelivery,{action:"draft",job_number:"2701",submittal_id:sid,kind:"package",package_id:artifact.id,draft:{to:"pat@example.com",cc:[],subject:"Fictional PCO",body:`Review ${artifact.download_url}`,link:artifact.download_url}});
   const common={job_number:"2701",submittal_id:sid,delivery_id:draft.structuredContent.delivery_id,draft_key:draft.structuredContent.draft_key};
   await call(submittalDelivery,{...common,action:"approve",confirmed:true});await call(submittalDelivery,{...common,action:"record_sent",provider:"local-test-only",message_id:crypto.randomUUID(),sent_at:new Date().toISOString()});
   const evidence={by:"Fictional Owner",at:new Date().toISOString(),reference:"Fictional signed change #1"};
   await query("UPDATE mcp_jobs SET sov_fee_pct=10 WHERE id=$1",[job]);
   await db.query("INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'sov','05.01',$2::jsonb,'known','member_answer',$3),($1,'contract','contract_value','1000','known','member_answer',$3)",[job,JSON.stringify({description:"Original steel",billable_value:900}),owner]);
   await call(changeOrderRecord,{action:"approve",job_number:"2701",request_id:crypto.randomUUID(),submittal_id:sid,expected_version:2,confirmed:true,evidence});
   const billingAtApproval=(await query("SELECT mcp_billing_evidence_get($1) data",[job]))[0].data;
   expect(billingAtApproval.recorded_contract.approved_cents).toBe(110000);
   expect((await query("SELECT * FROM mcp_job_facts WHERE job_id=$1 AND module='sov'",[job])).length).toBe(1);
   const execution={action:"execute",job_number:"2701",request_id:crypto.randomUUID(),submittal_id:sid,expected_version:3,confirmed:true,evidence,sov_division:"05"};
   await db.query("UPDATE mcp_job_facts SET value=$2::jsonb WHERE job_id=$1 AND module='sov' AND key='05.01'",[job,JSON.stringify({description:"Base steel",billable_value:null})]);
   await expect(call(changeOrderRecord,execution)).rejects.toThrow("Complete and verify every base SOV");
   await db.query("UPDATE mcp_job_facts SET value=$2::jsonb WHERE job_id=$1 AND module='sov' AND key='05.01'",[job,JSON.stringify({description:"Base steel",billable_value:"Needed"})]);
   await expect(call(changeOrderRecord,execution)).rejects.toThrow("Complete and verify every base SOV");
   await db.query("UPDATE mcp_job_facts SET value=$2::jsonb WHERE job_id=$1 AND module='sov' AND key='05.01'",[job,JSON.stringify({description:"Base steel",billable_value:950})]);
   await expect(call(changeOrderRecord,execution)).rejects.toThrow("does not tie");
   expect((await saved(sid)).change_order_details.state).toBe("approved");
   await db.query("UPDATE mcp_job_facts SET value=$2::jsonb WHERE job_id=$1 AND module='sov' AND key='05.01'",[job,JSON.stringify({description:"Base steel",billable_value:900})]);
   await call(changeOrderRecord,execution);await call(changeOrderRecord,execution);
   const facts=await query("SELECT module,key,value,status FROM mcp_job_facts WHERE job_id=$1",[job]);
   const lines=facts.filter((f:{module:string})=>f.module==="sov").map((f:{key:string;value:{billable_value:number;description:string;executed_change_order?:string;fee_included?:boolean}})=>({item_no:f.key,description:f.value.description,scheduled_value:f.value.billable_value,executed_change_order:f.value.executed_change_order,fee_included:f.value.fee_included}));
   const sov=buildSov(lines,10,10,{"05.01":{d:450,e:0}});expect(sov.summary.contract_total).toBe(1100);expect(sov.summary.fee).toBe(100);expect(sov.divisions.flatMap(d=>d.lines).find(l=>l.item_no==="05.01")!.d).toBe(450);expect(lines).toHaveLength(2);
   expect(setupContractValue(facts)).toBe(1100);
   const billingAtExecution=(await query("SELECT mcp_billing_evidence_get($1) data",[job]))[0].data;
   expect(billingAtExecution.recorded_contract.approved_cents).toBe(110000);
   await call(changeOrderLog,{job_number:"2701"});expect((await saved(sid)).change_order_details.state).toBe("executed");
   await expect(call(changeOrderRecord,{...execution,request_id:crypto.randomUUID(),expected_version:4})).rejects.toThrow("Execution requires");
   const historical=(await query("SELECT path FROM mcp_submittal_packages WHERE id=$1",[artifact.id]))[0];
   expect(blobs.has(historical.path)).toBe(true);
   const issued=await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid});
   expect(issued.structuredContent.package!.id).not.toBe(artifact.id);
   expect(JSON.stringify(issued.structuredContent.card)).toContain("CO-001");
 });
  it("substitutes the record-page link, keeps the file link in text, and still refuses the wrong package", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = Buffer.from(await source.save()).toString("base64");
    async function ready(number: string) {
      const sid = await create(number);
      const ctx = await saved(sid);
      for (const item of ctx.items) {
        await call(submittalPackage, {
          action: "upload_piece",
          job_number: "2701",
          submittal_id: sid,
          package_item_id: item.id,
          filename: `${item.kind}.pdf`,
          content_base64: bytes,
        });
      }
      const built = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
      const artifact = built.structuredContent.package!;
      const record = built.structuredContent.card.sections
        .flatMap((section) => section.rows)
        .find((row) => row.href?.includes(`package_id=${artifact.id}`))?.href;
      if (!record) throw new Error("record page link missing");
      return { sid, artifact, record, built };
    }
    const deliver = async (sid: string, action: string, payload: unknown) =>
      (await query("SELECT mcp_submittal_delivery($1,$2,$3,$4::jsonb) AS data", [job, sid, action, JSON.stringify(payload)]))[0].data as {
        id: string;
        draft_key: string;
        draft: { link: string; body: string; to: string };
        approved_at: string | null;
      };
    const draftOf = (link: string | null, body: string) => ({
      to: "reviewer@example.com",
      cc: [] as string[],
      subject: "Fictional package",
      body,
      link,
    });
    const first = await ready("LINK-001");
    const textOnly = first.built.content.map((part) => part.text ?? "").join("\n");
    expect(textOnly).toContain(first.artifact.download_url);
    expect(textOnly).toContain("Email delivery link:");
    expect(textOnly).toContain(first.record);
    const guidance = (first.built.structuredContent as { assistant_guidance?: string[] }).assistant_guidance ?? [];
    expect(guidance.join("\n")).toContain(
      `The email delivery link is ${first.artifact.download_url}. The record page link is for the member only.`,
    );
    const html = renderHtml(first.built.structuredContent.card);
    const widget = { dataset: {}, innerHTML: "" };
    runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
      window: { openai: { toolOutput: { card: first.built.structuredContent.card } } },
      document: { getElementById: () => widget },
    });
    for (const rendered of [html, widget.innerHTML]) {
      expect(rendered).toContain("Open package PDF");
      expect(rendered).toContain(`package_id=${first.artifact.id}`);
      expect(rendered).toContain("Draft, not sent");
    }
    const before = (
      await query("SELECT token_hash, approved_at, revoked_at, download_url FROM mcp_submittal_packages WHERE id=$1", [first.artifact.id])
    )[0];
    const savedDraft = await deliver(first.sid, "draft", {
      kind: "package",
      package_id: first.artifact.id,
      draft: draftOf(first.record, `Please review the package at ${first.record}`),
    });
    expect(savedDraft.draft.link).toBe(first.artifact.download_url);
    expect(savedDraft.draft.body).toContain(first.artifact.download_url);
    expect(savedDraft.draft.body).not.toContain(first.record);
    expect(savedDraft.approved_at).toBeNull();
    const after = (
      await query("SELECT token_hash, approved_at, revoked_at, download_url FROM mcp_submittal_packages WHERE id=$1", [first.artifact.id])
    )[0];
    expect(after).toEqual(before);
    const approved = await deliver(first.sid, "approve", {
      delivery_id: savedDraft.id,
      draft_key: savedDraft.draft_key,
      confirmed: true,
    });
    expect(approved.approved_at).toBeTruthy();
    expect(approved.draft.link).toBe(first.artifact.download_url);

    const missingBody = await ready("LINK-002");
    const appended = await deliver(missingBody.sid, "draft", {
      kind: "package",
      package_id: missingBody.artifact.id,
      draft: draftOf(missingBody.artifact.download_url, "Please review the attached package."),
    });
    expect(appended.draft.link).toBe(missingBody.artifact.download_url);
    expect(appended.draft.body.endsWith(missingBody.artifact.download_url)).toBe(true);

    const wrapped = await ready("LINK-003");
    const markdown = await deliver(wrapped.sid, "draft", {
      kind: "package",
      package_id: wrapped.artifact.id,
      draft: draftOf(
        `[Package](${wrapped.artifact.download_url}).`,
        `The file is [Package](${wrapped.artifact.download_url}).`,
      ),
    });
    expect(markdown.draft.link).toBe(wrapped.artifact.download_url);
    expect(markdown.draft.body).toContain(wrapped.artifact.download_url);
    await deliver(wrapped.sid, "approve", {
      delivery_id: markdown.id,
      draft_key: markdown.draft_key,
      confirmed: true,
    });

    const other = await ready("LINK-004");
    const stranger = await ready("LINK-005");
    await expect(
      deliver(other.sid, "draft", {
        kind: "package",
        package_id: other.artifact.id,
        draft: draftOf(stranger.artifact.download_url, `Wrong file ${stranger.artifact.download_url}`),
      }),
    ).rejects.toThrow(`Use this package link exactly: ${other.artifact.download_url}`);
    await expect(
      deliver(other.sid, "draft", {
        kind: "package",
        package_id: other.artifact.id,
        draft: draftOf(stranger.record, `Wrong record ${stranger.record}`),
      }),
    ).rejects.toThrow(`Use this package link exactly: ${other.artifact.download_url}`);

    const expired = await ready("LINK-006");
    await db.query("UPDATE mcp_submittal_packages SET expires_at=now()-interval '1 minute' WHERE id=$1", [expired.artifact.id]);
    await expect(
      deliver(expired.sid, "draft", {
        kind: "package",
        package_id: expired.artifact.id,
        draft: draftOf(expired.artifact.download_url, expired.artifact.download_url),
      }),
    ).rejects.toThrow("Build a current package first");
    const revoked = await ready("LINK-007");
    await call(submittalPackage, { action: "revoke", job_number: "2701", submittal_id: revoked.sid, package_id: revoked.artifact.id });
    await expect(
      deliver(revoked.sid, "draft", {
        kind: "package",
        package_id: revoked.artifact.id,
        draft: draftOf(revoked.artifact.download_url, revoked.artifact.download_url),
      }),
    ).rejects.toThrow("Build a current package first");

    const renewed = await ready("LINK-008");
    const nextUrl = `https://app.meetathena.io/r/submittal-file/${"c".repeat(43)}`;
    await db.query("UPDATE mcp_submittal_packages SET download_url=$2, token_hash=$3 WHERE id=$1", [
      renewed.artifact.id,
      nextUrl,
      "c".repeat(64),
    ]);
    await expect(
      deliver(renewed.sid, "draft", {
        kind: "package",
        package_id: renewed.artifact.id,
        draft: draftOf(renewed.artifact.download_url, renewed.artifact.download_url),
      }),
    ).rejects.toThrow(`Use this package link exactly: ${nextUrl}`);

    const foreignJob = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id,time_zone) VALUES ($1,$2,'Other fictional job','2702',$3,'UTC')",
      [foreignJob, owner, company],
    );
    const foreignSid = (
      await query("SELECT mcp_submittal_log($1,'add',$2::jsonb) AS data", [
        foreignJob,
        JSON.stringify({
          number: "FOREIGN-001",
          spec_section: "26 24 16",
          title: "Fictional other job",
          submittal_type: "product_data",
          status: "in_prep",
          ball_in_court: "gc",
        }),
      ])
    )[0].data.saved_id as string;
    const held = await ready("LINK-009");
    await db.query("UPDATE mcp_submittal_packages SET job_id=$2, submittal_id=$3 WHERE id=$1", [
      held.artifact.id,
      foreignJob,
      foreignSid,
    ]);
    await expect(
      deliver(held.sid, "draft", {
        kind: "package",
        package_id: held.artifact.id,
        draft: draftOf(held.artifact.download_url, held.artifact.download_url),
      }),
    ).rejects.toThrow("Build a current package first");

    const renewedCard = await call(submittalPackage, {
      action: "renew_link",
      job_number: "2701",
      submittal_id: missingBody.sid,
    });
    expect(renewedCard.content.map((part) => part.text ?? "").join("\n")).toContain(
      "Renewing this link turns off the package link already sent.",
    );
  });
});

describe("submittal delivery needs the saved row ids", () => {
  for (const action of ["get", "approve", "record_sent"] as const) {
    it(`refuses ${action} without delivery_id or draft_key before touching the database`, async () => {
      const base = {
        action,
        job_number: "2701",
        submittal_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        confirmed: true,
        provider: "local-test-only",
        message_id: "synthetic-missing-ids",
        sent_at: new Date().toISOString(),
      };
      const message = "Pass the delivery_id and draft_key from the saved delivery card. Nothing was recorded.";
      await expect(call(submittalDelivery, base)).rejects.toThrow(message);
      await expect(
        call(submittalDelivery, { ...base, delivery_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }),
      ).rejects.toThrow(message);
      await expect(call(submittalDelivery, { ...base, draft_key: "a".repeat(32) })).rejects.toThrow(message);
    });
  }
});

describe("submittal delivery ids and sent-body warning", () => {
  const shown = (result: Awaited<ReturnType<typeof call>>) =>
    `${result.content.map((part) => part.text ?? "").join("\n")}\n${(result.structuredContent.assistant_guidance ?? []).join("\n")}`;
  const refusal = async (args: Record<string, unknown>) => {
    try {
      await call(submittalDelivery, args);
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const expectNoPair = (message: string, ...values: string[]) => {
    expect(message).toContain("Re-read the saved draft card (call get) and stop");
    expect(message).not.toContain("Show the exact saved draft");
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(message).not.toMatch(/\b[a-f0-9]{32}\b/i);
    for (const value of values) expect(message).not.toContain(value);
  };
  async function chaseDraft(number: string) {
    const sid = await create(number);
    const ctx = await saved(sid);
    const piece = ctx.items.find((item: { kind: string; id: string }) => item.kind === "product_cut");
    const drafted = await call(submittalDelivery, {
      action: "draft",
      job_number: "2701",
      submittal_id: sid,
      kind: "chase",
      package_item_id: piece.id,
      draft: {
        to: "supplier@example.com",
        cc: [],
        subject: `Chase ${number}`,
        body: `Please send the product data for ${number}.`,
      },
    });
    const delivery_id = drafted.structuredContent.delivery_id!;
    const draft_key = drafted.structuredContent.draft_key!;
    return { sid, drafted, delivery_id, draft_key };
  }

  it("returns the exact delivery pair on draft, get and approve and names which id is wrong", async () => {
    const savedDraft = await chaseDraft("PAIR-001");
    const other = await chaseDraft("PAIR-002");
    const pairText = shown(savedDraft.drafted);
    expect(savedDraft.drafted.structuredContent.delivery_id).toBe(savedDraft.delivery_id);
    expect(savedDraft.drafted.structuredContent.draft_key).toBe(savedDraft.draft_key);
    expect(pairText).toContain(`delivery_id: ${savedDraft.delivery_id}`);
    expect(pairText).toContain(`draft_key: ${savedDraft.draft_key}`);
    expect(pairText).toContain("Reuse this exact pair unchanged");
    expect(pairText).toContain("Reuse this exact delivery_id and draft_key pair unchanged.");

    const wrongId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const wrongKey = "f".repeat(32);
    const hidden = [savedDraft.delivery_id, savedDraft.draft_key, other.delivery_id, other.draft_key];
    for (const action of ["get", "approve", "record_sent"] as const) {
      const base = {
        action,
        job_number: "2701",
        submittal_id: savedDraft.sid,
        confirmed: true,
        provider: "local-test-only",
        message_id: `synthetic-${action}-mismatch`,
        sent_at: new Date().toISOString(),
      };
      const missingDelivery = await refusal({ ...base, delivery_id: wrongId, draft_key: savedDraft.draft_key });
      expect(missingDelivery).toContain("delivery_id not found for this package");
      expectNoPair(missingDelivery, ...hidden);

      const otherPackage = await refusal({
        ...base,
        delivery_id: other.delivery_id,
        draft_key: other.draft_key,
      });
      expect(otherPackage).toContain("delivery_id not found for this package");
      expect(otherPackage).not.toContain("draft_key does not match");
      expectNoPair(otherPackage, ...hidden);

      const wrongDraftKey = await refusal({ ...base, delivery_id: savedDraft.delivery_id, draft_key: wrongKey });
      expect(wrongDraftKey).toContain("draft_key does not match that delivery_id");
      expect(wrongDraftKey).not.toContain("delivery_id not found");
      expectNoPair(wrongDraftKey, ...hidden);
    }
    const untouched = (
      await query("SELECT approved_at, sent_at FROM mcp_submittal_mail WHERE id=$1", [savedDraft.delivery_id])
    )[0];
    expect(untouched.approved_at).toBeNull();
    expect(untouched.sent_at).toBeNull();

    const got = await call(submittalDelivery, {
      action: "get",
      job_number: "2701",
      submittal_id: savedDraft.sid,
      delivery_id: savedDraft.delivery_id,
      draft_key: savedDraft.draft_key,
    });
    expect(got.structuredContent.delivery_id).toBe(savedDraft.delivery_id);
    expect(got.structuredContent.draft_key).toBe(savedDraft.draft_key);
    expect(got.structuredContent.approved_at).toBeNull();
    expect(got.isError).toBeUndefined();
    expect(shown(got)).toContain(`delivery_id: ${savedDraft.delivery_id}`);
    expect(shown(got)).toContain(`draft_key: ${savedDraft.draft_key}`);
    expect(shown(got)).toContain("unchanged");

    const approved = await call(submittalDelivery, {
      action: "approve",
      job_number: "2701",
      submittal_id: savedDraft.sid,
      delivery_id: savedDraft.delivery_id,
      draft_key: savedDraft.draft_key,
      confirmed: true,
    });
    expect(approved.structuredContent.delivery_id).toBe(savedDraft.delivery_id);
    expect(approved.structuredContent.draft_key).toBe(savedDraft.draft_key);
    const approvedText = shown(approved);
    expect(approvedText).toContain(`delivery_id: ${savedDraft.delivery_id}`);
    expect(approvedText).toContain(`draft_key: ${savedDraft.draft_key}`);
    expect(approvedText).toContain("Reuse this exact pair unchanged");
    expect(approvedText).toContain("Never re-draft after approval.");
    expect(approved.isError).toBeUndefined();
    expect(typeof approved.structuredContent.approved_at).toBe("string");
    expect(approvedText).toContain(`approved_at: ${approved.structuredContent.approved_at}`);
    const reread = await call(submittalDelivery, {
      action: "get",
      job_number: "2701",
      submittal_id: savedDraft.sid,
      delivery_id: savedDraft.delivery_id,
      draft_key: savedDraft.draft_key,
    });
    expect(reread.structuredContent.approved_at).toBe(approved.structuredContent.approved_at);
    expect(reread.isError).toBeUndefined();
    expect(savedDraft.drafted.isError).toBeUndefined();
    expect(savedDraft.drafted.structuredContent.approved_at).toBeNull();

    const byPair = await call(submittalDelivery, {
      action: "get",
      job_number: "2701",
      delivery_id: savedDraft.delivery_id,
      draft_key: savedDraft.draft_key,
    });
    expect(byPair.structuredContent.delivery_id).toBe(savedDraft.delivery_id);
    expect(byPair.structuredContent.draft_key).toBe(savedDraft.draft_key);
    expect(shown(byPair)).not.toContain("Which submittal number");

    const faithful = await call(submittalDelivery, {
      action: "record_sent",
      job_number: "2701",
      submittal_id: savedDraft.sid,
      delivery_id: savedDraft.delivery_id,
      draft_key: savedDraft.draft_key,
      provider: "local-test-only",
      message_id: "synthetic-faithful-body",
      sent_at: new Date().toISOString(),
      sent_body: savedDraft.drafted.structuredContent.draft!.body,
    });
    expect(faithful.structuredContent.sent).toBe(true);
    expect(faithful.structuredContent.warning).toBeUndefined();
    expect(shown(faithful)).not.toContain("WARNING:");
    const { CallToolResultSchema } = await import("@modelcontextprotocol/sdk/types.js");
    for (const sample of [savedDraft.drafted, got, approved]) {
      expect(sample.isError).toBeUndefined();
      expect(CallToolResultSchema.safeParse(sample).success).toBe(true);
    }
  });

  it("gets the delivery from the saved pair when no submittal number is given", async () => {
    const savedDraft = await chaseDraft("PAIR-NO-NUMBER");
    const got = await call(submittalDelivery, {
      action: "get",
      job_number: "2701",
      delivery_id: savedDraft.delivery_id,
      draft_key: savedDraft.draft_key,
    });
    expect(got.isError).toBeUndefined();
    expect(got.structuredContent.delivery_id).toBe(savedDraft.delivery_id);
    expect(got.structuredContent.draft_key).toBe(savedDraft.draft_key);
    expect(shown(got)).not.toContain("Which submittal number");
    const approved = await call(submittalDelivery, {
      action: "approve",
      job_number: "2701",
      delivery_id: savedDraft.delivery_id,
      draft_key: savedDraft.draft_key,
      confirmed: true,
    });
    expect(approved.structuredContent.approved_at).toEqual(expect.any(String));
  });

  it("rejects a submittal number that disagrees with the delivery and a bad pair without a number", async () => {
    const savedDraft = await chaseDraft("PAIR-NUM-A");
    await chaseDraft("PAIR-NUM-B");
    const conflict = await refusal({
      action: "get",
      job_number: "2701",
      delivery_id: savedDraft.delivery_id,
      draft_key: savedDraft.draft_key,
      submittal_number: "PAIR-NUM-B",
    });
    expect(conflict).toContain("That submittal number does not match this delivery");
    expect(conflict).toContain("Re-read the saved draft card (call get) and stop");
    expect(conflict).not.toContain(savedDraft.delivery_id);
    expect(conflict).not.toContain(savedDraft.draft_key);
    expect(conflict).not.toMatch(/\b[a-f0-9]{32}\b/i);
    expect(conflict).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    const badKey = await refusal({
      action: "get",
      job_number: "2701",
      delivery_id: savedDraft.delivery_id,
      draft_key: "a".repeat(32),
    });
    expect(badKey).toContain("draft_key does not match that delivery_id");
    expect(badKey).toContain("Re-read the saved draft card (call get) and stop");
    expect(badKey).not.toContain(savedDraft.delivery_id);
    expect(badKey).not.toContain(savedDraft.draft_key);
    expect(badKey).not.toMatch(/\b[a-f0-9]{32}\b/i);
  });

  it("records a send when the sent body differs or repeats the package link and only flags a warning", async () => {
    const sid = await create("PAIR-LINK");
    const ctx = await saved(sid);
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = Buffer.from(await source.save()).toString("base64");
    for (const item of ctx.items)
      await call(submittalPackage, {
        action: "upload_piece",
        job_number: "2701",
        submittal_id: sid,
        package_item_id: item.id,
        filename: `${item.kind}.pdf`,
        content_base64: bytes,
      });
    const built = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
    const artifact = built.structuredContent.package!;
    const drafted = await call(submittalDelivery, {
      action: "draft",
      job_number: "2701",
      submittal_id: sid,
      kind: "package",
      package_id: artifact.id,
      draft: {
        to: "reviewer@example.com",
        cc: [],
        subject: "Package PAIR-LINK",
        body: `Please review ${artifact.download_url}`,
        link: artifact.download_url,
      },
    });
    const delivery_id = drafted.structuredContent.delivery_id!;
    const draft_key = drafted.structuredContent.draft_key!;
    const savedBody = drafted.structuredContent.draft!.body;
    expect(savedBody.split(artifact.download_url).length - 1).toBe(1);
    const wrongPackage = await refusal({
      action: "approve",
      job_number: "2701",
      submittal_id: sid,
      delivery_id,
      draft_key,
      package_id: "99999999-9999-4999-8999-999999999999",
      confirmed: true,
    });
    expect(wrongPackage).toContain("delivery_id not found for this package");
    expectNoPair(wrongPackage, delivery_id, draft_key);
    expect(
      (await query("SELECT approved_at FROM mcp_submittal_mail WHERE id=$1", [delivery_id]))[0].approved_at,
    ).toBeNull();

    await call(submittalDelivery, {
      action: "approve",
      job_number: "2701",
      submittal_id: sid,
      delivery_id,
      draft_key,
      confirmed: true,
    });
    const repeated = `${savedBody}\n${artifact.download_url}`;
    const recorded = await call(submittalDelivery, {
      action: "record_sent",
      job_number: "2701",
      submittal_id: sid,
      delivery_id,
      draft_key,
      provider: "local-test-only",
      message_id: "synthetic-repeated-link",
      sent_at: new Date().toISOString(),
      sent_body: repeated,
    });
    expect(recorded.structuredContent.sent).toBe(true);
    expect(recorded.structuredContent.delivery_id).toBe(delivery_id);
    expect(recorded.structuredContent.draft_key).toBe(draft_key);
    expect(recorded.structuredContent.warning).toMatchObject({
      flag: "WARNING",
      package_link_repeated: true,
      body_differs: true,
    });
    const text = shown(recorded);
    expect(text).toContain("WARNING:");
    expect(text).toContain("The package link is repeated");
    expect(text).toContain("The sent body differs from the saved draft");
    expect(text).toContain("Never re-draft after approval.");
    const row = (
      await query("SELECT sent_at, message_id, provider FROM mcp_submittal_mail WHERE id=$1", [delivery_id])
    )[0];
    expect(row.sent_at).toBeTruthy();
    expect(row.message_id).toBe("synthetic-repeated-link");
    expect(row.provider).toBe("local-test-only");
  });
});
