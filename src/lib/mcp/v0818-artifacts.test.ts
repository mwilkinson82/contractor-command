// 0.8.18: Claude artifacts for lookahead and email_draft.
import { describe, expect, it, vi } from "vitest";

const LINK_RE = /^https:\/\/app\.meetathena\.io\/f\/[A-Za-z0-9_-]{43}$/;
const store = vi.hoisted(() => ({
  uploads: [] as { path: string; bytes: Uint8Array; mime: string }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  live: true,
}));
const fakeSb = () => ({
  storage: {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array, o: { contentType: string }) => {
        store.uploads.push({ path, bytes, mime: o.contentType });
        return { error: null };
      },
      createSignedUrl: async (p: string) => ({
        data: { signedUrl: `https://store.test/${p}?sig=1` },
        error: null,
      }),
      remove: async () => ({ error: null }),
    }),
  },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    store.rpcs.push({ fn, args });
    if (fn === "mcp_file_share_open")
      return {
        data: store.live ? { filename: "x.pdf", mime_type: "application/pdf" } : null,
        error: null,
      };
    return { data: null, error: null };
  },
});
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
const JOB = {
  job_id: "j1",
  company_id: "c1",
  job_number: "2701",
  name: "Ridgeline Medical",
  scope: "full",
  company_name: "ALP",
};
vi.mock("./jobs", async (orig) => ({
  ...(await orig<typeof import("./jobs")>()),
  resolveJob: async () => JOB,
  audit: async () => {},
  prefix: () => "",
}));
vi.mock("./visible", () => ({
  guide: (r: Record<string, unknown>, ...g: string[]) => ({ ...r, guidance: g }),
}));
const ACTS = [
  {
    id: "A1100",
    name: "Underground plumbing",
    start: "2026-10-26",
    finish: "2026-10-30",
    duration: 5,
    total_float: 0,
  },
  {
    id: "A1130",
    name: "Underground inspection",
    start: "2026-11-02",
    finish: "2026-11-02",
    duration: 1,
    total_float: 3,
  },
  {
    id: "A1200",
    name: "Slab pour – area A",
    start: "2026-11-03",
    finish: "2026-11-06",
    duration: 4,
    total_float: 0,
  },
];
vi.mock("./tools/workflow-tools", () => ({
  lookaheadData: async () => ({
    ref: "LA-31BE8",
    win: { start: "2026-10-26", end: "2026-11-06" },
    note: null,
    dataDate: "2026-10-19",
    version: 3,
    acts: ACTS,
    items: [{ action: "Confirm A1130 inspection with city", owner: "Sam", due: "2026-10-30" }],
  }),
}));
vi.mock("./people", () => ({ whoForJob: async () => [] }));

import { emailDraft } from "./tools/email-tools";
import { lookaheadView, LOOKAHEAD_ARTIFACT_LINE, SHOW_AS_IS } from "./styled-views";
import { EMAIL_DRAFT_VIEW_SPEC, LOOKAHEAD_VIEW_SPEC } from "./views";
import { CPM_GANTT_SPEC } from "./living";
import { EMAIL_CARD_RULE } from "./email-safety";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (t: any, a: Record<string, unknown>) =>
  t.handler(a, { authInfo: { token: "t" } } as never);
const L = "https://app.meetathena.io/f/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde";

// 0.8.18 Claude retest (Oct 21): lookahead and email_draft came back as plain markdown; the schedule (CPM_GANTT_SPEC) drew an artifact.
describe("Claude pastes the lookahead and email draft into the chat", () => {
  it("schedule instruction keeps the canvas line and tells Claude to paste the markdown", () => {
    expect(CPM_GANTT_SPEC[0]).toMatch(/^REQUIRED VIEW: .*artifact or canvas, never a plain list/);
    expect(CPM_GANTT_SPEC[0]).toMatch(/In Claude, paste the styled markdown card into the chat answer itself/);
    expect(CPM_GANTT_SPEC[0]).toMatch(/Never an artifact or a link/);
  });
  it("lookahead view is shown as written, without a style recipe", () => {
    const v = lookaheadView({
      title: "2701",
      ref: "LA-31BE8",
      start: "2026-10-26",
      end: "2026-11-06",
      dataDate: "2026-10-19",
      acts: ACTS,
      items: [],
    });
    expect(v).toContain(LOOKAHEAD_ARTIFACT_LINE);
    expect(v).not.toContain(SHOW_AS_IS);
    expect(LOOKAHEAD_ARTIFACT_LINE).toMatch(/^REQUIRED VIEW: build ONE styled lookahead artifact/);
    expect(LOOKAHEAD_ARTIFACT_LINE).toMatch(/In Claude: paste the styled markdown card below into the chat answer itself/);
    expect(LOOKAHEAD_ARTIFACT_LINE).toMatch(/Never an artifact or a link/);
    expect(LOOKAHEAD_ARTIFACT_LINE).toMatch(/In ChatGPT: a canvas/);
    expect(LOOKAHEAD_VIEW_SPEC[0]).toMatch(/In Claude, paste the styled markdown card into the chat answer itself/);
    expect(LOOKAHEAD_VIEW_SPEC.join("\n")).toContain("#2563EB");
  });
  it("email draft spec keeps the confirm question and sends nothing", () => {
    const s = EMAIL_DRAFT_VIEW_SPEC.join("\n");
    expect(s).toMatch(/Answer yes or no in chat\./);
    expect(s).toMatch(/No buttons of any kind/);
    expect(s).not.toMatch(/"Yes, send" button/);
    expect(s).toMatch(/confirm question word for word/);
    expect(s).toMatch(/navy, blue #2563EB and gray only/);
    expect(EMAIL_CARD_RULE).toMatch(/In Claude, paste the styled markdown card into the chat answer itself/);
    expect(EMAIL_CARD_RULE).toMatch(/Never an artifact or a link/);
    expect(s).toMatch(/Never show an attachment chip without a real attachment/);
    expect(s).toMatch(/Send nothing/);
  });
  it("email_draft result text carries the card, the view spec and the yes/no question", async () => {
    const r = await call(emailDraft, {
      to: "pm@example.test",
      cc: [],
      subject: "2701 two-week lookahead",
      body: `Download the lookahead PDF:\n${L}`,
      link: L,
    });
    const t: string = r.content[0].text;
    expect(t).toMatch(/^REQUIRED VIEW: build ONE styled email-draft artifact[^\n]*\n\nTo: pm@example.test/);
    expect(t).toContain(EMAIL_DRAFT_VIEW_SPEC[0]);
    expect(t).toMatch(
      /Confirm question: Send this email to pm@example.test from your connected email account\? Yes or no\?$/,
    );
    expect(t.indexOf("Ready for your review. Not sent.")).toBeLessThan(
      t.indexOf(EMAIL_DRAFT_VIEW_SPEC[0]),
    );
    expect(r.structuredContent.sent).toBe(false);
  });
});
