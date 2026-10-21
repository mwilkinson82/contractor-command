import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderReportBody, pageUrl, pageAllowed, JOB_PAGES, REPORT_PAGES } from "../report-pages";
import { payAppView, briefingView, emptyCard, lookaheadView, SHOW_AS_IS } from "./styled-views";
import { resolveCompany, MULTI_COMPANY_ASK, _resetCurrentCompanyCache } from "./jobs";

const JOB = "11111111-1111-4111-8111-111111111111";
const acts = [
  { id: "A1020", name: "Submit long-lead gear", start: "2026-10-19", finish: "2026-10-28", duration: 8, total_float: 0 },
  { id: "A1130", name: "Underground inspection (hold point)", start: "2026-11-05", finish: "2026-11-05", duration: 1, total_float: 18 },
];
const items = [{ action: "Underground electrical inspection on 2026-11-05 is not yet requested", owner: "Marcus Hale", due: "2026-11-02" }];
const billing = { billed_to_date: 0, months: [{ month: "2026-11", amount: 400000, kind: "forecast" as const }, { month: "2026-12", amount: 1000000, kind: "forecast" as const }] };

describe("hosted pages: lookahead, payapp, briefing", () => {
  it("URLs and access", () => {
    expect(pageUrl("lookahead", JOB)).toBe(`https://app.meetathena.io/r/job/${JOB}/lookahead`);
    expect(pageUrl("payapp", JOB)).toBe(`https://app.meetathena.io/r/job/${JOB}/payapp`);
    expect(pageUrl("briefing", JOB)).toBe(`https://app.meetathena.io/r/job/${JOB}/briefing`);
    expect(JOB_PAGES).toEqual(["ior", "schedule", "lookahead", "payapp", "briefing"]);
    expect(REPORT_PAGES).toEqual(["ior", "schedule", "portfolio"]); // share links unchanged
    expect(pageAllowed("payapp", "super", false)).toBe(false);
    expect(pageAllowed("lookahead", "super", false)).toBe(true);
    expect(pageAllowed("briefing", "contract", false)).toBe(false);
  });
  it("lookahead page: window from CPM, calendar, risk card, escaped", () => {
    const h = renderReportBody({ page: "lookahead", job_number: "2701", job_name: "Harbor <Point>", lookahead: null, report: { found: true, data_date: "2026-10-19", data: { activities: acts as never } }, items });
    expect(h).toContain("Two-Week Lookahead");
    expect(h).toContain("Harbor &lt;Point&gt;");
    expect(h).toContain("Window Oct 26, 2026 – Nov 6, 2026");
    expect(h).toContain("TOP 3 PRIORITIES");
    expect(h).toContain("CALENDAR");
    expect(h).toContain("#2563EB");
    expect(h).toContain("RISKS");
  });
  it("lookahead page empty state has a Next move", () => {
    expect(renderReportBody({ page: "lookahead", lookahead: null, report: { found: false }, items: [] })).toContain("Next move:");
  });
  it("pay app page ties to the contract; empty state has a Next move", () => {
    const h = renderReportBody({ page: "payapp", job_number: "2701", report: { found: true, version: 1, contract_total: 1400000, data: { billing } } });
    expect(h).toContain("Forecast total $1,400,000.00 = contract $1,400,000.00");
    expect(h).toContain("MONTHLY BILLING");
    expect(renderReportBody({ page: "payapp", report: { found: false } })).toContain("Next move:");
  });
  it("briefing page buckets overdue / today / next 7", () => {
    const h = renderReportBody({ page: "briefing", job_number: "2701", today: "2026-10-21", items: [{ action: "Late one", due: "2026-10-14" }, { action: "Today one", due: "2026-10-21" }, { action: "Soon", due: "2026-10-25" }] });
    expect(h).toContain("OVERDUE");
    expect(h).toContain("DUE TODAY");
    expect(h).toContain("NEXT 7 DAYS");
  });
});

describe("chat views: link first, then the finished view", () => {
  it("pay app view", () => {
    const v = payAppView({ title: "2701 – Harbor Point", version: 2, billing, contract: 1400000, pageUrl: pageUrl("payapp", JOB) });
    expect(v.split("\n")[0]).toBe(`Styled pay app (always current, private to your company): ${pageUrl("payapp", JOB)}`);
    expect(v).toContain(SHOW_AS_IS);
    expect(v).toContain("**Forecast total $1,400,000.00 = contract $1,400,000.00**");
    expect(v).toMatch(/\| Nov 2026 \| ⚪ Forecast \| \$400,000.00 \| \$400,000.00 \|/);
  });
  it("empty pay app card leads with the link and ends with a Next move", () => {
    const v = emptyCard("pay_app", "2701 – Harbor Point", "Send the billed-to-date figure.", ["Billed to date"], pageUrl("payapp", JOB));
    expect(v.split("\n")[0]).toContain("/payapp");
    expect(v).toMatch(/\*\*Next move:\*\* Send/);
  });
  it("briefing view", () => {
    const v = briefingView({ title: "2701 – Harbor Point", today: "2026-10-21", items: [{ action: "Late one", owner: "Elena", due: "2026-10-14" }], pageUrl: pageUrl("briefing", JOB) });
    expect(v.split("\n")[0]).toContain("Styled morning briefing");
    expect(v).toContain("### Overdue");
    expect(v).toMatch(/\*\*Next move:\*\* Elena closes "Late one" today\./);
  });
  it("lookahead view links to the lookahead page", () => {
    const v = lookaheadView({ title: "2701", ref: "LA-1", start: "2026-10-26", end: "2026-11-06", dataDate: "2026-10-19", acts, items, pageUrl: pageUrl("lookahead", JOB) });
    expect(v.split("\n")[0]).toContain("/lookahead");
  });
});

describe("migration (not applied)", () => {
  const sql = readFileSync("supabase/migrations/20261021210000_athena_report_pages_lookahead_payapp_briefing.sql", "utf8");
  it("adds the pages to both functions, keeps access rules, no shares, no data changes", () => {
    expect(sql).toMatch(/NOT APPLIED/);
    expect(sql.match(/'ior', 'schedule', 'lookahead', 'payapp', 'briefing'/g)?.length).toBe(2);
    expect(sql).toContain("'payapp' THEN 'billing_forecast'");
    expect(sql).toContain("_page IN ('ior', 'payapp') AND sc <> 'full'");
    expect(sql).toContain("NOT _super OR coalesce(i.internal_only, false) = false");
    expect(sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE|INSERT|UPDATE)\b/);
    expect(sql).not.toContain("mcp_report_shares");
  });
});

describe("current company is remembered", () => {
  beforeEach(() => _resetCurrentCompanyCache());
  const mk = (saved: string | null) => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const sb = {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
      rpc,
      from: (t: string) => t === "mcp_companies"
        ? { select: async () => ({ data: [{ id: "c1", name: "ALP Construction" }, { id: "c2", name: "TEST Ridgeline" }], error: null }) }
        : { select: () => ({ maybeSingle: async () => ({ data: saved ? { current_company: saved } : null, error: null }) }) },
    };
    return { sb: sb as never, rpc };
  };
  it("naming a company saves it as current", async () => {
    const { sb, rpc } = mk(null);
    expect(await resolveCompany(sb, "TEST Ridgeline")).toBe("c2");
    expect(rpc).toHaveBeenCalledWith("mcp_set_current_company", { _company: "c2" });
  });
  it("uses the saved company without asking", async () => {
    const { sb } = mk("c1");
    expect(await resolveCompany(sb)).toBe("c1");
  });
  it("asks once, saying it will remember", async () => {
    const { sb } = mk(null);
    await expect(resolveCompany(sb)).rejects.toThrow(MULTI_COMPANY_ASK);
  });
});

import { lookaheadWindow, dataDateRule } from "./styled-views";
import { deliverableProblems, draftCardText, draftKey, emailRules, EMAIL_DELIVERABLE_RULE } from "./email-safety";

describe("lookahead window comes from the CPM data date", () => {
  it("2701: CPM 2026-10-19 → Oct 26 – Nov 6, even with a stale Nov 2–13 saved window", () => {
    const w = lookaheadWindow({ start_date: "2026-11-02", end_date: "2026-11-13" }, "2026-10-19")!;
    expect([w.start, w.end, w.source]).toEqual(["2026-10-26", "2026-11-06", "cpm"]);
    expect(w.note).toMatch(/doesn't match the CPM data date; this view uses the CPM data date Oct 19, 2026/);
  });
  it("saved window only when no CPM", () => {
    expect(lookaheadWindow({ start_date: "2026-11-02", end_date: "2026-11-13" }, null)?.source).toBe("saved");
    expect(lookaheadWindow(null, null)).toBeNull();
  });
  it("hosted page uses the CPM window too", () => {
    const h = renderReportBody({ page: "lookahead", lookahead: { id: "x", start_date: "2026-11-02", end_date: "2026-11-13" }, report: { found: true, data_date: "2026-10-19", data: { activities: acts as never } }, items: [] });
    expect(h).toContain("Window Oct 26, 2026 – Nov 6, 2026");
  });
  it("data date rule forbids change-log dates", () => {
    expect(dataDateRule("2026-10-19", 3)).toMatch(/2026-10-19 \(saved CPM v3\).*including emails; never a date from a change-log note/);
  });
});

describe("email deliverables: attached PDF first, file_share link second, never HTML", () => {
  const base = { to: "pm@example.test", cc: [], subject: "2701 lookahead", body: "Hi Jordan, the lookahead for Oct 26 – Nov 6 is attached." };
  it("attached PDF passes and shows on the card", () => {
    const d = { ...base, body: `${base.body}\nhttps://app.meetathena.io/f/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde`, link: "https://app.meetathena.io/f/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde", attachment: "2701-lookahead.pdf" };
    expect(deliverableProblems(d)).toEqual([]);
    expect(draftCardText(d, {})).toContain("Attachment: 2701-lookahead.pdf");
    expect(draftKey(d)).not.toBe(draftKey(base));
  });
  it("HTML attachment or 'open in a browser' is refused", () => {
    expect(deliverableProblems({ ...base, attachment: "lookahead.html" })[0]).toMatch(/must be a PDF/);
    expect(deliverableProblems({ ...base, attachment: "x.pdf", body: "Open the HTML file in your browser." }).join(" ")).toMatch(/HTML file in a browser/);
    expect(deliverableProblems({ ...base, body: "See link", link: "https://x.test/l.html" })[0]).toMatch(/HTML/);
  });
  it("'attached' without an attachment is refused; file_share link without 'attached' passes", () => {
    expect(deliverableProblems(base)[0]).toMatch(/says "attached" but nothing is attached/);
    expect(deliverableProblems({ ...base, body: "The lookahead PDF is at the link below.\nhttps://app.meetathena.io/f/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde", link: "https://app.meetathena.io/f/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde" })).toEqual([]);
  });
  it("the deliverable order rides on every email result", () => {
    expect(emailRules({})).toContain(EMAIL_DELIVERABLE_RULE);
    expect(EMAIL_DELIVERABLE_RULE).toMatch(/\(1\) Get a real file from Athena: lookahead_pdf.*\(2\) If your email tool can attach a file from that URL.*\(3\) If it can't attach from a URL.*never "attached"/);
  });
});

import { pickLatestLookahead } from "./styled-views";
import { EMAIL_CARD_RULE, signatureProblem } from "./email-safety";

describe("latest non-empty lookahead", () => {
  it("2701: picks LA-31BE8 (6 items) over the empty LA-37D09 in the same window", () => {
    const rows = [
      { id: "37d093e2", start_date: "2026-10-26", end_date: "2026-11-06", created_at: "2026-10-20T15:12:00Z", items: 0 },
      { id: "31be8a04", start_date: "2026-10-26", end_date: "2026-11-06", created_at: "2026-10-20T14:10:00Z", items: 6 },
      { id: "a01414c3", start_date: "2026-10-19", end_date: "2026-10-30", created_at: "2026-10-20T13:00:00Z", items: 0 },
    ];
    expect(pickLatestLookahead(rows)?.id).toBe("31be8a04");
    expect(pickLatestLookahead(rows.map((r) => ({ ...r, items: 0 })))?.id).toBe("37d093e2");
    expect(pickLatestLookahead([])).toBeNull();
  });
  it("hosted page function prefers lookaheads with items and hides merged ones", () => {
    const sql = readFileSync("supabase/migrations/20261021210000_athena_report_pages_lookahead_payapp_briefing.sql", "utf8");
    expect(sql).toContain("ORDER BY NOT EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.lookahead_id = l.id)");
    expect(sql).toContain("NOT IN ('setup', 'merged')");
  });
  it("data script retires LA-37D09 as merged, backed up, guarded, unapplied", () => {
    const sql = readFileSync("supabase/scripts/2701_reseed_fix_UNAPPLIED.sql", "utf8");
    expect(sql).toMatch(/NOT APPLIED/);
    expect(sql).toContain("_bak_20261021_2701_lookaheads");
    expect(sql).toMatch(/'kind', 'merged', 'merged_into', '31be8a04-2867-4a20-9e19-3e6874111a2c'/);
    expect(sql).not.toMatch(/^\s*DELETE\b/im);
  });
});

describe("email card and signature", () => {
  it("card must show in the chat, not only in the permission prompt", () => {
    expect(EMAIL_CARD_RULE).toMatch(/show this draft in the chat as a styled email card or artifact first \(To, Cc, Subject, the full body, and an Attachment line/);
    expect(EMAIL_CARD_RULE).toMatch(/Never show it only inside the permission prompt/);
  });
  const pm = { name: "Elena Brooks", signature: "Elena Brooks, Project Manager, ALP Construction" };
  it("defaults to the job's PM, not the person chatting", () => {
    expect(signatureProblem("Hi Jordan,\n...\nThanks,\nMarshall Wilkinson", pm, null)).toMatch(/Sign the email as the job's PM: Elena Brooks, Project Manager, ALP Construction/);
    expect(signatureProblem("Hi Jordan,\n...\nThanks,\nElena Brooks\nProject Manager", pm, null)).toBeNull();
  });
  it("sign_as only when the member asked", () => {
    expect(signatureProblem("Thanks,\nMarshall Wilkinson", pm, "Marshall Wilkinson")).toBeNull();
    expect(signatureProblem("Thanks", null, null)).toBeNull();
  });
});

describe("company list defaults to the current company", () => {
  beforeEach(() => _resetCurrentCompanyCache());
  it("lists only the current company's jobs and names the others", async () => {
    const { listCompaniesAndJobs } = await import("./tools/workflow-tools");
    const sb = {
      auth: { getUser: async () => ({ data: { user: { id: "u9" } } }) },
      rpc: async () => ({ data: null, error: null }),
      from: (t: string) => t === "mcp_companies"
        ? { select: async () => ({ data: [{ id: "c1", name: "ALP Construction" }, { id: "c2", name: "TEST Ridgeline" }], error: null }) }
        : t === "mcp_user_settings"
          ? { select: () => ({ maybeSingle: async () => ({ data: { current_company: "c1" }, error: null }) }) }
          : { select: () => ({ in: async (_c: string, ids: string[]) => ({ data: [{ job_number: "2701", name: "Harbor Point", company_id: "c1" }, { job_number: "9001", name: "Ridge", company_id: "c2" }].filter((j) => ids.includes(j.company_id)), error: null }) }) },
    };
    const out = await listCompaniesAndJobs(sb as never);
    expect(out).toContain("ALP Construction: 2701");
    expect(out).not.toContain("9001");
    expect(out).toContain("Also yours: TEST Ridgeline");
  });
});
