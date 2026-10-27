import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boardSignInReturn } from "@/lib/board-sign-in";
import { boardPageFor } from "@/lib/mcp/board-url";
import { startedWithJobsCard } from "@/lib/mcp/getting-started";
import { renderHtml } from "@/lib/mcp/cards/html";

const fixture = vi.hoisted(() => ({ rows: {} as Record<string, unknown>, signedIn: true }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) =>
    fixture.rows[opts.queryKey[2] ?? "jobs"] ?? { data: undefined, isLoading: false, error: null },
}));
vi.mock("@/lib/board-link.functions", () => ({ openBoardPage: vi.fn() }));
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
import { JobHome } from "./JobHome";
import { ProjectHomeLinks } from "./ProjectHomeLinks";
const job = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const ok = (data: unknown) => ({ data, isLoading: false, error: null });

beforeEach(() => {
  fixture.signedIn = true;
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

describe("persistent job home", () => {
  it("opens account saved jobs at the same home while preserving the field destination", () => {
    const list = renderToStaticMarkup(
      React.createElement(ProjectHomeLinks, {
        jobs: [{ id: job, job_number: "QA-1", name: "Fixture" }],
      }),
    );
    expect(list).toContain(`href="/r/job/${job}/home"`);
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
    expect(html).not.toContain("Indicated Outcome Report");
    fixture.rows.field = {
      data: { page: "field", job_name: "Secret" },
      isLoading: false,
      error: new Error("denied"),
    };
    html = renderToStaticMarkup(React.createElement(JobHome, { jobId: job }));
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Secret");
  });
});
