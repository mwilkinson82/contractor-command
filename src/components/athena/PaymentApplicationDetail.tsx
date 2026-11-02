import { accountingRecordUrl } from "@/lib/accounting-record-target";
import { appMoney } from "@/lib/payment-applications/model";
import type { SavedApplication } from "@/lib/payment-applications/workflow";
export function PaymentApplicationDetail({
  saved,
  jobId,
}: {
  saved: SavedApplication;
  jobId?: string;
}) {
  const a = saved.body,
    c = saved.calculation;
  return (
    <section className="pa-detail">
      <h2>
        {a.number} · {a.state} · version {saved.version}
      </h2>
      <p>
        Period {a.period_start} through {a.period_end}. Prior certificate cutoff {a.prior_cutoff}.
        All amounts USD.
      </p>
      {!c.complete && (
        <div role="status">
          <strong>Incomplete draft · Needed inputs</strong>
          <ul>
            {c.issues.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="pa-totals">
        {[
          ["Contract", c.contract_cents],
          ["Completed and stored", c.gross_cents],
          ["Retainage held", c.retained_cents],
          ["Earned less retainage", c.earned_net_cents],
          ["Previous actual certificates", c.prior_certified_net_cents],
          ["Current requested payment", c.payment_due_cents],
          ["Unperformed contract remainder", c.unearned_cents],
          ["Balance including retainage", c.balance_including_retainage_cents],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dt>{label}</dt>
            <dd>{appMoney(value as number | null)}</dd>
          </div>
        ))}
      </dl>
      <div
        className="pa-scroll"
        tabIndex={0}
        role="region"
        aria-label="Application continuation, scroll horizontally"
      >
        <table>
          <thead>
            <tr>
              {[
                "Work item",
                "Scheduled value",
                "Prior installed",
                "Prior stored",
                "Work this period",
                "Cumulative installed",
                "Currently stored",
                "Completed and stored",
                "Retained",
                "Unperformed",
              ].map((s) => (
                <th key={s}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.item}>
                <th>
                  {r.item} · {r.description}
                </th>
                {[
                  r.scheduled_cents,
                  r.prior_work_cents,
                  r.prior_stored_cents,
                  r.this_period_work_cents,
                  r.work_cents,
                  r.stored_cents,
                  r.gross_cents,
                  r.retained_cents,
                  r.balance_cents,
                ].map((v, i) => (
                  <td key={i}>{appMoney(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Certificate and retainage basis</h3>
      <p>{a.prior_basis || "Prior basis needed"}</p>
      <p>{a.retainage_basis || "Retainage terms needed"}</p>
      {a.certification && (
        <p>
          Actual certificate {appMoney(a.certification.amount_cents)}, dated {a.certification.date}.{" "}
          {a.certification.source}
        </p>
      )}
      {a.lines.map((l) => (
        <div key={l.item}>
          <strong>{l.item}</strong>
          <p>
            Work retainage{" "}
            {l.work_retainage_bps === null ? "Needed" : `${l.work_retainage_bps / 100}%`}; stored
            retainage{" "}
            {l.stored_retainage_bps === null ? "Needed" : `${l.stored_retainage_bps / 100}%`}.
            Cumulative approved release {appMoney(l.release_cents)}.
          </p>
          {l.stored_basis && <p>Stored material evidence: {l.stored_basis}</p>}
          {l.release_basis && <p>Release basis: {l.release_basis}</p>}
        </div>
      ))}
      <h3>Source and reconciliation</h3>
      {jobId && saved.billing_version && (
        <p>
          <a
            href={accountingRecordUrl(jobId, {
              kind: "invoice",
              id: saved.application_id,
              version: saved.billing_version,
            })}
          >
            Open linked billing record, history and original evidence
          </a>
        </p>
      )}
      <p>{a.source}</p>
      {a.evidence.map((e) => (
        <p key={e.id}>
          {jobId && c.evidence?.find((b) => b.id === e.id) ? (
            <a
              href={accountingRecordUrl(jobId, {
                kind:
                  c.evidence.find((b) => b.id === e.id)?.kind === "credit" ? "credit" : "invoice",
                id: e.id,
                version: e.version,
              })}
            >
              {c.evidence.find((b) => b.id === e.id)?.number}
            </a>
          ) : e.treatment === "prior_billing" ? (
            "Prior billing"
          ) : (
            "Separate evidence"
          )}{" "}
          · version {e.version}: {e.reason}
        </p>
      ))}
      <p>
        {saved.recorded_at === "Not saved yet" ? "Not saved yet." : `Saved ${saved.recorded_at}.`}{" "}
        {a.reason}
      </p>
      <p>
        {saved.billing_version
          ? `Linked billing version ${saved.billing_version}. This records an application, not payment.`
          : "No issued billing from this application."}
      </p>
      <details>
        <summary>Source provenance</summary>
        <p>SOV fingerprint: {a.snapshot.fingerprint}</p>
      </details>
    </section>
  );
}
