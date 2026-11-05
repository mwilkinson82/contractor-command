import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { accountingRecordUrl, type AccountingTarget } from "@/lib/accounting-record-target";
import {
  readAccountingRecord,
  type RecordDetail,
  type RecordIO,
} from "@/lib/accounting-record-read";
import { AccountingWorkspace } from "./AccountingWorkspace";
import { PaymentTrailView, type TrailDocument } from "./PaymentTrailView";
import { BoardSignIn } from "./BoardSignIn";

function Facts({ facts }: { facts: RecordDetail["facts"] }) {
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {facts.map(([label, value], i) => (
        <div key={`${label}:${i}`}>
          <dt className="text-sm text-slate-600 capitalize">{label}</dt>
          <dd className="font-medium whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
/** Owner/AP only: pick a PDF, JPEG or PNG and attach it to the payment shown. */
export function AttachProof({
  onFile,
  busy,
  message,
}: {
  onFile: (file: File) => void;
  busy: boolean;
  message?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="pt-attach">
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="pt-btn pt-btn-secondary"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Attaching…" : "Attach proof of payment"}
      </button>
      <p className="pt-attach-hint">
        Check image, wire confirmation or remittance. PDF, JPEG or PNG, up to 10 MB.
      </p>
      {message && (
        <p className="pt-attach-msg" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function AccountingRecordView({
  detail,
  download,
  attach,
}: {
  detail: RecordDetail;
  download?: (doc: TrailDocument, kind: "original" | "proof") => void;
  attach?: ReactNode;
}) {
  if (detail.trail)
    return (
      <div className="grid gap-4">
        <PaymentTrailView trail={detail.trail} download={download} attach={attach} />
        <details className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <summary className="cursor-pointer font-semibold">Full record details</summary>
          <RecordDetails detail={detail} download={download} />
        </details>
      </div>
    );
  return (
    <article aria-label="Selected financial record" className="rounded-xl bg-white p-4 sm:p-6">
      <RecordDetails detail={detail} download={download} />
    </article>
  );
}
function RecordDetails({
  detail,
  download,
}: {
  detail: RecordDetail;
  download?: (doc: TrailDocument, kind: "original" | "proof") => void;
}) {
  return (
    <>
      <p className="mt-2 text-sm">{detail.subtitle}</p>
      <Facts facts={detail.facts} />
      <section className="mt-6">
        <h2 className="font-semibold">Related records</h2>
        {detail.related.length ? (
          <ul className="mt-2 space-y-2">
            {detail.related.map((l) => (
              <li key={l.url}>
                <a className="underline" href={l.url}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>No related records in this evidence.</p>
        )}
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">Original evidence for this selection</h2>
        {detail.originals.length ? (
          <ul>
            {detail.originals.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="underline py-2"
                  disabled={!download}
                  onClick={() => download?.(d, "original")}
                >
                  {d.filename}
                  {d.version ? ` · v${d.version}` : ""}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{detail.originalsNote}</p>
        )}
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">History</h2>
        {detail.history.length ? (
          detail.history.map((h, i) => (
            <details className="mt-3 border-t py-3" key={`${h.label}:${i}`}>
              <summary className="cursor-pointer">{h.label}</summary>
              <Facts facts={h.facts} />
              {h.link && (
                <a className="mt-2 inline-block underline" href={h.link.url}>
                  {h.link.label}
                </a>
              )}
            </details>
          ))
        ) : (
          <p>No additional history recorded.</p>
        )}
      </section>
    </>
  );
}
export function AccountingRecordPage({
  jobId,
  target,
  invalid,
  dates = {},
}: {
  jobId: string;
  target: AccountingTarget | null;
  invalid?: boolean;
  dates?: { from?: string; as_of?: string };
}) {
  const { session, loading } = useAuth();
  const [downloadError, setDownloadError] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attachMessage, setAttachMessage] = useState("");
  const query = useQuery({
    queryKey: ["accounting-record", jobId, session?.user.id, target],
    enabled: !loading && !!session && !!target && !invalid,
    retry: false,
    staleTime: 0,
    queryFn: () => readAccountingRecord(supabase as unknown as RecordIO, jobId, target!),
  });
  const project = useQuery({
    queryKey: ["accounting-record-project-label", jobId, session?.user.id],
    enabled: !loading && !!session && !!target && !invalid,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcp_jobs")
        .select("job_number,name")
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw new Error("Project label unavailable.");
      return data;
    },
  });
  if (invalid || !target)
    return (
      <AccountingWorkspace jobId={jobId} title="Record unavailable">
        <p role="alert">
          This record link is incomplete or invalid. Ask Athena for a fresh link to the exact
          record. No other record was substituted.
        </p>
      </AccountingWorkspace>
    );
  if (loading)
    return (
      <AccountingWorkspace jobId={jobId} title="Financial record">
        <p role="status">Checking access…</p>
      </AccountingWorkspace>
    );
  if (!session)
    return (
      <BoardSignIn
        returnTo={
          new URL(accountingRecordUrl(jobId, target, dates)).pathname +
          new URL(accountingRecordUrl(jobId, target, dates)).search
        }
      />
    );
  async function download(doc: TrailDocument, kind: "original" | "proof") {
    const { id, filename } = doc;
    setDownloadError("");
    try {
      const q = new URLSearchParams({ job: jobId, document: id });
      const billId =
        target!.kind === "payable"
          ? target!.id
          : target!.kind === "payment"
            ? target!.payableId
            : undefined;
      if (kind === "proof") q.set("payment_proof", "1");
      else if (billId) {
        q.set("ap_record", billId);
        const v =
          doc.version ??
          (target!.kind === "payable"
            ? query.data?.originals.find((d) => d.id === id)?.version
            : undefined);
        if (!v) throw new Error("Original version unavailable.");
        q.set("version", String(v));
      }
      const response = await fetch(`/api/billing-original?${q}`, {
        headers: { authorization: `Bearer ${session!.access_token}` },
      });
      if (!response.ok) throw new Error("This original is unavailable or could not be verified.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Original unavailable.");
    }
  }
  async function attachProof(file: File) {
    const proofTarget = query.data?.proofTarget;
    if (!proofTarget) return;
    setAttaching(true);
    setAttachMessage("");
    try {
      const q = new URLSearchParams({
        job: jobId,
        record: proofTarget.recordId,
        payment: proofTarget.paymentId,
        filename: file.name,
      });
      const response = await fetch(`/api/payment-proof?${q}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session!.access_token}`,
          "content-type": file.type || "application/octet-stream",
        },
        body: file,
      });
      const body = (await response.json().catch(() => ({}))) as {
        stored?: boolean;
        duplicate?: boolean;
        message?: string;
      };
      if (!response.ok || !body.stored)
        throw new Error(body.message || "The proof could not be attached. Nothing was linked.");
      setAttachMessage(
        body.duplicate
          ? "That file was already attached to this payment."
          : `Attached ${file.name}.`,
      );
      await query.refetch();
    } catch (e) {
      setAttachMessage(e instanceof Error ? e.message : "The proof could not be attached.");
    } finally {
      setAttaching(false);
    }
  }
  return (
    <AccountingWorkspace
      jobId={jobId}
      title={query.error ? "Record unavailable" : query.data?.title || "Financial record"}
      description={
        <p>
          {!project.error && project.data
            ? `${project.data.job_number} · ${project.data.name || "Project name not recorded"}`
            : "Project label unavailable"}{" "}
          · read-only evidence
        </p>
      }
    >
      <p className="text-sm">
        {dates.as_of
          ? `Opened from report through ${dates.as_of}${dates.from ? `, starting ${dates.from}` : ""}. `
          : ""}
        Record history is read now; this is not a historical accounting close. Recorded payment
        evidence does not verify a bank transfer.
      </p>
      {query.isFetching && !query.data ? (
        <p role="status">Reading selected record…</p>
      ) : query.error ? (
        <p role="alert">
          This exact record or version is unavailable for this project and your current access. No
          other record was substituted.
        </p>
      ) : query.data ? (
        <AccountingRecordView
          detail={query.data}
          download={(doc, kind) => void download(doc, kind)}
          attach={
            query.data.proofTarget ? (
              <AttachProof
                busy={attaching}
                message={attachMessage}
                onFile={(f) => void attachProof(f)}
              />
            ) : undefined
          }
        />
      ) : null}
      {downloadError && <p role="alert">{downloadError}</p>}
      <p className="mt-6">
        <a className="underline" href={`/r/job/${jobId}/accounting`}>
          All project financial reports
        </a>
      </p>
    </AccountingWorkspace>
  );
}
