import { build } from "esbuild";
import { Miniflare, Log, LogLevel } from "miniflare";
import { encode } from "fast-png";
import { describe, expect, it } from "vitest";
import { resolvePaymentBrand } from "../payment-applications/brand";
import { applicationPdf } from "../payment-applications/pdf";
import { applicationFixture } from "../payment-applications/fixtures";
import { calculateApplication } from "../payment-applications/model";

const backend = "https://backend.example";
const logoUrl = `${backend}/storage/v1/object/public/company-logos/owner/official.png`;
const logo = encode({ width: 256, height: 256, channels: 3, data: new Uint8Array(256 * 256 * 3).fill(80) });
const companyId = "synthetic-company";
const applicationId = "00000000-0000-4000-8000-000000000003";
function input(url = logoUrl) {
  const body = applicationFixture();
  const selected = { application_id: applicationId, version: 3, latest_version: 3, body,
    calculation: calculateApplication(body), billing_version: null, recorded_at: "2026-11-03T12:00:00Z", history: [] };
  return { companyId, jobId: "synthetic-job", applicationId, version: 3, allowHistorical: false,
    company: { id: companyId, name: "Synthetic Construction", logo_url: url },
    context: { job: { number: "SYN-03", name: "Synthetic project" }, currency: "USD", snapshot: body.snapshot,
      evidence: [], applications: [], selected } };
}

async function worker(response: () => Response) {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { documentEmailBrand } from './src/lib/mcp/document-email-brand';
      import { paymentApplicationArtifact } from './src/lib/mcp/document-email-artifact';
      export default { async fetch(request) {
        const input = await request.json();
        const sb = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: input.company, error: null }) }) }) }) };
        const brand = await documentEmailBrand(sb, input.companyId);
        return Response.json(await paymentApplicationArtifact({ ...input, brand }));
      } };` },
    bundle: true, write: false, format: "esm", platform: "browser",
    define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(backend) },
  });
  let calls = 0;
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2025-09-24", compatibilityFlags: ["nodejs_compat"], log: new Log(LogLevel.ERROR),
    outboundService: (request: Request) => {
      calls++;
      expect(request.url).toBe(logoUrl);
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.headers.has("cookie")).toBe(false);
      return response();
    },
  });
  return { runtime, calls: () => calls };
}

describe("payment logo browser and attachment runtime parity", () => {
  it("renders the same exact saved v3 PDF with a 256px PNG in browser and server paths", async () => {
    const source = input();
    const frozen = JSON.stringify(source.context.selected);
    const logoResponse = () => new Response(new Uint8Array(logo), { headers: { "content-length": String(logo.length) } });
    const browserBrand = await resolvePaymentBrand({ companyName: source.company.name, logoUrl, backendUrl: backend }, async () => logoResponse());
    expect(browserBrand.logo).toEqual(logo);
    const browserPdf = applicationPdf(source.context.job, source.context.selected, browserBrand);
    const { runtime, calls } = await worker(logoResponse);
    try {
      const response = await runtime.dispatchFetch("https://app.example/synthetic", { method: "POST", body: JSON.stringify(source) });
      expect(response.status).toBe(200);
      const artifact = await response.json() as { content_base64: string; sha256: string; version: number };
      const attachment = Buffer.from(artifact.content_base64, "base64");
      expect(attachment).toEqual(Buffer.from(browserPdf));
      expect(artifact.sha256).toBe(Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(browserPdf))).toString("hex"));
      expect(artifact.version).toBe(3);
      expect(attachment.toString("latin1")).toMatch(/\/Subtype \/Image[\s\S]*?\/Width 256[\s\S]*?\/Height 256/);
      expect(calls()).toBe(1);
      expect(JSON.stringify(source.context.selected)).toBe(frozen);
    } finally { await runtime.dispose(); }
  }, 30000);

  it("does not fetch unsafe URLs or follow redirects in the attachment runtime", async () => {
    const { runtime, calls } = await worker(() => new Response(null, { status: 302, headers: { location: "https://unsafe.example/logo.png" } }));
    try {
      for (const url of ["https://unsafe.example/storage/v1/object/public/company-logos/x.png", `${logoUrl}?token=secret`, `${logoUrl}#fragment`, "https://user:password@backend.example/storage/v1/object/public/company-logos/x.png", `${backend}/storage/v1/object/private/company-logos/x.png`, `${backend}/storage/v1/object/public/other/x.png`, "http://backend.example/storage/v1/object/public/company-logos/x.png", logoUrl]) {
        const source = input(url);
        const response = await runtime.dispatchFetch("https://app.example/synthetic", { method: "POST", body: JSON.stringify(source) });
        const artifact = await response.json() as { content_base64: string };
        expect(Buffer.from(artifact.content_base64, "base64")).toEqual(Buffer.from(applicationPdf(source.context.job, source.context.selected, { companyName: source.company.name })));
      }
      expect(calls()).toBe(1);
    } finally { await runtime.dispose(); }
  }, 30000);
});