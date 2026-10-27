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
  queryOptions: [] as { queryKey: readonly unknown[]; enabled?: boolean; refetchInterval?: number | false; refetchIntervalInBackground?: boolean }[],
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: state.session, loading: state.authLoading }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ getQueryData: () => undefined }),
  useQuery: (opts: { queryKey: readonly unknown[]; enabled?: boolean; refetchInterval?: number | false; refetchIntervalInBackground?: boolean }) => {
    state.queryOptions.push(opts);
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

function renderPage(page: "items" | "ior" | "payapp" | "field" | "lookahead", token?: string) {
  return renderToStaticMarkup(createElement(ReportPageView, { page, jobId: JOB, token }));
}

beforeEach(() => {
  state.session = null;
  state.authLoading = false;
  state.queryOptions = [];
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
  it("passes the authorized daily route identity to presentation without changing the saved payload", () => {
    const payload = JSON.stringify({
      page: "daily", found: true, job_number: "2708", job_name: "Cedar Grove Medical Office Building",
      report_date: "2026-10-27", weather: "FICTIONAL DEMO: Light rain, work indoors.",
      manpower: "FICTIONAL DEMO: 3 workers, 8 hours each, 24 person-hours.",
      lines: [{ work: "FICTIONAL DEMO: Installed 96 LF EMT.", qty: 96, unit: "LF", crew: 3, hours: 8, activity_id: "E090" }],
    });
    state.linkQuery = { data: { status: "ok", payload }, isLoading: false, error: null };
    const html = renderToStaticMarkup(createElement(ReportPageView, {
      page: "daily", jobId: "289ca2cd-b585-419a-8c09-3501d1be48c3", token: "live-token",
    }));
    expect(html).toContain("Daily Report for October 27, 2026");
    expect(html).toContain("96 LF · crew 3 · 8 hours");
    expect(html).not.toContain("FICTIONAL DEMO:");
    expect(state.linkQuery.data).toEqual({ status: "ok", payload });
  });

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

  it("opens a valid key even when another signed-in member cannot read the job", () => {
    state.session = { user: { id: "member-1" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no row") };
    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: null };
    const html = renderPage("items", "live-token");
    expect(html).not.toContain("have access to this page");
    expect(html).toContain("Buy the switchgear");
    expect(html).not.toContain(BOARD_SIGN_IN_TITLE);
  });

  it("keeps compact project navigation without mounting the morning subscription controls", () => {
    state.session = { user: { id: "member-1" } };
    for (const page of [
      "schedule",
      "lookahead",
      "items",
      "submittals",
      "ior",
      "payapp",
      "daily",
      "photos",
      "field",
    ] as const) {
      const payload =
        page === "items"
          ? items
          : page === "submittals"
            ? { page, submittals: [] }
            : page === "daily"
              ? { page, found: false }
              : page === "photos"
                ? { page, photos: [] }
                : page === "field"
                  ? { page, items: [] }
                  : { page, report: { found: false } };
      state.pageQuery = { data: { payload }, isLoading: false, error: null };
      const html = renderToStaticMarkup(
        createElement(ReportPageView, { page, jobId: JOB, token: "fixture-key" }),
      );
      expect(html).toContain('aria-label="Project navigation"');
      expect(html).toContain(`href="/r/job/${JOB}/home?t=fixture-key"`);
      expect(html).toContain('href="/today"');
      expect(html).toContain("Morning brief");
      expect(html).not.toContain('data-screen="morning-brief-push"');
      expect(html).not.toContain("Turn on morning briefing");
    }
  });

  it("retains the existing subscription controls outside job report pages", () => {
    state.session = { user: { id: "member-1" } };
    state.pageQuery = {
      data: { payload: { page: "portfolio", jobs: [] } },
      isLoading: false,
      error: null,
    };
    const html = renderToStaticMarkup(
      createElement(ReportPageView, { page: "portfolio", companyId: JOB }),
    );
    expect(html).toContain('data-screen="morning-brief-push"');
    expect(html).toContain("Turn on morning briefing");
    expect(html).toContain('href="/today"');
  });

  it("shows a signed-in member the live board even when the token in the url is expired", () => {
    state.session = { user: { id: "member-1" } };
    state.pageQuery = { data: { payload: items }, isLoading: false, error: null };
    const html = renderPage("items", "old-token");
    expect(html).toContain("Buy the switchgear");
    expect(html).not.toContain(BOARD_SIGN_IN_TITLE);
    expect(html).not.toContain("have access to this page");
  });

  it.each(["expired", "revoked", "wrong_job", "denied", "unknown"])("recovers a stale session and %s key through email-code sign-in", (status) => {
    state.session = { user: { id: "another-member" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no access") };
    state.linkQuery = { data: { status, payload: null }, isLoading: false, error: null };
    vi.stubGlobal("window", { location: { pathname: `/r/job/${JOB}/items`, search: "?t=old-token&utm_source=chatgpt.com", hash: "#item-1" } });
    const html = renderPage("items", "old-token");
    expect(html).toContain(BOARD_SIGN_IN_TITLE);
    expect(html).toContain("Email me a sign-in code");
    expect(signInReturn(html)).toBe(`/r/job/${JOB}/items#item-1`);
    expect(html).not.toContain("have access to this page");
    expect(html).not.toContain("Buy the switchgear");
  });

  it("recovers a signed-in member without a key and without job access", () => {
    state.session = { user: { id: "another-member" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("expired session") };
    const html = renderPage("field");
    expect(html).toContain(BOARD_SIGN_IN_TITLE);
    expect(signInReturn(html)).toBe(`/r/job/${JOB}/field`);
    expect(html).not.toContain("have access to this page");
  });

  it("opens a valid key while the stale member read is still loading", () => {
    state.session = { user: { id: "another-member" } };
    state.pageQuery = { data: undefined, isLoading: true, error: null };
    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: null };
    const html = renderPage("items", "live-token");
    expect(html).toContain("Buy the switchgear");
    expect(html).not.toContain("Loading");
  });

  it("opens the lookahead board linked by the card despite another user's session", () => {
    state.session = { user: { id: "another-member" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no access") };
    state.linkQuery = { data: { status: "ok", payload: JSON.stringify({ page: "lookahead", job_number: "2701", job_name: "Harbor", report: { found: false } }) }, isLoading: false, error: null };
    const html = renderPage("lookahead", "live-token");
    expect(html).toContain("2701 Harbor · Two-Week Lookahead");
    expect(html).not.toContain(BOARD_SIGN_IN_TITLE);
    expect(html).not.toContain("have access to this page");
  });

  it("does not reuse a cached member payload after its access check fails", () => {
    state.session = { user: { id: "another-member" } };
    state.pageQuery = { data: { payload: items }, isLoading: false, error: new Error("no access") };
    state.linkQuery = { data: { status: "revoked", payload: null }, isLoading: false, error: null };
    const html = renderPage("items", "revoked-token");
    expect(html).toContain(BOARD_SIGN_IN_TITLE);
    expect(html).not.toContain("Buy the switchgear");
  });

  it("waits for a pending key before showing sign-in after a member denial", () => {
    state.session = { user: { id: "another-member" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no access") };
    state.linkQuery = { data: undefined, isLoading: true, error: null };
    const html = renderPage("items", "live-token");
    expect(html).toContain("Loading");
    expect(html).not.toContain(BOARD_SIGN_IN_TITLE);
  });

  it("recovers both read failures without accepting a cached key on error", () => {
    state.session = { user: { id: "another-member" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no access") };
    state.linkQuery = { data: { status: "ok", payload: JSON.stringify(items) }, isLoading: false, error: new Error("link check failed") };
    const html = renderPage("items", "live-token");
    expect(html).toContain(BOARD_SIGN_IN_TITLE);
    expect(html).not.toContain("Buy the switchgear");
  });
  it.each(["visible", "hidden"])("refreshes token boards only when the tab is %s", (visibilityState) => {
    vi.stubGlobal("document", { visibilityState });
    state.session = { user: { id: "another-member" } };
    renderPage("items", "live-token");
    const linked = state.queryOptions.find((q) => q.queryKey[0] === "athena-board-link")!;
    expect(linked.enabled).toBe(true);
    expect(linked.refetchInterval).toBe(visibilityState === "visible" ? 60_000 : false);
    expect(linked.refetchIntervalInBackground).toBe(false);
  });

  it("keeps the existing portfolio access path separate from job recovery", () => {
    state.session = { user: { id: "another-member" } };
    state.pageQuery = { data: undefined, isLoading: false, error: new Error("no access") };
    const html = renderToStaticMarkup(createElement(ReportPageView, { page: "portfolio", companyId: JOB }));
    expect(html).toContain("have access to this page");
    expect(html).not.toContain(BOARD_SIGN_IN_TITLE);
    expect(state.queryOptions.find((q) => q.queryKey[0] === "athena-board-link")!.enabled).toBe(false);
  });

});
