import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { BoardSignIn } from "./BoardSignIn";
import { invoiceBalance, receiptBalance } from "@/lib/billing-evidence-balances";

type InvoiceVersion = {
  version: number;
  status: string;
  invoice_date: string;
  effective_date: string;
  period_start: string | null;
  period_end: string | null;
  certified_cents: number | null;
  certified_date: string | null;
  source: string;
  gross_cents: number | null;
  withheld_cents: number | null;
  released_cents: number | null;
  net_due_cents: number;
  reason: string | null;
};
type Invoice = {
  id: string;
  document_number: string;
  kind: string;
  credit_for: string | null;
  versions: InvoiceVersion[];
};
type Receipt = { id: string; receipt_date: string; source: string; amount_cents: number };
type Allocation = {
  id: string;
  receipt_id: string;
  invoice_id: string;
  amount_cents: number;
  reversal_of: string | null;
};
type ReceiptReversal = {
  id: string;
  receipt_id: string;
  amount_cents: number;
  effective_date: string;
  source: string;
};
type Payload = {
  invoices: Invoice[];
  receipts: Receipt[];
  allocations: Allocation[];
  receipt_reversals: ReceiptReversal[];
};
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
function cents(value: FormDataEntryValue | null): number {
  const s = String(value ?? "").trim();
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(s))
    throw new Error("Enter a nonnegative USD amount with at most two decimal places.");
  const [whole, fraction = ""] = s.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > 9_000_000_000_000)
    throw new Error("Amount is too large.");
  return amount;
}
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const input = "mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm";
const button =
  "rounded bg-[#1E3A5F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

export function BillingEvidencePage({ jobId }: { jobId: string }) {
  const { session, loading } = useAuth();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // The same request and content survive a failed response, so retry cannot duplicate a write.
  const [pending, setPending] = useState<{
    action: string;
    payload: Record<string, unknown>;
  } | null>(null);
  const userId = session?.user.id;
  const pendingKey = `billing-pending:${jobId}:${userId ?? ""}`;
  useEffect(() => {
    if (!userId) {
      setPending(null);
      return;
    }
    try {
      const saved = sessionStorage.getItem(pendingKey);
      setPending(saved ? JSON.parse(saved) : null);
    } catch {
      setPending(null);
    }
  }, [pendingKey, userId]);
  const data = useQuery({
    queryKey: ["billing-evidence", jobId, session?.user.id],
    enabled: !loading && !!session,
    retry: false,
    queryFn: async () => {
      const r = await rpc("mcp_billing_evidence_get", { _job: jobId });
      if (r.error) throw new Error(r.error.message);
      return r.data as Payload;
    },
  });
  async function send(action: string, payload: Record<string, unknown>) {
    setSaving(true);
    setError("");
    setPending({ action, payload });
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify({ action, payload }));
    } catch {
      setError("Could not preserve the request for a safe retry.");
      setSaving(false);
      return;
    }
    try {
      const result = await rpc("mcp_billing_evidence_record", {
        _job: jobId,
        _action: action,
        _p: payload,
      });
      if (result.error) {
        setError(result.error.message);
        // A SQLSTATE from the server confirms that the transaction was rejected.
        // A transport error leaves the outcome uncertain and preserves the retry.
        if (/^[0-9A-Z]{5}$/.test(result.error.code ?? "")) {
          sessionStorage.removeItem(pendingKey);
          setPending(null);
        }
      } else {
        sessionStorage.removeItem(pendingKey);
        setPending(null);
        await data.refetch();
      }
    } catch {
      setError("The save outcome is unknown. Retry the same request to reconcile it.");
    } finally {
      setSaving(false);
    }
  }
  function saveInvoice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      void send("invoice", {
        request_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        expected_version: 0,
        kind: field(f, "kind"),
        credit_for: field(f, "credit_for") || null,
        document_number: field(f, "number"),
        status: field(f, "status"),
        invoice_date: field(f, "date"),
        effective_date: field(f, "date"),
        period_start: field(f, "start") || null,
        period_end: field(f, "end") || null,
        source: field(f, "source"),
        gross_cents: cents(f.get("gross")),
        withheld_cents: cents(f.get("withheld")),
        released_cents: cents(f.get("released")),
        net_due_cents: cents(f.get("net")),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function saveCredit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      void send("invoice", {
        request_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        expected_version: 0,
        kind: "credit",
        credit_for: field(f, "credit_for"),
        document_number: field(f, "number"),
        status: field(f, "status"),
        invoice_date: field(f, "date"),
        effective_date: field(f, "date"),
        source: field(f, "source"),
        gross_cents: null,
        withheld_cents: null,
        released_cents: null,
        net_due_cents: cents(f.get("amount")),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function saveRevision(e: FormEvent<HTMLFormElement>, invoice: Invoice) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const current = invoice.versions[0];
    try {
      void send("invoice", {
        request_id: crypto.randomUUID(),
        id: invoice.id,
        expected_version: current.version,
        status: field(f, "status"),
        invoice_date: current.invoice_date,
        effective_date: field(f, "effective"),
        period_start: current.period_start,
        period_end: current.period_end,
        source: field(f, "source"),
        gross_cents: invoice.kind === "credit" ? null : cents(f.get("gross")),
        withheld_cents: invoice.kind === "credit" ? null : cents(f.get("withheld")),
        released_cents: invoice.kind === "credit" ? null : cents(f.get("released")),
        net_due_cents: cents(f.get("net")),
        certified_cents: field(f, "certified") ? cents(f.get("certified")) : null,
        certified_date: field(f, "certified_date") || null,
        reason: field(f, "reason"),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function saveReceipt(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      void send("receipt", {
        request_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        receipt_date: field(f, "date"),
        source: field(f, "source"),
        amount_cents: cents(f.get("amount")),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function reverseReceipt(e: FormEvent<HTMLFormElement>, receipt: Receipt) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      void send("reverse_receipt", {
        request_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        receipt_id: receipt.id,
        effective_date: field(f, "date"),
        source: field(f, "source"),
        amount_cents: cents(f.get("amount")),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function reverseAllocation(e: FormEvent<HTMLFormElement>, allocation: Allocation) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      void send("reverse_allocation", {
        request_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        allocation_id: allocation.id,
        effective_date: field(f, "date"),
        source: field(f, "source"),
        amount_cents: cents(f.get("amount")),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function saveAllocation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      void send("allocation", {
        request_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        receipt_id: field(f, "receipt"),
        invoice_id: field(f, "invoice"),
        effective_date: field(f, "date"),
        source: field(f, "source"),
        amount_cents: cents(f.get("amount")),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  if (loading || data.isLoading)
    return (
      <main className="p-6" role="status">
        Loading billing records…
      </main>
    );
  if (!session) return <BoardSignIn returnTo={`/r/job/${jobId}/billing-records`} />;
  if (data.error || !data.data)
    return (
      <main className="p-6">
        <p role="alert">Billing records are unavailable for this account.</p>
        <button onClick={() => void data.refetch()}>Retry</button>
      </main>
    );
  const { invoices, receipts, allocations, receipt_reversals } = data.data;
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6 text-[#1E3A5F]">
      <a className="text-sm underline" href={`/r/job/${jobId}/home`}>
        Project home
      </a>
      <header>
        <h1 className="text-2xl font-semibold">Billing and payment records</h1>
        <p className="mt-2 text-sm text-gray-600">
          Record source documents and cash received. Balances use recorded entries and may be
          incomplete. These records do not update the billing forecast or earned progress.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {pending && (
        <div className="rounded border border-amber-300 p-3">
          <p>
            The save outcome needs confirmation. Retry the same request before making another entry.
          </p>
          <button
            className={button}
            disabled={saving}
            onClick={() => void send(pending.action, pending.payload)}
          >
            Retry save
          </button>
        </div>
      )}
      <section>
        <h2 className="text-lg font-semibold">Invoices and pay applications</h2>
        {invoices.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            No records recorded yet. Project totals are unknown.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {invoices.map((i) => {
              const v = i.versions[0];
              const {
                cash: allocated,
                credits,
                remaining,
              } = invoiceBalance(i, invoices, allocations);
              return (
                <article className="rounded border border-gray-300 p-4" key={i.id}>
                  <h3 className="font-semibold">
                    {i.document_number} · {i.kind.replace("_", " ")}
                  </h3>
                  <p className="text-sm">
                    {v.status} · {v.invoice_date} · source: {v.source}
                  </p>
                  {i.kind === "credit" ? (
                    <p className="text-sm">
                      Credit amount {money(v.net_due_cents)} · invoice{" "}
                      {invoices.find((x) => x.id === i.credit_for)?.document_number ??
                        "Unavailable"}{" "}
                      ·{" "}
                      {v.status === "posted"
                        ? "Reduces invoice balance"
                        : "Does not reduce invoice balance"}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm">
                      Gross {money(v.gross_cents!)} · withheld {money(v.withheld_cents!)} · released{" "}
                      {money(v.released_cents!)} · source net due {money(v.net_due_cents)}
                    </p>
                  )}
                  {v.certified_cents !== null && (
                    <p className="text-sm">
                      Certified {money(v.certified_cents)} on {v.certified_date}
                    </p>
                  )}
                  {i.kind !== "credit" && ["submitted", "certified"].includes(v.status) && (
                    <p className="text-sm">
                      Recorded allocated cash {money(allocated)} · recorded posted credits{" "}
                      {money(credits)} · remaining from recorded entries {money(remaining)}
                    </p>
                  )}
                  <details className="mt-2 text-sm">
                    <summary>Version history ({i.versions.length})</summary>
                    {i.versions.map((h) => (
                      <p key={h.version}>
                        Version {h.version}: {h.status} · effective {h.effective_date} · {h.source}{" "}
                        ·{" "}
                        {i.kind === "credit"
                          ? `credit ${money(h.net_due_cents)}`
                          : `gross ${money(h.gross_cents!)} · withheld ${money(h.withheld_cents!)} · released ${money(h.released_cents!)} · source net due ${money(h.net_due_cents)}`}
                        {h.certified_cents !== null
                          ? ` · certified ${money(h.certified_cents)} on ${h.certified_date}`
                          : ""}
                        {h.reason ? ` — ${h.reason}` : ""}
                      </p>
                    ))}
                  </details>
                  {v.status !== "void" && (
                    <details className="mt-3">
                      <summary>Record a revision</summary>
                      <form
                        onSubmit={(e) => saveRevision(e, i)}
                        className="mt-3 grid gap-3 sm:grid-cols-2"
                      >
                        <label>
                          Status
                          <select name="status" defaultValue={v.status} className={input}>
                            <option value="draft">Draft</option>
                            {i.kind === "credit" ? (
                              <option value="posted">Posted</option>
                            ) : (
                              <>
                                <option value="submitted">Submitted</option>
                                <option value="certified">Certified</option>
                              </>
                            )}
                            <option value="void">Void</option>
                          </select>
                        </label>
                        <label>
                          Effective date
                          <input
                            required
                            type="date"
                            name="effective"
                            defaultValue={v.effective_date}
                            className={input}
                          />
                        </label>
                        {i.kind !== "credit" && (
                          <>
                            <label>
                              Gross for period (USD)
                              <input
                                required
                                name="gross"
                                defaultValue={(v.gross_cents! / 100).toFixed(2)}
                                className={input}
                              />
                            </label>
                            <label>
                              Retainage withheld (USD)
                              <input
                                required
                                name="withheld"
                                defaultValue={(v.withheld_cents! / 100).toFixed(2)}
                                className={input}
                              />
                            </label>
                            <label>
                              Retainage released (USD)
                              <input
                                required
                                name="released"
                                defaultValue={(v.released_cents! / 100).toFixed(2)}
                                className={input}
                              />
                            </label>
                          </>
                        )}
                        <label>
                          {i.kind === "credit" ? "Credit amount (USD)" : "Source net due (USD)"}
                          <input
                            required
                            name="net"
                            defaultValue={(v.net_due_cents / 100).toFixed(2)}
                            className={input}
                          />
                        </label>
                        {i.kind !== "credit" && (
                          <>
                            <label>
                              Certified amount (USD), if certified
                              <input
                                name="certified"
                                defaultValue={
                                  v.certified_cents == null
                                    ? ""
                                    : (v.certified_cents / 100).toFixed(2)
                                }
                                className={input}
                              />
                            </label>
                            <label>
                              Certification date
                              <input
                                type="date"
                                name="certified_date"
                                defaultValue={v.certified_date ?? ""}
                                className={input}
                              />
                            </label>
                          </>
                        )}
                        <label>
                          Source
                          <input required name="source" defaultValue={v.source} className={input} />
                        </label>
                        <label>
                          Reason for revision
                          <input required name="reason" className={input} />
                        </label>
                        <div>
                          <button disabled={saving || !!pending} className={button}>
                            Save revision
                          </button>
                        </div>
                      </form>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <details className="mt-4 rounded border border-gray-300 p-4">
          <summary className="font-semibold">Record an invoice or pay application</summary>
          <form onSubmit={saveInvoice} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              Document number
              <input required name="number" className={input} />
            </label>
            <label>
              Type
              <select name="kind" className={input}>
                <option value="invoice">Invoice</option>
                <option value="pay_application">Pay application</option>
              </select>
            </label>
            <label>
              Status
              <select name="status" className={input}>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
              </select>
            </label>
            <label>
              Invoice date
              <input required type="date" name="date" className={input} />
            </label>
            <label>
              Period start
              <input type="date" name="start" className={input} />
            </label>
            <label>
              Period end
              <input type="date" name="end" className={input} />
            </label>
            <label>
              Gross for this period (USD)
              <input required name="gross" inputMode="decimal" className={input} />
            </label>
            <label>
              Retainage withheld (USD)
              <input required name="withheld" inputMode="decimal" className={input} />
            </label>
            <label>
              Retainage released (USD)
              <input required name="released" inputMode="decimal" className={input} />
            </label>
            <label>
              Net due per source (USD)
              <input required name="net" inputMode="decimal" className={input} />
            </label>
            <label className="sm:col-span-2">
              Source document or reference
              <input required name="source" className={input} />
            </label>
            <div>
              <button disabled={saving || !!pending} className={button}>
                Save record
              </button>
            </div>
          </form>
        </details>
        <details className="mt-4 rounded border border-gray-300 p-4">
          <summary className="font-semibold">Record an invoice credit</summary>
          <form onSubmit={saveCredit} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              Credit number
              <input required name="number" className={input} />
            </label>
            <label>
              Invoice
              <select required name="credit_for" className={input}>
                <option value="">Choose invoice</option>
                {invoices
                  .filter(
                    (i) =>
                      i.kind !== "credit" &&
                      ["submitted", "certified"].includes(i.versions[0].status),
                  )
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.document_number}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Status
              <select name="status" className={input}>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
              </select>
            </label>
            <label>
              Credit date
              <input required type="date" name="date" className={input} />
            </label>
            <label>
              Credit amount (USD)
              <input required name="amount" className={input} />
            </label>
            <label>
              Source
              <input required name="source" className={input} />
            </label>
            <div>
              <button disabled={saving || !!pending} className={button}>
                Save credit
              </button>
            </div>
          </form>
        </details>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Cash receipts</h2>
        {allocations.filter((a) => !a.reversal_of).length > 0 && (
          <details className="mt-3 rounded border border-gray-300 p-4">
            <summary>Allocation history</summary>
            {allocations
              .filter((a) => !a.reversal_of)
              .map((a) => {
                const reversed = allocations
                  .filter((r) => r.reversal_of === a.id)
                  .reduce((n, r) => n + r.amount_cents, 0);
                return (
                  <article key={a.id} className="mt-3 border-t pt-3">
                    <p>
                      {invoices.find((i) => i.id === a.invoice_id)?.document_number ?? "Invoice"}:{" "}
                      {money(a.amount_cents)} allocated; {money(reversed)} reversed
                    </p>
                    {reversed < a.amount_cents && (
                      <details>
                        <summary>Reverse an allocation</summary>
                        <form
                          onSubmit={(e) => reverseAllocation(e, a)}
                          className="mt-3 grid gap-3 sm:grid-cols-2"
                        >
                          <label>
                            Amount (USD)
                            <input required name="amount" className={input} />
                          </label>
                          <label>
                            Effective date
                            <input required name="date" type="date" className={input} />
                          </label>
                          <label>
                            Correction source
                            <input required name="source" className={input} />
                          </label>
                          <div>
                            <button disabled={saving || !!pending} className={button}>
                              Save reversal
                            </button>
                          </div>
                        </form>
                      </details>
                    )}
                  </article>
                );
              })}
          </details>
        )}
        {receipts.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            No receipts recorded yet. Cash received is unknown.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {receipts.map((r) => {
              const {
                allocated: applied,
                reversed,
                unapplied,
              } = receiptBalance(r, allocations, receipt_reversals);
              const reversals = receipt_reversals.filter((x) => x.receipt_id === r.id);
              return (
                <article className="rounded border border-gray-300 p-4" key={r.id}>
                  <p className="font-semibold">
                    {money(r.amount_cents)} received {r.receipt_date}
                  </p>
                  <p className="text-sm">
                    {r.source} · corrected {money(reversed)} · allocated {money(applied)} ·
                    unapplied {money(unapplied)}
                  </p>
                  {reversals.map((x) => (
                    <p className="text-sm" key={x.id}>
                      Correction {money(x.amount_cents)} effective {x.effective_date} · {x.source}
                    </p>
                  ))}
                  {unapplied > 0 && (
                    <details>
                      <summary>Correct receipt</summary>
                      <p className="text-sm">
                        Reverse unapplied recorded cash. This does not issue a refund.
                      </p>
                      <form
                        onSubmit={(e) => reverseReceipt(e, r)}
                        className="mt-3 grid gap-3 sm:grid-cols-2"
                      >
                        <label>
                          Amount (USD)
                          <input required name="amount" className={input} />
                        </label>
                        <label>
                          Effective date
                          <input required type="date" name="date" className={input} />
                        </label>
                        <label>
                          Correction source
                          <input required name="source" className={input} />
                        </label>
                        <div>
                          <button disabled={saving || !!pending} className={button}>
                            Save correction
                          </button>
                        </div>
                      </form>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <details className="mt-4 rounded border border-gray-300 p-4">
          <summary className="font-semibold">Record a receipt</summary>
          <form onSubmit={saveReceipt} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              Receipt date
              <input required type="date" name="date" className={input} />
            </label>
            <label>
              Amount received (USD)
              <input required name="amount" inputMode="decimal" className={input} />
            </label>
            <label className="sm:col-span-2">
              Unique receipt source or reference
              <input required name="source" className={input} />
            </label>
            <div>
              <button disabled={saving || !!pending} className={button}>
                Save receipt
              </button>
            </div>
          </form>
        </details>
        <details className="mt-4 rounded border border-gray-300 p-4">
          <summary className="font-semibold">Allocate a receipt</summary>
          <form onSubmit={saveAllocation} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              Receipt
              <select required name="receipt" className={input}>
                <option value="">Choose receipt</option>
                {receipts.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.receipt_date} — {r.source}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Invoice
              <select required name="invoice" className={input}>
                <option value="">Choose invoice</option>
                {invoices
                  .filter(
                    (i) =>
                      i.kind !== "credit" &&
                      ["submitted", "certified"].includes(i.versions[0].status),
                  )
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.document_number}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Effective date
              <input required type="date" name="date" className={input} />
            </label>
            <label>
              Amount (USD)
              <input required name="amount" inputMode="decimal" className={input} />
            </label>
            <label className="sm:col-span-2">
              Allocation source
              <input required name="source" className={input} />
            </label>
            <div>
              <button disabled={saving || !!pending} className={button}>
                Save allocation
              </button>
            </div>
          </form>
        </details>
      </section>
    </main>
  );
}
