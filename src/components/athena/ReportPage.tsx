import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderReportBody, type PagePayload, type ReportPage } from "@/lib/report-pages";

// Signed-in living report page. The app's auth gate already sends signed-out visitors to /login?redirect=<this page>
// and back. The database decides access (company membership + job scope); this only renders what it returns.
export function ReportPageView({ page, jobId, companyId }: { page: ReportPage; jobId?: string; companyId?: string }) {
  const q = useQuery({
    queryKey: ["athena-report-page", page, jobId ?? null, companyId ?? null],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
        "mcp_report_page_get", { _page: page, _job: jobId ?? null, _company: companyId ?? null });
      if (error) throw new Error(error.message);
      return data as PagePayload;
    },
    retry: false,
  });
  if (q.isLoading) return <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>;
  if (q.error || !q.data) {
    return (
      <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", border: "1px solid #D1D5DB", borderRadius: 12, padding: 32, color: "#6B7280" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#2563EB" }}>You don't have access to this page</h1>
        <p style={{ margin: 0 }}>It's private to the company's members with access to this job. Ask your company owner if you need it.</p>
      </div>
    );
  }
  // renderReportBody escapes every value it prints.
  return <div style={{ background: "#F3F4F6", minHeight: "100%" }} dangerouslySetInnerHTML={{ __html: renderReportBody(q.data) }} />;
}
