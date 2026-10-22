import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderReportBody, reportPageQuery, type PagePayload, type AnyPage, type FieldPagePayload, type ItemsPagePayload } from "@/lib/report-pages";
import { FieldPushBar } from "@/components/athena/FieldPushBar";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { openBoardPage } from "@/lib/board-link.functions";
import { BOARD_PAGES, type BoardLinkStatus } from "@/lib/mcp/board-link";

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

// Signed-in living report page. The app's auth gate already sends signed-out visitors to /login?redirect=<this page>
// and back. The database decides access (company membership + job scope); this only renders what it returns.
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

const TOKEN_COPY: Record<Exclude<BoardLinkStatus, "ok">, string> = {
  expired: "This board link has expired. Ask Athena for a fresh one.",
  revoked: "This board link was turned off. Ask Athena for a fresh one.",
  wrong_job: "This link does not open that job.",
  denied: "This link cannot open that page.",
  unknown: "This board link does not work. Ask Athena for a fresh one.",
};

export function ReportPageView({ page, jobId, companyId, token }: { page: AnyPage; jobId?: string; companyId?: string; token?: string }) {
  const openLink = useServerFn(openBoardPage);
  const { session, loading: authLoading } = useAuth();
  const tokenPage = (BOARD_PAGES as readonly string[]).includes(page) ? page : "";
  const visible = usePageVisible();
  const qc = useQueryClient();
  const query = reportPageQuery(page, jobId, companyId);
  const key = ["athena-report-page", query.view, query.args._page, jobId ?? null, companyId ?? null, session?.user?.id ?? null] as const;
  const args = query.args;
  const q = useQuery({
    queryKey: key,
    enabled: !authLoading && !!session,
    // Refresh every 60 s only while the page is visible; hidden tabs make no calls.
    refetchInterval: visible ? REFRESH_MS : false,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<Cached> => {
      const prev = qc.getQueryData<Cached>(key);
      // Lightweight check first: when the saved version / saved-at stamp hasn't changed, keep the same object
      // (no full read, no re-render).
      const st = await rpc("mcp_report_page_stamp", args);
      if (st.error) throw new Error(st.error.message);
      const stamp = typeof st.data === "string" ? st.data : null;
      if (prev && stamp !== null && prev.stamp === stamp) return prev;
      const { data, error } = await rpc("mcp_report_page_get", args);
      if (error) throw new Error(error.message);
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
    enabled: !authLoading && !session && !!token && !!jobId && !!tokenPage,
    queryFn: () => openLink({ data: { token: token!, jobId: jobId!, page: tokenPage as (typeof BOARD_PAGES)[number] } }),
    retry: false,
  });
  const payload = session
    ? q.data?.payload
    : linked.data?.status === "ok"
      ? (JSON.parse(linked.data.payload) as PagePayload)
      : undefined;
  // renderReportBody escapes every value it prints. Re-rendered only when a new payload arrives.
  const html = useMemo(() => (payload ? renderReportBody(payload) : ""), [payload]);
  if (authLoading || (session && q.isLoading) || (!session && token && linked.isLoading)) return <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>;
  if (!session && linked.data && linked.data.status !== "ok") {
    return (
      <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", border: "1px solid #D1D5DB", borderRadius: 12, padding: 32, color: "#6B7280" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#1E3A5F" }}>{TOKEN_COPY[linked.data.status]}</h1>
      </div>
    );
  }
  // A valid board token already has a payload. Sign-in is only for a visitor with neither a session nor a payload.
  if (!session && !payload) {
    const back = typeof window === "undefined" ? `/r/job/${jobId ?? ""}/${query.view}` : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return (
      <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", border: "1px solid #D1D5DB", borderRadius: 12, padding: 32, color: "#6B7280" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#1E3A5F" }}>Sign in to open this page</h1>
        <p style={{ margin: 0 }}><a href={`/login?redirect=${encodeURIComponent(back)}`} style={{ color: "#2563EB" }}>Sign in</a> and you will come straight back here.</p>
      </div>
    );
  }
  // Signed-in members with no row see "no access". A token payload skips this branch.
  if (!payload || (session && q.error)) {
    return (
      <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", border: "1px solid #D1D5DB", borderRadius: 12, padding: 32, color: "#6B7280" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#2563EB" }}>You don't have access to this page</h1>
        <p style={{ margin: 0 }}>It's private to the company's members with access to this job. Ask your company owner if you need it.</p>
      </div>
    );
  }
  const jobNumber = payload.page === "portfolio" ? null : payload.job_number;
  return (
    <div style={{ background: "#F3F4F6", minHeight: "100%" }}>
      {page === "field" && jobId ? <FieldPushBar jobId={jobId} jobNumber={jobNumber} /> : null}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
