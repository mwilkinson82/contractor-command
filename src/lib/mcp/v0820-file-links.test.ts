import { describe, expect, it } from "vitest";
import { openShare } from "../file-share-route.server";
import { newToken } from "./file-share";
import { lookaheadPdfTool } from "./tools/file-tools";
import { EMAIL_DRAFT_ARTIFACT_LINE } from "./views";
import { CPM_GANTT_SPEC } from "./living";

const row = { filename: "2701 Two-Week Lookahead.pdf", mime_type: "application/pdf", size_bytes: 5, signed_url: "https://x.supabase.co/storage/v1/object/sign/athena-files/a?token=t" };
// Mimics workerd: redirect "error" throws (the live 500 on /f/<token>).
const workerdFetch = (async (_u: string, i?: RequestInit) => {
  if (i?.redirect === "error") throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
  return new Response("%PDF-", { status: 200 });
}) as unknown as typeof fetch;

describe("0.8.20 /f/<token> on Cloudflare Workers", () => {
  it("streams the PDF instead of a 500 (no redirect: error)", async () => {
    const r = await openShare(newToken(), "GET", async () => row, workerdFetch);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    expect(await r.text()).toBe("%PDF-");
  });
  it("a storage redirect or error is a 410 page, a network failure a 503, never a throw", async () => {
    const redir = (async () => new Response(null, { status: 302, headers: { location: "https://evil" } })) as unknown as typeof fetch;
    expect((await openShare(newToken(), "GET", async () => row, redir)).status).toBe(410);
    const down = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect((await openShare(newToken(), "GET", async () => row, down)).status).toBe(503);
  });
});

describe("0.8.20 wording", () => {
  it("email_draft artifact line matches the Gantt pattern", () => {
    expect(EMAIL_DRAFT_ARTIFACT_LINE).toMatch(/^REQUIRED VIEW: build ONE styled email-draft artifact/);
    expect(EMAIL_DRAFT_ARTIFACT_LINE).toMatch(/In Claude: an artifact built only from this result \(no tool calls inside it\)/);
    expect(CPM_GANTT_SPEC[0]).toMatch(/^REQUIRED VIEW/);
  });
  it("lookahead_pdf description is neutral: no imperatives to the model", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = String((lookaheadPdfTool as any).description ?? (lookaheadPdfTool as any).config?.description ?? "");
    expect(d).toMatch(/^Builds the job's two-week lookahead as a styled PDF/);
    expect(d).not.toMatch(/\b(must|always|never|whenever|call this|then:|REQUIRED)\b/i);
  });
});
