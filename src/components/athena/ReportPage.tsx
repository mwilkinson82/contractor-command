import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  jobHomePath,
  renderReportBody,
  reportPageQuery,
  type PagePayload,
  type AnyPage,
  type FieldPagePayload,
  type ItemsPagePayload,
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

export function ReportPageView({ page, jobId, companyId, token, reportDate }: { page: AnyPage; jobId?: string; companyId?: string; token?: string; reportDate?: string }) {
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
      const stamp = typeof st.data === "string" ? st.data : null;
      if (prev && stamp !== null && prev.stamp === stamp) return prev;
      const { data, error } = await rpc("mcp_report_page_get", args);
      if (error) throw error;
      const payload = data as PagePayload;
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
    const body = payload ? renderReportBody(payload, { jobId }) : "";
    return token && body ? signSiblingLinks(body, token) : body;
  }, [payload, token, jobId]);
  const jobNumber = payload && payload.page !== "portfolio" ? (payload.job_number ?? null) : null;
  const live = (
    <div style={{ background: "#F3F4F6", minHeight: "100%" }}>
      {page === "portfolio" && memberPayload ? <MorningBriefPushBar /> : null}
      {jobId ? (
        <nav
          aria-label="Project navigation"
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "16px 16px 0",
            display: "flex",
            gap: 20,
            font: "13px system-ui, sans-serif",
          }}
        >
          <a
            href={`${jobHomePath(jobId)}${token ? `?t=${encodeURIComponent(token)}` : ""}`}
            style={{ color: "#1E5FED" }}
          >
            Project home
          </a>
          <a href="/today" style={{ color: "#1E5FED" }}>
            Morning brief
          </a>
        </nav>
      ) : null}
      {page === "field" && jobId ? <FieldPushBar jobId={jobId} jobNumber={jobNumber} /> : null}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
  if (authLoading || (!payload && ((session && q.isLoading) || (token && jobId && tokenPage && linked.isLoading)))) return <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>;
  // Either the scoped member read or the validated key can open the live board.
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
