import { createElement as h, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  search: {} as Record<string, unknown>,
  calls: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    loading: false,
    user: { id: "synthetic" },
    session: {
      user: {
        id: "synthetic",
        email: "synthetic-long-reference-for-layout-testing@example.invalid",
      },
    },
  }),
}));
vi.mock("@/hooks/use-is-admin", () => ({ useIsAdmin: () => true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.calls, auth: {} } }));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => state.calls,
  createServerFn: () => {
    const chain = { inputValidator: () => chain, handler: () => state.calls };
    return chain;
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.calls }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: state.queries[
      String(queryKey[0]) === "job-home" ? String(queryKey[2]) : String(queryKey[0])
    ],
    error: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    refetch: state.calls,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({
    ...config,
    useSearch: () => state.search,
    useLoaderData: () => ({
      details: {
        client: { name: "Synthetic client" },
        scope: "openid email profile offline_access",
      },
      email: "synthetic-long-reference-for-layout-testing@example.invalid",
      userId: "synthetic",
      entitled: true,
      accessToken: "synthetic-not-a-credential",
    }),
  }),
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) =>
    h("a", { href: to, className }, children),
  redirect: vi.fn(),
  useNavigate: () => state.calls,
  useRouter: () => ({ invalidate: state.calls }),
}));
vi.mock("@/lib/athena-host-current", () => ({
  onAthenaHost: () => true,
  currentHostname: () => "app.meetathena.io",
}));
vi.mock("@/lib/account-team.functions", () => ({ getSeatPurchaseStatus: state.calls }));
vi.mock("@/lib/board-link.functions", () => ({
  openBoardPage: state.calls,
  openSubmittalRecord: state.calls,
  openBoardOriginal: state.calls,
}));
vi.mock("@/lib/support/dashboard.functions", () => ({
  readSupportDashboard: state.calls,
  readSupportAttachment: state.calls,
  listSupportAttachments: state.calls,
}));
vi.mock("@/lib/magic-link.functions", () => ({ requestMemberMagicLink: state.calls }));
vi.mock("@/lib/password-reset.functions", () => ({ requestPasswordReset: state.calls }));
vi.mock("@/lib/oauth-continuation.functions", () => ({ resolveOAuthContinuation: state.calls }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: state.calls }));
vi.mock("@/lib/request-log.functions", () => ({ openRequestLog: state.calls }));
vi.mock("@/lib/change-log.functions", () => ({ openChangeLog: state.calls }));
import { PurchaseOrderBuyout } from "@/components/athena/PurchaseOrderBuyout";
import { JobHome } from "@/components/athena/JobHome";
import { DailyReportReview } from "@/components/athena/DailyReportReview";
import { DailyReportCapture } from "@/components/athena/DailyReportCapture";
import { ProductionReportPage } from "@/components/athena/ProductionReportPage";
import { BoardSignIn } from "@/components/athena/BoardSignIn";
import { AthenaAccountLayout } from "@/components/account/athena-account-layout";
import { TeamSection } from "@/components/account/team-section";
import { OrganizationProfile } from "@/components/account/organization-profile";
import { Route as login, LoginForm } from "@/routes/login";
import { Route as magic } from "@/routes/magic-link";
import { Route as consent } from "@/routes/oauth.consent";
import { Route as support } from "@/routes/admin.support";
import type { ProductionReport } from "./production-report";
import type { AccountTeam } from "./account-team";
import type { DailyPagePayload } from "./report-pages";

import { RequestLogPage } from "@/components/athena/RequestLogPage";
import { ChangeOrderLogPage } from "@/components/athena/ChangeOrderLogPage";
import { ProjectHomeLinks } from "@/components/athena/ProjectHomeLinks";
import { TodayBriefView } from "@/routes/today";
import { Route as forgot } from "@/routes/forgot-password";
import { Route as reset } from "@/routes/reset-password";
import { Route as callback } from "@/routes/auth.callback";
import { buildMorningBrief } from "./mcp/morning-brief";
import { renderHtml } from "./mcp/cards/html";
const long = "Synthetic reference " + "LONGREFERENCE".repeat(12);
const id = "00000000-0000-4000-8000-000000000001";
const day = "2026-11-01";
const daily: DailyPagePayload = {
  page: "daily",
  job_number: "SYN-001",
  job_name: long,
  found: true,
  report_date: day,
  weather: long,
  manpower: long,
  subs_on_site: long,
  issues: long,
  deliveries: long,
  delays: long,
  safety: long,
  lines: [
    {
      work: long,
      activity_id: long,
      sov_item: long,
      qty: 1234567.5,
      unit: "linear feet",
      crew: 12,
      hours: 8,
    },
  ],
};
const production: ProductionReport = {
  job_id: id,
  job_number: "SYN-001",
  job_name: long,
  company: long,
  time_zone_used: "America/Chicago",
  captured_at: "2026-11-01T12:00:00Z",
  period: { from: day, to: day },
  reports_count: 1,
  complete: true,
  planned_rate: null,
  earned_value: null,
  source: "current_saved_dailies",
  references: "reported_unverified",
  groups: [
    {
      sov_item: long,
      activity_id: long,
      unit: "LF",
      quantity: 1234567.5,
      reported_person_hours: 96,
      actual_rate: 12860.08,
      records: 1,
    },
  ],
  rows: [
    {
      id: "synthetic",
      daily_id: "synthetic",
      report_date: day,
      created_at: day,
      work: long,
      sov_item: long,
      activity_id: long,
      unit: "LF",
      qty: 1234567.5,
      crew: 12,
      hours: 8,
      man_hours: 96,
      qty_per_man_hour: 12860.08,
    },
  ],
};
const seats = { tier: "athena_office", limit: 10, members: 1, pending: 1 };
const team: AccountTeam = {
  companyId: id,
  companyName: long,
  isOwner: true,
  seats,
  team: {
    seats,
    roles_allowed: null,
    members: [
      {
        user_id: id,
        display_name: long,
        email: "synthetic-long-reference-for-layout-testing@example.invalid",
        role: "pm",
        locked: false,
        jobs: ["SYN-001"],
      },
    ],
    pending: [
      {
        email: "synthetic-pending-for-layout@example.invalid",
        display_name: long,
        role: "pm",
        invited_at: day,
      },
    ],
    jobs: [{ job_number: "SYN-001", name: long, restricted: false }],
  },
};
const route = (r: unknown) => h((r as { component: ComponentType }).component);
const morning = buildMorningBrief({
  hasCompany: true,
  now: new Date("2026-11-01T12:00:00Z"),
  jobs: [
    {
      job_id: id,
      company_id: id,
      company_name: long,
      job_number: "SYN-001",
      name: long,
      time_zone: "America/Chicago",
      scope: "full",
      seat: "owner",
      activities: [],
      items: [{ id, action: long, owner: long, due: day }],
      lookahead: null,
      payApps: [],
      invoices: [],
      links: {},
    },
  ],
});
const buyout = {
  company_id: id,
  job_id: id,
  today: day,
  can_manage_directory: false,
  can_record: false,
  parties: [],
  orders: [],
  documents: [],
  submittals: [],
  bills: [],
  schedule_activities: [],
  records: [
    {
      id,
      kind: "package",
      version: 1,
      versions: [],
      facts: {
        code: "SYN-001",
        title: long,
        scope: long,
        budget_cents: 9000000000000,
        currency: "USD",
        status: "draft",
        candidates: [],
        selected_party_id: null,
        commitment_refs: [],
        expected_award_on: null,
        needed_by: null,
        submittal_ids: [],
        schedule_ref: null,
        source: long,
      },
    },
  ],
};
const previews: Record<string, () => ReactNode> = {
  buyout: () =>
    h(
      "main",
      { className: "po-workspace", style: { padding: 16 } },
      h(PurchaseOrderBuyout, {
        jobId: id,
        companyId: id,
        userId: "synthetic",
        rpc: state.calls,
        onOpenOrder: state.calls,
      }),
    ),
  "project-home": () => h(JobHome, { jobId: id }),
  "daily-review": () => h(DailyReportReview, { payload: daily, jobId: id, memberId: "synthetic" }),
  "daily-capture": () =>
    h(
      "main",
      { className: "dr-workspace" },
      h(DailyReportCapture, { jobId: id, identity: long, initialDate: day, onClose: state.calls }),
    ),
  production: () => h(ProductionReportPage, { jobId: id, from: day, to: day }),
  "account-overview": () =>
    h(AthenaAccountLayout, {
      name: long,
      email: "synthetic-long-reference-for-layout-testing@example.invalid",
      companyName: long,
      organization: { name: long, status: "ready" },
      plan: "Athena Office",
      seats: "2 of 10",
      teamLoading: false,
      teamError: false,
      canViewSupport: true,
      onSignOut: state.calls,
      profile: null,
      company: null,
      team: null,
      billing: null,
      projects: null,
      briefing: null,
      guide: null,
    }),
  "account-team": () =>
    h(
      "main",
      { className: "mx-auto max-w-5xl p-6" },
      h(TeamSection, { state: team, loading: false, reload: state.calls }),
    ),
  "account-organization": () =>
    h(
      "main",
      { className: "mx-auto max-w-5xl p-6" },
      h(OrganizationProfile, {
        user: { id, email: "synthetic@example.invalid" },
        company: null,
        loading: false,
        error: null,
        workspaceName: long,
        refetch: state.calls,
      }),
    ),
  "morning-brief": () => h(TodayBriefView, { html: renderHtml(morning.card), error: null }),
  "account-projects": () =>
    h(
      "main",
      { className: "aa-app p-4" },
      h(ProjectHomeLinks, { jobs: [{ id, job_number: "SYN-001", name: long }] }),
    ),
  "rfi-log": () => h(RequestLogPage, { jobId: id, kind: "rfi" }),
  "rfc-log": () => h(RequestLogPage, { jobId: id, kind: "rfc" }),
  "change-log": () => h(ChangeOrderLogPage, { jobId: id }),
  "forgot-password": () => route(forgot),
  "reset-checking": () => route(reset),
  "auth-callback": () => route(callback),
  "board-sign-in": () => h(BoardSignIn, { returnTo: `/r/job/${id}/home` }),
  login: () => route(login),
  "login-code": () =>
    h(LoginForm as ComponentType<{ initialCodeSent?: boolean }>, { initialCodeSent: true }),
  "magic-link": () => route(magic),
  "oauth-consent": () => route(consent),
  "support-list": () => route(support),
  "support-detail": () => route(support),
};
describe("board and account responsive fixtures", () => {
  it.each(Object.keys(previews))("renders %s without running any reads or mutations", (name) => {
    state.search = name === "support-detail" ? { ticket: id } : {};
    state.queries = {
      field: {
        page: "field",
        scope: "full",
        job_number: "SYN-001",
        job_name: long,
        company: long,
        items: [{ id, action: long, owner: long }],
      },
      schedule: { page: "schedule", report: { found: false } },
      submittals: { page: "submittals", submittals: [] },
      daily,
      lookahead: { page: "lookahead", report: { found: false } },
      payapp: { page: "payapp", report: { found: false } },
      ior: { page: "ior", report: { found: false } },
      "job-home-jobs": [],
      "daily-report-index": { dates: [day] },
      "production-report": production,
      "support-dashboard":
        name === "support-detail"
          ? {
              ticket: {
                ticket_number: "SYN-001",
                subject: long,
                from_email: "synthetic@example.invalid",
                brand: "athena",
                status: "open",
              },
              messages: [
                {
                  id,
                  received_at: day,
                  evidence: { text: long, attachments: [{ filename: long + ".pdf" }] },
                  deliveries: [{ kind: "owner", state: "delivered", text: long }],
                },
              ],
            }
          : {
              tickets: [
                {
                  id,
                  ticket_number: "SYN-001",
                  subject: long,
                  from_email: "synthetic-long-reference-for-layout@example.invalid",
                  status: "open",
                  last_update: day,
                },
              ],
            },
    };
    state.queries["po-buyout"] = buyout;
    state.queries["athena-request-log"] = {
      job_id: id,
      job_number: "SYN-001",
      job_name: long,
      today: day,
      read_only: false,
      records: [
        {
          id,
          number: "SYN-001",
          title: long,
          revision: 1,
          transmittal_number: 1,
          state: "sent",
          request_details: {
            condition: long,
            question: long,
            references: [{ kind: "drawing", citation: long }],
            recipient_name: long,
            due_date: day,
          },
          change_order_details: {
            state: "priced",
            record_version: 1,
            origin: "contractor",
            condition: long,
            scope: long,
            references: [],
            lines: [
              { category: "material", description: long, source: long, amount_cents: 123456789012 },
            ],
            total_cents: 123456789012,
          },
        },
      ],
    };
    const markup = renderToStaticMarkup(h("div", null, previews[name]()));
    expect(markup).not.toBe("");
    expect(state.calls).not.toHaveBeenCalled();
    if (process.env.ATHENA_RESPONSIVE_ARTIFACTS) {
      const directory = process.env.ATHENA_RESPONSIVE_ARTIFACTS;
      mkdirSync(directory, { recursive: true });
      const css = readdirSync(".output/public/assets")
        .filter((f) => f.endsWith(".css"))
        .map((f) => readFileSync(join(".output/public/assets", f), "utf8"))
        .join("\n");
      const font = readFileSync("src/routes/__root.tsx", "utf8").match(
        /https:\/\/fonts\.googleapis\.com\/css2[^"\s]+/,
      )?.[0];
      writeFileSync(
        join(directory, name + ".html"),
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${font ? `<link rel="stylesheet" href="${font.replaceAll("&", "&amp;")}">` : ""}<style>${css}</style></head><body>${markup}</body></html>`,
      );
      cpSync("public/brand", join(directory, "brand"), { recursive: true });
      writeFileSync(join(directory, "board-cases.json"), JSON.stringify(Object.keys(previews)));
    }
  });
});
