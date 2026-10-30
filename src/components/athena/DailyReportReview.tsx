import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DailyPagePayload } from "@/lib/report-pages";
import { readDailyIndex } from "@/lib/daily-report-workspace";
import { productionClient } from "@/lib/production-report";
import { dailyDisplayText, dailyReportHeading } from "@/lib/mcp/superintendent";
import { DailyReportCapture } from "./DailyReportCapture";
import "./daily-report-workspace.css";

export function DailyReportReview({
  payload,
  jobId,
  memberId,
  token,
}: {
  payload: DailyPagePayload;
  jobId: string;
  memberId?: string;
  token?: string;
}) {
  const [capture, setCapture] = useState(false);
  const [tab, setTab] = useState<"report" | "evidence" | "history">("report");
  const index = useQuery({
    queryKey: ["daily-report-index", jobId, memberId],
    enabled: !!memberId,
    retry: false,
    staleTime: 0,
    queryFn: () => readDailyIndex(productionClient(supabase), jobId),
  });
  const identity =
    [payload.job_number, payload.job_name].filter(Boolean).join(" · ") ||
    "Project name not recorded";
  const text = (value?: string | null) =>
    dailyDisplayText(value, payload.report_date, jobId)?.trim() || "Not recorded";
  const base = `/r/job/${jobId}/daily`;
  const current = payload.report_date ?? "";
  const dates = !index.error ? (index.data?.dates ?? []) : [];
  const pos = dates.indexOf(current);
  const fieldHref = `/r/job/${jobId}/field${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  return (
    <main className="dr-workspace">
      <header className="dr-top">
        <nav aria-label="Project navigation">
          <a href={`/r/job/${jobId}/home${token ? `?t=${encodeURIComponent(token)}` : ""}`}>
            ← Project home
          </a>
          <a href="/today">Morning brief</a>
        </nav>
        <span>ATHENA · DAILY REPORTS</span>
      </header>
      <div className="dr-heading">
        <div>
          <h1>{capture ? "Field capture" : "Daily report review"}</h1>
          <p>{identity}</p>
        </div>
        {memberId && !capture && (
          <button className="dr-button" type="button" onClick={() => setCapture(true)}>
            New daily report
          </button>
        )}
      </div>
      {capture ? (
        <DailyReportCapture jobId={jobId} identity={identity} onClose={() => setCapture(false)} />
      ) : (
        <div className="dr-layout">
          <aside className="dr-index" aria-label="Saved daily reports">
            <h2>Reports</h2>
            {memberId ? (
              <>
                <form action={base} method="get">
                  <label>
                    Open exact date
                    <input name="date" type="date" required defaultValue={current} key={current} />
                  </label>
                  <button type="submit">Open report</button>
                </form>
                {index.isLoading ? (
                  <p role="status">Reading saved dates…</p>
                ) : index.error ? (
                  <p role="alert">
                    Saved dates are unavailable. The exact-date reader remains available.
                  </p>
                ) : dates.length ? (
                  <nav aria-label="Report dates">
                    {dates.map((date) => (
                      <a
                        key={date}
                        aria-current={date === current ? "page" : undefined}
                        href={`${base}?date=${date}`}
                      >
                        {date}
                      </a>
                    ))}
                  </nav>
                ) : (
                  <p>No saved reports were found in the date index.</p>
                )}
                {index.data?.complete === false && (
                  <p>Latest 200 report dates shown. Open an earlier exact date above.</p>
                )}
              </>
            ) : (
              <p>
                Sign in to use the saved-date index and capture. This board link shows only its
                authorized daily.
              </p>
            )}
            <a href={fieldHref}>Field board</a>
            <a href={`/r/job/${jobId}/production`}>Production review</a>
          </aside>
          <article className="dr-document">
            <header>
              <p className="dr-kicker">
                {payload.found ? "CURRENT SAVED DAILY" : "NO SAVED DAILY"}
              </p>
              <h2>{current ? dailyReportHeading(current) : "Latest daily"}</h2>
              <div className="dr-date-nav">
                {memberId && pos >= 0 && dates[pos + 1] && (
                  <a href={`${base}?date=${dates[pos + 1]}`}>← Earlier report</a>
                )}
                {memberId && pos > 0 && (
                  <a href={`${base}?date=${dates[pos - 1]}`}>Later report →</a>
                )}
              </div>
            </header>
            {!payload.found ? (
              <div className="dr-empty">
                <h3>
                  {current
                    ? "No daily is saved for this date."
                    : "No daily is saved for this job yet."}
                </h3>
                <p>
                  Choose another saved date or start capture. No report sections or totals are
                  inferred.
                </p>
                {memberId && (
                  <button className="dr-button" type="button" onClick={() => setCapture(true)}>
                    Start daily report
                  </button>
                )}
              </div>
            ) : (
              <>
                <nav className="dr-tabs" aria-label="Daily report sections">
                  {(["report", "evidence", "history"] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-current={tab === value ? "page" : undefined}
                      onClick={() => setTab(value)}
                    >
                      {value[0].toUpperCase() + value.slice(1)}
                    </button>
                  ))}
                </nav>
                {tab === "report" && (
                  <div className="dr-sections">
                    <section className="dr-wide">
                      <h3>Work & production</h3>
                      {payload.lines?.length ? (
                        payload.lines.map((line, i) => (
                          <div className="dr-work-row" key={i}>
                            <p>{text(line.work)}</p>
                            <p className="dr-work-facts">
                              {[
                                line.qty != null ? `${line.qty} ${line.unit ?? ""}` : "",
                                line.crew != null ? `crew ${line.crew}` : "",
                                line.hours != null ? `${line.hours} hours` : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            <dl>
                              {[
                                [
                                  "Quantity",
                                  line.qty === null || line.qty === undefined
                                    ? "Not recorded"
                                    : `${line.qty} ${line.unit ?? "(unit not recorded)"}`,
                                ],
                                ["Crew size", line.crew ?? "Not recorded"],
                                ["Hours per person", line.hours ?? "Not recorded"],
                                ["SOV reference", line.sov_item ?? "Not recorded"],
                                ["CPM activity", line.activity_id ?? "Not recorded"],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <dt>{label}</dt>
                                  <dd>{value}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        ))
                      ) : (
                        <p>Work lines not recorded.</p>
                      )}
                    </section>
                    {[
                      ["Crews & hours", payload.manpower],
                      ["Weather", payload.weather],
                      ["Subcontractors on site", payload.subs_on_site],
                      ["Deliveries", payload.deliveries],
                      ["Issues & constraints", payload.issues],
                      ["Delays", payload.delays],
                      ["Safety", payload.safety],
                    ].map(([label, value]) => (
                      <section key={label}>
                        <h3>{label}</h3>
                        <p>{text(value)}</p>
                      </section>
                    ))}
                  </div>
                )}
                {tab === "evidence" && (
                  <section className="dr-evidence">
                    <h3>Saved evidence & references</h3>
                    <p>
                      Report date: {current}. Quantities, hours and references are as reported;
                      approved mappings and independent verification are not established.
                    </p>
                    <p>
                      Photo attachments are not included in this report read.{" "}
                      <a
                        href={`/r/job/${jobId}/photos${token ? `?t=${encodeURIComponent(token)}` : ""}`}
                      >
                        Open progress photos (all dates)
                      </a>
                      .
                    </p>
                    <p>
                      Original transcript and attachments are not supplied by this read model.
                      Missing evidence is not zero.
                    </p>
                  </section>
                )}
                {tab === "history" && (
                  <section className="dr-evidence">
                    <h3>Current saved version</h3>
                    <p>
                      The existing daily workflow replaces saved sections and work lines for a date.
                      Immutable revision history and historical snapshots are not available in this
                      read model.
                    </p>
                    <p>
                      Reopen a date to read its current saved content. No earlier revision is
                      reconstructed.
                    </p>
                  </section>
                )}
              </>
            )}
          </article>
        </div>
      )}
    </main>
  );
}
