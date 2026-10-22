import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/components/athena/FieldPushBar", () => ({ FieldPushBar: () => null }));

import { ReportPageView } from "./ReportPage";

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

describe("board link page without a session", () => {
  it("renders the token payload when there is no session", () => {
    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: null };
    const html = renderPage("items", "live-token");
    expect(html).toContain("Buy the switchgear");
    expect(html).toContain("2701 Harbor · Open items");
    expect(html).not.toContain("Sign in to open this page");
    expect(html).not.toContain("have access to this page");
  });

  it("shows the friendly message for a bad or expired token", () => {
    state.linkQuery = { data: { status: "expired", payload: null }, isLoading: false, error: null };
    const expired = renderPage("items", "old-token");
    expect(expired).toContain("This board link has expired. Ask Athena for a fresh one.");
    expect(expired).not.toContain("Sign in to open this page");
    expect(expired).not.toContain("have access to this page");

    state.linkQuery = { data: { status: "unknown", payload: null }, isLoading: false, error: null };
    const bad = renderPage("items", "bad-token");
    expect(bad).toContain("This board link does not work. Ask Athena for a fresh one.");
    expect(bad).not.toContain("Sign in to open this page");
    expect(bad).not.toContain("Buy the switchgear");
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
      expect(html).toContain("This link cannot open that page.");
      expect(html).not.toContain("Sign in to open this page");
      expect(html).not.toContain("have access to this page");
      expect(html).not.toContain("Buy the switchgear");
    }

    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: null };
    const allowed = renderPage("items", "super-token");
    expect(allowed).toContain("Buy the switchgear");
    expect(allowed).not.toContain("Sign in to open this page");
  });

  it("leaves a signed-in member with no row on the no-access card", () => {
    state.session = { user: { id: "member-1" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no row") };
    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: null };
    const html = renderPage("items", "live-token");
    expect(html).toContain("have access to this page");
    expect(html).not.toContain("Buy the switchgear");
    expect(html).not.toContain("Sign in to open this page");
  });
});
