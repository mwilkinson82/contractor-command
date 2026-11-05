import type { ReactNode } from "react";
import type { PaymentTrail, TrailStep } from "@/lib/payable-payment-trail";
import "./payment-trail.css";

const MARK: Record<TrailStep["state"], string> = { done: "✓", open: "", missing: "–", void: "×" };

/** Presentation only: amounts, dates and states come from buildPaymentTrail. */
export type TrailDocument = { id: string; filename: string; version?: number };
export function PaymentTrailView({
  trail,
  download,
  attach,
}: {
  trail: PaymentTrail;
  download?: (doc: TrailDocument, kind: "original" | "proof") => void;
  /** Attach-proof control, shown only to owner or accounts payable on a payment. */
  attach?: ReactNode;
}) {
  const tone =
    trail.status === "paid"
      ? "ok"
      : trail.status === "overpaid"
        ? "warn"
        : trail.status === "partial"
          ? "info"
          : "idle";
  return (
    <div className="pt" role="region" aria-label="Payment summary">
      <header className="pt-hero">
        <div>
          <p className="pt-eyebrow">
            {trail.focus
              ? `Payment to ${trail.payee}`
              : `${trail.kindLabel} ${trail.billLabel} · ${trail.payee}`}
          </p>
          <p className="pt-amount">{trail.focus ? trail.focus.amount : trail.total}</p>
          <p className="pt-sub">
            {trail.focus
              ? `${trail.focus.corrected ? "Corrected payment · was recorded " : "Paid "}${trail.focus.date} · ${trail.focus.reference}`
              : `${trail.payments.filter((p) => !p.corrected).length} payment${trail.payments.filter((p) => !p.corrected).length === 1 ? "" : "s"} recorded`}
          </p>
        </div>
        <span className={`pt-pill pt-${tone}`}>
          {trail.focus ? `Bill ${trail.statusLabel.toLowerCase()}` : trail.statusLabel}
        </span>
      </header>

      <div className="pt-balance" aria-label={`Balance on ${trail.billLabel}`}>
        <div className="pt-tile">
          <p>Bill total</p>
          <p className="pt-figure">{trail.total}</p>
          <p className="pt-note">{trail.billLabel}</p>
        </div>
        <div className="pt-tile">
          <p>Paid to date</p>
          <p className="pt-figure">{trail.paid}</p>
          <p className="pt-note">
            {trail.payments.filter((p) => !p.corrected).length} recorded payment
            {trail.payments.filter((p) => !p.corrected).length === 1 ? "" : "s"}
          </p>
        </div>
        <div className={`pt-tile pt-tile-${tone}`}>
          <p>Remaining</p>
          <p className="pt-figure">{trail.remaining}</p>
          <p className="pt-note">{trail.statusLabel}</p>
        </div>
        <div
          className="pt-bar"
          role="img"
          aria-label={`${trail.percentPaid}% of ${trail.total} paid`}
        >
          <span style={{ width: `${trail.percentPaid}%` }} />
        </div>
      </div>

      <div className="pt-grid">
        <section className="pt-card">
          <h2>Payment trail</h2>
          <ol className="pt-steps">
            {trail.steps.map((s) => (
              <li
                key={s.key}
                className={`pt-step pt-step-${s.state}${s.highlight ? " pt-step-focus" : ""}`}
              >
                <span className="pt-dot" aria-hidden="true">
                  {MARK[s.state]}
                </span>
                <div className="pt-step-body">
                  <p className="pt-step-title">
                    {s.title}
                    {s.highlight && <span className="pt-this">This payment</span>}
                  </p>
                  {(s.date || s.amount) && (
                    <p className="pt-step-meta">{[s.date, s.amount].filter(Boolean).join(" · ")}</p>
                  )}
                  {s.detail && (
                    <p className={`pt-step-detail${s.warn ? " pt-step-warn" : ""}`}>{s.detail}</p>
                  )}
                  {s.link && !s.highlight && s.key !== "bill" && (
                    <a className="pt-link" href={s.link.url}>
                      {s.link.label}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="pt-side">
          <section className="pt-card">
            <h2>Payments on this bill</h2>
            {trail.payments.length ? (
              <table className="pt-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Reference</th>
                    <th scope="col" className="pt-num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trail.payments.map((p) => (
                    <tr
                      key={p.id}
                      className={p.highlight ? "pt-row-focus" : p.corrected ? "pt-row-void" : ""}
                    >
                      <td className="pt-date">{p.date}</td>
                      <td>
                        {p.highlight ? p.reference : <a href={p.link.url}>{p.reference}</a>}
                        {p.corrected && " (corrected)"}
                      </td>
                      <td className="pt-num">{p.amount}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>
                      Remaining
                    </th>
                    <td className="pt-num">{trail.remaining}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="pt-empty">No payments recorded on this bill yet.</p>
            )}
          </section>

          <section className="pt-card">
            <h2>Proof</h2>
            <div className="pt-proof">
              <p className="pt-proof-label">Supplier invoice</p>
              {trail.proof.invoice.length ? (
                trail.proof.invoice.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="pt-btn pt-btn-primary"
                    disabled={!download}
                    onClick={() => download?.(d, "original")}
                  >
                    Download {d.filename}
                  </button>
                ))
              ) : (
                <p className="pt-missing">{trail.proof.invoiceNote}</p>
              )}
            </div>
            <div className="pt-proof">
              <p className="pt-proof-label">Proof of payment</p>
              {trail.proof.payment.length ? (
                trail.proof.payment.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="pt-btn pt-btn-primary"
                    disabled={!download}
                    onClick={() => download?.(d, "proof")}
                  >
                    Download {d.filename}
                  </button>
                ))
              ) : (
                <p className="pt-missing">{trail.proof.paymentNote}</p>
              )}
              {attach}
            </div>
            <div className="pt-actions">
              <a className="pt-btn pt-btn-secondary" href={trail.billLink.url}>
                {trail.billLink.label}
              </a>
              {trail.purchaseOrder?.url && (
                <a className="pt-btn pt-btn-secondary" href={trail.purchaseOrder.url}>
                  Open {trail.purchaseOrder.label}
                </a>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
