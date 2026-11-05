import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { openChangeLog } from "@/lib/change-log.functions";
import { readChangeLog, type ChangeLogRpc } from "@/lib/change-log-read";
import type { ChangeLogPayload } from "@/lib/mcp/change-orders";
import { BOARD_CO_ROWS, boardCoRows, coCounts } from "@/lib/notices/board-change-orders";
import { usePageVisible } from "./ReportPage";
import { useJobNotices } from "./JobHomeWhatsNew";
import "./job-home-notices.css";

const CO_POLL_MS = 30_000;

/** The board's change order rows. A client's approval or decline on the client page shows with who and when. */
export function JobHomeChangeOrders({
  jobId,
  token,
  companyId,
}: {
  jobId: string;
  token?: string;
  companyId?: string;
}) {
  void companyId;
  const { session, loading } = useAuth();
  const visible = usePageVisible();
  const open = useServerFn(openChangeLog);
  const q = useQuery({
    queryKey: ["job-home-cos", jobId, session?.user.id ?? null, token ?? ""],
    enabled: !loading && (!!session || !!token),
    retry: false,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query: { state: { error: unknown } }) =>
      visible && !query.state.error ? CO_POLL_MS : false,
    queryFn: async (): Promise<ChangeLogPayload> => {
      if (session) {
        try {
          return await readChangeLog(supabase.rpc.bind(supabase) as unknown as ChangeLogRpc, jobId);
        } catch (e) {
          if (!token) throw e;
        }
      }
      const linked = await open({ data: { jobId, token: token! } });
      if (linked.status === "ok" && linked.payload)
        return JSON.parse(linked.payload) as ChangeLogPayload;
      throw new Error("Change orders are unavailable.");
    },
  });
  // A new client decision notice refreshes the rows at once instead of waiting for the next poll.
  const notices = useJobNotices(jobId, token);
  const latestDecision = notices.list?.notices.find((n) => n.topic === "client_decision")?.id ?? null;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!latestDecision) return;
    if (seen.current && seen.current !== latestDecision)
      void (q as { refetch?: () => unknown }).refetch?.();
    seen.current = latestDecision;
  }, [latestDecision, q]);

  const payload =
    !q.error && q.data && Array.isArray((q.data as ChangeLogPayload).records)
      ? (q.data as ChangeLogPayload)
      : null;
  const rows = payload ? boardCoRows(payload) : [];
  const counts = coCounts(rows);
  const logHref = `/r/job/${jobId}/cos${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  return (
    <div className="jh-panel jhn-panel jhn-cos">
      <div className="jhn-head">
        <h2>Change orders</h2>
        <a className="jhn-see-all" href={logHref}>
          See all <span aria-hidden="true">→</span>
        </a>
      </div>
      <div className="jh-panel-body jhn-body">
        {!session && !token && !loading ? (
          <p>Sign in to see this job's change orders.</p>
        ) : loading || q.isLoading ? (
          <p role="status">Loading change orders…</p>
        ) : !payload ? (
          <p>Change orders are unavailable right now. Full job access is needed to see them.</p>
        ) : !rows.length ? (
          <p className="jhn-empty">No change orders on this job yet.</p>
        ) : (
          <>
            <p className="jhn-summary">
              {counts.total} on the log · {counts.waiting} waiting on the client · {counts.approved}{" "}
              approved · {counts.declined} declined
            </p>
            <div className="jhn-co-table" role="table" aria-label="Change orders">
              <div className="jhn-co-row jhn-co-headrow" role="row">
                <span role="columnheader">Number</span>
                <span role="columnheader">Title</span>
                <span role="columnheader">Status</span>
                <span role="columnheader" className="jhn-num">
                  Amount
                </span>
                <span role="columnheader" className="jhn-num">
                  Days
                </span>
              </div>
              {rows.slice(0, BOARD_CO_ROWS).map((row) => (
                <div className="jhn-co-row" role="row" key={row.id}>
                  <span role="cell" className="jhn-co-number">
                    {row.number}
                  </span>
                  <span role="cell" className="jhn-co-title">
                    {row.title}
                    {row.decision ? <small className="jhn-co-decision">{row.decision}</small> : null}
                  </span>
                  <span role="cell">
                    <span className={`jhn-status jhn-status-${row.tone}`}>{row.status}</span>
                  </span>
                  <span role="cell" className="jhn-num" data-label="Amount">
                    {row.amount ?? "Not priced"}
                  </span>
                  <span role="cell" className="jhn-num" data-label="Days">
                    {row.days}
                  </span>
                </div>
              ))}
            </div>
            {rows.length > BOARD_CO_ROWS ? (
              <p className="jhn-more">
                Showing {BOARD_CO_ROWS} of {rows.length}. <a href={logHref}>See all change orders</a>
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
