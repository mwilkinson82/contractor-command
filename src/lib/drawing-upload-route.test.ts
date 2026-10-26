import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleDrawingUpload } from "./drawing-upload-route.server";
import { isDrawingUploadPut, signDrawingUpload, stagedPathFor, verifyDrawingReceipt, verifyDrawingUpload } from "./mcp/drawing-upload";
import { storeDrawingSet } from "./mcp/drawing-set";
import { DRAWING_CARD_URI, DRAWING_CARD_URIS, drawingCardHtml, drawingResourceMeta } from "./mcp/cards/drawing-card";

const SECRET = "test-secret";
const job = { company_id: "11111111-1111-4111-8111-111111111111", job_id: "22222222-2222-4222-8222-222222222222" };
const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");

function deps() {
  const puts: { bucket: string; path: string; size: number }[] = [];
  return { puts, deps: { secret: SECRET, put: async (bucket: string, path: string, bytes: Uint8Array) => void puts.push({ bucket, path, size: bytes.length }) } };
}
const put = (url: string, body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(url, { method: "PUT", body, headers: { "content-type": "application/pdf", ...headers } });

describe("drawing direct upload", () => {
  it("signs a job-scoped link on the app origin and rejects tampering or expiry", async () => {
    const up = await signDrawingUpload(job, SECRET, 1_000_000);
    expect(up.url).toBe(`https://app.meetathena.io/r/drawing-upload/${up.token}`);
    expect(up.max_bytes).toBe(104857600);
    expect(await verifyDrawingUpload(up.token, SECRET, 1_000_000)).toMatchObject(job);
    expect(await verifyDrawingUpload(up.token, "other", 1_000_000)).toBeNull();
    expect(await verifyDrawingUpload(up.token + "x", SECRET, 1_000_000)).toBeNull();
    expect(await verifyDrawingUpload(up.token, SECRET, 1_000_000 + 31 * 60_000)).toBeNull();
  });

  it("stores a PDF at the job's content-hash path and returns it", async () => {
    const { puts, deps: d } = deps();
    const { token, url } = await signDrawingUpload(job, SECRET);
    const res = await handleDrawingUpload(put(url, pdf), token, d);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(body.stored).toBe(true);
    expect(body.path).toMatch(new RegExp(`^${job.company_id}/${job.job_id}/drawing-[0-9a-f]{64}/source\\.pdf$`));
    expect(puts).toEqual([{ bucket: "athena-drawings", path: body.path, size: pdf.length }]);
    const receipt = (await verifyDrawingReceipt(body.receipt, SECRET))!;
    expect(receipt).toMatchObject({ ...job, path: body.path, content_hash: body.content_hash, size: pdf.length });
    expect(await verifyDrawingReceipt(token, SECRET)).toBeNull(); // an upload token is not a receipt
    expect(await verifyDrawingUpload(body.receipt, SECRET)).toBeNull(); // and a receipt is not an upload token
    const claim = (await verifyDrawingUpload(token, SECRET))!;
    expect(stagedPathFor(claim, body.path)).toBe(body.content_hash);
    expect(stagedPathFor({ ...claim, job_id: "33333333-3333-4333-8333-333333333333" }, body.path)).toBeNull();
  });

  it("answers CORS preflight and returns real error text", async () => {
    const { puts, deps: d } = deps();
    const { token, url } = await signDrawingUpload(job, SECRET);
    expect((await handleDrawingUpload(new Request(url, { method: "OPTIONS" }), token, d)).status).toBe(204);
    const notPdf = await handleDrawingUpload(put(url, "hello"), token, d);
    expect((await notPdf.json()).error).toMatch(/has to be a PDF/);
    const big = await handleDrawingUpload(put(url, pdf, { "content-length": String(104857601) }), token, d);
    expect(big.status).toBe(400);
    expect((await big.json()).error).toMatch(/100 MB/);
    const bad = await handleDrawingUpload(put(url, pdf), "nope", d);
    expect(bad.status).toBe(403);
    expect((await bad.json()).error).toMatch(/not valid or has expired/);
    expect(puts).toEqual([]);
  });

  it("lets only the drawing upload PUT past the cross-origin guard", () => {
    expect(isDrawingUploadPut("PUT", "/r/drawing-upload/abc.def")).toBe(true);
    expect(isDrawingUploadPut("POST", "/r/drawing-upload/abc.def")).toBe(false);
    expect(isDrawingUploadPut("PUT", "/r/file-upload/abc")).toBe(false);
    expect(isDrawingUploadPut("PUT", "/r/drawing-upload/a/b")).toBe(false);
    const start = readFileSync("src/start.ts", "utf8");
    expect(start).toContain("if (isDrawingUploadPut(method, url.pathname))");
    expect(start.indexOf("isDrawingUploadPut(method")).toBeLessThan(start.indexOf("Cross-origin request blocked"));
  });

  it("card v7 uploads by fetch, falls back to a chat attachment, allows only the app origin, and keeps old URIs", () => {
    expect(DRAWING_CARD_URI).toBe("ui://athena/drawing-card-v7.html");
    for (const v of ["v6", "v5", "v4", "v3", "v2"]) expect(DRAWING_CARD_URIS.has(`ui://athena/drawing-card-${v}.html`)).toBe(true);
    expect(drawingResourceMeta.ui.csp.connectDomains).toEqual(["https://app.meetathena.io"]);
    expect(drawingResourceMeta["openai/widgetCSP"].connect_domains).toEqual(["https://app.meetathena.io"]);
    const html = drawingCardHtml("https://example.supabase.co");
    expect(html).toContain('fetch(up.url,{method:"PUT"');
    expect(html).toContain("staged_path:staged.path,upload_receipt:staged.receipt");
    expect(html).toContain("content_base64:btoa"); // small-file fallback for hosts without direct upload
    expect(html).toContain("toolText(m.result)");
    expect(html).toContain("Attach it in the chat instead");
    expect(html.match(/fetch\(/g)).toEqual(["fetch("]); // only the upload route; storage links are opened, never fetched
    expect(() => new Function(html.split("<script>")[1].split("</script>")[0])).not.toThrow();
  });

  it("confirms a staged upload from its receipt without downloading, re-uploading or parsing the PDF", async () => {
    const hash = "a".repeat(64);
    const path = `${job.company_id}/${job.job_id}/drawing-${hash}/source.pdf`;
    const touched: string[] = [];
    const saved: Record<string, unknown>[] = [];
    const sb = {
      storage: { from: () => ({
        download: async () => (touched.push("download"), { data: null, error: { message: "no" } }),
        upload: async () => (touched.push("upload"), { error: null }),
      }) },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === "mcp_drawing_records") return { data: [], error: null };
        if (fn === "mcp_drawing_source_save") {
          saved.push(args._record as Record<string, unknown>);
          return { data: { ...(args._record as object), id: "d1", version: 1 }, error: null };
        }
        return { data: null, error: null };
      },
    };
    const stored = await storeDrawingSet(sb as never, { ...job, job_number: "EX-1" } as never, {
      filename: "Example Set.pdf",
      sheets: ["S-100"],
      staged: { path, content_hash: hash, size: 73_400_320 },
    });
    expect(touched).toEqual([]);
    expect(saved[0]).toMatchObject({ path, storage_bucket: "athena-drawings", content_hash: hash });
    expect(stored.pageCount).toBeUndefined();
  });
});
