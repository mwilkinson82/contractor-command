import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({ scope: "full" as "full" | "super" | "contract", leader: true, rpcs: [] as [string, Record<string, unknown>][], revoke: null as unknown }));
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message: string }) => { throw new Error(e.message); },
}));
vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job. Your role can't do it.",
  READ_ONLY_MESSAGE: "Your role has a limited, read-only view of this job (no financials).",
  audit: async () => {},
  prefix: () => "2701 – ",
  named: (job: { job_number?: string; name?: string | null }) =>
    job?.name && job.job_number && job.name.startsWith(job.job_number) ? job.name : `${job?.job_number ?? ""} – ${job?.name ?? ""}`.trim(),
  resolveCompany: async () => "11111111-1111-4111-8111-111111111111",
  resolveJob: async () => ({ job_id: "22222222-2222-4222-8222-222222222222", job_number: "2701", name: "Harbor", company_id: "11111111-1111-4111-8111-111111111111", scope: state.scope }),
}));
vi.mock("./visible", () => ({ guide: (r: Record<string, unknown>, ...g: string[]) => ({ ...r, guidance: g }) }));
function fakeSb() {
  return { rpc: async (f: string, a: Record<string, unknown>) => {
    state.rpcs.push([f, a]);
    if (f === "mcp_is_company_leader") return { data: state.leader, error: null };
    if (f === "mcp_report_share_create") return { data: { id: "s1", show_money: state.scope === "full" }, error: null };
    if (f === "mcp_report_share_revoke") return { data: state.revoke, error: null };
    if (f === "mcp_board_link_create") return { data: { id: "link-1" }, error: null };
    return { data: null, error: null };
  } };
}

import { reportPageLink, reportPageShare, reportPageShareRevoke } from "./tools/report-page-tools";
import { jobLinksMissingToken } from "./board-url";
import { delayLabel, esc, pageAllowed, pageUrl, renderReportBody, renderReportDocument, shareTokenFromLink, REPORT_PAGE_HEADERS, PERMANENT_LINK_ASK } from "../report-pages";
import { openReportShare } from "../report-page-share.server";
type H = (a: Record<string, unknown>, c: unknown) => Promise<{ content: { text: string }[]; structuredContent: Record<string, unknown>; guidance: string[] }>;
const call = (t: unknown, a: Record<string, unknown>) => (t as { handler: H }).handler(a, {});
const JOB = "22222222-2222-4222-8222-222222222222", CO = "11111111-1111-4111-8111-111111111111";
const TOKEN = "A".repeat(43);

const sched = { page: "schedule" as const, job_number: "2701", job_name: "Harbor <script>", report: { found: true, version: 3, scope: "super", data_date: "2026-11-02", updated_at: "2026-10-20T10:00:00Z", data: {
    tia: { fragnet: "D1060", prior_completion: "2026-11-26", updated_completion: "2026-12-17" },
    activities: [
      { id: "A1000", name: "Mobilize", start: "2026-10-01", finish: "2026-10-05", critical: true, total_float: 0 },
      { id: "D1060", name: "Engineer redesign delay fragnet", start: "2026-10-06", finish: "2026-10-27", critical: true, total_float: 0 },
      { id: "A1100", name: "Trim", start: "2026-10-06", finish: "2026-10-10", critical: false, total_float: 5 },
    ] } } };

beforeEach(() => { state.scope = "full"; state.leader = true; state.rpcs = []; state.revoke = null; });

describe("0.8.14 report_page_link", () => {
  it("returns the private meetathena page for the job, and says it's private", async () => {
    const r = await call(reportPageLink, { page: "schedule", job_number: "2701" });
    expect(String(r.structuredContent.url)).toMatch(new RegExp(`^https://app\\.meetathena\\.io/r/job/${JOB}/schedule\\?t=`));
    expect(r.structuredContent.private).toBe(true);
    expect(r.content[0].text).toMatch(/works until/i);
    expect(r.content[0].text).not.toContain("<!doctype html");
    expect(String(r.structuredContent.html)).toContain("<!doctype html>");
    expect(String(r.structuredContent.html)).toContain("#1E3A5F");
    expect(String(r.structuredContent.html)).toContain("#1E5FED");
    expect(r.content[0].text).not.toMatch(/lovable|supabase/i);
    expect(jobLinksMissingToken(r)).toEqual([]);
  });
  it("maps items, ior, and field to their own signed paths", async () => {
    const items = await call(reportPageLink, { page: "items board", job_number: "2701" });
    const ior = await call(reportPageLink, { page: "ior", job_number: "2701" });
    const field = await call(reportPageLink, { page: "field", job_number: "2701" });
    expect(String(items.structuredContent.url)).toMatch(/\/items\?t=/);
    expect(String(ior.structuredContent.url)).toMatch(/\/ior\?t=/);
    expect(String(field.structuredContent.url)).toMatch(/\/field\?t=/);
    expect(String(items.structuredContent.url)).not.toContain("/ior");
    expect(jobLinksMissingToken(items)).toEqual([]);
    expect(jobLinksMissingToken(ior)).toEqual([]);
    expect(jobLinksMissingToken(field)).toEqual([]);
  });
  it("supers get the schedule page, never the IOR; contract scope gets neither", async () => {
    state.scope = "super";
    await expect(call(reportPageLink, { page: "schedule", job_number: "2701" })).resolves.toBeTruthy();
    await expect(call(reportPageLink, { page: "ior", job_number: "2701" })).rejects.toThrow(/read-only/);
    state.scope = "contract";
    await expect(call(reportPageLink, { page: "schedule", job_number: "2701" })).rejects.toThrow(/full access/);
  });
  it("portfolio is owners and leadership only", async () => {
    expect((await call(reportPageLink, { page: "portfolio" })).structuredContent.url).toBe(`https://app.meetathena.io/r/portfolio/${CO}`);
    state.leader = false;
    await expect(call(reportPageLink, { page: "portfolio" })).rejects.toThrow(/owners and leadership/);
  });
});

describe("0.8.14 report_page_share (off by default)", () => {
  it("needs confirmation, stores only the hash, returns /r/s/<token>", async () => {
    await expect(call(reportPageShare, { page: "ior", job_number: "2701", confirmed: false })).rejects.toThrow(/Confirm/);
    const r = await call(reportPageShare, { page: "ior", job_number: "2701", confirmed: true });
    const link = r.structuredContent.link as string;
    expect(link).toMatch(/^https:\/\/app\.meetathena\.io\/r\/s\/[A-Za-z0-9_-]{43}$/);
    const [, a] = state.rpcs.find(([f]) => f === "mcp_report_share_create")!;
    expect(a._token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a)).not.toContain(link.split("/").pop());
    const days = (Date.parse(a._expires_at as string) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9); expect(days).toBeLessThan(30.1);
  });
  it("revoke takes the link and reports not found without changing anything", async () => {
    await expect(call(reportPageShareRevoke, { link: "https://x/r/s/bad" })).rejects.toThrow(/isn't an Athena/);
    await expect(call(reportPageShareRevoke, { link: `https://app.meetathena.io/r/s/${TOKEN}` })).rejects.toThrow(/Nothing was changed/);
    state.revoke = { id: "s1", page: "ior" };
    expect((await call(reportPageShareRevoke, { link: `https://app.meetathena.io/r/s/${TOKEN}` })).structuredContent.revoked).toBe(true);
  });
});

describe("0.8.14 page rules and rendering", () => {
  it("access mirror", () => {
    expect(pageAllowed("ior", "full", false)).toBe(true);
    expect(pageAllowed("ior", "super", true)).toBe(false);
    expect(pageAllowed("schedule", "super", false)).toBe(true);
    expect(pageAllowed("schedule", "contract", true)).toBe(false);
    expect(pageAllowed("portfolio", "full", false)).toBe(false);
    expect(() => pageUrl("ior", "../x")).toThrow();
    expect(shareTokenFromLink(`https://app.meetathena.io/r/s/${TOKEN}?x=1`)).toBe(TOKEN);
  });
  it("delay label matches the chart callout and notice (2701: +15 WD (21 CD))", () => {
    expect(delayLabel("2026-11-26", "2026-12-17")).toBe("Delay: +15 WD (21 CD)");
  });
  it("schedule: escapes, red only on the delay, fragnet wording, both units, no vendor names", () => {
    const h = renderReportBody(sched);
    expect(h).toContain("Harbor &lt;script&gt;");
    expect(h).not.toContain("<script>");
    expect(h).toContain("Delay: +15 WD (21 CD)");
    expect(h).toContain("Delay fragnet D1060");
    expect(h).not.toMatch(/fragment|lovable|supabase/i);
    expect(h).not.toMatch(/#(?:F43F5E|EC4899|F97316)/i);
    expect(h).not.toContain("$");
  });
  it("IOR with money for full scope; portfolio flags delays", () => {
    const ior = renderReportBody({ page: "ior", job_number: "2701", job_name: "Harbor", report: { found: true, version: 1, scope: "full", contract_total: 1400000, forecast_total: 1400000, data: { kpis: { gp_pct: "12.5%", contract: 1400000 }, risks: [{ risk: "Switchgear", exposure: 25000 }] } } });
    expect(ior).toContain("Forecast $1,400,000.00 = contract $1,400,000.00");
    expect(ior).toContain("$25,000.00");
    const pf = renderReportBody({ page: "portfolio", company: "ALP", money: true, jobs: [{ job_id: JOB, job_number: "2701", name: "Harbor", cpm: { version: 3, contract_total: 1400000, tia: { prior_completion: "2026-11-26", updated_completion: "2026-12-17" } } }] });
    expect(pf).toContain("Needs attention");
    expect(pf).toContain("$1,400,000.00");
    expect(renderReportBody({ page: "ior", report: { found: false } })).toContain("Nothing saved yet");
    const named = "a4634d00-0000-4000-8000-000000000009";
    const dumped = renderReportBody({
      page: "ior",
      job_number: "2701",
      job_name: "Harbor Point Medical Office Building – Electrical",
      names: { items: [{ id: named, action: "Price the switchgear delay" }], people: [{ id: "11111111-1111-4111-8111-111111111111", name: "Marshall Wilkinson" }] },
      report: {
        found: true, version: 3, scope: "full", updated_by_name: "Marshall (Owner)",
        data: {
          title: "Job 2701 IOR — risk allocation",
          open_item_ref: "A4634D",
          source_cpm_version: 3,
          budget_profit_basis: { source: "Marshall's correction", gross_profit: 226000 },
          billing_timing_exposure: { amount: 140000, activity: "A1210" },
          risk_allocations: [{ name: "Marshall-directed risk allowance", amount: 10000 }],
        },
      },
    });
    expect(dumped).toContain("Price the switchgear delay");
    expect(dumped).not.toContain("A4634D");
    expect(dumped).not.toContain("Source CPM version");
    expect(dumped).not.toContain("$3.00");
    expect(dumped).toContain("$226,000.00");
    expect(dumped).not.toMatch(/\{&quot;|{"source"/);
    expect(dumped).toContain("#1E3A5F");
    expect(dumped).toContain("#1E5FED");
    expect(dumped).toContain("Marshall-directed risk allowance");
    expect(esc(`"'&`)).toBe("&quot;&#39;&amp;");
  });
  it("formats job 2701 margins as percents and hides internal IOR fields", () => {
    const html = renderReportBody({
      page: "ior",
      job_number: "2701",
      job_name: "Harbor Point",
      report: {
        found: true,
        version: 4,
        scope: "full",
        contract_total: 1400000,
        forecast_total: 1400000,
        data: {
          audience: "internal",
          source_cpm_version: 3,
          allocation_status: "draft",
          budgeted_margin: 0.161,
          margin_if_fully_incurred: 0.14714285714285713,
          billing: "10,000 / 8,000",
          plan: 10000,
          risk_allocations: [{ id: "IOR-01", description: "Switchgear delay holds the gear", amount: 10000, allocation_status: "open" }],
          top_three_actions: [{ id: "IOR-02", action: "Price the ceiling conflict", owner: "Elena Brooks", status: "open" }],
          risks: [{ id: "IOR-03", description: "Storm line conflict", exposure: 25000, status: "risk" }],
        },
      },
    });
    expect(html).toContain("16.1%");
    expect(html).toContain("14.7%");
    expect(html).not.toContain("$0.16");
    expect(html).not.toContain("0.14714285714285713");
    expect(html).toContain("$10,000.00 / $8,000.00");
    expect(html).toContain("$10,000.00");
    expect(html).toContain("Switchgear delay holds the gear");
    expect(html).toContain("Price the ceiling conflict");
    expect(html).toContain("Storm line conflict");
    expect(html).not.toContain("IOR-01");
    expect(html).not.toContain("IOR-02");
    expect(html).not.toContain("IOR-03");
    expect(html).not.toContain("Audience");
    expect(html).not.toContain("Source CPM version");
    expect(html).not.toMatch(/Allocation [Ss]tatus/);
    expect(html).not.toContain(">Id<");
    expect(html).toContain("#1E3A5F");
    expect(html).toContain("#1E5FED");
    const allocations = html.slice(html.indexOf("Risk allocations"), html.indexOf("Top three actions"));
    expect(allocations).not.toContain("#DC2626");
    const storm = html.slice(html.indexOf("Storm line conflict") - 200, html.indexOf("Storm line conflict") + 80);
    expect(storm).toContain("#DC2626");
  });
});

describe("0.8.14 share page route", () => {
  it("bad token 404, unknown/expired 410, live link renders with strict headers; HEAD never counts", async () => {
    expect((await openReportShare("nope", "GET", async () => null)).status).toBe(404);
    expect((await openReportShare(TOKEN, "GET", async () => null)).status).toBe(410);
    let calls = 0;
    const ok = await openReportShare(TOKEN, "GET", async (h) => { calls++; expect(h).toMatch(/^[0-9a-f]{64}$/); return { ...sched, shared: true, expires_at: "2026-11-19T00:00:00Z" }; });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await ok.text()).toContain("Shared view · link works until 2026-11-19");
    await openReportShare(TOKEN, "HEAD", async () => { calls++; return null; });
    expect(calls).toBe(1);
    expect(REPORT_PAGE_HEADERS["x-robots-tag"]).toBe("noindex");
    expect(renderReportDocument(sched)).toMatch(/^<!doctype html>/);
  });
});

describe("0.8.14 guidance and migration", () => {
  it("living_report_get/save offer the job board links; server instructions mention report_page_link", () => {
    const src = readFileSync("src/lib/mcp/tools/living-tools.ts", "utf8");
    expect(src).toContain("PERMANENT_LINK_ASK");
    expect(PERMANENT_LINK_ASK).toBe("Want the job board links I keep updated? Items (/items), the IOR (/ior), the field board (/field), and the schedule.");
    expect(PERMANENT_LINK_ASK.toLowerCase()).not.toContain("permanent");
    expect(readFileSync("src/lib/mcp/index.ts", "utf8")).toMatch(/reportPageLink, reportPageShare, reportPageShareRevoke[,\]]/);
  });
  it("migration is additive, hash-only, anon only on the open function, not applied", () => {
    const m = readFileSync("supabase/migrations/20261021120000_athena_report_pages.sql", "utf8");
    expect(m).toMatch(/NOT APPLIED/);
    expect(m).not.toMatch(/\bDROP (TABLE|FUNCTION|COLUMN)\b|\bDELETE FROM\b|\bTRUNCATE\b/i);
    expect(m).toMatch(/token_hash text NOT NULL UNIQUE/);
    expect(m.match(/TO anon/g)?.length).toBe(1);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.mcp_report_share_open\(text\) TO anon, authenticated/);
    expect(m).toMatch(/REVOKE ALL ON public\.mcp_report_shares FROM anon, authenticated, public/);
  });
});


describe("0.8.14 page refresh", () => {
  it("refreshes only while visible and skips the full read when the stamp is unchanged", () => {
    const c = readFileSync("src/components/athena/ReportPage.tsx", "utf8");
    expect(c).toMatch(/document\.visibilityState === "visible"/);
    expect(c).toMatch(/refetchInterval: visible \? REFRESH_MS : false/);
    expect(c).toMatch(/mcp_report_page_stamp/);
    expect(c).toMatch(/prev\.stamp === stamp\) return prev/);
    const m = readFileSync("supabase/migrations/20261021120000_athena_report_pages.sql", "utf8");
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.mcp_report_page_stamp\(text, uuid, uuid\) TO authenticated;/);
  });
});
