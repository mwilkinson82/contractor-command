import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signedIn: true,
  error: { code: "25006" } as unknown,
  loading: false,
  calls: 0,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: state.signedIn ? { user: { id: "fictional-user" } } : null,
    loading: state.loading,
  }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/board-link.functions", () => ({ openBoardPage: vi.fn() }));
vi.mock("@/components/athena/ReportPage", () => ({ usePageVisible: () => true }));
vi.mock("@/components/athena/BoardSignIn", () => ({
  BoardSignIn: () =>
    createElement("form", { "data-screen": "board-sign-in" }, "Sign in to keep this board open"),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () =>
    state.calls++ === 0
      ? { error: state.error, data: undefined, isLoading: false }
      : { error: null, data: undefined, isLoading: false },
}));
import { JobHome } from "@/components/athena/JobHome";
const render = () =>
  renderToStaticMarkup(createElement(JobHome, { jobId: "11111111-1111-4111-8111-111111111111" }));
beforeEach(() => {
  state.signedIn = true;
  state.error = { code: "25006" };
  state.loading = false;
  state.calls = 0;
});

describe("project home recovery screen", () => {
  it("shows an unavailable state instead of OTP after an authenticated read-only transaction error", () => {
    const html = render();
    expect(html).toContain("This project is currently unavailable");
    expect(html).toContain("Back to your account");
    expect(html).not.toContain("board-sign-in");
  });
  it("does not expose another company's project or request another code after access denial", () => {
    state.error = { code: "P0001", message: "MCP_NO_JOB" };
    expect(render()).toContain("This project is currently unavailable");
  });
  it("offers the normal sign-in form for a missing session or rejected JWT", () => {
    state.signedIn = false;
    expect(render()).toContain("board-sign-in");
    state.signedIn = true;
    state.error = { code: "PGRST303" };
    state.calls = 0;
    expect(render()).toContain("board-sign-in");
  });
  it("waits for session initialization instead of prematurely showing a code form", () => {
    state.loading = true;
    expect(render()).toContain("Loading project");
    expect(render()).not.toContain("board-sign-in");
  });
});
