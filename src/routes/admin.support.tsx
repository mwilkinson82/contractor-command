import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { Button } from "@/components/ui/button";
import {
  readSupportDashboard,
  readSupportAttachment,
  listSupportAttachments,
} from "@/lib/support/dashboard.functions";
import { sendSupportTicketReply } from "@/lib/support/manual-reply.functions";
export const Route = createFileRoute("/admin/support")({
  head: () => ({
    meta: [
      { title: "Support tickets — Athena" },
      {
        name: "description",
        content: "Administrator-only Athena and Contractor Circle support conversation review.",
      },
      { property: "og:title", content: "Support tickets — Athena" },
      {
        property: "og:description",
        content: "Administrator-only Athena and Contractor Circle support conversation review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
    <main className="mx-auto min-w-0 [overflow-wrap:anywhere] max-w-6xl space-y-5 p-6">
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
      <Button variant="link" className="mr-4 underline" onClick={() => q.refetch()}>
        Refresh
      </Button>
      {error && <p role="alert">{error}</p>}
      {data.tickets ? (
        <>
          <p>Tickets ordered by creation date. Last message received is shown for each ticket.</p>
          <div
            className="overflow-auto"
            role="region"
            aria-label="Support ticket table"
            tabIndex={0}
          >
            <table className="w-full min-w-[760px] text-left [&_th]:whitespace-nowrap [&_td]:p-2">
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
            {data.ticket.from_email} / {data.ticket.brand} / {data.ticket.status}
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
                / {m.preview ? "Receipt preview" : "Customer receipt mode"}
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
                    <Button
                      variant="link"
                      className="mr-4 underline"
                      onClick={() => showAttachments(m.id)}
                    >
                      Show stored attachments
                    </Button>
                  )}
                  {d.kind === "owner" &&
                    (attachmentLists[m.id] ?? []).map((a: any) => (
                      <Button
                        variant="link"
                        className="mr-4 underline"
                        key={a.index}
                        onClick={() => download(m.id, a.index)}
                      >
                        {a.label} / download
                      </Button>
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
          <section className="space-y-3 rounded border p-4" aria-label="Replies on this ticket">
            <h3 className="font-semibold">Replies on this ticket</h3>
            {!data.replies ? (
              <p>The reply log isn&apos;t set up yet.</p>
            ) : data.replies.length === 0 ? (
              <p>No replies sent yet.</p>
            ) : (
              data.replies.map((r: any) => (
                <article className="space-y-1 rounded border p-3" key={r.id}>
                  <p className="text-sm">
                    {r.mode === "preview" ? "Test copy" : "Sent to customer"} / {r.to_email} /{" "}
                    {r.state === "sent" ? "sent " + (r.sent_at ?? "") : r.state}
                    {r.error ? " / " + r.error : ""}
                  </p>
                  <pre className="whitespace-pre-wrap break-words">{r.body}</pre>
                </article>
              ))
            )}
          </section>
          <ReplyBox key={data.ticket.id} ticket={data.ticket} onSent={() => void q.refetch()} />
        </>
      )}
      {rows.length === 0 && <p>No records on this page.</p>}
      <nav className="flex gap-4">
        <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span>Page {page + 1}</span>
        <Button variant="outline" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </nav>
    </section>
  );
}

const SIGNATURES: Record<string, string> = { athena: "Athena Support", circle: "Circle Support" };
const FROM: Record<string, string> = {
  athena: "Athena Support <support@meetathena.io>",
  circle: "Circle Support <support@alpcontractorcircle.com>",
};
const TEST_TO = "marshall@marshallwilkinson.com";

/** Send a reply from the ticket's support address. Test copies go to Marshall only. */
function ReplyBox({
  ticket,
  onSent,
}: {
  ticket: {
    id: string;
    ticket_number: string;
    brand: string;
    from_email: string;
    subject: string | null;
  };
  onSent: () => void;
}) {
  const send = useServerFn(sendSupportTicketReply);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const signature = SIGNATURES[ticket.brand] ?? "Support";
  const lastLine = draft.trim().split("\n").at(-1)?.trim().toLowerCase() ?? "";
  const signed = lastLine === signature.toLowerCase();
  async function go(mode: "preview" | "customer") {
    setBusy(true);
    setNote("");
    try {
      const r = await send({
        data: { ticketId: ticket.id, message: draft, mode, expectTo: ticket.from_email },
      });
      setNote(
        (r.alreadySent ? "Already sent earlier: " : "Sent: ") +
          (mode === "preview" ? "test copy to " : "reply to ") +
          r.to +
          " from " +
          r.from +
          ".",
      );
      if (mode === "customer") setDraft("");
      setConfirming(false);
      onSent();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The reply did not send.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-4" aria-label="Send a reply">
      <h3 className="font-semibold">Send a reply</h3>
      <p className="text-sm">
        From {FROM[ticket.brand] ?? "the support address"}. Every reply is signed {signature} and
        logged on this ticket.
      </p>
      <textarea
        aria-label="Reply"
        maxLength={8000}
        className="min-h-40 w-full rounded border bg-background p-3"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setConfirming(false);
          setNote("");
        }}
      />
      {draft.trim() && (
        <div className="space-y-1 rounded border p-3 text-sm">
          <p>To: {ticket.from_email}</p>
          <p>
            Subject: Re: {ticket.subject ?? "(no subject)"} [{ticket.ticket_number}]
          </p>
          <pre className="whitespace-pre-wrap break-words">
            {draft.trim() + (signed ? "" : "\n\n" + signature)}
          </pre>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={!draft.trim() || busy} onClick={() => go("preview")}>
          Send test to {TEST_TO}
        </Button>
        {!confirming ? (
          <Button disabled={!draft.trim() || busy} onClick={() => setConfirming(true)}>
            Send to {ticket.from_email}
          </Button>
        ) : (
          <>
            <Button disabled={busy} onClick={() => go("customer")}>
              Yes, send to {ticket.from_email}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {note && <p role="status">{note}</p>}
    </section>
  );
}
