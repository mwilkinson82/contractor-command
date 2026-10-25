import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: null as { user: { id: string; email: string } } | null,
  member: undefined as unknown,
  error: null as Error | null,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session: m.session, loading: false }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ getQueryData: () => undefined }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === "athena-submittal-record"
      ? { data: m.member, error: m.error, isLoading: false, isFetching: false, refetch: vi.fn() }
      : {
          data: {
            status: "ok",
            payload: JSON.stringify({ current: { id: "fictional", number: "05 12 00-001" } }),
          },
          error: null,
        },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/board-link.functions", () => ({ openSubmittalRecord: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/athena/ReportPage", () => ({
  REFRESH_MS: 60_000,
  usePageVisible: () => false,
}));
vi.mock("./SubmittalPieceUpload", () => ({
  SubmittalPieceUpload: () => createElement("form", { "aria-label": "Upload control" }),
}));
vi.mock("./BoardSignIn", () => ({
  BoardSignIn: () => createElement("p", null, "Sign in with job account"),
}));
vi.mock("@/lib/submittal-record-page", () => ({
  renderSubmittalRecordBody: () => "<h1>Fictional record</h1>",
  submittalRecordPath: () =>
    "/r/job/11111111-1111-4111-8111-111111111111/submittal/05%2012%2000-001",
  submittalPackageTarget: () => null,
  submittalRecordFile: () => null,
}));
import { SubmittalRecordView } from "./SubmittalRecordPage";
function render() {
  return renderToStaticMarkup(
    createElement(SubmittalRecordView, {
      jobId: "11111111-1111-4111-8111-111111111111",
      number: "05 12 00-001",
      token: "fictional",
      uploadRequested: true,
    }),
  );
}
beforeEach(() => {
  m.session = null;
  m.member = undefined;
  m.error = null;
});
describe("record browser-account visibility", () => {
  it("labels a token-only browser as not signed in without showing an upload control", () => {
    expect(render()).toContain("Browser account: Not signed in");
    expect(render()).not.toContain('aria-label="Upload control"');
  });
  it("shows the actual browser account beside the authorized upload control", () => {
    m.session = { user: { id: "owner", email: "pm@example.com" } };
    m.member = { payload: { read_only: false, current: { id: "fictional" } } };
    const html = render();
    expect(html).toContain("Browser account: pm@example.com");
    expect(html).toContain('aria-label="Upload control"');
  });
  it("shows the browser identity on failure and never grants upload from the read-only link", () => {
    m.session = { user: { id: "other", email: "other@example.com" } };
    m.error = new Error("failed access read");
    const html = render();
    expect(html).toContain("Browser account: other@example.com");
    expect(html).toContain("Retry upload access");
    expect(html).not.toContain('aria-label="Upload control"');
  });
  it("keeps a real read-only member read-only", () => {
    m.session = { user: { id: "super", email: "super@example.com" } };
    m.member = { payload: { read_only: true, current: { id: "fictional" } } };
    expect(render()).toContain("This signed-in account has read-only access");
    expect(render()).not.toContain('aria-label="Upload control"');
  });
});
