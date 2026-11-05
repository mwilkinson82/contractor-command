import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Bell, Mail } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  EMPTY_NOTICES,
  NOTICE_EMAILS_ANCHOR,
  groupNoticesByJob,
  jobLabel,
  markJobNoticesRead,
  noticeBoardHref,
  readMyNotices,
  relativeTime,
  type MyNotice,
  type NoticeRpc,
} from "@/lib/notices/board-notices";

const rpc: NoticeRpc = (name, args) =>
  (supabase.rpc as unknown as NoticeRpc).call(supabase, name, args);

export const ACCOUNT_NOTICE_LIMIT = 60;

/** Unread count across every job, for the account page's nav. */
export function useAccountNotices(enabled = true) {
  const { session, loading } = useAuth();
  return useQuery({
    queryKey: ["my-notices", session?.user.id ?? null],
    enabled: enabled && !loading && !!session,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: () => readMyNotices(rpc, { limit: ACCOUNT_NOTICE_LIMIT }),
  });
}

/** The account page's Notifications: what came back on every job, with mark read per notice and per job. */
export function AccountNotices() {
  const q = useAccountNotices();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const notices: MyNotice[] | null = Array.isArray(q.data)
    ? q.data.map((n) => (readIds.has(n.id) ? { ...n, read: true } : n))
    : null;
  const groups = notices ? groupNoticesByJob(notices) : [];
  const mark = async (jobId: string, ids: string[] | null) => {
    setError(null);
    const target = ids ?? (notices ?? []).filter((n) => n.job_id === jobId).map((n) => n.id);
    const before = readIds;
    setReadIds(new Set([...readIds, ...target]));
    try {
      await markJobNoticesRead(rpc, jobId, ids);
    } catch (e) {
      setReadIds(before);
      setError(e instanceof Error ? e.message : "That could not be marked read. Try again.");
    } finally {
      void q.refetch();
    }
  };
  return (
    <section className="aa-card aa-notices" aria-labelledby="aa-notices-title">
      <div className="aa-notices-head">
        <div className="aa-card-title">
          <Bell size={19} />
          <h2 id="aa-notices-title">Notifications on your jobs</h2>
        </div>
        <p>
          Client approvals and questions, submittal replies, confirmed dates and subcontract
          signatures, newest first.
        </p>
      </div>
      {q.isLoading ? (
        <p role="status" className="aa-notices-state">
          Loading your notifications…
        </p>
      ) : q.error || !notices ? (
        <p role="status" className="aa-notices-state">
          Your notifications could not be loaded. Reload the page to try again.
        </p>
      ) : !groups.length ? (
        <p className="aa-notices-state">{EMPTY_NOTICES}</p>
      ) : (
        <div className="aa-notice-jobs">
          {groups.map((g) => (
            <article key={g.job_id} className="aa-notice-job">
              <header>
                <div>
                  <h3>{jobLabel(g)}</h3>
                  <span>{g.unread ? `${g.unread} unread` : "All read"}</span>
                </div>
                <div className="aa-notice-job-actions">
                  {g.unread ? (
                    <button type="button" onClick={() => void mark(g.job_id, null)}>
                      Mark read
                    </button>
                  ) : null}
                  <a href={`/r/job/${g.job_id}/home#${NOTICE_EMAILS_ANCHOR}`}>
                    <Mail size={14} aria-hidden="true" />
                    Email choices
                  </a>
                </div>
              </header>
              <ul>
                {g.notices.slice(0, 8).map((n) => {
                  const link = noticeBoardHref(n.job_id, n.board_page);
                  const href = link?.href ?? `/r/job/${n.job_id}/home#notifications`;
                  return (
                    <li key={n.id} className={n.read ? undefined : "aa-notice-unread"}>
                      <span className="aa-notice-dot" aria-hidden="true" />
                      <div>
                        <a
                          href={href}
                          onClick={(event) => {
                            if (n.read) return;
                            event.preventDefault();
                            const go = () => window.location.assign(href);
                            const timer = window.setTimeout(go, 1500);
                            void mark(n.job_id, [n.id]).finally(() => {
                              window.clearTimeout(timer);
                              go();
                            });
                          }}
                        >
                          {n.read ? null : <span className="aa-sr">New: </span>}
                          {n.title}
                        </a>
                        <small>
                          {n.actor ? `${n.actor} · ` : ""}
                          <time dateTime={n.created_at}>{relativeTime(n.created_at, now)}</time>
                        </small>
                      </div>
                      {!n.read ? (
                        <button
                          type="button"
                          className="aa-notice-mark"
                          aria-label={`Mark read: ${n.title}`}
                          onClick={() => void mark(n.job_id, [n.id])}
                        >
                          Mark read
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {g.notices.length > 8 ? (
                <a className="aa-text-action" href={`/r/job/${g.job_id}/home#notifications`}>
                  See all on the job board
                  <ArrowRight size={15} />
                </a>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {error ? (
        <p role="alert" className="aa-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
