import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { openBoardPage } from "@/lib/board-link.functions";
import { BoardSignIn } from "./BoardSignIn";
import { usePageVisible } from "./ReportPage";
import { dedupeOpenRows } from "@/lib/mcp/open-feed";
import { lookaheadModel, lookaheadWindow, type SAct } from "@/lib/mcp/styled-views";
import { currentSubmittals } from "@/lib/mcp/submittals";
import type { BoardPage } from "@/lib/mcp/board-link";
import { jobHomePath } from "@/lib/report-pages";
import type {
  PagePayload,
  FieldPagePayload,
  JobPayload,
  SubmittalsPagePayload,
  DailyPagePayload,
} from "@/lib/report-pages";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
type Job = { id: string; job_number: string; name: string | null; company_id: string };

/** A home composes existing scoped board reads; it never saves a separate dashboard. */
export function JobHome({ jobId, token }: { jobId: string; token?: string }) {
  const { session, loading } = useAuth();
  const open = useServerFn(openBoardPage);
  const visible = usePageVisible();
  const read = async (page: BoardPage): Promise<PagePayload> => {
    if (session) {
      const result = await rpc("mcp_report_page_get", { _page: page, _job: jobId, _company: null });
      if (
        !result.error &&
        result.data &&
        typeof result.data === "object" &&
        (result.data as PagePayload).page === page
      )
        return result.data as PagePayload;
    }
    if (token) {
      const result = await open({ data: { token, jobId, page } });
      if (result.status === "ok") return JSON.parse(result.payload) as PagePayload;
    }
    throw new Error("This view is unavailable.");
  };
  const field = useQuery({
    queryKey: ["job-home", jobId, "field", session?.user.id, token],
    enabled: !loading && (!!session || !!token),
    queryFn: () => read("field"),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (q) => (visible && !q.state.error ? 60_000 : false),
  });
  const base =
    !field.error && field.data?.page === "field" ? (field.data as FieldPagePayload) : undefined;
  const full = base?.scope === "full";
  const extra = (page: BoardPage, enabled = true) => ({
    queryKey: ["job-home", jobId, page, session?.user.id, token],
    enabled: !!base && enabled,
    queryFn: () => read(page),
    retry: false as const,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (q: { state: { error: unknown } }) =>
      visible && !q.state.error ? 60_000 : false,
  });
  // Each source is independent: an unavailable read cannot be mistaken for zero records.
  const schedule = useQuery(extra("schedule"));
  const lookahead = useQuery(extra("lookahead"));
  const submittals = useQuery(extra("submittals"));
  const daily = useQuery(extra("daily"));
  const billing = useQuery(extra("payapp", full));
  const ior = useQuery(extra("ior", full));
  const jobs = useQuery({
    queryKey: ["job-home-jobs", session?.user.id],
    enabled: !!session && !!base,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcp_jobs")
        .select("id, job_number, name, company_id")
        .order("job_number");
      if (error) throw error;
      return (data ?? []) as Job[];
    },
  });
  if (loading || field.isLoading)
    return (
      <main className="job-home">
        <p role="status">Loading project…</p>
      </main>
    );
  if (!base) return <BoardSignIn returnTo={`/r/job/${jobId}/home`} />;
  const href = (page: string) =>
    `/r/job/${jobId}/${page}${token && page !== "purchase-orders" && page !== "billing-records" ? `?t=${encodeURIComponent(token)}` : ""}`;
  const state = (q: { isLoading: boolean; error: unknown }, text: string) =>
    q.isLoading ? "Loading…" : q.error ? "Currently unavailable" : text;
  const sched = schedule.data?.page === "schedule" ? (schedule.data as JobPayload).report : null;
  const subs =
    submittals.data?.page === "submittals" ? (submittals.data as SubmittalsPagePayload) : null;
  const today = daily.data?.page === "daily" ? (daily.data as DailyPagePayload) : null;
  const la = lookahead.data?.page === "lookahead" ? lookahead.data : null;
  const laWindow = la
    ? lookaheadWindow(la.lookahead ?? null, la.report?.found ? (la.report.data_date ?? null) : null)
    : null;
  const laDetail =
    laWindow && la && Array.isArray(la.report?.data?.activities)
      ? `${lookaheadModel(laWindow.start, laWindow.end, (la.report?.data?.activities ?? []) as SAct[], la.items ?? [], { today: la.today, dataDate: la.report?.data_date }).counts.activities} activities in window`
      : laWindow
        ? "Activity details unavailable"
        : la?.report && typeof la.report.found === "boolean"
          ? "No lookahead window or saved schedule yet"
          : "Currently unavailable";
  const count = Array.isArray(base.items)
    ? dedupeOpenRows(
        (base.items ?? []).map((item, i) => ({
          ...item,
          id: item.id || String(i),
          action: item.action || "Item",
        })),
      ).length
    : null;
  const tiles = [
    {
      title: "Schedule",
      detail: state(
        schedule,
        sched?.found
          ? Array.isArray(sched.data?.activities)
            ? `${sched.data.activities.length} saved activities`
            : "Activity details unavailable"
          : sched?.found === false
            ? "No schedule recorded yet"
            : "Currently unavailable",
      ),
      page: "schedule",
    },
    { title: "Two-week lookahead", detail: state(lookahead, laDetail), page: "lookahead" },
    {
      title: "Open items",
      detail:
        count === null
          ? "Currently unavailable"
          : `${count} open ${count === 1 ? "item" : "items"}`,
      page: "items",
    },
    {
      title: "Submittals",
      detail: state(
        submittals,
        subs && Array.isArray(subs.submittals)
          ? `${currentSubmittals(subs.submittals).filter((row) => row.status !== "void").length} current submittals`
          : "Currently unavailable",
      ),
      page: "submittals",
    },
    { title: "RFI log", detail: "View saved requests", page: "rfis" },
    { title: "RFC log", detail: "View saved requests", page: "rfcs" },
    {
      title: "Daily reports",
      detail: state(
        daily,
        today?.found
          ? `Latest report · ${today.report_date ?? "Date not recorded"}`
          : today?.found === false
            ? "No report recorded yet"
            : "Currently unavailable",
      ),
      page: "daily",
    },
    { title: "Field board", detail: "Activities, crews and follow-ups", page: "field" },
    { title: "Progress photos", detail: "View saved photos", page: "photos" },
    ...(full
      ? [
          { title: "Change orders", detail: "View saved log", page: "cos" },
          {
            title: "Suppliers and purchase orders",
            detail: "View project parties and PO drafts",
            page: "purchase-orders",
          },
          {
            title: "Billing and payment records",
            detail: "View recorded invoices and receipts",
            page: "billing-records",
          },
          {
            title: "Billing forecast",
            detail: state(
              billing,
              billing.data?.page === "payapp" && billing.data.report?.found
                ? "View saved billing"
                : billing.data?.page === "payapp" && billing.data.report?.found === false
                  ? "No billing recorded yet"
                  : "Currently unavailable",
            ),
            page: "payapp",
          },
          {
            title: "Indicated Outcome Report",
            detail: state(
              ior,
              ior.data?.page === "ior" && ior.data.report?.found
                ? "View saved IOR"
                : ior.data?.page === "ior" && ior.data.report?.found === false
                  ? "No IOR recorded yet"
                  : "Currently unavailable",
            ),
            page: "ior",
          },
        ]
      : []),
  ];
  return (
    <main className="job-home">
      <style>{`
    .job-home{min-height:100vh;background:#f2f5f9;color:#183453;font-family:system-ui,-apple-system,sans-serif;padding:32px 20px 56px}.job-home *{box-sizing:border-box}.jh-wrap{max-width:1120px;margin:auto}.jh-top{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}.jh-brand{font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:#2465cb}.jh-select{display:grid;gap:5px;color:#53677d;font-size:12px;font-weight:700}.jh-select select{min-height:44px;max-width:100%;border:1px solid #cbd6e3;background:white;color:#183453;border-radius:9px;padding:8px 12px;font:inherit;font-size:14px}.jh-hero{margin:26px 0 28px;padding:28px;border-radius:18px;background:white;border:1px solid #dce5ee;box-shadow:0 8px 30px #18345309}.jh-hero h1{font-size:clamp(26px,4vw,38px);line-height:1.15;letter-spacing:-.03em;margin:8px 0}.jh-hero p{margin:0;color:#5b6e82;line-height:1.5}.jh-section{font-size:18px;margin:0 0 14px}.jh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:14px}.jh-card{min-height:126px;display:flex;flex-direction:column;justify-content:space-between;gap:12px;padding:20px;background:white;border:1px solid #dce5ee;border-radius:14px;color:#183453;text-decoration:none;box-shadow:0 3px 12px #18345308}.jh-card:hover,.jh-card:focus-visible{border-color:#3577d8;box-shadow:0 4px 18px #1d5ebc20;outline:2px solid transparent}.jh-card strong{font-size:16px}.jh-card span{font-size:13px;line-height:1.4;color:#5b6e82}.jh-card b{color:#2465cb;font-size:13px}.jh-note{margin-top:24px;color:#5b6e82;font-size:13px;line-height:1.5}.jh-note a{color:#2465cb}.jh-error{color:#8b3340}
  `}</style>
      <div className="jh-wrap">
        <div className="jh-top">
          <div className="jh-brand">Athena · Project home</div>
          {jobs.data && jobs.data.length > 1 ? (
            <label className="jh-select">
              Saved jobs
              <select
                value={jobId}
                onChange={(e) => {
                  if (e.target.value !== jobId) window.location.assign(jobHomePath(e.target.value));
                }}
              >
                {jobs.data.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_number} · {j.name ?? "Saved job"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <header className="jh-hero">
          <p>{base.company || "Your project"}</p>
          <h1>
            {base.job_number} {base.job_name ? `· ${base.job_name}` : ""}
          </h1>
          <p>
            Your saved project views, together in one place. Open a view for its latest details.
          </p>
        </header>
        <h2 className="jh-section">Project views</h2>
        <div className="jh-grid">
          {tiles.map((tile) => (
            <a className="jh-card" key={tile.page} href={href(tile.page)}>
              <strong>{tile.title}</strong>
              <span>{tile.detail}</span>
              <b>Open →</b>
            </a>
          ))}
        </div>
        <p className="jh-note">
          Saved contracts, specifications and drawings are available through Athena in chat. Ask to
          list this job’s project documents or drawing sets.
        </p>
        <p className="jh-note">
          <a href="/today">Open morning brief</a> · Project views refresh from saved records while
          this page is open.
        </p>
      </div>
    </main>
  );
}
