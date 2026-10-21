import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderReportBody, type PagePayload, type AnyPage } from "@/lib/report-pages";

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
export function ReportPageView({ page, jobId, companyId }: { page: AnyPage; jobId?: string; companyId?: string }) {
  const visible = usePageVisible();
  const qc = useQueryClient();
  const key = ["athena-report-page", page, jobId ?? null, companyId ?? null] as const;
  const args = { _page: page, _job: jobId ?? null, _company: companyId ?? null };
  const q = useQuery({
    queryKey: key,
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
      return { stamp, payload };
    },
    retry: false,
  });
  const payload = q.data?.payload;
  // renderReportBody escapes every value it prints. Re-rendered only when a new payload arrives.
  const html = useMemo(() => (payload ? renderReportBody(payload) : ""), [payload]);
  if (q.isLoading) return <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>;
  if (q.error || !payload) {
    return (
      <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", border: "1px solid #D1D5DB", borderRadius: 12, padding: 32, color: "#6B7280" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#2563EB" }}>You don't have access to this page</h1>
        <p style={{ margin: 0 }}>It's private to the company's members with access to this job. Ask your company owner if you need it.</p>
      </div>
    );
  }
  return <div style={{ background: "#F3F4F6", minHeight: "100%" }} dangerouslySetInnerHTML={{ __html: html }} />;
}
