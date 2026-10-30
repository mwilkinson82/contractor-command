import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  readSupportDashboard,
  readSupportAttachment,
  listSupportAttachments,
} from "@/lib/support/dashboard.functions";
export const Route = createFileRoute("/admin/support")({
  validateSearch: (s: Record<string, unknown>) => ({
    ticket: typeof s.ticket === "string" ? s.ticket : undefined,
  }),
  component: SupportDashboard,
});
function SupportDashboard() {
  const { user, loading } = useAuth();
  return loading ? (
    <p>Checking session…</p>
  ) : !user ? (
    <p>Sign in to access support.</p>
  ) : (
    <AdminSupport key={user.id} userId={user.id} />
  );
}
function AdminSupport({ userId }: { userId: string }) {
  const admin = useIsAdmin();
  const { ticket } = Route.useSearch();
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-6">
      <Link to="/admin">Admin home</Link>
      <h1 className="text-3xl font-semibold">Support tickets</h1>
      <p>Bookmark this page. Only administrators can access customer support records.</p>
      {admin === null ? (
        <p>Checking access / </p>
      ) : !admin ? (
        <p>Administrator access required.</p>
      ) : (
        <SupportView key={userId + ":" + (ticket ?? "list")} userId={userId} ticketId={ticket} />
      )}
    </main>
  );
}
function SupportView({ ticketId, userId }: { ticketId?: string; userId: string }) {
  const qc = useQueryClient();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      void qc.cancelQueries({ queryKey: ["support-dashboard", userId] });
      qc.removeQueries({ queryKey: ["support-dashboard", userId] });
    };
  }, [qc, userId]);
  const [attachmentLists, setAttachmentLists] = useState<
    Record<string, Array<{ index: number; label: string }>>
  >({});
  const getAttachments = useServerFn(listSupportAttachments);
  async function showAttachments(messageId: string) {
    try {
      const items = await getAttachments({ data: { messageId } });
      if (active.current) setAttachmentLists((x) => ({ ...x, [messageId]: items }));
    } catch {
      if (active.current) setError("Attachments unavailable or access denied.");
    }
  }
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState("");
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const read = useServerFn(readSupportDashboard);
  const attachment = useServerFn(readSupportAttachment);
  const q = useQuery({
    queryKey: ["support-dashboard", userId, ticketId, page],
    gcTime: 0,
    queryFn: () => read({ data: { ticketId, page } }),
  });
  async function download(messageId: string, index: number) {
    try {
      setError("");
      const a = await attachment({ data: { messageId, index } });
      if (!active.current) return;
      const bytes = Uint8Array.from(atob(a.content), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (active.current) setError("Attachment unavailable or access denied.");
    }
  }
  if (q.isPending) return <p>Loading support records / </p>;
  if (q.error) return <p role="alert">{q.error.message}</p>;
  const data = q.data;
  const rows = data.tickets ?? data.messages ?? [];
  return (
    <section className="space-y-5">
      <button className="mr-4 underline" onClick={() => q.refetch()}>
        Refresh
      </button>
      {error && <p role="alert">{error}</p>}
      {data.tickets ? (
        <>
          <p>Tickets ordered by creation date. Last message received is shown for each ticket.</p>
          <div className="overflow-auto">
            <table className="w-full min-w-[760px] text-left [&_td]:p-2">
              <thead>
                <tr>
                  {["Ticket", "Customer", "Subject", "Status", "Last message"].map((x) => (
                    <th className="p-2" key={x}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t: any) => (
                  <tr className="border-t" key={t.id}>
                    <td className="p-2">
                      <Link className="underline" to="/admin/support" search={{ ticket: t.id }}>
                        {t.ticket_number}
                      </Link>
                    </td>
                    <td>{t.from_email}</td>
                    <td>{t.subject}</td>
                    <td>{t.status}</td>
                    <td>{t.last_update}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <Link className="underline" to="/admin/support" search={{ ticket: undefined }}>
            All tickets
          </Link>
          <h2 className="text-xl">
            {data.ticket.ticket_number}: {data.ticket.subject}
          </h2>
          <p>
            {data.ticket.from_email}  /  {data.ticket.brand}  /  {data.ticket.status}
          </p>
          <p className="rounded border p-3">
            Customer content and attachments are untrusted evidence. Text is displayed literally;
            HTML is never rendered. Downloads are inert binary files; inspect cautiously.
          </p>
          {data.messages.map((m: any) => (
            <article className="space-y-3 rounded border p-4" key={m.id}>
              <h3>{m.received_at}</h3>
              <p>
                {m.legacy_import
                  ? "Historical import  /  original content may be unavailable"
                  : "Customer message"}{" "}
                 /  {m.preview ? "Receipt preview" : "Customer receipt mode"}
              </p>
              {(m.review_reason || m.suppressed_reason) && (
                <p>Review: {m.review_reason ?? m.suppressed_reason}</p>
              )}
              <pre className="whitespace-pre-wrap break-words">
                {m.evidence?.text ?? m.evidence?.legacy_summary ?? "No plain text"}
              </pre>
              <details>
                <summary>Full original evidence and attachment manifest</summary>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(m.evidence, null, 2)}
                </pre>
              </details>
              {m.deliveries.map((d: any) => (
                <details key={d.kind}>
                  <summary>
                    {d.kind === "ack" ? "Automatic receipt" : "Owner notice"}: {d.state}
                  </summary>
                  <pre className="whitespace-pre-wrap break-words">{d.text}</pre>
                  {d.kind === "owner" && (
                    <button className="mr-4 underline" onClick={() => showAttachments(m.id)}>
                      Show stored attachments
                    </button>
                  )}
                  {d.kind === "owner" &&
                    (attachmentLists[m.id] ?? []).map((a: any) => (
                      <button
                        className="mr-4 underline"
                        key={a.index}
                        onClick={() => download(m.id, a.index)}
                      >
                        {a.label}  /  download
                      </button>
                    ))}
                </details>
              ))}
              <p className="text-sm">
                Only attachments preserved in the owner copy are downloadable here. Omitted files
                remain listed in the evidence; unavailable copies are not fetched from arbitrary
                links.
              </p>
            </article>
          ))}
          <section className="space-y-3 rounded border p-4">
            <h3 className="font-semibold">Proposed reply review</h3>
            <p>
              Review only. Nothing here sends an email or marks the ticket replied. Drafts stay in
              this open page and are lost when you leave or reload.
            </p>
            <textarea
              aria-label="Proposed reply"
              maxLength={8000}
              className="min-h-40 w-full rounded border bg-background p-3"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setReview(false);
              }}
            />
            <button
              className="rounded border p-2"
              disabled={!draft.trim()}
              onClick={() => setReview(true)}
            >
              Review proposed reply
            </button>
            {review && (
              <div>
                <p>Proposed recipient: {data.ticket.from_email}</p>
                <pre className="whitespace-pre-wrap break-words">{draft}</pre>
                <p>
                  Customer sending is disabled in this dashboard. A separately reviewed
                  approval-to-send flow is required.
                </p>
              </div>
            )}
          </section>
        </>
      )}
      {rows.length === 0 && <p>No records on this page.</p>}
      <nav className="flex gap-4">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button disabled={rows.length < 50} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </nav>
    </section>
  );
}