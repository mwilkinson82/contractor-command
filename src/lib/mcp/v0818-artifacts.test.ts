// 0.8.18: Claude artifacts for lookahead and email_draft.
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

import { emailDraft } from "./tools/email-tools";
import { lookaheadView, LOOKAHEAD_ARTIFACT_LINE, SHOW_AS_IS } from "./styled-views";
import { EMAIL_DRAFT_VIEW_SPEC, LOOKAHEAD_VIEW_SPEC } from "./views";
import { CPM_GANTT_SPEC } from "./living";
import { EMAIL_CARD_RULE } from "./email-safety";
import { ALERT_HEX } from "./alert-color";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (t: any, a: Record<string, unknown>) => t.handler(a, { authInfo: { token: "t" } } as never);
const L = "https://app.meetathena.io/f/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde";

// 0.8.18 Claude retest (Oct 21): lookahead and email_draft came back as plain markdown; the schedule (CPM_GANTT_SPEC) drew an artifact.
describe("Claude renders lookahead and email draft as artifacts, like the schedule", () => {
  it("schedule pattern: a REQUIRED VIEW line asking for an artifact", () => {
    expect(CPM_GANTT_SPEC[0]).toMatch(/^REQUIRED VIEW: .*artifact or canvas, never a plain list/);
  });
  it("lookahead view asks for an artifact instead of 'show as written'", () => {
    const v = lookaheadView({ title: "2701", ref: "LA-31BE8", start: "2026-10-26", end: "2026-11-06", dataDate: "2026-10-19", acts: ACTS, items: [] });
    expect(v).toContain(LOOKAHEAD_ARTIFACT_LINE);
    expect(v).not.toContain(SHOW_AS_IS);
    expect(LOOKAHEAD_ARTIFACT_LINE).toMatch(/^REQUIRED VIEW: build ONE styled lookahead artifact/);
    expect(LOOKAHEAD_ARTIFACT_LINE).toMatch(/In Claude: an artifact.*no tool calls inside it/);
    expect(LOOKAHEAD_ARTIFACT_LINE).toMatch(/Never paste the markdown/);
    expect(LOOKAHEAD_VIEW_SPEC[0]).toMatch(/In Claude this is always an artifact/);
  });
  it("lookahead spec keeps navy/blue/gray and the alert color only for risks", () => {
    const s = LOOKAHEAD_VIEW_SPEC.join("\n");
    expect(s).toContain("#2563EB");
    expect(s).toMatch(new RegExp(`${ALERT_HEX} only for risks, delays and overdue items`));
    expect(s).toMatch(/no orange/);
  });
  it("email draft spec: styled card artifact with a yes/no question, palette rules", () => {
    const s = EMAIL_DRAFT_VIEW_SPEC.join("\n");
    expect(EMAIL_DRAFT_VIEW_SPEC[0]).toMatch(/^REQUIRED VIEW – EMAIL DRAFT: .*ONE styled email card, never a plain text or markdown block\. In Claude: an artifact/);
    expect(s).toMatch(/"Yes, send" button and a gray "No" button/);
    expect(s).toMatch(/confirm question word for word/);
    expect(s).toMatch(/navy, blue #2563EB and gray only/);
    expect(s).toMatch(new RegExp(`${ALERT_HEX} only if the email itself is about a delay, risk or overdue item`));
    expect(s).toMatch(/Never show an attachment chip without a real attachment/);
    expect(s).toMatch(/Send nothing/);
    expect(EMAIL_CARD_RULE).toMatch(/In Claude it must be an artifact/);
  });
  it("email_draft result text carries the card, the view spec and the yes/no question", async () => {
    const r = await call(emailDraft, { to: "pm@example.test", cc: [], subject: "2701 two-week lookahead", body: `Download the lookahead PDF:\n${L}`, link: L });
    const t: string = r.content[0].text;
    expect(t).toMatch(/^REQUIRED VIEW: build ONE styled email-draft artifact[^\n]*\n\nTo: pm@example.test/);
    expect(t).toContain(EMAIL_DRAFT_VIEW_SPEC[0]);
    expect(t).toMatch(/Confirm question: Send this email to pm@example.test from your connected email account\? Yes or no\?$/);
    expect(t.indexOf("Ready for your review. Not sent.")).toBeLessThan(t.indexOf("REQUIRED VIEW – EMAIL DRAFT:"));
    expect(r.structuredContent.sent).toBe(false);
  });
});
