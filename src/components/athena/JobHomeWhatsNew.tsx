import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { usePageVisible } from "./ReportPage";
import {
  BOARD_NOTICE_LIMIT,
  BOARD_NOTICE_SHOWN,
  EMPTY_NOTICES,
  NOTICE_POLL_MS,
  NO_LOCAL_READS,
  badgeText,
  bellLabel,
  markJobNoticesRead,
  noticeBoardHref,
  parseNoticeList,
  readJobNotices,
  relativeTime,
  withLocalReads,
  type BoardNotice,
  type LocalReads,
  type NoticeList,
  type NoticeRpc,
} from "@/lib/notices/board-notices";
import "./job-home-notices.css";

const rpc: NoticeRpc = (name, args) =>
  (supabase.rpc as unknown as NoticeRpc).call(supabase, name, args);

type BoardProps = { jobId: string; token?: string; companyId?: string };

/*
 * One read feeds the Notifications panel, the bell in the top bar and the count in the left nav, so all three agree
 * and the page polls once. Only one mounted user of a job's read runs the timer; the others share its result.
 */
const pollLeaders = new Map<string, number>();
let observerSeq = 0;

/** Read marks made on this page, shared by the panel, bell and nav until the next read confirms them. */
const localReads = new Map<string, LocalReads>();
const readListeners = new Set<() => void>();
function setLocalReads(jobId: string, next: LocalReads) {
  localReads.set(jobId, next);
  for (const l of readListeners) l();
}
function useLocalReads(jobId: string): LocalReads {
  return useSyncExternalStore(
    (cb) => {
      readListeners.add(cb);
      return () => readListeners.delete(cb);
    },
    () => localReads.get(jobId) ?? NO_LOCAL_READS,
    () => NO_LOCAL_READS,
  );
}

export type JobNotices = {
  /** False when nobody is signed in: a board share link alone never reads notices. */
  signedIn: boolean;
  loading: boolean;
  error: boolean;
  list: NoticeList | null;
  unread: number | null;
  refetch: () => void;
  markRead: (ids: string[] | null) => Promise<boolean>;
};

export function useJobNotices(jobId: string, token?: string): JobNotices {
  void token;
  const { session, loading } = useAuth();
  const visible = usePageVisible();
  const [me] = useState(() => ++observerSeq);
  const key = `${jobId}:${session?.user.id ?? ""}`;
  useEffect(() => {
    if (!pollLeaders.has(key)) pollLeaders.set(key, me);
    return () => {
      if (pollLeaders.get(key) === me) pollLeaders.delete(key);
    };
  }, [key, me]);
  const leads = () => {
    if (!pollLeaders.has(key)) pollLeaders.set(key, me);
    return pollLeaders.get(key) === me;
  };
  const q = useQuery({
    queryKey: ["job-notices", jobId, session?.user.id ?? null],
    enabled: !loading && !!session,
    queryFn: () => readJobNotices(rpc, jobId, BOARD_NOTICE_LIMIT),
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query: { state: { error: unknown } }) =>
      visible && !query.state.error && leads() ? NOTICE_POLL_MS : false,
  });
  const local = useLocalReads(jobId);
  const raw = q.error ? null : parseNoticeList(q.data);
  const list = raw ? withLocalReads(raw, local) : null;
  const refetch = () => void (q as { refetch?: () => unknown }).refetch?.();
  const markRead = async (ids: string[] | null) => {
    const before = localReads.get(jobId) ?? NO_LOCAL_READS;
    const stamp = new Date().toISOString();
    setLocalReads(
      jobId,
      ids === null
        ? { ids: before.ids, allAt: stamp }
        : { ids: new Set([...before.ids, ...ids]), allAt: before.allAt },
    );
    try {
      await markJobNoticesRead(rpc, jobId, ids);
      return true;
    } catch {
      setLocalReads(jobId, before);
      return false;
    } finally {
      refetch();
    }
  };
  return {
    signedIn: !!session,
    loading: loading || (!!session && q.isLoading),
    error: !!q.error || (!!session && !q.isLoading && q.data !== undefined && !raw),
    list,
    unread: list ? list.unread : null,
    refetch,
    markRead,
  };
}

/** The left nav's count: the unread number, or null while loading or when it cannot be read. */
export function useNotificationsCount(jobId: string, token?: string): number | null {
  return useJobNotices(jobId, token).unread;
}

/** The board's top bar bell. A red count only when something is new; it scrolls to the Notifications panel. */
export function NotificationsBell({ jobId, token }: { jobId: string; token?: string }) {
  const { signedIn, unread } = useJobNotices(jobId, token);
  if (!signedIn) return null;
  return (
    <button
      type="button"
      className="jhn-bell"
      aria-label={bellLabel(unread)}
      title={bellLabel(unread)}
      onClick={() => {
        const target = document.getElementById("notifications");
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          window.history.replaceState(null, "", "#notifications");
        } else window.location.hash = "notifications";
      }}
    >
      <Bell size={20} aria-hidden="true" />
      {unread ? (
        <span className="jhn-bell-count" aria-hidden="true">
          {badgeText(unread)}
        </span>
      ) : null}
    </button>
  );
}

function NoticeRow({
  notice,
  jobId,
  token,
  now,
  onRead,
}: {
  notice: BoardNotice;
  jobId: string;
  token?: string;
  now: number;
  onRead: (id: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const link = noticeBoardHref(jobId, notice.board_page, token);
  const when = relativeTime(notice.created_at, now);
  return (
    <li className={`jhn-row${notice.read ? "" : " jhn-unread"}`}>
      <span className="jhn-dot" aria-hidden="true" />
      <div className="jhn-main">
        <button
          type="button"
          className="jhn-title"
          aria-expanded={notice.detail ? open : undefined}
          onClick={() => {
            if (notice.detail) setOpen((v) => !v);
            if (!notice.read) void onRead(notice.id);
          }}
        >
          {notice.read ? null : <span className="jhn-sr">New: </span>}
          {notice.title}
        </button>
        <p className="jhn-meta">
          {notice.actor ? <span>{notice.actor}</span> : null}
          {when ? (
            <time dateTime={notice.created_at} title={new Date(notice.created_at).toLocaleString()}>
              {when}
            </time>
          ) : null}
        </p>
        {open && notice.detail ? <p className="jhn-detail">{notice.detail}</p> : null}
      </div>
      {link ? (
        <a
          className="jhn-open"
          href={link.href}
          onClick={(event) => {
            if (notice.read || event.metaKey || event.ctrlKey || event.shiftKey) {
              if (!notice.read) void onRead(notice.id);
              return;
            }
            // Mark it read before leaving, so the count is right when the member comes back.
            event.preventDefault();
            const go = () => window.location.assign(link.href);
            const timer = window.setTimeout(go, 1500);
            void onRead(notice.id).finally(() => {
              window.clearTimeout(timer);
              go();
            });
          }}
        >
          {link.label} <span aria-hidden="true">→</span>
        </a>
      ) : null}
    </li>
  );
}

/**
 * The board's Notifications panel: the newest client and field notices on this job. The board mounts it inside its
 * own section with id="notifications"; this renders its own card and heading.
 */
export function JobHomeNotifications({ jobId, token, companyId }: BoardProps) {
  void companyId;
  const notices = useJobNotices(jobId, token);
  const [all, setAll] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const list = notices.list;
  const shown = list ? list.notices.slice(0, all ? BOARD_NOTICE_LIMIT : BOARD_NOTICE_SHOWN) : [];
  const unread = notices.unread ?? 0;
  const mark = async (ids: string[] | null) => {
    setFailed(null);
    const ok = await notices.markRead(ids);
    if (!ok) setFailed("That could not be marked read. Try again.");
    return ok;
  };
  return (
    <div className="jh-panel jhn-panel">
      <div className="jhn-head">
        <h2>
          Notifications
          {unread > 0 ? (
            <span className="jhn-count" aria-label={`${unread} unread`}>
              {badgeText(unread)} new
            </span>
          ) : null}
        </h2>
        {list && list.notices.length ? (
          <div className="jhn-actions">
            <button type="button" disabled={unread === 0} onClick={() => void mark(null)}>
              Mark all read
            </button>
            {list.notices.length > BOARD_NOTICE_SHOWN ? (
              <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : "Show all"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="jh-panel-body jhn-body">
        {!notices.signedIn && !notices.loading ? (
          <p>Sign in to see this job's notifications.</p>
        ) : notices.loading ? (
          <p role="status">Loading notifications…</p>
        ) : notices.error || !list ? (
          <p>
            Notifications are unavailable right now.{" "}
            <button type="button" className="jhn-link" onClick={notices.refetch}>
              Try again
            </button>
          </p>
        ) : !list.notices.length ? (
          <p className="jhn-empty">{EMPTY_NOTICES}</p>
        ) : (
          <ul className="jhn-list" aria-live="polite">
            {shown.map((n) => (
              <NoticeRow
                key={n.id}
                notice={n}
                jobId={jobId}
                token={token}
                now={now}
                onRead={(id) => mark([id])}
              />
            ))}
          </ul>
        )}
        {failed ? (
          <p role="alert" className="jhn-error">
            {failed}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The first name the board thread used for this panel. */
export const JobHomeWhatsNew = JobHomeNotifications;

/** A small unread count for the board header. */
export function JobHomeNoticeBadge({ jobId, token }: { jobId: string; token?: string }) {
  const unread = useNotificationsCount(jobId, token);
  if (!unread) return null;
  return (
    <span className="jhn-badge" aria-label={`${unread} new notifications`}>
      {badgeText(unread)}
    </span>
  );
}
