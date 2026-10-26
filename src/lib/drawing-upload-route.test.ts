import { describe, expect, it } from "vitest";
import { handleDrawingUpload } from "./drawing-upload-route.server";
import { signDrawingUpload, stagedPathFor, verifyDrawingUpload } from "./mcp/drawing-upload";
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

  it("card v6 uploads by fetch, allows only the app origin, and keeps old URIs", () => {
    expect(DRAWING_CARD_URI).toBe("ui://athena/drawing-card-v6.html");
    for (const v of ["v5", "v4", "v3", "v2"]) expect(DRAWING_CARD_URIS.has(`ui://athena/drawing-card-${v}.html`)).toBe(true);
    expect(drawingResourceMeta.ui.csp.connectDomains).toEqual(["https://app.meetathena.io"]);
    expect(drawingResourceMeta["openai/widgetCSP"].connect_domains).toEqual(["https://app.meetathena.io"]);
    const html = drawingCardHtml("https://example.supabase.co");
    expect(html).toContain('fetch(up.url,{method:"PUT"');
    expect(html).toContain("staged_path:staged.path");
    expect(html).toContain("content_base64:btoa"); // small-file fallback for hosts without direct upload
    expect(html).toContain("toolText(m.result)");
    expect(() => new Function(html.split("<script>")[1].split("</script>")[0])).not.toThrow();
  });
});
