import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boardSignInReturn } from "@/lib/board-sign-in";
import { boardPageFor } from "@/lib/mcp/board-url";
import { startedWithJobsCard } from "@/lib/mcp/getting-started";
import { renderHtml } from "@/lib/mcp/cards/html";
import { overviewPayments, overviewContract } from "@/lib/project-overview";
import { supabase } from "@/integrations/supabase/client";
import { estimateOverview } from "@/lib/job-board-commercial";
import { emptyBoard } from "@/lib/selections/model";

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  signedIn: true,
  queries: [] as { queryKey: string[]; enabled?: boolean; queryFn: () => Promise<unknown> }[],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[]; queryFn: () => Promise<unknown> }) => {
    fixture.queries.push(opts);
    return (
      fixture.rows[opts.queryKey[2] ?? "jobs"] ?? { data: undefined, isLoading: false, error: null }
    );
  },
}));
vi.mock("@/lib/board-link.functions", () => ({ openBoardPage: vi.fn() }));
// The notices pieces have their own tests; here they render nothing so the board's own reads stay exact.
const mark = vi.hoisted(
  () => (name: string) => () => React.createElement("i", { "data-mount": name }),
);
vi.mock("@/components/athena/JobHomeWhatsNew", () => ({
  JobHomeNotifications: mark("panel"),
  NotificationsBell: mark("bell"),
  NotificationsNavLink: mark("nav"),
}));
vi.mock("@/components/athena/JobHomeChangeOrders", () => ({ JobHomeChangeOrders: mark("cos") }));
vi.mock("@/components/athena/JobHomeMessages", () => ({ JobHomeMessages: mark("messages") }));
vi.mock("@/components/athena/JobNoticeEmailSettings", () => ({
  JobNoticeEmailSettings: mark("emails"),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: fixture.signedIn ? { user: { id: "member" } } : null,
    loading: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("./ReportPage", () => ({ usePageVisible: () => true }));
vi.mock("./BoardSignIn", () => ({
  BoardSignIn: ({ returnTo }: { returnTo: string }) =>
    React.createElement("div", null, `Sign in: ${returnTo}`),
}));
import { JobHome, hideAmounts, iorFigures } from "./JobHome";
import { ProjectHomeLinks } from "./ProjectHomeLinks";
const job = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const ok = (data: unknown) => ({ data, isLoading: false, error: null });

beforeEach(() => {
  fixture.signedIn = true;
  fixture.queries = [];
  fixture.rows = {
    field: ok({
      page: "field",
      scope: "full",
      job_number: "QA-1",
      job_name: "Fixture",
      company: "Builder",
      items: [
        { id: "1", action: "Follow up AJ", check_key: "manual:1" },
        { id: "2", action: "Follow up supplier", check_key: "manual:2" },
      ],
    }),
    schedule: ok({
      page: "schedule",
      report: { found: true, data: { activities: [{ id: "A" }, { id: "B" }] } },
    }),
    lookahead: ok({ page: "lookahead", report: { found: false }, lookahead: null }),
    submittals: ok({ page: "submittals", submittals: [] }),
    daily: ok({ page: "daily", found: false }),
    payapp: { data: undefined, isLoading: false, error: new Error("unavailable") },
    ior: ok({ page: "ior", report: { found: false } }),
    jobs: ok([
      { id: job, job_number: "QA-1", name: "Fixture" },
      { id: other, job_number: "QA-2", name: "Other" },
    ]),
  };
});

const finance = () => ({
  contract: overviewContract(
    [{ module: "setup", key: "contract_value", value: 12345 }],
    null,
    null,
  ),
  payments: overviewPayments(
    { currency: "USD", invoices: [], receipts: [], allocations: [], receipt_reversals: [] },
    job,
    new Date("2026-10-30T12:00:00Z"),
  ),
});

describe("approved project overview", () => {
  it("shows source bases, honest unknowns, due dates and canonical review routes", () => {
    fixture.rows.financial = ok(finance());
    fixture.rows.communications = ok([]);
    fixture.rows.field = ok({
      page: "field",
      scope: "full",
      items: [
        {
          id: "request-1",
          action: "Synthetic question",
          owner: "PM",
          due: "2026-11-01",
          type: "rfi",
        },
      ],
    });
    const html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(html).toContain("$12,345.00");
    expect(html).toContain("Source: job setup");
    expect(html).toContain("Unknown");
    expect(html).toContain("Inception through Oct 30, 2026");
    expect(html).toContain("Unapplied receipts");
    expect(html).toContain("Recorded retainage held");
    expect(html).toContain("Due 2026-11-01");
    expect(html).toContain("Review RFI date");
    expect(html).toContain("No matching communication records");
    // Board buttons only copy an ask for Athena chat or open a saved PDF; nothing submits.
    expect(html).not.toMatch(
      /<button(?![^>]*type="button")|<form|datetime-local|type="date"|calendar.google/,
    );
    // Estimate, proposal and contracts show on the board, and a failed read is never shown as empty.
    expect(html).toContain('id="estimate"');
    expect(html).toContain('id="contracts"');
    expect(html).toContain("Contracts are unavailable right now. Nothing is assumed empty.");
    expect(html).toContain("The estimate is unavailable right now. Nothing is assumed empty.");
    expect(html).toContain('<span class="jh-sr">Saved jobs</span>');
    // Notifications: the bell before the saved-jobs picker, the nav entry after Overview, the panel right after
    // the hero; change orders, client messages and email choices for full access only.
    expect(html).toMatch(
      /class="jh-top-right"><i data-mount="bell"><\/i><label class="jh-select">/,
    );
    expect(html).toMatch(/Overview<\/a><i data-mount="nav"><\/i>/);
    expect(html).toMatch(
      /<\/header><section id="notifications" class="jb-section"><i data-mount="panel"><\/i><\/section>/,
    );
    for (const m of ["cos", "messages", "emails"]) expect(html).toContain(`data-mount="${m}"`);
  });
  it("hides stale private results on source error, sign-out, field scope and denied base", () => {
    fixture.rows.financial = { ...ok(finance()), error: new Error("denied") };
    fixture.rows.communications = {
      ...ok([{ title: "PRIVATE SUBJECT" }]),
      error: new Error("denied"),
    };
    let html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(html).not.toContain("$12,345");
    expect(html).not.toContain("PRIVATE SUBJECT");
    expect(html).toContain("Currently unavailable");
    fixture.rows.financial = ok(finance());
    for (const scope of ["super", "contract"]) {
      fixture.rows.field = ok({ page: "field", scope, items: [] });
      fixture.queries = [];
      html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
      expect(html).not.toContain("$12,345");
      expect(html).not.toContain("Current contract value");
      expect(html).not.toContain('data-mount="messages"');
      expect(
        fixture.queries
          .filter((q) => ["financial", "communications"].includes(q.queryKey[2]))
          .every((q) => !q.enabled),
      ).toBe(true);
    }
    fixture.signedIn = false;
    fixture.rows.field = ok({ page: "field", scope: "full", items: [] });
    fixture.queries = [];
    html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job, token: "share-token" }));
    expect(html).not.toContain('id="notifications"');
    expect(html).not.toContain("$12,345");
    expect(html).not.toContain("PRIVATE SUBJECT");
    expect(
      fixture.queries
        .filter((q) => ["financial", "communications"].includes(q.queryKey[2]))
        .every((q) => !q.enabled),
    ).toBe(true);
  });
  it("stops financial and communication reads at the canonical server-side denial", async () => {
    renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "denied" },
    } as never);
    await expect(
      fixture.queries.find((q) => q.queryKey[2] === "financial")!.queryFn(),
    ).rejects.toThrow("Financial evidence unavailable");
    await expect(
      fixture.queries.find((q) => q.queryKey[2] === "communications")!.queryFn(),
    ).rejects.toThrow("Communications unavailable");
    expect(
      vi
        .mocked(supabase.rpc)
        .mock.calls.slice(-2)
        .map((call) => call[0]),
    ).toEqual(["mcp_billing_evidence_get", "mcp_report_page_get"]);
  });
});

describe("persistent job home", () => {
  it("opens account saved jobs at the same home while preserving the field destination", () => {
    const list = renderToStaticMarkup(
      React.createElement(ProjectHomeLinks, {
        jobs: [{ id: job, job_number: "QA-1", name: "Fixture" }],
      }),
    );
    expect(list).toContain(`href="/r/job/${job}/home"`);
    expect(list).toContain("Project dashboards");
    expect(list).toContain("Open project dashboard");
    expect(list).not.toContain("Open project home");
    expect(list).not.toContain(`/r/job/${job}/field`);
    const home = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(home).toContain(`href="/r/job/${job}/field"`);
  });
  it("links saved entry and sign-in back to the same stable home", () => {
    const html = renderHtml(
      startedWithJobsCard([{ id: job, job_number: "QA-1", name: "Fixture" }]),
    );
    expect(html).toContain(`/r/job/${job}/home`);
    expect(boardPageFor("Open project board".replace(/^Open /, ""))).toBe("home");
    expect(boardSignInReturn(`/r/job/${job}/home?t=secret&utm_source=chat`)).toBe(
      `/r/job/${job}/home`,
    );
  });
  it("does not turn the overflow guidance into a sixth job link", () => {
    const jobs = Array.from({ length: 6 }, (_, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      job_number: `QA-${i}`,
      name: "Fixture",
    }));
    const rows = startedWithJobsCard(jobs).sections![0].rows;
    expect(rows[4].href).toContain("/home");
    expect(rows[5].href).toBeUndefined();
  });
  it("renders real counts, destinations, empty and unavailable states", () => {
    const html = renderToStaticMarkup(
      React.createElement(JobHome, { jobId: job, token: "test-token" }),
    );
    expect(html).toContain("2 saved activities");
    expect(html).toContain("2 open items");
    expect(html).toContain("0 current submittals");
    expect(html).toContain("No report recorded yet");
    expect(html).toContain("Currently unavailable");
    for (const page of [
      "schedule",
      "lookahead",
      "items",
      "submittals",
      "rfis",
      "rfcs",
      "cos",
      "daily",
      "payapp",
      "ior",
    ])
      expect(html).toContain(`/r/job/${job}/${page}?t=test-token`);
    expect(html).toContain("Saved jobs");
    expect(html).toContain("Indicated Outcome Report");
    expect(html).not.toContain("Items of record");
    expect(html).not.toContain("From your inbox and calendar");

    // Every link sits in a menu group; the overview keeps Marshall's order.
    for (const g of [
      "Overview",
      "Estimate &amp; proposal",
      "Contracts &amp; specs",
      "Schedule",
      "Field",
      "Logs",
      "Money",
      "Project record",
    ])
      expect(html).toContain(`<summary><span>${g}</span>`);
    expect(html).toContain("Change order log");
    expect(html).toContain("Project financials →");
    expect(html).not.toContain("Full accounting evidence");
    expect(html).toContain("Cost budget");
    expect(html).toContain("Indicated gross margin");
    const order = [
      'id="notifications"',
      "Current contract value",
      'id="jh-routines"',
      'id="jh-schedule"',
      "More Athena can do on this job",
      "Dig deeper on this project",
    ].map((t) => html.indexOf(t));
    expect(order.every((at, n) => at > 0 && (n === 0 || at > order[n - 1]))).toBe(true);
    expect(html.match(/Copy Athena prompt/g)?.length).toBe(5);
    expect(html).toContain('aria-label="Phase"');
  });
  it("treats missing payload fields as unavailable instead of an empty record", () => {
    fixture.rows.schedule = ok({ page: "schedule" });
    fixture.rows.daily = ok({ page: "daily" });
    fixture.rows.ior = ok({ page: "ior" });
    const html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(html).not.toContain("No schedule recorded yet");
    expect(html).not.toContain("No report recorded yet");
    expect(html).not.toContain("No IOR recorded yet");
    expect(html.match(/Currently unavailable/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it("does not expose commercial destinations for field scope or cached data after denial", () => {
    fixture.rows.field = ok({ page: "field", scope: "super", job_number: "QA-1", items: [] });
    let html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(html).not.toContain("Payment and billing");
    expect(html).not.toContain("Change orders");
    expect(html).not.toContain("Change order log");
    expect(html).not.toContain("Cost budget");
    expect(html).not.toContain("Prepare the next pay app");
    expect(html).not.toContain("<summary><span>Money</span>");
    expect(html.match(/Copy Athena prompt/g)?.length).toBe(2);
    expect(html).not.toContain("Indicated Outcome Report");
    fixture.rows.field = {
      data: { page: "field", job_name: "Secret" },
      isLoading: false,
      error: new Error("denied"),
    };
    html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(html).toContain("This project is currently unavailable");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Secret");
  });
});

describe("estimate, proposal and contracts on the board", () => {
  const estimate = () =>
    estimateOverview(
      {
        setup: { role: "self_performer", trades: ["Electrical"] },
        takeoff: {
          version: 2,
          lines: [
            { line_no: 1, qty: 4 },
            { line_no: 2, qty: null, missing_input: "Height" },
          ],
        },
        gaps: [],
        verdicts: [],
      },
      null,
      [],
    );
  const pos = {
    orders: [
      {
        id: "po1",
        number: "WC-2810-PO01",
        versions: [
          {
            version: 2,
            status: "draft",
            party_snapshot: {
              name: "Summit Electrical Supply",
              kind: "supplier",
              trade: "Electrical materials",
            },
            lines: [{ quantity: 4000, unit_price_cents: 200 }],
          },
        ],
      },
    ],
  };
  it("puts contracts first on a contracted job and walks the member to the signed copy", () => {
    fixture.rows.financial = ok(finance());
    fixture.rows.communications = ok([]);
    fixture.rows.estimate = ok(estimate());
    fixture.rows.gbb = ok({ version: 0, board: emptyBoard() });
    fixture.rows.contracts = ok({ contracts: null, pos, posFailed: false });
    const html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(html.indexOf('id="contracts"')).toBeLessThan(html.indexOf('id="estimate"'));
    expect(html).toContain("Save the signed prime contract on this job");
    expect(html).toContain("Summit Electrical Supply");
    expect(html).toContain("$8,000.00");
    expect(html).toContain("Value only, no signed copy");
    expect(html).toContain("Takeoff version 2");
  });
  it("opens a job with no contract value on the estimate", () => {
    fixture.rows.financial = ok({
      ...finance(),
      contract: { ...finance().contract, amount: null },
    });
    fixture.rows.communications = ok([]);
    fixture.rows.estimate = ok(estimateOverview({ setup: null, takeoff: null }, null, []));
    fixture.rows.gbb = ok({ version: 0, board: emptyBoard() });
    fixture.rows.contracts = ok({
      contracts: { contracts: [] },
      pos: { orders: [] },
      posFailed: false,
    });
    const html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(html.indexOf('id="estimate"')).toBeLessThan(html.indexOf('id="contracts"'));
    expect(html).toContain("Start the estimate: add the drawings");
    expect(html).toContain("No contracts on this job yet.");
  });
});

describe("IOR budget and margin on the money row", () => {
  it("reads the saved IOR the same way the IOR page does and never shows unknown as zero", () => {
    expect(iorFigures({ found: false })).toEqual({ state: "none" });
    expect(iorFigures(null)).toBeNull();
    expect(iorFigures({ found: true, version: 3, data: {} })).toEqual({
      state: "unread",
      version: 3,
    });
    const read = iorFigures({
      found: true,
      version: 4,
      data: {
        ior_model: {
          original_contract: 1000000,
          original_cost_budget: 800000,
          cost_growth: 0,
          phase: "Middle",
          change_orders: [],
          exposures: [],
        },
      },
    });
    expect(read).toMatchObject({ state: "read", version: 4, costKnown: true, cost: 80_000_000 });
    if (read?.state === "read") expect(read.pct).toBeCloseTo(20, 5);
  });
});

describe("hideAmounts", () => {
  it("drops a bracketed dollar figure from a signed-out open item title", () => {
    expect(
      hideAmounts(
        "2717 – Review the IOR risk: Cabinets misassembled and damaged on delivery ($20,000 held)",
      ),
    ).toBe("2717 – Review the IOR risk: Cabinets misassembled and damaged on delivery");
  });
  it("replaces a loose dollar figure and leaves other numbers", () => {
    expect(hideAmounts("Collect $9,500.25 on job 2717 by 6/28")).toBe(
      "Collect an amount on job 2717 by 6/28",
    );
    expect(hideAmounts("Unpaid $12k retainage")).toBe("Unpaid an amount retainage");
  });
  it("leaves a title with no money alone", () => {
    expect(hideAmounts("Submit RFI 126 response")).toBe("Submit RFI 126 response");
  });
});
