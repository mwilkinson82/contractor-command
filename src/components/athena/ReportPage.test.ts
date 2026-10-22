import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardLinkStatus, boardPageAllowed, type BoardLinkRow } from "@/lib/mcp/board-link";
import type { PagePayload } from "@/lib/report-pages";

const JOB = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-22T12:00:00Z");

type QueryResult = { data?: unknown; isLoading: boolean; error: Error | null };

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  authLoading: false,
  pageQuery: { data: undefined, isLoading: false, error: null } as QueryResult,
  linkQuery: { data: undefined, isLoading: false, error: null } as QueryResult,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: state.session, loading: state.authLoading }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ getQueryData: () => undefined }),
  useQuery: (opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    if (!opts.enabled) return { data: undefined, isLoading: false, error: null };
    return String(opts.queryKey[0]) === "athena-board-link" ? state.linkQuery : state.pageQuery;
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/board-link.functions", () => ({ openBoardPage: vi.fn() }));
vi.mock("@/lib/magic-link.functions", () => ({ requestMemberMagicLink: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), auth: {} } }));
vi.mock("@/components/athena/FieldPushBar", () => ({ FieldPushBar: () => null }));

import { ReportPageView } from "./ReportPage";
import { BOARD_SIGN_IN_TITLE } from "@/lib/board-sign-in";

const items: PagePayload = {
  page: "items",
  company: "ALP",
  job_number: "2701",
  job_name: "Harbor",
  items: [{ id: "1", action: "Buy the switchgear", owner: "Morgan", due: "2026-11-02" }],
};

function row(over: Partial<BoardLinkRow> = {}): BoardLinkRow {
  return { job_id: JOB, scope: "full", expires_at: "2026-10-23T12:00:00Z", revoked_at: null, ...over };
}

function renderPage(page: "items" | "ior" | "payapp" | "field", token?: string) {
  return renderToStaticMarkup(createElement(ReportPageView, { page, jobId: JOB, token }));
}

beforeEach(() => {
  state.session = null;
  state.authLoading = false;
  state.pageQuery = { data: undefined, isLoading: false, error: null };
  state.linkQuery = { data: undefined, isLoading: false, error: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function signInReturn(html: string): string {
  const match = html.match(/data-return-to="([^"]*)"/);
  return match?.[1] ?? "";
}

describe("board link page without a session", () => {
  it("renders the token payload when there is no session", () => {
    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: null };
    const html = renderPage("items", "live-token");
    expect(html).toContain("Buy the switchgear");
    expect(html).toContain("2701 Harbor · Open items");
    expect(html).not.toContain(BOARD_SIGN_IN_TITLE);
    expect(html).not.toContain("have access to this page");
  });

  it("sends an expired token to sign-in and back to the same board", () => {
    vi.stubGlobal("window", {
      location: {
        pathname: `/r/job/${JOB}/items`,
        search: "?t=old-token",
        hash: "#item-1",
      },
    });
    state.linkQuery = { data: { status: "expired", payload: null }, isLoading: false, error: null };
    const expired = renderPage("items", "old-token");
    expect(expired).toContain(BOARD_SIGN_IN_TITLE);
    expect(expired).toContain("Email me a sign-in code");
    expect(expired).toContain('type="email"');
    expect(signInReturn(expired)).toBe(`/r/job/${JOB}/items#item-1`);
    expect(expired).not.toContain("Ask Athena for a fresh one");
    expect(expired).not.toContain("have access to this page");
    expect(expired).not.toContain("Buy the switchgear");
    expect(expired).not.toContain("Lovable");
    expect(expired).not.toContain("Supabase");
    vi.unstubAllGlobals();
  });

  it("sends a missing token to sign-in and back to the stable board path", () => {
    const html = renderPage("field");
    expect(html).toContain(BOARD_SIGN_IN_TITLE);
    expect(html).toContain("Email me a sign-in code");
    expect(html).not.toContain("Use a different account");
    expect(signInReturn(html)).toBe(`/r/job/${JOB}/field`);
    expect(html).not.toContain("Ask Athena for a fresh one");
    expect(html).not.toContain("Buy the switchgear");
  });

  it("drops utm params from the sign-in return", () => {
    vi.stubGlobal("window", {
      location: {
        pathname: `/r/job/${JOB}/items`,
        search: "?t=old-token&utm_source=chatgpt.com&utm_medium=email",
        hash: "",
      },
    });
    state.linkQuery = { data: { status: "unknown", payload: null }, isLoading: false, error: null };
    const html = renderPage("items", "old-token");
    expect(html).toContain(BOARD_SIGN_IN_TITLE);
    expect(signInReturn(html)).toBe(`/r/job/${JOB}/items`);
    expect(signInReturn(html)).not.toContain("utm_");
    expect(signInReturn(html)).not.toContain("old-token");
    vi.unstubAllGlobals();
  });

  it("does not follow an open redirect off the job board", () => {
    vi.stubGlobal("window", {
      location: {
        pathname: "//evil.example/r/job/" + JOB + "/items",
        search: "?next=https://evil.example",
        hash: "",
      },
    });
    const html = renderPage("items");
    expect(html).toContain(BOARD_SIGN_IN_TITLE);
    expect(signInReturn(html)).toBe(`/r/job/${JOB}/items`);
    expect(html).not.toContain("evil.example");
    vi.unstubAllGlobals();
  });

  it("keeps super scope blocked from IOR and pay app", () => {
    expect(boardPageAllowed("ior", "super")).toBe(false);
    expect(boardPageAllowed("payapp", "super")).toBe(false);
    expect(boardPageAllowed("items", "super")).toBe(true);
    expect(boardLinkStatus(row({ scope: "super" }), JOB, "ior", now)).toBe("denied");
    expect(boardLinkStatus(row({ scope: "super" }), JOB, "payapp", now)).toBe("denied");
    expect(boardLinkStatus(row({ scope: "super" }), JOB, "items", now)).toBe("ok");

    state.linkQuery = { data: { status: "denied", payload: null }, isLoading: false, error: null };
    for (const page of ["ior", "payapp"] as const) {
      const html = renderPage(page, "super-token");
      expect(html).toContain(BOARD_SIGN_IN_TITLE);
      expect(html).not.toContain("have access to this page");
      expect(html).not.toContain("Buy the switchgear");
    }

    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: null };
    const allowed = renderPage("items", "super-token");
    expect(allowed).toContain("Buy the switchgear");
    expect(allowed).not.toContain(BOARD_SIGN_IN_TITLE);
  });

  it("renders a valid token when the signed-in account has no row for the job", () => {
    state.session = { user: { id: "member-1" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no row") };
    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: null };
    const html = renderPage("items", "live-token");
    expect(html).toContain("Buy the switchgear");
    expect(html).toContain("2701 Harbor · Open items");
    expect(html).not.toContain("have access to this page");
    expect(html).not.toContain(BOARD_SIGN_IN_TITLE);
    expect(html).not.toContain("Use a different account");
  });

  it("sends a signed-in account with no row and no valid token to code sign-in", () => {
    state.session = { user: { id: "member-1" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no row") };
    vi.stubGlobal("window", {
      location: { pathname: `/r/job/${JOB}/items`, search: "", hash: "#item-1" },
    });
    const missing = renderPage("items");
    expect(missing).toContain(BOARD_SIGN_IN_TITLE);
    expect(missing).toContain("Email me a sign-in code");
    expect(missing).toContain('type="email"');
    expect(missing).toContain("Use a different account");
    expect(missing).not.toContain("have access to this page");
    expect(missing).not.toContain("Buy the switchgear");
    expect(missing).not.toContain("alpcontractorcircle");
    expect(missing).not.toContain("/login");
    expect(missing).not.toContain("magic link");
    expect(signInReturn(missing)).toBe(`/r/job/${JOB}/items#item-1`);

    vi.stubGlobal("window", {
      location: { pathname: `/r/job/${JOB}/items`, search: "?t=old-token", hash: "" },
    });
    state.linkQuery = { data: { status: "expired", payload: null }, isLoading: false, error: null };
    const expired = renderPage("items", "old-token");
    expect(expired).toContain(BOARD_SIGN_IN_TITLE);
    expect(expired).toContain("Use a different account");
    expect(expired).not.toContain("have access to this page");
    expect(expired).not.toContain("Buy the switchgear");
    expect(signInReturn(expired)).toBe(`/r/job/${JOB}/items`);
    vi.unstubAllGlobals();
  });

  it("shows a signed-in member the live board even when the token in the url is expired", () => {
    state.session = { user: { id: "member-1" } };
    state.pageQuery = { data: { payload: items }, isLoading: false, error: null };
    const html = renderPage("items", "old-token");
    expect(html).toContain("Buy the switchgear");
    expect(html).not.toContain(BOARD_SIGN_IN_TITLE);
    expect(html).not.toContain("Use a different account");
    expect(html).not.toContain("have access to this page");
  });
});
