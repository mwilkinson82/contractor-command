import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { MESSAGES_ANCHOR, relativeTime, type NoticeRpc } from "@/lib/notices/board-notices";
import {
  MessagesNotForYou,
  REPLY_MAX,
  lastAbout,
  listJobMessages,
  replyProblem,
  replySentLine,
  threadWaiting,
  unreadNoticeIds,
  type JobMessages,
  type MessageThread,
} from "@/lib/notices/job-messages";
import { replyJobMessageFn } from "@/lib/notices/job-messages.functions";
import { usePageVisible } from "./ReportPage";
import { useJobNotices } from "./JobHomeWhatsNew";
import "./job-home-notices.css";

const rpc: NoticeRpc = (name, args) =>
  (supabase.rpc as unknown as NoticeRpc).call(supabase, name, args);

function ThreadCard({
  thread,
  jobId,
  onSent,
  markRead,
}: {
  thread: MessageThread;
  jobId: string;
  onSent: () => void;
  markRead: (ids: string[]) => Promise<boolean>;
}) {
  const reply = useServerFn(replyJobMessageFn);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = threadWaiting(thread);
  const about = lastAbout(thread);
  const unread = unreadNoticeIds(thread);
  const field = `jhm-reply-${thread.access_id}`;
  const readThread = () => {
    if (unread.length) void markRead(unread);
  };
  const send = async () => {
    const problem = replyProblem(body);
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError(null);
    setSent(null);
    try {
      const result = await reply({
        data: { jobId, accessId: thread.access_id, body: body.trim(), aboutItem: about.id },
      });
      setBody("");
      setSent(replySentLine(result));
      onSent();
    } catch (e) {
      setError(
        e instanceof Error && e.message && !/^Unauthorized/.test(e.message)
          ? e.message
          : "Your reply was not sent. Try again.",
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <article className="jhm-thread">
      <header className="jhm-thread-head">
        <h3>{thread.customer_name}</h3>
        <div className="jhm-thread-tags">
          {waiting ? (
            <span className="jhn-status jhn-status-waiting">Waiting on your reply</span>
          ) : null}
          {unread.length ? (
            <button type="button" className="jhn-link" onClick={readThread}>
              Mark read
            </button>
          ) : null}
        </div>
      </header>
      <ol className="jhm-messages">
        {thread.messages.slice(-6).map((m) => (
          <li key={m.id} className={`jhm-msg jhm-${m.author_kind}${m.read ? "" : " jhm-new"}`}>
            <p className="jhm-who">
              <strong>
                {m.author_name || (m.author_kind === "client" ? thread.customer_name : "Your team")}
              </strong>
              {m.about_label ? <span> · About {m.about_label}</span> : null}
              <time dateTime={m.created_at}> · {relativeTime(m.created_at)}</time>
            </p>
            <p className="jhm-body">{m.body}</p>
          </li>
        ))}
      </ol>
      {thread.messages.length > 6 ? (
        <p className="jhn-more">Showing the latest 6 of {thread.messages.length} messages.</p>
      ) : null}
      {thread.can_reply ? (
        <form
          className="jhm-reply"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor={field}>
            Reply to {thread.customer_name}
            {about.label ? <span> about {about.label}</span> : null}
          </label>
          <textarea
            id={field}
            value={body}
            maxLength={REPLY_MAX}
            rows={3}
            placeholder="Write your reply"
            onFocus={readThread}
            onChange={(event) => {
              setBody(event.target.value);
              setSent(null);
            }}
          />
          <div className="jhm-reply-row">
            <span className="jhm-hint">
              It shows on their client page, and Athena emails {thread.customer_email || "them"}{" "}
              that there's a reply.
            </span>
            <button type="submit" className="jh-button" disabled={sending || !body.trim()}>
              {sending ? "Sending…" : `Send to ${thread.customer_name}`}
            </button>
          </div>
          {sent ? (
            <p role="status" className="jhm-sent">
              {sent}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="jhn-error">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="jhn-more">
          This client's page link was turned off, so replies can't be sent from here.
        </p>
      )}
    </article>
  );
}

/** The board's client messages panel: questions from the client page and the team's replies. */
export function JobHomeMessages({
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
  const notices = useJobNotices(jobId, token);
  const q = useQuery({
    queryKey: ["job-messages", jobId, session?.user.id ?? null],
    enabled: !loading && !!session,
    retry: false,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query: { state: { error: unknown } }) =>
      visible && !query.state.error ? 30_000 : false,
    queryFn: () => listJobMessages(rpc, jobId),
  });
  const refetch = () => void (q as { refetch?: () => unknown }).refetch?.();
  // A share-link view with no member, or a super (messages need full access), shows nothing.
  if ((!session && !loading) || q.error instanceof MessagesNotForYou) return null;
  const data =
    !q.error && q.data && Array.isArray((q.data as JobMessages).threads)
      ? (q.data as JobMessages)
      : null;
  const threads = data?.threads ?? null;
  const markRead = async (ids: string[]) => {
    const ok = await notices.markRead(ids);
    refetch();
    return ok;
  };
  return (
    <div className="jh-panel jhn-panel jhm-panel" id={MESSAGES_ANCHOR}>
      <div className="jhn-head">
        <h2>
          Client messages
          {data?.awaiting_reply ? (
            <span className="jhn-count">{data.awaiting_reply} waiting</span>
          ) : null}
        </h2>
      </div>
      <div className="jh-panel-body jhn-body">
        {loading || q.isLoading ? (
          <p role="status">Loading client messages…</p>
        ) : !threads ? (
          <p>
            Client messages are unavailable right now.{" "}
            <button type="button" className="jhn-link" onClick={refetch}>
              Try again
            </button>
          </p>
        ) : !threads.length ? (
          <p className="jhn-empty">
            No client messages yet. When your client asks a question on their client page, it shows
            up here for you to answer.
          </p>
        ) : (
          threads.map((t) => (
            <ThreadCard
              key={t.access_id}
              thread={t}
              jobId={jobId}
              markRead={markRead}
              onSent={() => {
                refetch();
                notices.refetch();
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
