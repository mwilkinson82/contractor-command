import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { requestLogCard, type RequestKind, type RequestLogPayload } from "@/lib/mcp/request-log";
import { openRequestLog } from "@/lib/request-log.functions";
import { BoardSignIn } from "./BoardSignIn";
import { redactMoney } from "@/lib/board-redact";
import { AthenaPage, CardModelPage } from "./AthenaPage";
import { readRequestLog, boundedRequestRead, type RequestLogRpc } from "@/lib/request-log-read";

export function RequestLogPage({
  jobId,
  kind,
  token,
}: {
  jobId: string;
  kind: RequestKind;
  token?: string;
}) {
  const { session, loading } = useAuth();
  const [state, setState] = useState<"all" | "draft" | "sent" | "answered" | "closed">("all");
  const [overdue, setOverdue] = useState(false);
  const open = useServerFn(openRequestLog);
  const member = useQuery({
    queryKey: ["athena-request-log", jobId, kind, session?.user.id ?? null],
    enabled: !loading && !!session,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async () => {
      return readRequestLog(supabase.rpc.bind(supabase) as unknown as RequestLogRpc, jobId, kind);
    },
  });
  const linked = useQuery({
    queryKey: ["athena-request-log-link", jobId, kind, token ?? ""],
    enabled: !loading && !!token,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: () => boundedRequestRead(() => open({ data: { jobId, kind, token: token! } })),
  });
  const payload =
    (!member.error ? member.data : null) ??
    (linked.data?.status === "ok" && linked.data.payload
      ? // Read through a link alone (signed out): no dollar figures.
        session
        ? (JSON.parse(linked.data.payload) as RequestLogPayload)
        : redactMoney(JSON.parse(linked.data.payload) as RequestLogPayload)
      : null);
  const path = `/r/job/${jobId}/${kind}s`;
  const board = `https://app.meetathena.io/r/job/${jobId}/submittals${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  if (payload) {
    const { card } = requestLogCard(kind, payload, board, {
      state: state === "all" ? undefined : state,
      overdue,
    });
    return (
      <AthenaPage jobId={jobId} token={token} account={session?.user.email}>
        <CardModelPage
          card={card}
          skip={["Live log"]}
          filters={
            <>
              <label>
                Status
                <select
                  value={state}
                  onChange={(event) => setState(event.target.value as typeof state)}
                >
                  <option value="all">All</option>
                  <option value="draft">Draft, not sent</option>
                  <option value="sent">Sent</option>
                  <option value="answered">Answered</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className="ath-page-check">
                <input
                  type="checkbox"
                  checked={overdue}
                  onChange={(event) => setOverdue(event.target.checked)}
                />
                Overdue targets only
              </label>
            </>
          }
        />
      </AthenaPage>
    );
  }
  if (loading || member.isFetching || linked.isFetching)
    return (
      <AthenaPage jobId={jobId} token={token}>
        <p role="status" className="ath-page-status">
          Loading your {kind.toUpperCase()} log…
        </p>
      </AthenaPage>
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
