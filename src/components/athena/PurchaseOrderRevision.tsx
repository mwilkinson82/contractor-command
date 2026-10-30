import { useRef, useState } from "react";
import { OrderLines } from "./PurchaseOrderDetails";
import {
  prepareRevision,
  revisionFields,
  reviewPoRevision,
  savePoRevision,
  orderVersions,
  poDate,
  poMoney,
  orderTotal,
  type PurchaseOrder,
  type PurchaseOrderParty,
  type PurchaseOrderTerms,
  type PurchaseOrderContext,
  type PoRpc,
  type RevisionPayload,
} from "@/lib/purchase-order-workspace";

type Pending = { payload: RevisionPayload; reviewId: string; expiresAt: string };
export function PurchaseOrderRevision({
  jobId,
  order,
  party,
  terms,
  context,
  rpc,
  onFinish,
}: {
  jobId: string;
  order: PurchaseOrder;
  party: PurchaseOrderParty;
  terms: PurchaseOrderTerms;
  context: PurchaseOrderContext;
  rpc: PoRpc;
  onFinish: (message: string) => Promise<void>;
}) {
  const current = orderVersions(order)[0];
  const [fields, setFields] = useState(() => revisionFields(current)),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  async function prepare() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = prepareRevision(order, party, terms, fields, crypto.randomUUID()),
        reviewId = crypto.randomUUID();
      const r = await reviewPoRevision(rpc, jobId, payload, reviewId);
      setPending({ payload, reviewId, expiresAt: r.expires_at });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review unavailable. No revision was saved.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function save() {
    if (inFlight.current || !pending) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await savePoRevision(rpc, jobId, pending.payload, pending.reviewId);
      await onFinish(
        r.already_applied
          ? `This exact draft request was already saved as version ${r.version}. Current history has been refreshed.`
          : `Saved draft version ${r.version}. Internal approval, issuance, supplier acceptance, posted costs and payments are separate.`,
      );
    } catch (e) {
      setUncertain(true);
      setError(
        `${e instanceof Error ? e.message : "Save outcome unavailable."} Keep this review to retry the identical request, or close and inspect refreshed history. Do not create a replacement request blindly.`,
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  const proposal = pending
    ? {
        ...current,
        version: current.version + 1,
        ...pending.payload,
        party_snapshot: { name: party.name },
        reason: pending.payload.reason,
      }
    : null;
  return (
    <section className="po-panel po-revision" aria-label="Propose purchase order revision">
      <div className="po-panel-head">
        <h2>{pending ? "Review proposed draft" : "Propose revision"}</h2>
        <span className="po-badge">New draft only</span>
      </div>
      <div className="po-panel-body">
        <p>
          <strong>
            {context.companyName} · {context.jobNumber} · {order.number}
          </strong>
        </p>
        <p>
          Based on version {current.version}. Supplier: {party.name} · current directory version{" "}
          {party.version}. The selected terms remain {terms.title}.
        </p>
        <p className="po-muted">
          Saving adds a new draft to immutable history. It does not approve terms or issue, accept
          or pay an order.
        </p>
        {error && (
          <p className="po-error" role="alert">
            {error}
          </p>
        )}
        {!pending ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void prepare();
            }}
          >
            <div className="po-form-grid">
              <label className="po-field">
                Order date
                <input
                  type="date"
                  required
                  value={fields.orderDate}
                  onChange={(e) => setFields({ ...fields, orderDate: e.target.value })}
                />
              </label>
              <label className="po-field">
                Needed by
                <input
                  type="date"
                  required
                  value={fields.neededBy}
                  onChange={(e) => setFields({ ...fields, neededBy: e.target.value })}
                />
              </label>
            </div>
            {fields.lines.map((line, i) => (
              <fieldset key={i}>
                <legend>Line {i + 1}</legend>
                <div className="po-line-form">
                  {(
                    [
                      ["description", "Description"],
                      ["quantity", "Quantity"],
                      ["unit", "Unit"],
                      ["rate", "Rate (USD)"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="po-field" key={key}>
                      {label}
                      <input
                        required
                        inputMode={key === "quantity" || key === "rate" ? "decimal" : undefined}
                        value={line[key]}
                        onChange={(e) =>
                          setFields({
                            ...fields,
                            lines: fields.lines.map((l, n) =>
                              n === i ? { ...l, [key]: e.target.value } : l,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="po-button po-subtle"
                    disabled={busy || fields.lines.length === 1}
                    onClick={() =>
                      setFields({ ...fields, lines: fields.lines.filter((_, n) => n !== i) })
                    }
                  >
                    Remove line {i + 1}
                  </button>
                </div>
              </fieldset>
            ))}
            <button
              type="button"
              className="po-button po-subtle"
              disabled={busy || fields.lines.length >= 100}
              onClick={() =>
                setFields({
                  ...fields,
                  lines: [...fields.lines, { description: "", quantity: "", unit: "", rate: "" }],
                })
              }
            >
              Add line
            </button>
            <label className="po-field">
              Revision reason
              <textarea
                required
                maxLength={2000}
                value={fields.reason}
                onChange={(e) => setFields({ ...fields, reason: e.target.value })}
              />
            </label>
            <div className="po-actions">
              <button type="submit" className="po-button po-primary" disabled={busy}>
                Review exact draft
              </button>
              <button
                type="button"
                className="po-button"
                disabled={busy}
                onClick={() =>
                  void onFinish("Revision cancelled. No draft was saved from this form.")
                }
              >
                Cancel revision
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="po-review-totals">
              <div>
                <span className="po-label">Current version {current.version}</span>
                <strong>{poMoney(orderTotal(current))}</strong>
                <p>Needed by {poDate(current.needed_by)}</p>
              </div>
              <div>
                <span className="po-label">Proposed draft version {proposal!.version}</span>
                <strong>{poMoney(orderTotal(proposal!))}</strong>
                <p>Needed by {poDate(proposal!.needed_by)}</p>
              </div>
            </div>
            <OrderLines version={proposal!} />
            <p>
              <strong>Reason:</strong> {pending.payload.reason}
            </p>
            <details>
              <summary>Unchanged selected terms</summary>
              <pre>{terms.body}</pre>
            </details>
            <p className="po-small po-muted">
              Review expires{" "}
              {new Date(pending.expiresAt).toLocaleString(undefined, { timeZoneName: "short" })}.
            </p>
            <div className="po-actions">
              <button className="po-button po-primary" disabled={busy} onClick={() => void save()}>
                {uncertain ? "Retry identical save" : "Confirm and save draft"}
              </button>
              {!uncertain && (
                <button
                  className="po-button"
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    setError("");
                  }}
                >
                  Back to edit
                </button>
              )}
              <button
                className="po-button"
                disabled={busy}
                onClick={() =>
                  void onFinish(
                    uncertain
                      ? "Save outcome is not confirmed. Check the refreshed current revision and history before taking another action; closing did not undo a save."
                      : "Review cancelled. This form did not save a draft.",
                  )
                }
              >
                {uncertain ? "Close and refresh history" : "Cancel revision"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
