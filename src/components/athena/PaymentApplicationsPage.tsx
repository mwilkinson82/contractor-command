import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { BoardSignIn } from "./BoardSignIn";
import { AccountingWorkspace } from "./AccountingWorkspace";
import { PaymentApplicationDetail } from "./PaymentApplicationDetail";
import { PayAppPayments } from "./PayAppPayments";
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
  isCertificateRevision,
  type ApplicationContext,
  type ApplicationReview,
  type SavePayload,
  type SavedApplication,
} from "@/lib/payment-applications/workflow";
import { PaymentApplicationContractBasis } from "./PaymentApplicationContractBasis";
import { PaymentCompanyBrand } from "./PaymentCompanyBrand";
import { resolvePaymentBrand } from "@/lib/payment-applications/brand";
import {
  deriveIntent,
  displayIntent,
  intentFromSavedApplication,
  sameWorkingValue,
  workingApplicationSchema,
  workingRequestHash,
  type WorkingIntent,
} from "@/lib/payment-applications/working";
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
  const [editContext, setEditContextState] = useState<{
    kind: "new" | "revision" | "certificate";
    id: string;
    expected_version: number;
    base: SavedApplication | null;
    read: ApplicationContext;
    recoveryRequestId?: string;
  } | null>(null);
  type WorkingPayload = {
    id: string;
    request_id: string;
    request_hash: string;
    expected_version: number;
    operation: "save" | "cancel" | "resume";
    application?: Application;
    intent?: WorkingIntent;
  };
  const [intent, setIntent] = useState<WorkingIntent>({});
  const intentRef = useRef(intent);
  intentRef.current = intent;
  const [workingPending, setWorkingPending] = useState<WorkingPayload | null>(null);
  const [workingConflict, setWorkingConflict] = useState<number | null>(null);
  const workingOpened = useRef("");
  const workingKey = `working-application:${session?.user.id ?? ""}:${jobId}`;
  useEffect(() => {
    setWorkingPending(null);
    setWorkingConflict(null);
    if (!session) return;
    try {
      const x = sessionStorage.getItem(workingKey);
      if (x) setWorkingPending(JSON.parse(x));
    } catch {
      /* outcome remains server guarded */
    }
  }, [workingKey, session?.user.id]);
  const [pendingPredecessor, setPendingPredecessor] = useState<string | null>(null);
  const editContextRef = useRef(editContext);
  const predecessorRequest = useRef(0);
  function setEditContext(next: typeof editContext) {
    editContextRef.current = next;
    setPendingPredecessor(null);
    setEditContextState(next);
  }
  const certificateMode = editContext?.kind === "certificate";
  const visibleIntent = edit ? displayIntent(edit, intent) : intent;
  const editingBase = editContext?.base;
  const recoveryKey = `payment-application:${session?.user.id ?? ""}:${jobId}`;
  useEffect(() => {
    setEdit(null);
    setEditContext(null);
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
    refetchInterval: editContext?.base?.working_state ? 8000 : false,
    queryFn: () => call<ApplicationContext>(jobId, "payment_application_read", { id, version }),
  });
  const saved = data.error ? undefined : data.data?.selected;
  const workingData = editContext?.read ?? data.data;
  const knownApplications = (data.error ? [] : (workingData?.applications ?? []))
    .filter(
      (a) =>
        a.id !== (editContext?.id ?? saved?.application_id) &&
        ["submitted", "certified"].includes(a.state),
    )
    .sort((a, b) => b.period_end.localeCompare(a.period_end));
  const latestKnown = knownApplications[0];
  const currentSovMatches =
    !!saved && saved.body.snapshot.fingerprint === data.data?.snapshot?.fingerprint;
  const managedPriorIds = new Set(knownApplications.map((a) => a.id));
  const downloadStarted = useRef("");
  async function download(s: SavedApplication) {
    try {
      const { applicationPdf } = await import("@/lib/payment-applications/pdf");
      // Resolve the company through the same job-scoped, RLS-protected path used by purchase orders.
      let brand: Awaited<ReturnType<typeof resolvePaymentBrand>> = {};
      try {
        const j = await supabase.from("mcp_jobs").select("id,company_id").eq("id", jobId).single();
        if (!j.error && j.data?.id === jobId && j.data.company_id) {
          const c = await supabase.from("mcp_companies").select("id,name,logo_url").eq("id", j.data.company_id).single();
          if (!c.error && c.data?.id === j.data.company_id) {
            brand = await resolvePaymentBrand({ companyName: c.data.name, logoUrl: c.data.logo_url, backendUrl: import.meta.env.VITE_SUPABASE_URL });
          }
        }
      } catch { /* A missing or inaccessible logo must not prevent the saved document. */ }
      const bytes = applicationPdf(data.data!.job, s, brand);
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
    if (target?.download && saved && !saved.working_state && data.data) {
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
    let nextIntent = intent;
    if (Object.prototype.hasOwnProperty.call(p, "work_cents")) {
      nextIntent = {
        ...intent,
        [item]: { basis: "cumulative", amount_cents: p.work_cents ?? null },
      };
      setIntent(nextIntent);
    }
    setEdit((a) =>
      a
        ? deriveIntent(
            { ...a, lines: a.lines.map((l) => (l.item === item ? { ...l, ...p } : l)) },
            nextIntent,
          )
        : a,
    );
    setReview(null);
  }
  async function selectPredecessor(id: string) {
    const context = editContextRef.current;
    if (!context) return;
    const request = ++predecessorRequest.current;
    setPendingPredecessor(id);
    setReview(null);
    setEdit((a) =>
      a ? { ...a, prior_application: null, prior_certified_net_cents: null, prior_basis: "" } : a,
    );
    if (!id) {
      setPendingPredecessor(null);
      return;
    }
    try {
      const p = await call<ApplicationContext>(jobId, "payment_application_read", { id });
      if (editContextRef.current !== context || predecessorRequest.current !== request) return;
      setPendingPredecessor(null);
      if (p.selected)
        setEdit((current) =>
          current
            ? deriveIntent(carryCertificate(current, p.selected!), intentRef.current)
            : current,
        );
    } catch (e) {
      if (editContextRef.current === context && predecessorRequest.current === request) {
        setPendingPredecessor(null);
        setError((e as Error).message);
      }
    }
  }
  async function startNew() {
    if (busy || pending) return;
    setBusy(true);
    setError("");
    try {
      // A selected detail omits its own invoice from evidence; a new request needs the full job context.
      const read = await call<ApplicationContext>(jobId, "payment_application_read", {});
      if (!read.snapshot) throw Error(read.snapshot_issue ?? "A current saved SOV is needed.");
      setIntent({});
      setEditContext({
        kind: "new",
        id: crypto.randomUUID(),
        expected_version: 0,
        base: null,
        read,
      });
      setEdit({
        ...emptyApplication(read.snapshot),
        ...(read.applications.some((a) => ["submitted", "certified"].includes(a.state))
          ? { prior_mode: "saved" as const }
          : {}),
      });
      setReview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function startRevision(certificate = false) {
    if (!saved || !data.data || busy || pending || workingPending) return;
    setEditContext({
      kind: certificate ? "certificate" : "revision",
      id: saved.application_id,
      expected_version: saved.version,
      base: saved,
      read: data.data,
    });
    setIntent(saved.working_state ? (saved.working_intent ?? {}) : intentFromSavedApplication(saved.body));
    setEdit(
      certificate
        ? {
            ...structuredClone(saved.body),
            state: "certified",
            reason: "",
            certification: { amount_cents: null as unknown as number, date: "", source: "" },
          }
        : structuredClone(saved.body),
    );
    setReview(null);
    setError("");
  }
  useEffect(() => {
    if (
      !saved ||
      saved.working_state !== "open" ||
      saved.version !== saved.latest_version ||
      edit ||
      pending ||
      workingPending
    )
      return;
    const k = `${saved.application_id}:${saved.version}`;
    if (workingOpened.current === k) return;
    workingOpened.current = k;
    setEditContext({
      kind: "revision",
      id: saved.application_id,
      expected_version: saved.version,
      base: saved,
      read: data.data!,
    });
    setIntent(saved.working_intent ?? {});
    setEdit(structuredClone(saved.body));
    setReview(null);
  }, [
    saved?.application_id,
    saved?.version,
    saved?.latest_version,
    saved?.working_state,
    edit,
    pending,
    workingPending,
  ]);
  async function commitWorking(p: WorkingPayload) {
    setBusy(true);
    setError("");
    setWorkingPending(p);
    setWorkingConflict(null);
    try {
      sessionStorage.setItem(workingKey, JSON.stringify(p));
    } catch {
      /* retain in memory */
    }
    try {
      const result = await call<{ id: string; version: number }>(
        jobId,
        "payment_application_working",
        p,
      );
      await call(jobId, "payment_application_read", { id: result.id, version: result.version });
      sessionStorage.removeItem(workingKey);
      setWorkingPending(null);
      window.location.assign(applicationUrl(jobId, result.id, result.version));
    } catch (e) {
      setError(`${(e as Error).message} Check this same working request before starting another.`);
    } finally {
      setBusy(false);
    }
  }
  async function makeWorking(operation: "save" | "cancel" | "resume") {
    const base =
      editContext ?? (saved ? { id: saved.application_id, expected_version: saved.version } : null);
    if (!base || busy || pending || workingPending) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        id: base.id,
        request_id: crypto.randomUUID(),
        expected_version: base.expected_version,
        operation,
        ...(operation === "save" && edit
          ? {
              application: workingApplicationSchema.parse({
                ...deriveIntent(edit, intent),
                state: "draft",
                certification: null,
              }),
              intent,
            }
          : {}),
      };
      const request_hash = await workingRequestHash(payload);
      await commitWorking({ ...payload, request_hash });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function recoverWorking() {
    if (!workingPending) return;
    setBusy(true);
    setError("");
    try {
      const found = await call<{ applied: boolean; id?: string; version?: number }>(
        jobId,
        "payment_application_working_outcome",
        workingPending,
      );
      if (found.applied) {
        sessionStorage.removeItem(workingKey);
        setWorkingPending(null);
        window.location.assign(applicationUrl(jobId, found.id, found.version));
        return;
      }
      if (workingPending.operation !== "save" || !workingPending.application) {
        sessionStorage.removeItem(workingKey);
        setWorkingPending(null);
        setError("No working change was applied. Read the current draft before trying again.");
        return;
      }
      const read = await call<ApplicationContext>(
        jobId,
        "payment_application_read",
        workingPending.expected_version
          ? { id: workingPending.id, version: workingPending.expected_version }
          : {},
      );
      if (
        workingPending.expected_version &&
        (!read.selected || read.selected.latest_version !== workingPending.expected_version)
      ) {
        if (read.selected?.latest_version) setWorkingConflict(read.selected.latest_version);
        throw Error(
          "This save was not applied because the draft changed. Your entries remain visible here for comparison.",
        );
      }
      setEditContext({
        kind: workingPending.expected_version ? "revision" : "new",
        id: workingPending.id,
        expected_version: workingPending.expected_version,
        base: read.selected,
        read,
      });
      setEdit(workingPending.application);
      setIntent(workingPending.intent ?? {});
      sessionStorage.removeItem(workingKey);
      setWorkingPending(null);
      setError("The working change was not applied. Your entries are restored for review.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    if (!edit || !editContext) return;
    setBusy(true);
    setError("");
    try {
      const application = applicationSchema.parse(edit);
      if (editContext.base?.working_state) {
        const current = { ...application, state: "draft", certification: null };
        if (
          !sameWorkingValue(current, workingApplicationSchema.parse(editContext.base.body)) ||
          !sameWorkingValue(intent, editContext.base.working_intent ?? {})
        )
          throw Error("Save working changes before reviewing the exact application version.");
        if (
          application.lines.some(
            (line) =>
              intent[line.item]?.basis === "this_period" &&
              intent[line.item]?.amount_cents !== null &&
              (line.prior_work_cents === null || line.work_cents === null),
          )
        )
          throw Error(
            "Prior installed work is Needed before reviewing this-period work. Your request remains in the working draft.",
          );
      }
      const payload: SavePayload = {
        id: editContext.id,
        request_id: editContext.recoveryRequestId ?? crypto.randomUUID(),
        expected_version: editContext.expected_version,
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
      const read = await call<ApplicationContext>(
        jobId,
        "payment_application_read",
        pending.expected_version > 0 ? { id: pending.id, version: pending.expected_version } : {},
      );
      const base = pending.expected_version > 0 ? read.selected : null;
      if (
        pending.expected_version > 0 &&
        (!base || base.latest_version !== pending.expected_version)
      )
        throw Error(
          "This application changed. Open its latest saved version with Athena before reconciling the pending edit.",
        );
      setEditContext({
        kind: base
          ? isCertificateRevision(pending.application, base)
            ? "certificate"
            : "revision"
          : "new",
        id: pending.id,
        expected_version: pending.expected_version,
        base,
        read,
        recoveryRequestId: pending.request_id,
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
      {target?.download && saved?.working_state && (
        <p role="status">Review and save the application before downloading its document.</p>
      )}
      {workingPending && (
        <section role="status">
          <p>A working draft save may be pending. Check the outcome or retry the same request.</p>
          <button disabled={busy} onClick={() => void recoverWorking()}>
            Check working save
          </button>
          <button disabled={busy} onClick={() => void commitWorking(workingPending)}>
            Retry working save
          </button>
          {workingConflict && (
            <div>
              <p>
                Opening the latest version discards this unapplied attempt. Note any entries you
                want to keep before continuing.
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  sessionStorage.removeItem(workingKey);
                  setWorkingPending(null);
                  window.location.assign(applicationUrl(jobId, workingPending.id, workingConflict));
                }}
              >
                Discard unapplied attempt and open latest version
              </button>
            </div>
          )}
        </section>
      )}
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
      {!data.error && data.data?.snapshot_issue && (
        <p role="status">
          Before preparing or revising an application: {data.data.snapshot_issue} Saved versions
          remain readable; recording a certificate against unchanged issued facts does not require
          the current SOV.
        </p>
      )}
      {data.data && !invalid && !data.error && !edit && !pending && (
        <PaymentCompanyBrand key={`${session.user.id}:${jobId}`} jobId={jobId} actorId={session.user.id} />
      )}
      {data.data && !invalid && !data.error && !edit && !pending && (
        <PaymentApplicationContractBasis
          key={`${session.user.id}:${jobId}`}
          jobId={jobId}
          actorId={session.user.id}
          onSaved={() => data.refetch()}
        />
      )}
      {data.data && !invalid && !data.error && (
        <>
          {saved && !edit && !saved.working_state && (
            <>
              <PaymentApplicationDetail jobId={jobId} saved={saved} />
              {saved.version === saved.latest_version &&
                ["submitted", "certified"].includes(saved.body.state) && (
                  <PayAppPayments jobId={jobId} applicationId={saved.application_id} />
                )}
              <div className="pa-actions">
                <button onClick={() => void download(saved)}>Download saved PDF</button>
                {saved.version === saved.latest_version &&
                  ["submitted", "certified"].includes(saved.body.state) && (
                    <button disabled={busy || !!pending} onClick={() => startRevision(true)}>
                      {saved.body.state === "certified"
                        ? "Correct actual certificate"
                        : "Record actual certificate"}
                    </button>
                  )}
                {saved.version === saved.latest_version && (
                  <button
                    disabled={busy || !!pending || !currentSovMatches}
                    onClick={() => startRevision()}
                  >
                    Revise this application
                  </button>
                )}
              </div>
              {!currentSovMatches && (
                <p>
                  The current SOV source differs from this saved snapshot. Reconcile it with Athena
                  before revising application facts. An actual certificate can still be recorded
                  against the unchanged issued request.
                </p>
              )}
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
          {saved && !edit && saved.working_state && (
            <section>
              <p>
                Working draft · {saved.working_state} · version {saved.version}. No billing has been
                issued.
              </p>
              {saved.version < saved.latest_version ? (
                <a href={applicationUrl(jobId, saved.application_id, saved.latest_version)}>
                  Open latest working version
                </a>
              ) : saved.working_state === "cancelled" ? (
                <button
                  disabled={busy || !!workingPending}
                  onClick={() => void makeWorking("resume")}
                >
                  Resume working draft
                </button>
              ) : (
                <button disabled={busy || !!workingPending} onClick={() => startRevision()}>
                  Edit working draft
                </button>
              )}
            </section>
          )}
          {!edit && (
            <>
              <h2>Saved applications</h2>
              {data.data.applications.length ? (
                <ul>
                  {data.data.applications.map((a) => (
                    <li key={a.id}>
                      <a href={applicationUrl(jobId, a.id, a.version)}>
                        {a.number} · {a.working_state ? `working ${a.working_state}` : a.state} ·{" "}
                        {a.period_start || "Period needed"}
                        {a.period_end ? `–${a.period_end}` : ""} · version {a.version}
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
                  disabled={busy || !data.data.snapshot || !!pending}
                  onClick={() => void startNew()}
                >
                  Prepare a new application
                </button>
              </div>
            </>
          )}
          {edit && (
            <section className="pa-editor">
              <fieldset disabled={busy || !!pending || !!workingPending}>
                {editContext?.base?.working_state &&
                  data.data?.selected &&
                  data.data.selected.latest_version > editContext.expected_version && (
                    <p role="alert">
                      This draft has newer changes. Your unsaved entries are still here.{" "}
                      <a
                        href={applicationUrl(
                          jobId,
                          editContext.id,
                          data.data.selected.latest_version,
                        )}
                      >
                        Open the latest version to reconcile them.
                      </a>
                    </p>
                  )}
                <h2>
                  {certificateMode
                    ? "Record an actual certificate"
                    : editContext?.expected_version
                      ? "Revise application"
                      : "Prepare application"}
                </h2>
                {certificateMode && editingBase && (
                  <>
                    <p>
                      This certificate refers to the unchanged issued request, version{" "}
                      {editingBase.version}. Its period, SOV, amounts and prior sources stay frozen.
                      No additional invoice is created.
                    </p>
                    <details>
                      <summary>
                        Issued request, version {editingBase.version} ·{" "}
                        {appMoney(editingBase.calculation.payment_due_cents)}
                      </summary>
                      <PaymentApplicationDetail saved={editingBase} jobId={jobId} />
                    </details>
                    <TextInput
                      label="Revision reason"
                      value={edit.reason}
                      onChange={(reason) => change({ reason })}
                    />
                  </>
                )}
                {!certificateMode && (
                  <>
                    <p>
                      Blank means Needed. Choose this-period or cumulative work for each line.
                      Stored materials are separate from purchases or cash; transfers into installed
                      work must not be counted twice.
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
                                  ? {
                                      amount_cents: null as unknown as number,
                                      date: "",
                                      source: "",
                                    }
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
                    {latestKnown && (
                      <p>
                        Continue from{" "}
                        <a href={applicationUrl(jobId, latestKnown.id, latestKnown.version)}>
                          {latestKnown.number}, version {latestKnown.version}
                        </a>
                        .{" "}
                        {latestKnown.state === "submitted"
                          ? "Record its actual certificate before preparing the next application."
                          : "Its actual certificate and line values must carry forward; it cannot be classified as unrelated billing."}
                      </p>
                    )}
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
                        <option value="external" disabled={!!latestKnown}>
                          {edit.prior_certified_net_cents === null && !edit.prior_basis
                            ? "External certificate · details needed"
                            : "External certificate"}
                        </option>
                        <option value="first" disabled={!!latestKnown}>
                          First application
                        </option>
                        <option value="saved">Saved certificate</option>
                      </select>
                    </label>
                    {edit.prior_mode === "saved" && (
                      <label>
                        Saved predecessor
                        <select
                          value={pendingPredecessor ?? edit.prior_application?.id ?? ""}
                          onChange={(e) => void selectPredecessor(e.target.value)}
                        >
                          <option value="">Choose the actual prior certificate</option>
                          {workingData!.applications
                            .filter((a) => a.state === "certified" && a.id === latestKnown?.id)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.number} · version {a.version} · {a.period_end}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {!!pendingPredecessor && (
                      <p role="status">
                        Loading the selected certificate. Current work entries will be preserved.
                      </p>
                    )}
                    <div className="pa-fields">
                      <MoneyInput
                        label="Cumulative previous actual certificates, net"
                        value={edit.prior_certified_net_cents}
                        onChange={(prior_certified_net_cents) =>
                          change({ prior_certified_net_cents })
                        }
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
                          {l.item} ·{" "}
                          {edit.snapshot.lines.find((s) => s.item === l.item)?.description} ·
                          scheduled{" "}
                          {appMoney(
                            edit.snapshot.lines.find((s) => s.item === l.item)?.scheduled_cents,
                          )}
                        </h3>
                        {!certificateMode && (
                          <div className="pa-fields">
                            <label>
                              Amount represents
                              <select
                                value={visibleIntent[l.item]?.basis ?? "this_period"}
                                onChange={(e) => {
                                  const next = {
                                    ...intent,
                                    [l.item]: {
                                      basis: e.target.value as "this_period" | "cumulative",
                                      amount_cents: visibleIntent[l.item]?.amount_cents ?? null,
                                    },
                                  };
                                  setIntent(next);
                                  setEdit((a) => (a ? deriveIntent(a, next) : a));
                                  setReview(null);
                                }}
                              >
                                <option value="this_period">This period</option>
                                <option value="cumulative">Cumulative total</option>
                              </select>
                            </label>
                            <MoneyInput
                              label={`Requested work · ${l.item}`}
                              value={visibleIntent[l.item]?.amount_cents ?? null}
                              onChange={(amount_cents) => {
                                const next = {
                                  ...intent,
                                  [l.item]: {
                                    basis: visibleIntent[l.item]?.basis ?? "this_period",
                                    amount_cents,
                                  },
                                };
                                setIntent(next);
                                setEdit((a) => (a ? deriveIntent(a, next) : a));
                                setReview(null);
                              }}
                            />
                          </div>
                        )}
                        <details>
                          <summary>Prior work, storage and retainage details</summary>
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
                            {(["work_retainage_bps", "stored_retainage_bps"] as const).map(
                              (key) => (
                                <RateInput
                                  key={key}
                                  label={
                                    key === "work_retainage_bps"
                                      ? "Work retainage"
                                      : "Stored retainage"
                                  }
                                  value={l[key]}
                                  onChange={(n) => lineChange(l.item, { [key]: n })}
                                />
                              ),
                            )}
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
                        </details>
                      </section>
                    ))}
                    <h3>Reconcile existing issued billing</h3>
                    <p>
                      Classify every record explicitly. Prior invoices, credits and cash do not
                      automatically become certificates. A prior requested amount above actual
                      certification must be reconciled before issuing another application.
                    </p>
                    {workingData!.evidence.map((e) => {
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
                                            treatment: ev.target.value as
                                              | "prior_billing"
                                              | "separate",
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
                              <option
                                value="separate"
                                disabled={
                                  managedPriorIds.has(e.id) ||
                                  (!!e.credit_for && managedPriorIds.has(e.credit_for))
                                }
                              >
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
                  </>
                )}
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
                  {!certificateMode &&
                    !["submitted", "certified"].includes(editingBase?.body.state ?? "") && (
                      <button
                        disabled={busy || !!pending || !!workingPending}
                        onClick={() => void makeWorking("save")}
                      >
                        Save working changes
                      </button>
                    )}
                  {editContext?.base?.working_state === "open" && (
                    <button
                      disabled={busy || !!pending || !!workingPending}
                      onClick={() => void makeWorking("cancel")}
                    >
                      Cancel working draft
                    </button>
                  )}
                  <button
                    disabled={busy || !!pending || !!workingPending || !!pendingPredecessor}
                    className="pa-primary"
                    onClick={() => void prepare()}
                  >
                    {certificateMode ? "Review certificate" : "Review application"}
                  </button>
                  <button
                    disabled={busy || !!pending}
                    onClick={() => {
                      setEdit(null);
                      setEditContext(null);
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
                      onClick={() =>
                        void save({ ...review.payload, review_key: review.review_key })
                      }
                    >
                      {edit.state === "submitted"
                        ? "Confirm submission"
                        : edit.state === "certified"
                          ? "Confirm actual certificate"
                          : `Save ${edit.state === "draft" ? "draft" : "ready application"}`}
                    </button>
                  </section>
                )}
              </fieldset>
            </section>
          )}
        </>
      )}
    </AccountingWorkspace>
  );
}
