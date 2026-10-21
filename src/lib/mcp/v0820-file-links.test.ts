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

// 0.8.20 live smoke test of v0.8.19 on 2701 (data date Nov 2, today Oct 21, window Nov 9-20).
import { linkedActivity, lookaheadModel, type SAct as LaAct } from "./styled-views";
const A2701: LaAct[] = [
  { id: "A1120a", name: "FA/LV underground pathways", start: "2026-10-27", finish: "2026-11-02", duration: 5, total_float: 3 },
  { id: "A1120b", name: "FA/LV underground pathways east", start: "2026-10-28", finish: "2026-11-03", duration: 5, total_float: 3 },
  { id: "A1130", name: "Underground inspection (hold point)", start: "2026-11-05", finish: "2026-11-05", duration: 1, total_float: 0 },
  { id: "A1200", name: "Slab pour", start: "2026-11-09", finish: "2026-11-13", duration: 5, total_float: 0 },
];
const FA = { action: "2701 – Inspections: Fire alarm underground pathway inspection (A1120a/A1120b, at the A1130 hold point) on 2026-11-05 is not yet requested.", owner: "Priya", due: "2026-11-02" };

describe("0.8.20 OVERDUE is against today in the job's zone, not the data date", () => {
  const items = ["2026-10-14", "2026-10-21", "2026-10-23", "2026-10-28", "2026-10-30"].map((due, i) => ({ action: `Item ${i}`, owner: "PM", due }));
  const m = lookaheadModel("2026-11-09", "2026-11-20", A2701, items, { today: "2026-10-21", dataDate: "2026-11-02" });
  it("only items due before today are overdue; due today is DUE TODAY", () => {
    expect(m.asOf).toBe("2026-10-21");
    expect(m.overdue.map((e) => e.item.due)).toEqual(["2026-10-14"]);
    expect(m.entries.find((e) => e.item.due === "2026-10-21")).toMatchObject({ overdue: false, dueToday: true });
    expect(m.counts.overdue).toBe(1);
  });
  it("future sent dates are still checked against today", () => {
    const f = lookaheadModel("2026-11-09", "2026-11-20", A2701, [{ action: "RFI-9 sent 2026-10-25" }], { today: "2026-10-21", dataDate: "2026-11-02" });
    expect(f.entries[0].flags[0]?.kind).toBe("bad_date");
  });
});

describe("0.8.20 date mismatch: try every matched activity", () => {
  it("FA inspection naming A1120a/A1120b and A1130 links the A1130 hold point, no false mismatch", () => {
    expect(linkedActivity(FA, A2701)?.id).toBe("A1130");
    const m = lookaheadModel("2026-11-09", "2026-11-20", A2701, [FA], { today: "2026-10-21", dataDate: "2026-11-02" });
    expect(m.entries[0].flags).toEqual([]);
  });
  it("still flags when no matched activity has the item's date", () => {
    const bad = { ...FA, action: FA.action.replace("2026-11-05", "2026-11-18") };
    const m = lookaheadModel("2026-11-09", "2026-11-20", A2701, [bad], { today: "2026-10-21" });
    expect(m.entries[0].a?.id).toBe("A1130");
    expect(m.entries[0].flags.find((f) => f.kind === "date_mismatch")?.text).toMatch(/Item says Nov 18, 2026; schedule A1130/);
  });
});
