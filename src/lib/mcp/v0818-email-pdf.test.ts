// 0.8.18 live fail (v0.8.17, Oct 21 00:10 Manaus): ChatGPT "attached" the lookahead to a Gmail draft and nothing was attached.
// Logs: report(lookahead) -> cpm_activities -> living_report_get; no file_share, no email_draft. Athena only told the host
// to "build a PDF and attach it"; the host had no file. Now Athena builds the PDF and email_draft checks for a real file or link.
import { describe, expect, it, vi } from "vitest";

const LINK_RE = /^https:\/\/app\.meetathena\.io\/f\/[A-Za-z0-9_-]{43}$/;
const store = vi.hoisted(() => ({ uploads: [] as { path: string; bytes: Uint8Array; mime: string }[], rpcs: [] as { fn: string; args: Record<string, unknown> }[], live: true }));
const fakeSb = () => ({
  storage: { from: () => ({
    upload: async (path: string, bytes: Uint8Array, o: { contentType: string }) => { store.uploads.push({ path, bytes, mime: o.contentType }); return { error: null }; },
    createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://store.test/${p}?sig=1` }, error: null }),
    remove: async () => ({ error: null }),
  }) },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    store.rpcs.push({ fn, args });
    if (fn === "mcp_file_share_open") return { data: store.live ? { filename: "x.pdf", mime_type: "application/pdf" } : null, error: null };
    return { data: null, error: null };
  },
});
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message: string }) => { throw new Error(e.message); },
}));
const JOB = { job_id: "j1", company_id: "c1", job_number: "2701", name: "Ridgeline Medical", scope: "full", company_name: "ALP" };
vi.mock("./jobs", async (orig) => ({ ...(await orig<typeof import("./jobs")>()), resolveJob: async () => JOB, audit: async () => {}, prefix: () => "" }));
vi.mock("./visible", () => ({ guide: (r: Record<string, unknown>, ...g: string[]) => ({ ...r, guidance: g }) }));
const ACTS = [
  { id: "A1100", name: "Underground plumbing", start: "2026-10-26", finish: "2026-10-30", duration: 5, total_float: 0 },
  { id: "A1130", name: "Underground inspection", start: "2026-11-02", finish: "2026-11-02", duration: 1, total_float: 3 },
  { id: "A1200", name: "Slab pour – area A", start: "2026-11-03", finish: "2026-11-06", duration: 4, total_float: 0 },
];
vi.mock("./tools/workflow-tools", () => ({
  lookaheadData: async () => ({ ref: "LA-31BE8", win: { start: "2026-10-26", end: "2026-11-06" }, note: null, dataDate: "2026-10-19", version: 3, acts: ACTS, items: [{ action: "Confirm A1130 inspection with city", owner: "Sam", due: "2026-10-30" }] }),
}));
vi.mock("./people", () => ({ whoForJob: async () => [] }));

import { lookaheadPdfTool } from "./tools/file-tools";
import { emailDraft } from "./tools/email-tools";
import { lookaheadPdf, pdfText } from "./lookahead-pdf";
import { deliverableProblems, LOOKAHEAD_EMAIL_LINE, EMAIL_DELIVERABLE_RULE } from "./email-safety";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (t: any, a: Record<string, unknown>) => t.handler(a, { authInfo: { token: "t" } } as never);

describe("server-built lookahead PDF", () => {
  it("lookaheadPdf returns a real PDF with the job, window and activities", () => {
    const b = lookaheadPdf({ title: "2701 - Ridgeline", ref: "LA-31BE8", start: "2026-10-26", end: "2026-11-06", dataDate: "2026-10-19", acts: ACTS, items: [] });
    const s = Buffer.from(b).toString("latin1");
    expect(s.startsWith("%PDF-")).toBe(true);
    expect(s).toMatch(/Two-Week Lookahead - 2701 - Ridgeline/);
    expect(s).toMatch(/A1100/);
    expect(s).toMatch(/Oct 26, 2026 - Nov 6, 2026/);
  });
  it("pdfText keeps text Latin-1 safe", () => {
    expect(pdfText("Slab – area “A” 🔵")).toBe('Slab - area "A"');
  });
  it("lookahead_pdf stores a PDF and returns a downloadable link, attached:false", async () => {
    const r = await call(lookaheadPdfTool, { job_number: "2701" });
    expect(store.uploads).toHaveLength(1);
    expect(store.uploads[0].mime).toBe("application/pdf");
    expect(Buffer.from(store.uploads[0].bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(store.rpcs.find((x) => x.fn === "mcp_file_share_create")?.args._kind).toBe("schedule");
    const sc = r.structuredContent;
    expect(sc.download_url).toMatch(LINK_RE);
    expect(sc.filename).toBe("2701 Two-Week Lookahead 2026-10-26 to 2026-11-06.pdf");
    expect(sc.attached).toBe(false);
    expect(r.content[0].text).toContain(`Download: ${sc.download_url}`);
    expect(r.guidance.join(" ")).toMatch(/can't attach from a URL.*never "attached"/);
  });
  it("every lookahead result points at lookahead_pdf instead of 'build a PDF'", () => {
    expect(LOOKAHEAD_EMAIL_LINE).toMatch(/call lookahead_pdf/);
    expect(EMAIL_DELIVERABLE_RULE).toMatch(/Don't tell yourself to "build a PDF"/);
  });
});

describe("email_draft needs a real attachment or a working Athena link", () => {
  const L = "https://app.meetathena.io/f/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde";
  const base = { to: "marshall@example.test", cc: [], subject: "2701 two-week lookahead" };
  it("the live-fail draft (says attached, no file, no link) is refused", () => {
    expect(deliverableProblems({ ...base, body: "Attached is the 2-week lookahead.", link: null, attachment: null }).join(" ")).toMatch(/says "attached" but nothing is attached/);
  });
  it("a report email with no attachment and no link is refused", () => {
    expect(deliverableProblems({ ...base, body: "Here is the 2-week lookahead for 2701.", link: null, attachment: null }).join(" ")).toMatch(/no attachment and no link.*lookahead_pdf/);
  });
  it("an attachment with no Athena source link is refused", () => {
    expect(deliverableProblems({ ...base, body: "The lookahead PDF is attached.", link: null, attachment: "2701.pdf" }).join(" ")).toMatch(/has no source/);
  });
  it("the link must be in the body and be an Athena file link", () => {
    expect(deliverableProblems({ ...base, body: "Lookahead at the link.", link: L, attachment: null }).join(" ")).toMatch(/in the email body/);
    expect(deliverableProblems({ ...base, body: "Lookahead: https://drive.test/x.pdf", link: "https://drive.test/x.pdf", attachment: null }).join(" ")).toMatch(/isn't an Athena file link/);
  });
  it("link-only draft passes; 'attached' with a link but no attachment is refused", () => {
    expect(deliverableProblems({ ...base, body: `Download the lookahead PDF here:\n${L}`, link: L, attachment: null })).toEqual([]);
    expect(deliverableProblems({ ...base, body: `Lookahead attached.\n${L}`, link: L, attachment: null }).join(" ")).toMatch(/at the link instead/);
  });
  it("email_draft checks the Athena link really opens", async () => {
    store.live = false;
    await expect(call(emailDraft, { ...base, body: `Download the lookahead PDF:\n${L}`, link: L })).rejects.toThrow(/doesn't work/);
    store.live = true;
    const r = await call(emailDraft, { ...base, body: `Download the lookahead PDF:\n${L}`, link: L });
    expect(r.structuredContent.draft.link).toBe(L);
    expect(store.rpcs.filter((x) => x.fn === "mcp_file_share_open").every((x) => x.args._count === false)).toBe(true);
  });
});
