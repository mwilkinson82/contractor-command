import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { NOTICE_EMAILS_ANCHOR, type NoticeRpc } from "@/lib/notices/board-notices";
import {
  ROLE_LABEL,
  readNoticePrefs,
  saveNoticePref,
  type PrefCell,
  type PrefGrid,
} from "@/lib/notices/notice-prefs";
import { NOTICE_TOPICS, TOPIC_LABEL } from "@/lib/notices/send";
import "./job-home-notices.css";

const rpc: NoticeRpc = (name, args) =>
  (supabase.rpc as unknown as NoticeRpc).call(supabase, name, args);

function cellNote(cell: PrefCell): string | null {
  if (cell.locked) return "Always on";
  if (!cell.allowed) return "Not for supers";
  return null;
}

/** "Notice emails": which roles get an email for each kind of notice on this job. */
export function JobNoticeEmailSettings({
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
  const q = useQuery({
    queryKey: ["job-notice-prefs", jobId, session?.user.id ?? null],
    enabled: !loading && !!session,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => readNoticePrefs(rpc, jobId),
  });
  const [saved, setSaved] = useState<PrefGrid | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const fetched = !q.error && q.data && Array.isArray((q.data as PrefGrid).rows) ? (q.data as PrefGrid) : null;
  const grid = saved ?? fetched;
  const toggle = async (cell: PrefCell, email: boolean) => {
    const key = `${cell.role}:${cell.topic}`;
    setBusy(key);
    setMessage(null);
    try {
      const next = await saveNoticePref(rpc, { jobId, role: cell.role, topic: cell.topic, email });
      setSaved(next);
      setMessage({
        tone: "ok",
        text: `${ROLE_LABEL[cell.role]} ${email ? "now gets" : "no longer gets"} ${TOPIC_LABEL[cell.topic].toLowerCase()} emails.`,
      });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "That choice was not saved." });
    } finally {
      setBusy(null);
    }
  };
  // A share-link view with no signed-in member shows nothing.
  if (!session && !loading) return null;
  return (
    <div className="jh-panel jhn-panel jhe-panel" id={NOTICE_EMAILS_ANCHOR}>
      <div className="jhn-head">
        <h2>Notice emails</h2>
      </div>
      <div className="jh-panel-body jhn-body">
        <p className="jhe-intro">
          Choose which roles get an email for each kind of notice on this job. Everyone on the job
          still sees every notice they have access to on the board.
        </p>
        {loading || q.isLoading ? (
          <p role="status">Loading email choices…</p>
        ) : !grid ? (
          <p>
            {q.error instanceof Error && q.error.message
              ? q.error.message
              : "Email choices are unavailable right now."}
          </p>
        ) : (
          <>
            {!grid.canChange ? (
              <p className="jhe-readonly">
                Only the job's PM, an owner or an all-access member can change these.
              </p>
            ) : null}
            <table className="jhe-table">
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  {NOTICE_TOPICS.map((t) => (
                    <th scope="col" key={t}>
                      {TOPIC_LABEL[t]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.role}>
                    <th scope="row">{ROLE_LABEL[row.role]}</th>
                    {row.cells.map((cell) => {
                      const key = `${cell.role}:${cell.topic}`;
                      const note = cellNote(cell);
                      const disabled =
                        !grid.canChange || cell.locked || !cell.allowed || busy !== null;
                      return (
                        <td key={key} data-label={TOPIC_LABEL[cell.topic]}>
                          {cell.allowed ? (
                            <label className="jhe-switch">
                              <input
                                type="checkbox"
                                role="switch"
                                checked={cell.email}
                                disabled={disabled}
                                aria-label={`${ROLE_LABEL[cell.role]}: ${TOPIC_LABEL[cell.topic]}`}
                                onChange={(event) => void toggle(cell, event.target.checked)}
                              />
                              <span className="jhe-track" aria-hidden="true" />
                              {note ? <span className="jhe-note">{note}</span> : null}
                            </label>
                          ) : (
                            <span className="jhe-note jhe-off">{note}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="jh-small">
              The job's PM gets every notice email. Owners get client questions unless switched off.
              Supers get submittal replies, date confirmations and subcontract signatures, never money.
            </p>
            {message ? (
              <p
                role={message.tone === "error" ? "alert" : "status"}
                className={message.tone === "error" ? "jhn-error" : "jhm-sent"}
              >
                {message.text}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
