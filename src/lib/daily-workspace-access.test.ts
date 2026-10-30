import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: true,
  memberError: false,
  board: false,
  queries: [] as { queryKey: unknown[]; enabled: boolean }[],
}));
const daily = {
  page: "daily",
  found: true,
  report_date: "2026-10-30",
  job_number: "2810",
  job_name: "Access fixture",
  weather: "PRIVATE SAVED WEATHER",
  lines: [],
};
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: state.session ? { user: { id: "member" } } : null, loading: false }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/components/athena/BoardSignIn", () => ({
  BoardSignIn: () => createElement("main", null, "Sign in"),
}));
vi.mock("@/lib/board-link.functions", () => ({ openBoardPage: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ getQueryData: vi.fn() }),
  useQuery: (q: { queryKey: unknown[]; enabled: boolean }) => {
    state.queries.push(q);
    if (q.queryKey[0] === "athena-report-page")
      return {
        data: { payload: daily },
        error: state.memberError ? new Error("permission denied") : null,
        isLoading: false,
      };
    if (q.queryKey[0] === "athena-board-link")
      return {
        data: state.board ? { status: "ok", payload: JSON.stringify(daily) } : undefined,
        error: null,
        isLoading: false,
      };
    return { data: { dates: ["2026-10-30"], complete: true }, error: null, isLoading: false };
  },
}));
import { ReportPageView } from "@/components/athena/ReportPage";
const render = () =>
  renderToStaticMarkup(
    createElement(ReportPageView, {
      page: "daily",
      jobId: "73000000-0000-4000-8000-000000000011",
      token: "board-fixture",
    }),
  );
beforeEach(() => {
  state.session = true;
  state.memberError = false;
  state.board = false;
  state.queries = [];
});
describe("daily workspace permissions and cached content", () => {
  it("enables index and capture only after a successful member payload", () => {
    const html = render();
    expect(html).toContain("New daily report");
    expect(state.queries.find((q) => q.queryKey[0] === "daily-report-index")?.enabled).toBe(true);
  });
  it("keeps token-only reading separate from member capture/index", () => {
    state.session = false;
    state.board = true;
    const html = render();
    expect(html).toContain("PRIVATE SAVED WEATHER");
    expect(html).not.toContain("New daily report");
    expect(state.queries.find((q) => q.queryKey[0] === "daily-report-index")?.enabled).toBe(false);
  });
  it("withholds cached saved content after a denied scoped refresh", () => {
    state.memberError = true;
    const html = render();
    expect(html).toContain("This project is currently unavailable");
    expect(html).not.toContain("PRIVATE SAVED WEATHER");
    expect(html).not.toContain("New daily report");
    expect(state.queries.some((q) => q.queryKey[0] === "daily-report-index")).toBe(false);
  });
  it("a valid board fallback after member denial grants no capture controls", () => {
    state.memberError = true;
    state.board = true;
    const html = render();
    expect(html).toContain("PRIVATE SAVED WEATHER");
    expect(html).not.toContain("New daily report");
    expect(state.queries.find((q) => q.queryKey[0] === "daily-report-index")?.enabled).toBe(false);
  });
});
