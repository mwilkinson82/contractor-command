// Payments received on one pay application, and the PM's way to record a wire or check that came in outside
// Athena. Recording books it on the job exactly like a client page payment (a receipt applied to the pay
// application), so billing stays right and the client page shows it as paid. No Athena fee, no bank details.
import { useState } from "react";
import { ArrowLeftRight, CreditCard, Landmark, ReceiptText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { appMoney, dollarsToCents } from "@/lib/payment-applications/model";

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;

export type RecordedRow = {
  id: string;
  method: "wire" | "check";
  amount_cents: number;
  received_on: string;
  reference: string;
  note: string | null;
  recorded_by: string;
  voided: boolean;
  void_reason: string | null;
};
export type OnlineRow = {
  status: string;
  method: string | null;
  amount_cents: number;
  refunded_cents?: number | null;
  paid_at?: string | null;
  updated_at?: string | null;
  test: boolean;
};
export type PayAppPaymentsData = {
  status: "ok" | "not_found";
  number?: string;
  state?: string;
  can_record?: boolean;
  net_due_cents?: number;
  credits_cents?: number;
  applied_cents?: number;
  pending_cents?: number;
  remaining_cents?: number;
  recorded?: RecordedRow[];
  online?: OnlineRow[];
};

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpc(fn, args);
  if (r.error)
    throw Error(
      r.error.message.startsWith("MCP_BAD:")
        ? r.error.message.slice(8)
        : "That didn't save. Try again in a moment.",
    );
  return r.data as T;
}

const shortDate = (d: string | null | undefined) => {
  if (!d) return "";
  const t = new Date(d.length === 10 ? `${d}T12:00:00Z` : d);
  return Number.isNaN(t.getTime())
    ? d
    : t.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
};
const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};
const onlineWord = (m: string | null) =>
  m === "us_bank_account" ? "by bank" : m === "card" ? "by card" : "";

/** The panel as it renders for given data. Split out so it can be rendered and tested without a database. */
export function PayAppPaymentsPanel({
  data,
  busy,
  error,
  onRecord,
  onVoid,
  initialForm = false,
}: {
  data: PayAppPaymentsData;
  busy: boolean;
  error: string;
  onRecord: (p: {
    method: "wire" | "check";
    amount_cents: number;
    received_on: string;
    reference: string;
    note: string;
  }) => Promise<boolean>;
  onVoid: (id: string, reason: string) => Promise<boolean>;
  initialForm?: boolean;
}) {
  const remaining = data.remaining_cents ?? 0;
  const [open, setOpen] = useState(initialForm);
  const [method, setMethod] = useState<"wire" | "check">("wire");
  const [amount, setAmount] = useState(remaining ? (remaining / 100).toFixed(2) : "");
  const [received, setReceived] = useState(today());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (data.status !== "ok") return null;
  const recorded = data.recorded ?? [];
  const online = (data.online ?? []).filter((o) => o.status !== "failed");
  const received$ = (data.applied_cents ?? 0) + (data.pending_cents ?? 0);
  const due = (data.net_due_cents ?? 0) - (data.credits_cents ?? 0);
  const paidUp = due > 0 && remaining === 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    let cents: number | null;
    try {
      cents = dollarsToCents(amount);
    } catch (x) {
      setFormError((x as Error).message);
      return;
    }
    if (!cents || cents <= 0) return setFormError("Enter the amount received.");
    if (cents > remaining) return setFormError(`That's more than the ${appMoney(remaining)} left.`);
    if (!reference.trim())
      return setFormError(
        method === "check" ? "Enter the check number." : "Enter the wire reference.",
      );
    const ok = await onRecord({
      method,
      amount_cents: cents,
      received_on: received,
      reference,
      note,
    });
    if (ok) {
      setOpen(false);
      setReference("");
      setNote("");
    }
  }

  return (
    <section className="pa-paid" aria-labelledby="pa-paid-title">
      <div className="pa-paid-head">
        <div>
          <h2 id="pa-paid-title">Payments received</h2>
          <p className="pa-paid-sub">
            Card and bank payments from the client page land here on their own. Record wires and
            checks yourself.
          </p>
        </div>
        <span className={`pa-paid-pill ${paidUp ? "is-paid" : remaining < due ? "is-part" : ""}`}>
          {paidUp ? "Paid in full" : remaining < due ? "Partly paid" : "Not paid yet"}
        </span>
      </div>
      <dl className="pa-paid-sum">
        <div>
          <dt>Due on this application</dt>
          <dd>{appMoney(due)}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd>{appMoney(received$)}</dd>
        </div>
        <div className="pa-paid-left">
          <dt>Left to collect</dt>
          <dd>{appMoney(remaining)}</dd>
        </div>
      </dl>
      {recorded.length || online.length ? (
        <ul className="pa-paid-list">
          {online.map((o, i) => (
            <li key={`o${i}`}>
              <span className="pa-paid-icon" aria-hidden="true">
                {o.method === "card" ? <CreditCard size={16} /> : <Landmark size={16} />}
              </span>
              <span className="pa-paid-what">
                <strong>
                  Client page {onlineWord(o.method)}
                  {o.test ? " (test)" : ""}
                </strong>
                <small>
                  {o.status === "processing"
                    ? `Started ${shortDate(o.updated_at)}, clearing`
                    : o.status === "refunded"
                      ? `Paid ${shortDate(o.paid_at)}, refunded`
                      : o.status === "partially_refunded"
                        ? `Paid ${shortDate(o.paid_at)}, ${appMoney(o.refunded_cents ?? 0)} refunded`
                        : `Paid ${shortDate(o.paid_at)}`}
                </small>
              </span>
              <span className="pa-paid-amt">{appMoney(o.amount_cents)}</span>
              <span />
            </li>
          ))}
          {recorded.map((r) => (
            <li key={r.id} className={r.voided ? "is-void" : undefined}>
              <span className="pa-paid-icon" aria-hidden="true">
                {r.method === "check" ? <ReceiptText size={16} /> : <ArrowLeftRight size={16} />}
              </span>
              <span className="pa-paid-what">
                <strong>
                  {r.method === "check" ? `Check ${r.reference}` : `Wire ${r.reference}`}
                </strong>
                <small>
                  {r.voided
                    ? `Removed: ${r.void_reason ?? ""}`
                    : `Received ${shortDate(r.received_on)} · recorded by ${r.recorded_by}${r.note ? ` · ${r.note}` : ""}`}
                </small>
              </span>
              <span className="pa-paid-amt">{appMoney(r.amount_cents)}</span>
              {r.voided ? (
                <span />
              ) : removing === r.id ? (
                <form
                  className="pa-paid-remove"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await onVoid(r.id, reason)) {
                      setRemoving(null);
                      setReason("");
                    }
                  }}
                >
                  <label>
                    Why remove it?
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      placeholder="Entered twice, check bounced…"
                      required
                    />
                  </label>
                  <div className="pa-paid-btns">
                    <button type="submit" className="pa-danger" disabled={busy}>
                      Remove payment
                    </button>
                    <button type="button" disabled={busy} onClick={() => setRemoving(null)}>
                      Keep it
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="pa-paid-x"
                  disabled={busy}
                  onClick={() => {
                    setRemoving(r.id);
                    setReason("");
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {error && <p role="alert">{error}</p>}
      {!data.can_record ? (
        <p className="pa-paid-note">
          Payments can be recorded once this application is submitted or certified.
        </p>
      ) : remaining <= 0 ? null : open ? (
        <form className="pa-paid-form" onSubmit={save}>
          <h3>Record a wire or check</h3>
          <div className="pa-paid-seg" role="radiogroup" aria-label="How it was paid">
            {(["wire", "check"] as const).map((m) => (
              <label key={m} className={method === m ? "is-on" : undefined}>
                <input
                  type="radio"
                  name="pa-paid-method"
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {m === "wire" ? "Wire" : "Check"}
              </label>
            ))}
          </div>
          <div className="pa-paid-fields">
            <label>
              Amount received
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              <small>{`${appMoney(remaining)} left. A partial payment is fine.`}</small>
            </label>
            <label>
              Date it arrived
              <input
                type="date"
                value={received}
                max={today()}
                onChange={(e) => setReceived(e.target.value)}
                required
              />
            </label>
            <label>
              {method === "check" ? "Check number" : "Wire reference"}
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={80}
                placeholder={method === "check" ? "1042" : "Bank confirmation or trace number"}
                required
              />
            </label>
            <label>
              Note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </label>
          </div>
          <p className="pa-paid-note">
            This books the payment on the job and shows the pay application as paid on your client's
            page. Athena charges no fee on wires and checks.
          </p>
          {formError && <p role="alert">{formError}</p>}
          <div className="pa-paid-btns">
            <button type="submit" className="pa-primary" disabled={busy}>
              {busy ? "Saving…" : "Save payment"}
            </button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="pa-paid-btns">
          <button
            type="button"
            className="pa-primary"
            onClick={() => {
              setAmount((remaining / 100).toFixed(2));
              setFormError("");
              setOpen(true);
            }}
          >
            Record a wire or check
          </button>
        </div>
      )}
    </section>
  );
}

/** Loads one pay application's payments and wires the panel to the database. Shows nothing until it can read
 * them, so the page keeps working before the payments database update is applied. */
export function PayAppPayments({ jobId, applicationId }: { jobId: string; applicationId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One request id per attempt, kept across retries so a lost answer never records the payment twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const q = useQuery({
    queryKey: ["pay-app-payments", jobId, applicationId],
    retry: false,
    queryFn: () =>
      call<PayAppPaymentsData>("mcp_pay_app_payments", {
        _job: jobId,
        _application: applicationId,
      }),
  });
  if (!q.data || q.error) return null;
  return (
    <PayAppPaymentsPanel
      key={`${applicationId}:${q.data.remaining_cents}`}
      data={q.data}
      busy={busy}
      error={error}
      onRecord={async (p) => {
        setBusy(true);
        setError("");
        try {
          await call("mcp_pay_app_record_payment", {
            _job: jobId,
            _application: applicationId,
            _id: requestId,
            _method: p.method,
            _amount_cents: p.amount_cents,
            _received_on: p.received_on,
            _reference: p.reference.trim(),
            _note: p.note.trim() || null,
          });
          setRequestId(crypto.randomUUID());
          await q.refetch();
          return true;
        } catch (e) {
          setError((e as Error).message);
          return false;
        } finally {
          setBusy(false);
        }
      }}
      onVoid={async (id, reason) => {
        setBusy(true);
        setError("");
        try {
          await call("mcp_pay_app_void_payment", { _job: jobId, _payment: id, _reason: reason });
          await q.refetch();
          return true;
        } catch (e) {
          setError((e as Error).message);
          return false;
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
