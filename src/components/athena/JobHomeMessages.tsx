import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { MESSAGES_ANCHOR, relativeTime, type NoticeRpc } from "@/lib/notices/board-notices";
import {
  REPLY_MAX,
  lastAbout,
  listJobMessages,
  replyJobMessage,
  replyProblem,
  threadWaiting,
  type MessageThread,
} from "@/lib/notices/job-messages";
import { usePageVisible } from "./ReportPage";
import "./job-home-notices.css";

const rpc: NoticeRpc = (name, args) =>
  (supabase.rpc as unknown as NoticeRpc).call(supabase, name, args);

function ThreadCard({
  thread,
  jobId,
  onSent,
}: {
  thread: MessageThread;
  jobId: string;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = threadWaiting(thread);
  const about = lastAbout(thread);
  const field = `jhm-reply-${thread.access_id}`;
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
      await replyJobMessage(rpc, { jobId, accessId: thread.access_id, body, aboutItem: null });
      setBody("");
      setSent(`Sent to ${thread.customer_name}. They see your reply on their client page.`);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your reply was not sent. Try again.");
    } finally {
      setSending(false);
    }
  };
  return (
    <article className="jhm-thread">
      <header className="jhm-thread-head">
        <h3>{thread.customer_name}</h3>
        {waiting ? <span className="jhn-status jhn-status-waiting">Waiting on your reply</span> : null}
      </header>
      <ol className="jhm-messages">
        {thread.messages.slice(-6).map((m) => (
          <li key={m.id} className={`jhm-msg jhm-${m.author_kind}`}>
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
      <form
        className="jhm-reply"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor={field}>
          Reply to {thread.customer_name}
          {about ? <span> about {about}</span> : null}
        </label>
        <textarea
          id={field}
          value={body}
          maxLength={REPLY_MAX}
          rows={3}
          placeholder="Write your reply"
          onChange={(event) => {
            setBody(event.target.value);
            setSent(null);
          }}
        />
        <div className="jhm-reply-row">
          <span className="jhm-hint">Your client sees this on their client page.</span>
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
  void token;
  void companyId;
  const { session, loading } = useAuth();
  const visible = usePageVisible();
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
  const threads = !q.error && Array.isArray(q.data) ? (q.data as MessageThread[]) : null;
  const waiting = threads?.filter(threadWaiting).length ?? 0;
  return (
    <div className="jh-panel jhn-panel jhm-panel" id={MESSAGES_ANCHOR}>
      <div className="jhn-head">
        <h2>
          Client messages
          {waiting ? <span className="jhn-count">{waiting} waiting</span> : null}
        </h2>
      </div>
      <div className="jh-panel-body jhn-body">
        {!session && !loading ? (
          <p>Sign in to see and answer client messages.</p>
        ) : loading || q.isLoading ? (
          <p role="status">Loading client messages…</p>
        ) : !threads ? (
          <p>
            Client messages are unavailable right now.{" "}
            <button
              type="button"
              className="jhn-link"
              onClick={() => void (q as { refetch?: () => unknown }).refetch?.()}
            >
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
              onSent={() => void (q as { refetch?: () => unknown }).refetch?.()}
            />
          ))
        )}
      </div>
    </div>
  );
}
