import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { changeLogCard, type ChangeLogPayload } from "@/lib/mcp/change-orders";
import { renderHtml } from "@/lib/mcp/cards/html";
import { openChangeLog } from "@/lib/change-log.functions";
import { BoardSignIn } from "./BoardSignIn";
import { boundedRequestRead } from "@/lib/request-log-read";
import { readChangeLog, type ChangeLogRpc } from "@/lib/change-log-read";

export function ChangeOrderLogPage({ jobId, token }: { jobId: string; token?: string }) {
  const { session, loading } = useAuth();
  const [state, setState] = useState<
    "all" | "draft" | "priced" | "submitted" | "approved" | "rejected" | "executed"
  >("all");
  const [overdue, setOverdue] = useState(false);
  const open = useServerFn(openChangeLog);
  const member = useQuery({
    queryKey: ["athena-request-log", jobId, "co", session?.user.id ?? null],
    enabled: !loading && !!session,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async () => {
      return readChangeLog(supabase.rpc.bind(supabase) as unknown as ChangeLogRpc, jobId);
    },
  });
  const linked = useQuery({
    queryKey: ["athena-request-log-link", jobId, "co", token ?? ""],
    enabled: !loading && !!token,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: () => boundedRequestRead(() => open({ data: { jobId, token: token! } })),
  });
  const payload =
    (!member.error ? member.data : null) ??
    (linked.data?.status === "ok" && linked.data.payload
      ? (JSON.parse(linked.data.payload) as ChangeLogPayload)
      : null);
  const path = `/r/job/${jobId}/cos`;
  const board = `https://app.meetathena.io/r/job/${jobId}/submittals${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  if (payload) {
    const rendered = renderHtml(
      changeLogCard(payload, board, { state: state === "all" ? undefined : state, overdue }).card,
    );
    const style = rendered.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const body = rendered.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? "";
    return (
      <main style={{ padding: 16 }}>
        {session?.user.email && (
          <p style={{ color: "#6B7280", fontSize: 12 }}>Browser account: {session.user.email}</p>
        )}
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16, color: "#1E3A5F" }}
        >
          <label>
            Status{" "}
            <select
              value={state}
              onChange={(event) => setState(event.target.value as typeof state)}
            >
              <option value="all">All</option>
              <option value="draft">Draft, not sent</option>
              <option value="priced">Priced</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="executed">Executed</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={overdue}
              onChange={(event) => setOverdue(event.target.checked)}
            />{" "}
            Overdue targets only
          </label>
        </div>
        <div dangerouslySetInnerHTML={{ __html: `<style>${style}</style>${body}` }} />
      </main>
    );
  }
  if (loading || member.isFetching || linked.isFetching)
    return (
      <p role="status" style={{ padding: 24, color: "#1E3A5F" }}>
        Loading your change-order log…
      </p>
    );
  return (
    <main>
      {session && (
        <div style={{ padding: 24, color: "#1E3A5F" }}>
          <p>Browser account: {session.user.email}</p>
          <p role="alert">Your signed-in account could not load this job’s request log.</p>
          <button
            onClick={() => {
              void member.refetch();
              void linked.refetch();
            }}
          >
            Retry
          </button>
        </div>
      )}
      <BoardSignIn returnTo={`${path}${token ? `?t=${encodeURIComponent(token)}` : ""}`} />
    </main>
  );
}
