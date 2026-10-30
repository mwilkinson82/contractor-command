import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { productionClient, readProductionDaily } from "@/lib/production-report";
import {
  DAILY_FIELDS,
  DailyCaptureSaveError,
  reviewDailyCapture,
  saveDailyCapture,
  validateDailyCapture,
  type DailyCaptureReview,
} from "@/lib/daily-report-workspace";
import type { DailySections, WorkLine } from "@/lib/mcp/superintendent";

const emptyLine = (): WorkLine => ({
  work: "",
  sov_item: null,
  activity_id: null,
  qty: null,
  unit: null,
  crew: null,
  hours: null,
  pct_complete: null,
});
const emptyDraft = (): DailySections => ({
  weather: "",
  manpower: "",
  subs_on_site: "",
  deliveries: "",
  issues: "",
  delays: "",
  safety: "",
  work: [emptyLine()],
});
export function DailyReportCapture({
  jobId,
  identity,
  initialDate,
  onClose,
}: {
  jobId: string;
  identity: string;
  initialDate?: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate ?? "");
  const [draft, setDraft] = useState(emptyDraft);
  const [review, setReview] = useState(false);
  const [prepared, setPrepared] = useState<DailyCaptureReview | null>(null);
  const [replayed, setReplayed] = useState(false);
  const [existing, setExisting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!saved) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saved]);
  async function prepare() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      validateDailyCapture(date, draft);
      const current = await readProductionDaily(productionClient(supabase), jobId, date);
      setExisting(!!current.found);
      if (current.found)
        throw new Error(
          "A daily already exists for this date. Review the saved report or use Athena's existing correction workflow. This capture form creates a new daily; it does not replace saved evidence.",
        );
      setPrepared(reviewDailyCapture(jobId, date, draft));
      setConfirmed(false);
      setReview(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Daily review is unavailable.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function save(manualRetry = false) {
    if (inFlight.current || (uncertain && !manualRetry) || !confirmed || !prepared) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await saveDailyCapture(
        productionClient(supabase),
        jobId,
        date,
        draft,
        confirmed,
        prepared,
      );
      setReplayed(receipt.replayed === true);
      setUncertain(false);
      setSaved(true);
    } catch (e) {
      const unresolved = !(e instanceof DailyCaptureSaveError) || e.kind === "uncertain";
      setUncertain(unresolved);
      if (!unresolved) {
        setPrepared(null);
        setReview(false);
        setConfirmed(false);
        setExisting(e instanceof DailyCaptureSaveError && e.kind === "conflict");
      }
      setError(
        e instanceof Error
          ? e.message
          : "Save outcome is uncertain. Review the saved date before another attempt.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function updateLine(index: number, field: keyof WorkLine, value: string) {
    setDraft((d) => ({
      ...d,
      work: d.work.map((w, i) =>
        i === index
          ? {
              ...w,
              [field]: ["qty", "crew", "hours", "pct_complete"].includes(field)
                ? value === ""
                  ? null
                  : Number(value)
                : value || null,
            }
          : w,
      ),
    }));
  }
  if (saved)
    return (
      <section className="dr-capture">
        <h2>{replayed ? "Daily creation confirmed" : "Daily report saved"}</h2>
        {replayed && (
          <p>
            This request created the daily earlier. Open the current saved report to check any later
            corrections. Retrying did not replace it.
          </p>
        )}
        <p>
          {identity} · {date}
        </p>
        <a className="dr-button" href={`/r/job/${jobId}/daily?date=${date}`}>
          Read saved daily
        </a>
        <p>
          The saved schedule has not been changed. Percent-complete entries are available to the
          existing schedule feed.
        </p>
      </section>
    );
  return (
    <section className="dr-capture" aria-label="Daily report capture">
      <header>
        <p>{identity}</p>
        <h2>{review ? "Review daily before saving" : "New daily report"}</h2>
        <p>
          {review
            ? "Review every section and confirm the date."
            : "Nothing is saved until you review and confirm. Say none explicitly where appropriate."}
        </p>
      </header>
      {error && <p role="alert">{error}</p>}
      {existing && !review && (
        <p>
          <a href={`/r/job/${jobId}/daily?date=${date}`}>Review this date's saved daily</a>
        </p>
      )}
      <fieldset disabled={busy || review || uncertain}>
        <label>
          Report date
          <input
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setExisting(false);
              setError("");
            }}
          />
        </label>
        {DAILY_FIELDS.map(([field, label, max]) => (
          <label key={field}>
            {label}
            <textarea
              rows={3}
              maxLength={max}
              value={draft[field] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
            />
          </label>
        ))}
        <h3>Work & production</h3>
        {draft.work.map((work, index) => (
          <fieldset className="dr-work-entry" key={index}>
            <legend>Work line {index + 1}</legend>
            <label>
              Work performed
              <textarea
                maxLength={400}
                value={work.work}
                onChange={(e) => updateLine(index, "work", e.target.value)}
              />
            </label>
            <div className="dr-entry-grid">
              {(
                [
                  ["sov_item", "SOV item", "text"],
                  ["activity_id", "CPM activity", "text"],
                  ["qty", "Quantity", "number"],
                  ["unit", "Unit", "text"],
                  ["crew", "Crew size", "number"],
                  ["hours", "Hours per person", "number"],
                  ["pct_complete", "Percent complete (optional)", "number"],
                ] as const
              ).map(([field, label, type]) => (
                <label key={field}>
                  {label}
                  <input
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    min={type === "number" ? 0 : undefined}
                    max={field === "pct_complete" ? 100 : undefined}
                    value={work[field] ?? ""}
                    onChange={(e) => updateLine(index, field, e.target.value)}
                  />
                </label>
              ))}
            </div>
            {draft.work.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({ ...d, work: d.work.filter((_, i) => i !== index) }))
                }
              >
                Remove line {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          disabled={draft.work.length >= 80}
          onClick={() => setDraft((d) => ({ ...d, work: [...d.work, emptyLine()] }))}
        >
          + Add work line
        </button>
      </fieldset>
      {review && (
        <div className="dr-confirm">
          <p>
            No report was found for this date during review. This confirmed request can only create
            a new daily. If another session creates it first, nothing is replaced and you must
            review again.
          </p>
          <a href={`/r/job/${jobId}/daily?date=${date}`} target="_blank" rel="noreferrer">
            Read this date's currently saved report
          </a>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || uncertain}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I confirm this date and every section.
          </label>
        </div>
      )}
      <div className="dr-actions">
        {review ? (
          <>
            <button
              type="button"
              disabled={busy || uncertain}
              onClick={() => {
                setReview(false);
                setConfirmed(false);
                setPrepared(null);
              }}
            >
              Edit draft
            </button>
            <button
              className="dr-button"
              type="button"
              disabled={!confirmed || busy || uncertain}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Confirm & save daily"}
            </button>
          </>
        ) : (
          <button
            className="dr-button"
            type="button"
            disabled={busy || uncertain}
            onClick={() => void prepare()}
          >
            {busy ? "Checking saved date…" : "Review before saving"}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Discard this unsaved draft and return to review?")) onClose();
          }}
        >
          Discard draft
        </button>
      </div>
      {uncertain && (
        <div role="status">
          <p>
            Keep this reviewed draft open. You can check the saved date or manually retry the exact
            confirmed request. Retrying checks the original confirmed save; it cannot replace a
            saved report.
          </p>
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            {busy ? "Checking request…" : "Check / retry confirmed save"}
          </button>
        </div>
      )}
      <p>
        Photos use the existing Athena photo-capture workflow.{" "}
        <a href={`/r/job/${jobId}/photos`}>Review progress photos</a>.
      </p>
    </section>
  );
}
