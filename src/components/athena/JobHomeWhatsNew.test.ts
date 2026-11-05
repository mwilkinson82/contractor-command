import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  signedIn: true,
  queries: [] as { queryKey: unknown[]; enabled?: boolean; refetchInterval?: unknown }[],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    fixture.queries.push(opts);
    return fixture.rows[String(opts.queryKey[0])] ?? { data: undefined, isLoading: false, error: null };
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/change-log.functions", () => ({ openChangeLog: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: fixture.signedIn ? { user: { id: "member" } } : null, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("./ReportPage", () => ({ usePageVisible: () => true }));

import {
  JobHomeNoticeBadge,
  JobHomeNotifications,
  JobHomeWhatsNew,
  NotificationsBell,
  NotificationsNavLink,
} from "./JobHomeWhatsNew";
import { JobHomeChangeOrders } from "./JobHomeChangeOrders";
import { JobHomeMessages } from "./JobHomeMessages";
import { JobNoticeEmailSettings } from "./JobNoticeEmailSettings";
import { AthenaAccountLayout } from "../account/athena-account-layout";

const job = "22222222-2222-4222-8222-222222222222";
const ok = (data: unknown) => ({ data, isLoading: false, error: null });
const notice = (id: string, read = false, board_page: string | null = "cos") => ({
  id,
  topic: "client_decision",
  kind: "co_approved",
  title: `Rosa Delgado approved ${id}`,
  detail: null,
  actor: "Rosa Delgado",
  facts: {},
  board_page,
  created_at: "2026-11-05T10:00:00Z",
  read,
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

beforeEach(() => {
  fixture.signedIn = true;
  fixture.queries = [];
  fixture.rows = {
    "job-notices": ok({
      notices: [notice("CO-003"), notice("CO-002", true, "nowhere"), ...Array.from({ length: 6 }, (_, i) => notice(`N-${i}`, true))],
      unread: 3,
    }),
  };
});

describe("board notifications", () => {
  it("headed Notifications, newest 5, a dot for unread and a link to the board page", () => {
    const out = html(React.createElement(JobHomeNotifications, { jobId: job }));
    expect(out).toContain("Notifications");
    expect(out).toContain("3 new");
    expect(out).not.toContain('id="notifications"');
    expect(out).not.toContain("<section");
    expect(out.match(/class="jhn-row/g)).toHaveLength(5);
    expect(out).toContain("jhn-unread");
    expect(out).toContain(`href="/r/job/${job}/cos"`);
    expect(out).toContain("Mark all read");
    expect(out).toContain("Show all");
    expect(out).not.toMatch(/What&#x27;s new|What's new/);
    expect(JobHomeWhatsNew).toBe(JobHomeNotifications);
  });
  it("shows the empty sentence when nothing has come back yet", () => {
    fixture.rows["job-notices"] = ok({ notices: [], unread: 0 });
    const out = html(React.createElement(JobHomeNotifications, { jobId: job }));
    expect(out).toContain(
      "Nothing new yet. Client approvals, questions, submittal replies and confirmed dates show up here.",
    );
    expect(out).not.toContain("Mark all read");
  });
  it("says unavailable instead of zero when the read fails", () => {
    fixture.rows["job-notices"] = { data: undefined, isLoading: false, error: new Error("x") };
    expect(html(React.createElement(JobHomeNotifications, { jobId: job }))).toContain("unavailable");
    expect(html(React.createElement(NotificationsBell, { jobId: job }))).not.toContain("jhn-bell-count");
  });
  it("shows nothing on a share link with no signed-in member", () => {
    fixture.signedIn = false;
    for (const C of [JobHomeNotifications, NotificationsBell, NotificationsNavLink, JobHomeMessages, JobNoticeEmailSettings])
      expect(html(React.createElement(C, { jobId: job, token: "share" }))).toBe("");
    expect(fixture.queries.filter((q) => q.queryKey[0] !== "job-home-cos").every((q) => q.enabled === false)).toBe(true);
  });
  it("feeds the panel, bell, nav and badge from one shared query", () => {
    html(
      React.createElement(
        "div",
        null,
        React.createElement(NotificationsBell, { jobId: job }),
        React.createElement(NotificationsNavLink, { jobId: job }),
        React.createElement(JobHomeNoticeBadge, { jobId: job }),
        React.createElement(JobHomeNotifications, { jobId: job }),
      ),
    );
    const keys = new Set(fixture.queries.map((q) => JSON.stringify(q.queryKey)));
    expect([...keys]).toEqual([JSON.stringify(["job-notices", job, "member"])]);
  });
  it("draws an icon-only bell with a red count and an accessible label", () => {
    const bell = html(React.createElement(NotificationsBell, { jobId: job }));
    expect(bell).toContain('aria-label="Notifications, 3 new"');
    expect(bell).toContain('class="jhn-bell-count"');
    expect(bell).toContain(">3<");
    fixture.rows["job-notices"] = ok({ notices: [], unread: 140 });
    expect(html(React.createElement(NotificationsBell, { jobId: job }))).toContain("99+");
    fixture.rows["job-notices"] = ok({ notices: [], unread: 0 });
    expect(html(React.createElement(NotificationsBell, { jobId: job }))).not.toContain("jhn-bell-count");
  });
  it("renders the nav link with the board's classes", () => {
    const nav = html(React.createElement(NotificationsNavLink, { jobId: job }));
    expect(nav).toContain('href="#notifications"');
    expect(nav).toContain('class="jh-nav-icon"');
    expect(nav).toContain('<span class="jh-count" aria-hidden="true">3</span>');
    fixture.rows["job-notices"] = ok({ notices: [], unread: 0 });
    expect(html(React.createElement(NotificationsNavLink, { jobId: job }))).not.toContain("jh-count");
  });
});

describe("board change orders, messages and email choices", () => {
  it("shows the client's decision on the change order rows with a See all link", () => {
    fixture.rows["job-home-cos"] = ok({
      job_id: job,
      job_number: "2810",
      job_name: "Willow Creek",
      today: "2026-11-05",
      read_only: false,
      time_zone: "America/New_York",
      records: [
        {
          id: "s1",
          number: "PCO-002",
          title: "Tile upgrade",
          revision: 0,
          transmittal_number: 1,
          history: [],
          change_order_details: {
            state: "approved",
            record_version: 2,
            co_number: "CO-003",
            origin: "contractor",
            condition: "",
            scope: "",
            references: [],
            lines: [],
            total_cents: 267192,
            schedule_days: 2,
            decision: { by: "Rosa Delgado <rosa@example.com>", at: "2026-11-05T19:14:00Z", reference: "r", channel: "customer_page" },
          },
        },
      ],
    });
    const out = html(React.createElement(JobHomeChangeOrders, { jobId: job }));
    expect(out).toContain("CO-003");
    expect(out).toContain("$2,671.92");
    expect(out).toContain("Approved by Rosa Delgado on the client page");
    expect(out).toContain(`href="/r/job/${job}/cos"`);
    expect(out).not.toContain("rosa@example.com");
  });
  it("lists client threads with a reply box", () => {
    fixture.rows["job-messages"] = ok([
      {
        customer_name: "Rosa Delgado",
        access_id: "acc-1",
        messages: [{ id: "m1", author_kind: "client", author_name: "Rosa", body: "Is the tile in?", about_label: "CO-003", created_at: "2026-11-05T09:00:00Z" }],
      },
    ]);
    const out = html(React.createElement(JobHomeMessages, { jobId: job }));
    expect(out).toContain("Client messages");
    expect(out).toContain("1 waiting");
    expect(out).toContain("Is the tile in?");
    expect(out).toContain("Send to Rosa Delgado");
    expect(out).toContain('id="job-messages"');
  });
  it("locks the Job PM row on and keeps it read only when the member cannot change it", () => {
    fixture.rows["job-notice-prefs"] = ok({
      canChange: false,
      rows: ["job_pm", "super"].map((role) => ({
        role,
        cells: ["client_decision", "submittal_reply"].map((topic) => ({
          role,
          topic,
          email: role === "job_pm",
          allowed: role !== "super" || topic === "submittal_reply",
          locked: role === "job_pm",
        })),
      })),
    });
    const out = html(React.createElement(JobNoticeEmailSettings, { jobId: job }));
    expect(out).toContain("Notice emails");
    expect(out).toContain("Only the job&#x27;s PM, an owner or an all-access member can change these.");
    expect(out).toContain("Always on");
    expect(out).toContain("Not for supers");
    expect(out).toContain("Client approvals and choices");
    expect(out.match(/disabled=""/g)?.length).toBe(3);
  });
});

describe("account page", () => {
  it("adds a Notifications section with a red count", () => {
    const props = {
      name: "Owner", email: "o@example.com", companyName: "Co", plan: "Athena", seats: "1",
      teamLoading: false, teamError: false, canViewSupport: false, onSignOut: async () => {},
      profile: null, company: null, team: null, billing: null, projects: null, briefing: null, guide: null,
    };
    const out = html(React.createElement(AthenaAccountLayout, { ...props, notices: "LIST", noticeCount: 4 }));
    expect(out).toContain("Notifications");
    expect(out).toContain('class="aa-nav-count"');
    expect(out).toContain("LIST");
    expect(html(React.createElement(AthenaAccountLayout, props))).not.toContain("Notifications");
  });
});
