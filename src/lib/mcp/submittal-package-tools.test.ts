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
        structuredContent: {
          ready?: boolean;
          sent?: boolean;
          send_confirmed?: boolean;
          already_approved?: boolean;
          send_allowed?: boolean;
          package?: { id: string; download_url: string; page_count: number; approved: boolean; filename: string };
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
    expect(new URL(logRow!.href!).searchParams.get("package_id")).toBe(a.id);
    expect(new URL(logRow!.href!).searchParams.get("open")).toBe("package");
    expect(new URL(logRow!.href!).pathname).toBe(`/r/job/${job}/submittal/INTEGRATION-001`);
    expect(log.card.sections?.find(s => s.heading === "Submittal records")?.rows[0].href).not.toContain("open=package");
    writeFileSync("artifacts/submittal-polish/log-card.html", renderHtml(log.card));
    expect(JSON.stringify(build.structuredContent)).not.toContain("signed_url");
    expect(
      build.structuredContent.card.sections[0].rows.some((r) =>
        r.href?.includes("/r/submittal-preview/"),
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
  it("rebuilds three immutable PDFs with distinct transmittals, one current copy and two superseded copies", async () => {
    const sid = await ready("REBUILD-001"), versions = [], hashes = [];
    const sourcePaths = (await saved(sid)).items.map((p: { file_ref: string }) => p.file_ref.replace("athena-submittals/", ""));
    const sourceHashes = await Promise.all(sourcePaths.map((path: string) => sha256Hex(blobs.get(path)!)));
    for (let i = 0; i < 3; i++) {
      const result = await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
      versions.push((await saved(sid)).package);
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
    await call(submittalPackage, { action: "build", job_number: "2701", submittal_id: sid });
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
    const rebuilt = await call(submittalPackage,{action:"build",job_number:"2701",submittal_id:sid});
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
