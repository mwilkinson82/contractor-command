import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signedIn: true,
  queries: [] as { enabled: boolean; queryKey: unknown[]; queryFn: () => Promise<unknown> }[],
  datedRead: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: state.signedIn ? { user: { id: "member" } } : null, loading: false }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/board-link.functions", () => ({ openBoardPage: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/production-report", () => ({
  productionClient: (value: unknown) => value,
  readProductionDaily: (...args: unknown[]) => state.datedRead(...args),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ getQueryData: vi.fn() }),
  useQuery: (options: (typeof state.queries)[number]) => {
    state.queries.push(options);
    return { error: null, isLoading: false, data: undefined };
  },
}));
vi.mock("@/components/athena/BoardSignIn", () => ({
  BoardSignIn: ({ returnTo }: { returnTo: string }) =>
    createElement("form", { "data-return": returnTo, "data-screen": "sign-in" }),
}));
import { ReportPageView } from "@/components/athena/ReportPage";
const job = "73000000-0000-4000-8000-000000000011";
beforeEach(() => {
  state.queries = [];
  state.signedIn = true;
  state.datedRead.mockReset();
});
describe("dated production source route", () => {
  it("reads the exact daily and never substitutes a token's latest-daily payload", async () => {
    renderToStaticMarkup(
      createElement(ReportPageView, {
        page: "daily",
        jobId: job,
        token: "old-board-token",
        reportDate: "2026-10-28",
      }),
    );
    expect(state.queries[0].queryKey).toContain("2026-10-28");
    expect(state.queries[0].enabled).toBe(true);
    expect(state.queries[1].enabled).toBe(false);
    state.datedRead.mockResolvedValue({ page: "daily", found: true, report_date: "2026-10-28" });
    expect(await state.queries[0].queryFn()).toMatchObject({
      payload: { report_date: "2026-10-28" },
    });
    expect(state.datedRead).toHaveBeenCalledWith(expect.anything(), job, "2026-10-28");
  });
  it("requires member sign-in for an exact source daily, retaining the requested date", () => {
    state.signedIn = false;
    const html = renderToStaticMarkup(
      createElement(ReportPageView, {
        page: "daily",
        jobId: job,
        token: "old-board-token",
        reportDate: "2026-10-28",
      }),
    );
    expect(state.queries.every((q) => !q.enabled)).toBe(true);
    expect(html).toContain('data-screen="sign-in"');
    expect(html).toContain("daily?date=2026-10-28");
  });
});
