import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { appMoney, dollarsToCents } from "@/lib/payment-applications/model";
import { supabase } from "@/integrations/supabase/client";

type Basis = {
  version: string;
  original_cents: number | null;
  approved_cents: number | null;
  change_cents: number | null;
  sov_cents: number | null;
  basis: string | null;
};
type Payload = {
  request_id: string;
  expected_version: string;
  original_cents: number;
  basis: string;
};
type Review = {
  payload: Payload;
  review_key: string;
  approved_cents: number;
  sov_cents: number;
  expires_at: string;
};
type Pending = Payload & { review_key: string };
async function call<T>(job: string, action: string, p: unknown): Promise<T> {
  const r = await (supabase.rpc as any)("mcp_billing_evidence_record", {
    _job: job,
    _action: action,
    _p: p,
  });
  if (r.error) throw Error(r.error.message.replace(/^MCP_BAD:/, ""));
  return r.data;
}
export function PaymentApplicationContractBasis({
  jobId,
  actorId,
  onSaved,
}: {
  jobId: string;
  actorId: string;
  onSaved: () => Promise<unknown>;
}) {
  const key = `contract-basis:v1:${actorId}:${jobId}`;
  const current = useQuery({
    queryKey: ["contract-basis", jobId, actorId],
    queryFn: () => call<Basis>(jobId, "contract_basis_read", {}),
    retry: false,
  });
  const [form, setForm] = useState<{
    amount: string;
    basis: string;
    version: string;
    request: string;
  } | null>(null);
  const [review, setReview] = useState<Review | null>(null),
    [pending, setPending] = useState<Pending | null>(null);
  const [phase, setPhase] = useState("idle"),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    try {
      const value = sessionStorage.getItem(key);
      if (value) setPending(JSON.parse(value));
    } catch {
      /* server still verifies every recovered payload */
    }
    return () => {
      generation.current++;
    };
  }, [key]);
  function change(p: Partial<NonNullable<typeof form>>) {
    generation.current++;
    setForm((f) => (f ? { ...f, ...p, request: crypto.randomUUID() } : f));
    setReview(null);
    setPhase("idle");
    setError("");
  }
  function close() {
    generation.current++;
    setForm(null);
    setReview(null);
    setPhase("idle");
    setError("");
  }
  async function prepare() {
    if (!form) return;
    const g = ++generation.current;
    setPhase("reviewing");
    setError("");
    try {
      const cents = dollarsToCents(form.amount);
      if (cents === null || cents < 0 || !form.basis.trim())
        throw Error("Provide the original contract amount and its basis.");
      const result = await call<Review & { applied?: boolean }>(jobId, "contract_basis_review", {
        request_id: form.request,
        expected_version: form.version,
        original_cents: cents,
        basis: form.basis.trim(),
      });
      if (g !== generation.current) return;
      if (result.applied) {
        setForm(null);
        setReview(null);
        const reads = await Promise.all([current.refetch(), onSaved()]);
        if (g !== generation.current) return;
        if (reads.some((r) => (r as { error?: unknown })?.error))
          throw Error(
            "This request was saved, but refreshed details are unavailable. Reload after checking access.",
          );
        setStatus("This exact request was already saved. Application prerequisites refreshed.");
      } else setReview(result);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setPhase("idle");
    }
  }
  async function complete(p: Pending) {
    if (phase === "saving") return;
    const g = ++generation.current;
    setPhase("saving");
    setError("");
    setPending(p);
    try {
      sessionStorage.setItem(key, JSON.stringify(p));
    } catch {
      /* keep same request in memory */
    }
    try {
      await call(jobId, "contract_basis_save", p);
      if (g !== generation.current) return;
      sessionStorage.removeItem(key);
      setPending(null);
      setForm(null);
      setReview(null);
      const basisRead = await current.refetch();
      const applicationRead = await onSaved();
      if (basisRead.error || (applicationRead as { error?: unknown })?.error) {
        setError(
          "Contract basis was saved, but its refreshed details are unavailable. Reload after checking access.",
        );
        return;
      }
      if (g === generation.current)
        setStatus("Contract basis saved and refreshed. No invoice or payment was created.");
    } catch (e) {
      if (g === generation.current)
        setError(
          `${(e as Error).message} The outcome may be pending; check this same request before starting another.`,
        );
    } finally {
      if (g === generation.current) setPhase("idle");
    }
  }
  async function check() {
    if (!pending || phase !== "idle") return;
    const g = ++generation.current;
    setPhase("checking");
    setError("");
    try {
      const result = await call<{ applied: boolean }>(jobId, "contract_basis_outcome", pending);
      if (g !== generation.current) return;
      if (result.applied) {
        sessionStorage.removeItem(key);
        setPending(null);
        setForm(null);
        setReview(null);
        const basisRead = await current.refetch();
        const applicationRead = await onSaved();
        if (basisRead.error || (applicationRead as { error?: unknown })?.error) {
          setError(
            "The saved contract basis was found, but its refreshed details are unavailable. Reload after checking access.",
          );
          return;
        }
        if (g === generation.current)
          setStatus("The saved contract basis was found. Application prerequisites refreshed.");
      } else {
        sessionStorage.removeItem(key);
        setForm({
          amount: (pending.original_cents / 100).toFixed(2),
          basis: pending.basis,
          version: pending.expected_version,
          request: pending.request_id,
        });
        setPending(null);
        setReview(null);
        setStatus(
          "This request was not applied. Review it again; changed contract or SOV sources require reloading the current basis.",
        );
      }
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setPhase("idle");
    }
  }
  return (
    <section className="pa-editor" aria-label="Contract basis">
      <h2>Contract basis</h2>
      <p>
        Confirm the original amount and its basis so the application ties to the approved contract
        and saved SOV.
      </p>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {current.error && (
        <p role="alert">{current.error.message} No cached contract details are shown.</p>
      )}
      {pending ? (
        <>
          <p role="status">
            A contract-basis save may be pending. Check its outcome before another edit.
          </p>
          <button disabled={phase !== "idle"} onClick={() => void check()}>
            Check contract save
          </button>
          <button disabled={phase !== "idle"} onClick={() => void complete(pending)}>
            Retry contract save
          </button>
        </>
      ) : (
        !current.error &&
        current.data && (
          <>
            <p>
              Original contract: {appMoney(current.data.original_cents)} · Approved changes:{" "}
              {appMoney(current.data.change_cents)} · Saved SOV: {appMoney(current.data.sov_cents)}
            </p>
            {!form ? (
              <button
                onClick={() => {
                  generation.current++;
                  setStatus("");
                  setForm({
                    amount:
                      current.data.original_cents === null
                        ? ""
                        : (current.data.original_cents / 100).toFixed(2),
                    basis: current.data.basis ?? "",
                    version: current.data.version,
                    request: crypto.randomUUID(),
                  });
                }}
              >
                Review contract basis
              </button>
            ) : (
              <>
                <label>
                  Original contract amount (USD)
                  <input
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => change({ amount: e.target.value })}
                  />
                </label>
                <label>
                  Basis or source reference
                  <textarea
                    maxLength={2000}
                    value={form.basis}
                    onChange={(e) => change({ basis: e.target.value })}
                  />
                </label>
                <p>
                  Recorded as information you provide. A reference does not independently verify a
                  document or approval. Approved changes stay separate.
                </p>
                {review ? (
                  <>
                    <h3>Review contract basis</h3>
                    <p>
                      Original: {appMoney(review.payload.original_cents)} · Approved total:{" "}
                      {appMoney(review.approved_cents)} · Saved SOV: {appMoney(review.sov_cents)}
                    </p>
                    <p>{review.payload.basis}</p>
                    <p>
                      This updates the contract basis only. Existing invoices, credits and cash
                      remain unchanged.
                    </p>
                    <button
                      disabled={phase !== "idle"}
                      onClick={() =>
                        void complete({ ...review.payload, review_key: review.review_key })
                      }
                    >
                      Confirm contract basis
                    </button>
                  </>
                ) : (
                  <button disabled={phase !== "idle"} onClick={() => void prepare()}>
                    Review amount and basis
                  </button>
                )}
                <button disabled={phase === "saving"} onClick={close}>
                  Cancel contract edit
                </button>
                <button
                  disabled={phase !== "idle"}
                  onClick={async () => {
                    close();
                    await current.refetch();
                  }}
                >
                  Reload current basis
                </button>
              </>
            )}
          </>
        )
      )}
    </section>
  );
}
