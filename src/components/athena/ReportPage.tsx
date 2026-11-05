import { DailyReportReview } from "./DailyReportReview";
import { ProgressPhotosPage } from "./ProgressPhotosPage";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  renderReportBody,
  scheduleLayoutHref,
  reportPageQuery,
  type PagePayload,
  type AnyPage,
  type FieldPagePayload,
  type ItemsPagePayload,
  type PortfolioPayload,
} from "@/lib/report-pages";
import { FieldPushBar } from "@/components/athena/FieldPushBar";
import { MorningBriefPushBar } from "@/components/athena/MorningBriefPushBar";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { openBoardPage } from "@/lib/board-link.functions";
import { boardReturnForVisit } from "@/lib/board-sign-in";
import { BOARD_PAGES } from "@/lib/mcp/board-link";
import { BoardSignIn } from "@/components/athena/BoardSignIn";
import { ProjectReadUnavailable } from "@/components/athena/ProjectReadUnavailable";
import { AthenaPage } from "@/components/athena/AthenaPage";
import { OwnerPortfolio } from "@/components/athena/OwnerPortfolio";
import { productionClient, readProductionDaily } from "@/lib/production-report";
import { projectReadRecovery } from "@/lib/project-read-recovery";

type Rpc = (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = (f: string, a: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(f, a);
export const REFRESH_MS = 60_000;

/** True only while the tab is on screen (0.8.14: the 60-second refresh never runs in a hidden tab). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

type Cached = { stamp: string | null; payload: PagePayload };

// Living report page. A valid board token works independently of the browser session. A missing, expired, or bad token
// shows Athena's email-code sign-in and returns to this same /r/job path. The database decides access.
export function itemsFromField(payload: PagePayload): PagePayload {
  if (payload.page !== "field") return payload;
  const field = payload as FieldPagePayload;
  const items: ItemsPagePayload = {
    page: "items",
    company: field.company,
    job_number: field.job_number,
    job_name: field.job_name,
    items: field.items ?? [],
  };
  return items;
}

/** Sibling board pages (../items) and submittal records (submittal/<number>) keep the live token when the host adds utm params. */
export function signSiblingLinks(body: string, token: string): string {
  return body.replace(/href="(\.\.\/[a-z]+|submittal\/[^"?#]+)(?:\?([^"#]*))?"/g, (_match, path: string, search: string | undefined) => {
    const query = new URLSearchParams((search ?? "").replace(/&amp;/g, "&"));
    query.set("t", token);
    return `href="${path}?${query.toString().replace(/&/g, "&amp;")}"`;
  });
}

/** The company name a page payload already carries, so the top bar needs no extra read. */
function payloadCompany(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("company" in payload)) return undefined;
  const company = (payload as { company?: unknown }).company;
  return typeof company === "string" && company.trim() ? company : undefined;
}

export function ReportPageView({ page, jobId, companyId, token, reportDate, layout }: { page: AnyPage; jobId?: string; companyId?: string; token?: string; reportDate?: string; layout?: string }) {
  const openLink = useServerFn(openBoardPage);
  const { session, loading: authLoading } = useAuth();
  const datedDaily = page === "daily" && reportDate !== undefined;
  const tokenPage = !datedDaily && (BOARD_PAGES as readonly string[]).includes(page) ? page : "";
  const visible = usePageVisible();
  const qc = useQueryClient();
  const query = reportPageQuery(page, jobId, companyId);
  const key = ["athena-report-page", query.view, query.args._page, jobId ?? null, companyId ?? null, session?.user?.id ?? null, datedDaily ? reportDate : null] as const;
  const args = query.args;
  const q = useQuery({
    queryKey: key,
    enabled: !authLoading && !!session,
    // Refresh every 60 s only while the page is visible; hidden tabs make no calls.
    refetchInterval: visible ? REFRESH_MS : false,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<Cached> => {
      if (datedDaily && jobId) return { stamp: null, payload: await readProductionDaily(productionClient(supabase), jobId, reportDate!) };
      const prev = qc.getQueryData<Cached>(key);
      // Lightweight check first: when the saved version / saved-at stamp hasn't changed, keep the same object
      // (no full read, no re-render).
      const st = await rpc("mcp_report_page_stamp", args);
      if (st.error) throw st.error;
      let stamp = typeof st.data === "string" ? st.data : null;
      // The IOR also redraws when its job's CPM is saved again, since its finish comes from there.
      if (stamp !== null && args._page === "ior") {
        const cs = await rpc("mcp_report_page_stamp", { ...args, _page: "schedule" });
        stamp = `${stamp}#${!cs.error && typeof cs.data === "string" ? cs.data : "none"}`;
      }
      if (prev && stamp !== null && prev.stamp === stamp) return prev;
      const { data, error } = await rpc("mcp_report_page_get", args);
      if (error) throw error;
      let payload = data as PagePayload;
      // The IOR's finish follows the job's CPM. Read it with the member's own access; no schedule, no change.
      if (payload.page === "ior" && args._page === "ior") {
        const cpm = await rpc("mcp_report_page_get", { ...args, _page: "schedule" });
        const sched = !cpm.error ? (cpm.data as PagePayload | null) : null;
        if (sched && sched.page === "schedule") payload = { ...payload, schedule: sched.report };
      }
      if (payload.page === "photos" && payload.photos?.length) {
        const photos = await Promise.all(payload.photos.map(async (ph) => {
          if (ph.url || !ph.storage_path) return ph;
          const signed = await supabase.storage.from("athena-progress").createSignedUrl(ph.storage_path, 3600);
          return { ...ph, url: signed.data?.signedUrl ?? null };
        }));
        return { stamp, payload: { ...payload, photos } };
      }
      return { stamp, payload: query.view === "items" ? itemsFromField(payload) : payload };
    },
    retry: false,
  });
  const linked = useQuery({
    queryKey: ["athena-board-link", token ?? "", jobId ?? "", tokenPage],
    enabled: !authLoading && !!token && !!jobId && !!tokenPage,
    refetchInterval: visible ? REFRESH_MS : false,
    refetchIntervalInBackground: false,
    queryFn: () => openLink({ data: { token: token!, jobId: jobId!, page: tokenPage as (typeof BOARD_PAGES)[number] } }),
    retry: false,
  });
  // A rejected refresh must not render a previously cached member payload.
  const memberPayload = session && !q.error ? q.data?.payload : undefined;
  const payload = memberPayload ?? (!linked.error && linked.data?.status === "ok"
    ? (JSON.parse(linked.data.payload) as PagePayload)
    : undefined);
  // renderReportBody escapes every value it prints. Re-rendered only when a new payload arrives.
  // A live token keeps sibling board links on the same token when the host adds utm params.
  const html = useMemo(() => {
    const body = payload ? renderReportBody(payload, { jobId, layout: page === "schedule" ? (layout ?? null) : null, layoutHref: jobId ? scheduleLayoutHref : undefined }) : "";
    return token && body ? signSiblingLinks(body, token) : body;
  }, [payload, token, jobId, page, layout]);
  const jobNumber = payload && payload.page !== "portfolio" ? (payload.job_number ?? null) : null;
  const live = (
    <AthenaPage jobId={jobId} token={token} company={payloadCompany(payload)}>
      {page === "portfolio" && memberPayload ? (
        <div className="ath-page-bar">
          <MorningBriefPushBar />
        </div>
      ) : null}
      {page === "schedule" && payload ? (
        // The schedule page itself has no scripts, so printing to PDF is offered here.
        <div className="ath-page-bar ath-print-hide" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
          <button type="button" onClick={() => window.print()} style={{ background: "#1E5FED", color: "#fff", border: 0, borderRadius: 8, padding: "9px 14px", fontWeight: 700, cursor: "pointer" }}>
            Print or save as PDF
          </button>
        </div>
      ) : null}
      {page === "field" && jobId ? (
        <div className="ath-page-bar">
          <FieldPushBar jobId={jobId} jobNumber={jobNumber} />
        </div>
      ) : null}
      {page === "portfolio" && memberPayload?.page === "portfolio" ? (
        // Owners and leadership get the full portfolio: each job's contract, billing, cost and IOR, read with their own access.
        <OwnerPortfolio payload={memberPayload as PortfolioPayload} companyId={companyId} visible={visible} memberId={session?.user.id} />
      ) : (
        <div className="ath-page-embed" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </AthenaPage>
  );
  if (authLoading || (!payload && ((session && q.isLoading) || (token && jobId && tokenPage && linked.isLoading)))) return <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>;
  // Either the scoped member read or the validated key can open the live board.
  if (payload?.page === "daily" && jobId) return <DailyReportReview key={`${jobId}:${session?.user.id ?? "board"}:${reportDate ?? "latest"}`} payload={payload} jobId={jobId} memberId={memberPayload ? session?.user.id : undefined} token={token} />;
  // Photos get the responsive gallery and full-size viewer; the member read adds file and saved-by details.
  if (payload?.page === "photos" && jobId) return <ProgressPhotosPage key={`${jobId}:${reportDate ?? "all"}`} payload={payload} jobId={jobId} token={token} memberId={memberPayload ? session?.user.id : undefined} date={reportDate} />;
  if (payload) return live;
  // Only a missing/rejected session needs a code. A failed scoped read must not create a login loop.
  if (page !== "portfolio") {
    if (projectReadRecovery(!!session, q.error) === "unavailable")
      return <ProjectReadUnavailable />;
    const location = typeof window === "undefined" ? undefined : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const datedLocation = datedDaily && jobId ? `/r/job/${jobId}/daily?date=${encodeURIComponent(reportDate!)}` : undefined;
    const returnTo = boardReturnForVisit(page, jobId, location ?? datedLocation);
    if (returnTo) return <BoardSignIn returnTo={returnTo} />;
    return (
      <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", border: "1px solid #D1D5DB", borderRadius: 12, padding: 32, color: "#6B7280" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#1E3A5F" }}>Sign in to keep this board open</h1>
      </div>
    );
  }
  if (!session && !payload) {
    const back = typeof window === "undefined" ? `/r/portfolio/${companyId ?? ""}` : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return (
      <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", border: "1px solid #D1D5DB", borderRadius: 12, padding: 32, color: "#6B7280" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#1E3A5F" }}>Sign in to open this page</h1>
        <p style={{ margin: 0 }}><a href={`/login?redirect=${encodeURIComponent(back)}`} style={{ color: "#2563EB" }}>Sign in</a> and you will come straight back here.</p>
      </div>
    );
  }
  // The company portfolio retains its existing membership-only access screen.
  if (!payload) {
    return (
      <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", border: "1px solid #D1D5DB", borderRadius: 12, padding: 32, color: "#6B7280" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#2563EB" }}>You don't have access to this page</h1>
        <p style={{ margin: 0 }}>It's private to the company's members with access to this job. Ask your company owner if you need it.</p>
      </div>
    );
  }
  return live;
}
