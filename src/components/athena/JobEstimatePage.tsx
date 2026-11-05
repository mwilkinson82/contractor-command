import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { estimateOverview, gbbOverview } from "@/lib/job-board-commercial";
import { BoardSignIn } from "./BoardSignIn";
import { ProjectReadUnavailable } from "./ProjectReadUnavailable";
import { AthenaBrand, AthenaFooter } from "./AthenaBrand";
import { CopyAsk, ExportList, GbbCard } from "./JobHomeCommercial";
import "./project-overview.css";
import "./job-board-commercial.css";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

type Line = {
  line_no: number;
  item: string;
  material?: string | null;
  qty?: number | string | null;
  unit?: string | null;
  range_text?: string | null;
  sheet: string;
  detail?: string | null;
  basis?: string;
  confidence?: string;
  missing_input?: string | null;
  exclusion?: string | null;
};
type Gap = { ref: string; title: string; severity?: string; holds_bid?: boolean; sheet?: string };

const SEVERITY: Record<string, string> = {
  hard: "Holds the bid",
  soft: "Worth checking",
  cannot_know: "Can't be known from the drawings",
};

/** The saved estimate for a job, read-only. Work on it happens in the member's Athena chat. */
export function JobEstimatePage({ jobId }: { jobId: string }) {
  const { session, loading } = useAuth();
  const q = useQuery({
    queryKey: ["job-estimate", jobId, session?.user.id],
    enabled: !loading && !!session,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [job, e, b, x, g, field] = await Promise.all([
        supabase.from("mcp_jobs").select("job_number, name").eq("id", jobId).single(),
        rpc("mcp_estimate_get", { _job: jobId }),
        rpc("mcp_estimate_bid_get", { _job: jobId }),
        rpc("mcp_takeoff_exports", { _job: jobId }),
        rpc("mcp_residential_selections_get", { _job: jobId }),
        rpc("mcp_report_page_get", { _page: "field", _job: jobId, _company: null }),
      ]);
      if (job.error || e.error) throw new Error("Estimate unavailable.");
      const raw = e.data as {
        takeoff?: { lines?: Line[] } | null;
        gaps?: Gap[];
        verdicts?: { gap_ref?: string | null }[];
      } | null;
      const answered = new Set((raw?.verdicts ?? []).map((v) => v.gap_ref).filter(Boolean));
      const company = (field.data as { company?: string } | null)?.company;
      return {
        jobNumber: job.data.job_number as string,
        jobName: (job.data.name as string | null) ?? null,
        company,
        overview: estimateOverview(e.data, b.error ? null : b.data, x.error ? [] : x.data),
        lines: raw?.takeoff?.lines ?? [],
        gaps: (raw?.gaps ?? []).filter((gap) => !answered.has(gap.ref)),
        gbb: g.error ? null : gbbOverview(g.data, false),
      };
    },
  });
  if (loading || q.isLoading)
    return (
      <main className="job-home">
        <p role="status">Loading the estimate…</p>
      </main>
    );
  if (!session) return <BoardSignIn returnTo={`/r/job/${jobId}/estimate`} />;
  if (!q.data) return <ProjectReadUnavailable />;
  const { jobNumber, jobName, company, overview: e, lines, gaps, gbb } = q.data;
  return (
    <main className="job-home">
      <div className="jh-shell">
        <div className="jh-top">
          <AthenaBrand jobId={jobId} company={company} />
          <span className="jh-project">
            {jobNumber}
            {jobName ? ` · ${jobName}` : ""}
          </span>
          <div className="jh-top-right">
            <a className="jb-btn" href={`/r/job/${jobId}/home`}>
              Back to the job board
            </a>
          </div>
        </div>
        <div className="jh-content">
          <header className="jh-hero">
            <div>
              <p className="jh-eyebrow">Estimate</p>
              <h1>{jobName || jobNumber}</h1>
              <p>
                {[
                  e.takeoffVersion ? `Takeoff version ${e.takeoffVersion}` : "No takeoff yet",
                  e.revision,
                  e.role,
                  e.trades.join(", ") || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <CopyAsk
              ask={`Hey Athena, let's keep working on the estimate for job ${jobNumber}.`}
              label="Continue in Athena chat"
              primary
            />
          </header>
          {!e.started ? (
            <section className="jb-card">
              <h2>No estimate yet</h2>
              <p>Athena sets it up from the drawings and asks which trade and scope are yours.</p>
              <div className="jb-actions">
                <CopyAsk
                  ask={`Hey Athena, start the estimate for job ${jobNumber} and add the drawings.`}
                  label="Start the estimate in Athena chat"
                  primary
                />
              </div>
            </section>
          ) : (
            <>
              <dl className="jb-kpis">
                <div>
                  <dt>Takeoff lines</dt>
                  <dd>
                    {e.lines}
                    <small>{e.withQuantity} with quantities</small>
                  </dd>
                </div>
                <div>
                  <dt>Need a quantity</dt>
                  <dd>
                    {e.missingInput}
                    <small>A named input is missing</small>
                  </dd>
                </div>
                <div>
                  <dt>Open questions</dt>
                  <dd>
                    {e.openQuestions}
                    <small>{e.holdingBid} hold the bid</small>
                  </dd>
                </div>
                <div>
                  <dt>Priced lines</dt>
                  <dd>
                    {e.pricedLines}
                    <small>
                      Overhead and profit{" "}
                      {e.overheadPct === null && e.profitPct === null
                        ? "not set"
                        : `${e.overheadPct ?? 0}% + ${e.profitPct ?? 0}%`}
                    </small>
                  </dd>
                </div>
              </dl>
              <div className="jb-two" style={{ marginBottom: 18 }}>
                <section className="jb-card">
                  <h2>Scope</h2>
                  <ScopeList title="In scope" items={e.inScope} />
                  <ScopeList title="Out of scope" items={e.outScope} />
                  <ScopeList title="Assumptions" items={e.assumptions} />
                  <ScopeList title="Drawings and documents" items={e.drawings} />
                </section>
                <section className="jb-card">
                  <h2>Saved takeoff PDFs</h2>
                  {e.files.length ? (
                    <ExportList files={e.files} limit={20} />
                  ) : (
                    <p className="jb-empty">No measured takeoff PDF saved yet.</p>
                  )}
                  <h2 style={{ marginTop: 18 }}>Open questions</h2>
                  {gaps.length ? (
                    <ul className="jb-files">
                      {gaps.slice(0, 12).map((gap) => (
                        <li key={gap.ref}>
                          <div>
                            <strong>{gap.title}</strong>
                            <br />
                            <span>
                              {gap.ref} · {gap.sheet ?? "Sheet not named"}
                            </span>
                          </div>
                          <span>
                            {gap.holds_bid ? "Holds the bid" : (SEVERITY[gap.severity ?? ""] ?? "")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="jb-empty">No open questions.</p>
                  )}
                </section>
              </div>
              {gbb?.exists ? (
                <GbbCard g={gbb} jobNumber={jobNumber} heading="Good, Better, Best options" />
              ) : null}
              <section className="jb-card">
                <h2>Takeoff</h2>
                {lines.length ? (
                  <div className="jb-table-wrap">
                    <table className="jb-table jb-page-lines">
                      <thead>
                        <tr>
                          <th scope="col">Line</th>
                          <th scope="col">Item</th>
                          <th scope="col" className="jb-num">
                            Quantity
                          </th>
                          <th scope="col">Sheet</th>
                          <th scope="col">How it was taken</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.line_no}>
                            <td data-label="Line">T-{l.line_no}</td>
                            <td data-label="Item">
                              <strong>{l.item}</strong>
                              {l.material ? <small>{l.material}</small> : null}
                              {l.exclusion ? <small>Excluded: {l.exclusion}</small> : null}
                            </td>
                            <td data-label="Quantity" className="jb-num">
                              {l.qty === null || l.qty === undefined || l.qty === ""
                                ? l.range_text || "Needed"
                                : `${Number(l.qty).toLocaleString("en-US")} ${l.unit ?? ""}`}
                              {l.missing_input ? <small>{l.missing_input}</small> : null}
                            </td>
                            <td data-label="Sheet">
                              {l.sheet}
                              {l.detail ? <small>{l.detail}</small> : null}
                            </td>
                            <td data-label="How it was taken">
                              {l.basis === "measured" ? "Measured" : "Deduced"}
                              <small>{l.confidence ? `${l.confidence} confidence` : ""}</small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="jb-empty">No takeoff lines yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      <div className="jh-foot">
        <AthenaFooter jobId={jobId} />
      </div>
    </main>
  );
}

function ScopeList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <>
      <h3 style={{ margin: "12px 0 4px", fontSize: 13, color: "#4a5f78" }}>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.slice(0, 12).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </>
  );
}
