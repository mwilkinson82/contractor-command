import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { BoardSignIn } from "./BoardSignIn";
import { AccountingWorkspace } from "./AccountingWorkspace";
import { PaymentApplicationDetail } from "./PaymentApplicationDetail";
import {
  applicationSchema,
  appMoney,
  dollarsToCents,
  type Application,
  type AppLine,
} from "@/lib/payment-applications/model";
import {
  applicationTarget,
  applicationUrl,
  emptyApplication,
  carryCertificate,
  type ApplicationContext,
  type ApplicationReview,
  type SavePayload,
  type SavedApplication,
} from "@/lib/payment-applications/workflow";
import "./payment-applications.css";
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
async function call<T>(job: string, action: string, p: unknown): Promise<T> {
  const r = await rpc("mcp_billing_evidence_record", { _job: job, _action: action, _p: p });
  if (r.error) throw Error(r.error.message.replace(/^MCP_BAD:/, ""));
  return r.data as T;
}
const amountValue = (n: number | null) => (n === null ? "" : (n / 100).toFixed(2));
function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  const [raw, setRaw] = useState(amountValue(value));
  const [error, setError] = useState("");
  useEffect(() => setRaw(amountValue(value)), [value]);
  return (
    <label>
      {label} (USD)
      <input
        inputMode="decimal"
        value={raw}
        placeholder="Needed"
        onChange={(e) => {
          setRaw(e.target.value);
          try {
            onChange(dollarsToCents(e.target.value));
            setError("");
          } catch {
            onChange(null);
            setError("Use dollars with at most two decimals.");
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  );
}
function RateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  const [raw, setRaw] = useState(value === null ? "" : String(value / 100));
  const [error, setError] = useState("");
  useEffect(() => setRaw(value === null ? "" : String(value / 100)), [value]);
  return (
    <label>
      {label} (%)
      <input
        inputMode="decimal"
        placeholder="Needed"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          try {
            const n = dollarsToCents(e.target.value);
            if (n !== null && (n < 0 || n > 10000)) throw Error();
            onChange(n);
            setError("");
          } catch {
            onChange(null);
            setError("Use zero to 100 percent with at most two decimal places.");
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  );
}
function TextInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
export function PaymentApplicationsPage({
  jobId,
  search,
}: {
  jobId: string;
  search: Record<string, unknown>;
}) {
  const { session, loading } = useAuth();
  let target: ReturnType<typeof applicationTarget> | null = null;
  let invalid = "";
  try {
    target = applicationTarget(search);
  } catch (e) {
    invalid = (e as Error).message;
  }
  const id = target?.id,
    version = target?.version;
  const [edit, setEdit] = useState<Application | null>(null),
    [review, setReview] = useState<ApplicationReview | null>(null),
    [pending, setPending] = useState<(SavePayload & { review_key: string }) | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [recoveredIdentity, setRecoveredIdentity] = useState<Pick<
    SavePayload,
    "id" | "request_id" | "expected_version"
  > | null>(null);
  const recoveryKey = `payment-application:${session?.user.id ?? ""}:${jobId}`;
  useEffect(() => {
    setEdit(null);
    setReview(null);
    setError("");
  }, [id, version, jobId, session?.user.id]);
  useEffect(() => {
    setPending(null);
    if (!session) return;
    try {
      const p = sessionStorage.getItem(recoveryKey);
      if (p) setPending(JSON.parse(p));
    } catch {
      /* unavailable storage */
    }
  }, [recoveryKey, session?.user.id]);
  const data = useQuery({
    queryKey: ["payment-applications", jobId, session?.user.id, id, version],
    enabled: !!session && !loading && !invalid,
    retry: false,
    queryFn: () => call<ApplicationContext>(jobId, "payment_application_read", { id, version }),
  });
  const saved = data.data?.selected;
  const downloadStarted = useRef("");
  async function download(s: SavedApplication) {
    try {
      const { applicationPdf } = await import("@/lib/payment-applications/pdf");
      const bytes = applicationPdf(data.data!.job, s);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Payment-application-${s.body.number.replace(/[^a-zA-Z0-9_-]/g, "-")}-v${s.version}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (target?.download && saved && data.data) {
      const key = `${jobId}:${saved.application_id}:${saved.version}`;
      if (downloadStarted.current !== key) {
        downloadStarted.current = key;
        void download(saved);
      }
    }
  }, [saved, target?.download]);
  function change(p: Partial<Application>) {
    setEdit((a) => (a ? { ...a, ...p } : a));
    setReview(null);
  }
  function lineChange(item: string, p: Partial<AppLine>) {
    setEdit((a) =>
      a ? { ...a, lines: a.lines.map((l) => (l.item === item ? { ...l, ...p } : l)) } : a,
    );
    setReview(null);
  }
  async function prepare() {
    if (!edit) return;
    setBusy(true);
    setError("");
    try {
      const application = applicationSchema.parse(edit);
      const payload: SavePayload = {
        id: recoveredIdentity?.id ?? saved?.application_id ?? crypto.randomUUID(),
        request_id: recoveredIdentity?.request_id ?? crypto.randomUUID(),
        expected_version: recoveredIdentity?.expected_version ?? saved?.version ?? 0,
        application,
      };
      setReview(await call(jobId, "payment_application_review", payload));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(p: SavePayload & { review_key: string }) {
    setBusy(true);
    setError("");
    setPending(p);
    try {
      sessionStorage.setItem(recoveryKey, JSON.stringify(p));
    } catch {
      /* in-memory retry still retains identity */
    }
    try {
      const result = await call<{ id: string; version: number }>(
        jobId,
        "payment_application_save",
        p,
      );
      await call(jobId, "payment_application_read", { id: result.id, version: result.version });
      sessionStorage.removeItem(recoveryKey);
      setPending(null);
      window.location.assign(applicationUrl(jobId, result.id, result.version));
    } catch (e) {
      setError(
        `${(e as Error).message} Retry the same save to check its outcome; do not create another application.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const r = await call<{ applied: boolean; id?: string; version?: number }>(
        jobId,
        "payment_application_outcome",
        pending,
      );
      if (r.applied) {
        window.location.assign(applicationUrl(jobId, r.id, r.version));
        return;
      }
      setRecoveredIdentity({
        id: pending.id,
        request_id: pending.request_id,
        expected_version: pending.expected_version,
      });
      setEdit(pending.application);
      setReview(null);
      setPending(null);
      sessionStorage.removeItem(recoveryKey);
      setError("No save was applied. Review the same application again before confirming.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <AccountingWorkspace jobId={jobId} title="Payment applications">
        <p>Checking sign-in…</p>
      </AccountingWorkspace>
    );
  if (!session)
    return <BoardSignIn returnTo={applicationUrl(jobId, id, version, target?.download)} />;
  return (
    <AccountingWorkspace
      jobId={jobId}
      title="Payment applications"
      description="Saved SOV applications and continuation schedules · USD"
      className="pa-page"
    >
      <p>
        <a href={`/r/job/${jobId}/payapp`}>Monthly billing forecast</a> ·{" "}
        <a href={`/r/job/${jobId}/billing-records`}>Billing evidence and originals</a>
      </p>
      {invalid && <p role="alert">{invalid} No other application was substituted.</p>}
      {data.isPending && !invalid && <p>Loading application records…</p>}
      {data.error && <p role="alert">{data.error.message} No other application was substituted.</p>}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <section role="status">
          <p>A reviewed save may be pending. Retry its same request to verify the saved outcome.</p>
          <button disabled={busy} onClick={() => void save(pending)}>
            Retry this save
          </button>
          <button disabled={busy} onClick={() => void recover()}>
            Check outcome and return to review
          </button>
        </section>
      )}
      {data.data?.snapshot_issue && (
        <p role="status">
          Before preparing or revising an application: {data.data.snapshot_issue} Saved versions
          remain readable.
        </p>
      )}
      {data.data && !invalid && (
        <>
          {saved && !edit && (
            <>
              <PaymentApplicationDetail jobId={jobId} saved={saved} />
              <div className="pa-actions">
                <button onClick={() => void download(saved)}>Download saved PDF</button>
                {saved.version === saved.latest_version && (
                  <button
                    disabled={!!pending}
                    onClick={() => {
                      setEdit(structuredClone(saved.body));
                      setReview(null);
                    }}
                  >
                    Revise this application
                  </button>
                )}
              </div>
              <h3>Version history</h3>
              <ul>
                {saved.history.map((h) => (
                  <li key={h.version}>
                    <a href={applicationUrl(jobId, saved.application_id, h.version)}>
                      Version {h.version} · {h.state}
                    </a>{" "}
                    · {h.recorded_at} {h.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!edit && (
            <>
              <h2>Saved applications</h2>
              {data.data.applications.length ? (
                <ul>
                  {data.data.applications.map((a) => (
                    <li key={a.id}>
                      <a href={applicationUrl(jobId, a.id, a.version)}>
                        {a.number} · {a.state} · {a.period_start}–{a.period_end} · version{" "}
                        {a.version}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No SOV payment application has been saved. Billing evidence and forecasts are
                  separate.
                </p>
              )}
              <div className="pa-actions">
                <button
                  disabled={!data.data.snapshot || !!pending}
                  onClick={() => {
                    if (data.data?.snapshot) {
                      setEdit(emptyApplication(data.data.snapshot));
                      setReview(null);
                    }
                  }}
                >
                  Prepare a new application
                </button>
              </div>
            </>
          )}
          {edit && (
            <section className="pa-editor">
              <h2>{saved ? "Revise" : "Prepare"} application</h2>
              <p>
                Blank means Needed. Enter cumulative installed work and currently stored materials,
                not purchases or cash. Moving stored materials into installed work must not count
                them twice.
              </p>
              <div className="pa-fields">
                <TextInput
                  label="Application number"
                  value={edit.number}
                  onChange={(number) => change({ number })}
                />
                <TextInput
                  label="Period start"
                  type="date"
                  value={edit.period_start}
                  onChange={(period_start) => change({ period_start })}
                />
                <TextInput
                  label="Period end / billing date"
                  type="date"
                  value={edit.period_end}
                  onChange={(period_end) => change({ period_end })}
                />
                <TextInput
                  label="Prior application cutoff"
                  type="date"
                  value={edit.prior_cutoff}
                  onChange={(prior_cutoff) => change({ prior_cutoff })}
                />
                <label>
                  Save state
                  <select
                    value={edit.state}
                    onChange={(e) =>
                      change({
                        state: e.target.value as Application["state"],
                        certification:
                          e.target.value === "certified"
                            ? { amount_cents: 0, date: "", source: "" }
                            : null,
                      })
                    }
                  >
                    <option value="draft">Draft</option>
                    <option value="ready">Ready</option>
                    <option value="submitted">Submitted</option>
                    <option value="certified">Certified</option>
                  </select>
                </label>
                <TextInput
                  label="Progress/application source"
                  value={edit.source}
                  onChange={(source) => change({ source })}
                />
                <TextInput
                  label="Revision reason"
                  value={edit.reason}
                  onChange={(reason) => change({ reason })}
                />
              </div>
              <h3>Prior application and certificate</h3>
              <label>
                Prior basis
                <select
                  value={edit.prior_mode}
                  onChange={(e) =>
                    change({
                      prior_mode: e.target.value as Application["prior_mode"],
                      prior_application: null,
                    })
                  }
                >
                  <option value="external">External certificate</option>
                  <option value="first">First application</option>
                  <option value="saved">Saved certificate</option>
                </select>
              </label>
              {edit.prior_mode === "saved" && (
                <label>
                  Saved predecessor
                  <select
                    value={edit.prior_application?.id ?? ""}
                    onChange={async (e) => {
                      try {
                        const p = await call<ApplicationContext>(
                          jobId,
                          "payment_application_read",
                          { id: e.target.value },
                        );
                        if (p.selected) change(carryCertificate(edit, p.selected));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <option value="">Choose the actual prior certificate</option>
                    {data.data.applications
                      .filter((a) => a.state === "certified" && a.id !== saved?.application_id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.number} · version {a.version} · {a.period_end}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <div className="pa-fields">
                <MoneyInput
                  label="Cumulative previous actual certificates, net"
                  value={edit.prior_certified_net_cents}
                  onChange={(prior_certified_net_cents) => change({ prior_certified_net_cents })}
                />
                <TextInput
                  label="Prior certificate source / first-application declaration"
                  value={edit.prior_basis}
                  onChange={(prior_basis) => change({ prior_basis })}
                />
                <TextInput
                  label="Applicable retainage terms"
                  value={edit.retainage_basis}
                  onChange={(retainage_basis) => change({ retainage_basis })}
                />
              </div>
              <h3>Continuation schedule</h3>
              {edit.lines.map((l) => (
                <section className="pa-line" key={l.item}>
                  <h3>
                    {l.item} · {edit.snapshot.lines.find((s) => s.item === l.item)?.description} ·
                    scheduled{" "}
                    {appMoney(edit.snapshot.lines.find((s) => s.item === l.item)?.scheduled_cents)}
                  </h3>
                  <div className="pa-fields">
                    {(
                      [
                        ["prior_work_cents", "Prior installed"],
                        ["prior_stored_cents", "Prior stored"],
                        ["prior_retained_cents", "Prior retained"],
                        ["work_cents", "Cumulative installed"],
                        ["stored_cents", "Currently stored"],
                        [
                          "stored_to_work_cents",
                          "Transferred from prior storage into installed work",
                        ],
                        ["release_cents", "Cumulative approved release"],
                      ] as const
                    ).map(([key, label]) => (
                      <MoneyInput
                        key={key}
                        label={label}
                        value={l[key]}
                        onChange={(n) => lineChange(l.item, { [key]: n })}
                      />
                    ))}
                    {(["work_retainage_bps", "stored_retainage_bps"] as const).map((key) => (
                      <RateInput
                        key={key}
                        label={key === "work_retainage_bps" ? "Work retainage" : "Stored retainage"}
                        value={l[key]}
                        onChange={(n) => lineChange(l.item, { [key]: n })}
                      />
                    ))}
                    <TextInput
                      label="Stored material evidence and eligibility"
                      value={l.stored_basis}
                      onChange={(stored_basis) => lineChange(l.item, { stored_basis })}
                    />
                    <TextInput
                      label="Retainage release approval/source"
                      value={l.release_basis}
                      onChange={(release_basis) => lineChange(l.item, { release_basis })}
                    />
                  </div>
                </section>
              ))}
              <h3>Reconcile existing issued billing</h3>
              <p>
                Classify every record explicitly. Prior invoices, credits and cash do not
                automatically become certificates. A prior requested amount above actual
                certification must be reconciled before issuing another application.
              </p>
              {data.data.evidence.map((e) => {
                const choice = edit.evidence.find((c) => c.id === e.id);
                return (
                  <section className="pa-line" key={e.id}>
                    <p>
                      {e.number} · {e.kind} · version {e.version} · {e.invoice_date} · net{" "}
                      {appMoney(e.net_due_cents)}
                    </p>
                    <label>
                      Relationship
                      <select
                        value={choice?.treatment ?? ""}
                        onChange={(ev) =>
                          change({
                            evidence: [
                              ...edit.evidence.filter((c) => c.id !== e.id),
                              ...(ev.target.value
                                ? [
                                    {
                                      id: e.id,
                                      version: e.version,
                                      treatment: ev.target.value as "prior_billing" | "separate",
                                      reason: choice?.reason ?? "",
                                    },
                                  ]
                                : []),
                            ],
                          })
                        }
                      >
                        <option value="">Needed</option>
                        <option value="prior_billing">
                          Prior billing supporting this certificate basis
                        </option>
                        <option value="separate">
                          Separate scope/evidence · explain why not carried forward
                        </option>
                      </select>
                    </label>
                    {choice && (
                      <TextInput
                        label="Reconciliation basis"
                        value={choice.reason}
                        onChange={(reason) =>
                          change({
                            evidence: edit.evidence.map((c) =>
                              c.id === e.id ? { ...c, reason } : c,
                            ),
                          })
                        }
                      />
                    )}
                  </section>
                );
              })}
              {edit.certification && (
                <>
                  <h3>Actual certificate</h3>
                  <div className="pa-fields">
                    <MoneyInput
                      label="Amount certified for this application"
                      value={edit.certification.amount_cents}
                      onChange={(amount_cents) =>
                        change({
                          certification: {
                            ...edit.certification!,
                            amount_cents: amount_cents as number,
                          },
                        })
                      }
                    />
                    <TextInput
                      label="Certificate date"
                      type="date"
                      value={edit.certification.date}
                      onChange={(date) =>
                        change({ certification: { ...edit.certification!, date } })
                      }
                    />
                    <TextInput
                      label="Certificate source"
                      value={edit.certification.source}
                      onChange={(source) =>
                        change({ certification: { ...edit.certification!, source } })
                      }
                    />
                  </div>
                </>
              )}
              <div className="pa-actions">
                <button
                  disabled={busy || !!pending}
                  className="pa-primary"
                  onClick={() => void prepare()}
                >
                  Review application
                </button>
                <button
                  disabled={busy || !!pending}
                  onClick={() => {
                    setEdit(null);
                    setReview(null);
                  }}
                >
                  Cancel editing
                </button>
              </div>
              {review && (
                <section className="pa-review">
                  <h2>Review only · nothing saved yet</h2>
                  <PaymentApplicationDetail
                    saved={{
                      application_id: review.payload.id,
                      version: review.payload.expected_version + 1,
                      latest_version: review.payload.expected_version + 1,
                      body: review.payload.application,
                      calculation: review.calculation,
                      billing_version: null,
                      recorded_at: "Not saved yet",
                      history: [],
                    }}
                  />
                  <p>{review.billing_effect}</p>
                  <p>
                    Review valid until {review.expires_at}. Confirming saves this exact reviewed
                    content.
                  </p>
                  <button
                    disabled={busy || !!pending}
                    className="pa-primary"
                    onClick={() => void save({ ...review.payload, review_key: review.review_key })}
                  >
                    {edit.state === "submitted"
                      ? "Confirm submission"
                      : edit.state === "certified"
                        ? "Confirm actual certificate"
                        : `Save ${edit.state === "draft" ? "draft" : "ready application"}`}
                  </button>
                </section>
              )}
            </section>
          )}
        </>
      )}
    </AccountingWorkspace>
  );
}
