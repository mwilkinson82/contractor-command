import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleDrawingUpload, USED_MARKER_BUCKET, USED_MARKER_CONTENT_TYPE } from "./drawing-upload-route.server";
import { DOC_BUCKET } from "./mcp/file-upload";
import { isDrawingUploadPut, signDrawingUpload, stagedPathFor, verifyDrawingReceipt, verifyDrawingUpload } from "./mcp/drawing-upload";
import { storeDrawingSet } from "./mcp/drawing-set";
import { DRAWING_CARD_URI, DRAWING_CARD_URIS, drawingCardHtml, drawingResourceMeta } from "./mcp/cards/drawing-card";

const SECRET = "test-secret";
const job = { company_id: "11111111-1111-4111-8111-111111111111", job_id: "22222222-2222-4222-8222-222222222222" };
const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");

function deps(opts: { failPuts?: number } = {}) {
  const puts: { bucket: string; path: string; size: number }[] = [];
  const used = new Set<string>();
  let fails = opts.failPuts ?? 0;
  return {
    puts,
    used,
    deps: {
      secret: SECRET,
      put: async (bucket: string, path: string, bytes: Uint8Array) => {
        if (fails-- > 0) throw new Error("storage down");
        puts.push({ bucket, path, size: bytes.length });
      },
      claim: async (nonce: string) => (used.has(nonce) ? false : (used.add(nonce), true)),
    },
  };
}
const SANDBOX = "https://web-sandbox.oaiusercontent.com";
async function throughGuard(method: string, path: string) {
  const { csrfOriginGuard } = await import("../start");
  const server = (csrfOriginGuard as unknown as { options: { server: (a: unknown) => Promise<unknown> } }).options.server;
  const request = new Request(`https://app.meetathena.io${path}`, { method, headers: { origin: SANDBOX } });
  const out = await server({ request, next: async () => "PASSED" });
  return out instanceof Response ? { status: out.status, text: await out.text() } : out;
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
    expect(receipt).toMatchObject({ ...job, path: body.path, content_hash: body.content_hash, size: pdf.length, page_count: null });
    expect(body.page_count).toBeNull();
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

  it("the real cross-origin guard blocks other routes and passes only the drawing upload", async () => {
    expect(await throughGuard("POST", "/api/drawing-upload")).toEqual({ status: 403, text: "Cross-origin request blocked" });
    expect(await throughGuard("POST", "/r/drawing-upload/abc.def")).toEqual({ status: 403, text: "Cross-origin request blocked" });
    expect(await throughGuard("PUT", "/r/file-upload/abc")).toEqual({ status: 403, text: "Cross-origin request blocked" });
    expect(await throughGuard("PUT", "/r/drawing-upload/abc.def")).toBe("PASSED");
    expect(await throughGuard("OPTIONS", "/r/drawing-upload/abc.def")).toBe("PASSED");
  });

  it("an expired token is refused with CORS headers", async () => {
    const { puts, deps: d } = deps();
    const { token, url } = await signDrawingUpload(job, SECRET, Date.now() - 31 * 60_000);
    const res = await handleDrawingUpload(put(url, pdf), token, d);
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await res.json()).error).toMatch(/not valid or has expired/);
    expect(puts).toEqual([]);
  });

  it("used markers go to a bucket that accepts their content type, not athena-drawings", () => {
    expect(USED_MARKER_BUCKET).toBe(DOC_BUCKET);
    const spec = JSON.parse(readFileSync("supabase/storage/athena-documents.json", "utf8"));
    expect(spec.id).toBe(USED_MARKER_BUCKET);
    expect(spec.allowed_mime_types === null || spec.allowed_mime_types.includes(USED_MARKER_CONTENT_TYPE)).toBe(true);
    const src = readFileSync("src/lib/drawing-upload-route.server.ts", "utf8");
    expect(src).toContain("storage.from(USED_MARKER_BUCKET)");
    expect(src).toContain("contentType: USED_MARKER_CONTENT_TYPE");
  });

  it("a token is single use once the file is stored", async () => {
    const { used, deps: d } = deps();
    const { token, url } = await signDrawingUpload(job, SECRET);
    expect((await handleDrawingUpload(put(url, pdf), token, d)).status).toBe(200);
    expect(used.size).toBe(1);
    const again = await handleDrawingUpload(put(url, pdf), token, d);
    expect(again.status).toBe(403);
    expect(again.headers.get("access-control-allow-origin")).toBe("*");
    const body = await again.json();
    expect(body.error).toMatch(/already used/);
    expect(body.receipt).toBeUndefined();
  });

  it("a failed store or a rejected body leaves the token reusable", async () => {
    const { used, deps: d } = deps({ failPuts: 1 });
    const { token, url } = await signDrawingUpload(job, SECRET);
    expect((await handleDrawingUpload(put(url, pdf), token, d)).status).toBe(502);
    expect((await handleDrawingUpload(put(url, "hello"), token, d)).status).toBe(400);
    expect(used.size).toBe(0);
    expect((await handleDrawingUpload(put(url, pdf), token, d)).status).toBe(200);
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
      staged: { path, content_hash: hash, size: 73_400_320, page_count: 42 },
    });
    expect(touched).toEqual([]);
    expect(saved[0]).toMatchObject({ path, storage_bucket: "athena-drawings", content_hash: hash, page_count: 42 });
    expect(stored.pageCount).toBe(42);
  });
});
