import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionReport } from "./production-report";

const state = vi.hoisted(() => ({
  signedIn: true,
  loading: false,
  error: null as Error | null,
  data: undefined as unknown,
  fetching: false,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: state.signedIn ? { user: { id: "member" } } : null,
    loading: state.loading,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/athena/BoardSignIn", () => ({
  BoardSignIn: ({ returnTo }: { returnTo: string }) =>
    createElement("form", { "data-screen": "sign-in", "data-return": returnTo }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: state.data,
    error: state.error,
    isFetching: state.fetching,
    refetch: vi.fn(),
  }),
}));
import {
  ProductionReportPage,
  ProductionReportView,
} from "@/components/athena/ProductionReportPage";
const job = "73000000-0000-4000-8000-000000000011";
const report: ProductionReport = {
  job_id: job,
  job_number: "2708",
  job_name: "Cedar Grove",
  company: "ALP Construction",
  time_zone_used: "America/Chicago",
  captured_at: "2026-10-30T02:00:00Z",
  period: { from: "2026-10-28", to: "2026-10-29" },
  reports_count: 2,
  complete: true,
  planned_rate: null,
  earned_value: null,
  source: "current_saved_dailies",
  references: "reported_unverified",
  groups: [
    {
      sov_item: "26.04",
      activity_id: "E090",
      unit: "LF",
      quantity: 390,
      reported_person_hours: 72,
      actual_rate: 390 / 72,
      records: 2,
    },
    {
      sov_item: "26.04",
      activity_id: "E090",
      unit: "EA",
      quantity: 24,
      reported_person_hours: 6,
      actual_rate: 4,
      records: 1,
    },
  ],
  rows: [
    {
      id: "r1",
      daily_id: "d1",
      report_date: "2026-10-28",
      created_at: "2026-10-30T02:00:00Z",
      work: "West wing <script>work</script>",
      sov_item: "26.04",
      activity_id: "E090",
      unit: "LF",
      qty: 180,
      crew: 4,
      hours: 7.5,
      man_hours: 30,
      qty_per_man_hour: 6,
    },
  ],
};
const render = () =>
  renderToStaticMarkup(
    createElement(ProductionReportPage, { jobId: job, from: "2026-10-28", to: "2026-10-29" }),
  );
beforeEach(() => {
  state.signedIn = true;
  state.loading = false;
  state.error = null;
  state.data = report;
  state.fetching = false;
});
describe("production report presentation and recovery", () => {
  it("shows actual rates, the named job, explicit basis and exact dated source links", () => {
    const html = render();
    expect(html).toContain("Cedar Grove");
    expect(html).toContain("ALP Construction");
    expect(html).toContain("5.42");
    expect(html).toContain("390 LF");
    expect(html).toContain("72 reported person-hours");
    expect(html).toContain("24 EA");
    expect(html).toContain(`/r/job/${job}/daily?date=2026-10-28`);
    expect(html).toContain(
      "Planned productivity, labor cost, cost variance and earned value: unavailable",
    );
    expect(html).toContain("may overlap");
    expect(html).not.toContain("<script>work");
  });
  it("distinguishes incomplete coverage and empty records", () => {
    const incomplete = renderToStaticMarkup(
      createElement(ProductionReportView, { report: { ...report, complete: false } }),
    );
    expect(incomplete).toContain("Incomplete coverage");
    const empty = renderToStaticMarkup(
      createElement(ProductionReportView, {
        report: { ...report, rows: [], groups: [], reports_count: 0 },
      }),
    );
    expect(empty).toContain("No saved production rows for this period");
    expect(empty).not.toContain("0 LF");
  });
  it("preserves the selected date range through sign-in", () => {
    state.signedIn = false;
    const html = render();
    expect(html).toContain('data-screen="sign-in"');
    expect(html).toContain("from=2026-10-28&amp;to=2026-10-29");
    expect(html).not.toContain("Cedar Grove");
  });
  it("does not show stale project data or start an OTP loop on denied or unavailable refresh", () => {
    state.error = Object.assign(new Error("Source unavailable"), { code: "25006" });
    expect(render()).not.toContain("Cedar Grove");
    expect(render()).not.toContain("West wing");
    expect(render()).not.toContain('data-screen="sign-in"');
    state.data = undefined;
    expect(render()).toContain("This project is currently unavailable");
  });
  it("permits sign-in only for a rejected JWT and waits during auth initialization", () => {
    state.error = Object.assign(new Error("Expired session"), { code: "PGRST303" });
    expect(render()).toContain('data-screen="sign-in"');
    state.loading = true;
    expect(render()).toContain("Checking project access");
    expect(render()).not.toContain('data-screen="sign-in"');
  });
});
