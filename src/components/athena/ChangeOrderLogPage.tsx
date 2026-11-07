import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { changeLogCard, type ChangeLogPayload } from "@/lib/mcp/change-orders";
import { openChangeLog } from "@/lib/change-log.functions";
import { BoardSignIn } from "./BoardSignIn";
import { AthenaPage, CardModelPage } from "./AthenaPage";
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
    // Change orders are money: a link alone never opens them, the sign-in below asks first.
    enabled: !loading && !!token && !!session,
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
    const { card } = changeLogCard(payload, board, {
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
                  <option value="priced">Priced</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="executed">Executed</option>
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
          Loading your change-order log…
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
      <BoardSignIn
        returnTo={`${path}${token ? `?t=${encodeURIComponent(token)}` : ""}`}
        {...(session
          ? {}
          : {
              title: "Sign in to see this job's money",
              lede: "Change orders show job money, so they open only for signed-in members of the company. You'll come straight back here.",
            })}
      />
    </main>
  );
}
