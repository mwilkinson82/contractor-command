import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { jobHomePath, type PortfolioPayload } from "@/lib/report-pages";
import { companyBoardPath, isCompanyId } from "@/lib/company-board";
import {
  HEALTH_LABEL,
  buildOwnerPortfolio,
  fullMoney,
  percent,
  shortDay,
  shortMoney,
  sortCards,
  type Health,
  type JobMoneyRead,
  type PortfolioCard,
  type PortfolioSort,
} from "@/lib/owner-portfolio";
import { PORTFOLIO_MONEY_REFRESH_MS, readPortfolioMoney } from "@/lib/owner-portfolio-read";
import "./owner-portfolio.css";

const isReads = (v: unknown): v is Record<string, JobMoneyRead> =>
  !!v && typeof v === "object" && !("page" in (v as object));

export function OwnerPortfolio({
  payload,
  companyId,
  visible,
  memberId,
}: {
  payload: PortfolioPayload;
  companyId?: string;
  visible: boolean;
  memberId?: string;
}) {
  const asOf = new Date().toISOString().slice(0, 10);
  const jobIds = useMemo(() => (payload.jobs ?? []).map((j) => j.job_id), [payload.jobs]);
  const money = useQuery({
    queryKey: [
      "athena-portfolio-money",
      companyId ?? null,
      memberId ?? null,
      asOf,
      jobIds.join(","),
    ],
    enabled: jobIds.length > 0,
    refetchInterval: visible ? PORTFOLIO_MONEY_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    staleTime: PORTFOLIO_MONEY_REFRESH_MS,
    retry: false,
    queryFn: () => readPortfolioMoney(jobIds, asOf),
  });
  const reads = useMemo(() => (isReads(money.data) ? money.data : {}), [money.data]);
  const loading = jobIds.length > 0 && money.isLoading;
  const model = useMemo(() => buildOwnerPortfolio(payload, reads, asOf), [payload, reads, asOf]);
  const [filter, setFilter] = useState<Health | "all">("all");
  const [sort, setSort] = useState<PortfolioSort>("health");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [openId, setOpenId] = useState<string | null>(null);
  const t = model.totals;
  const cards = sortCards(
    model.active.filter((c) => filter === "all" || c.health === filter),
    sort,
  );
  const open = model.active.find((c) => c.jobId === openId) ?? null;

  if (loading) return <p className="op-sub">Reading each job's contract, billing and cost…</p>;

  const partial = t.readJobs < t.activeJobs;
  const missingIor = model.active.filter((c) => !c.iorSaved);
  const totalBar = t.billedCents + t.leftThisYearCents + t.leftNextYearCents + t.leftNoFinishCents;
  const w = (v: number) => (totalBar > 0 ? `${(v / totalBar) * 100}%` : "0%");

  return (
    <div className="op">
      <header className="op-header">
        <div>
          <h1>{model.company} · Portfolio</h1>
          <p className="op-sub">
            {t.activeJobs} active {t.activeJobs === 1 ? "job" : "jobs"} · {t.counts.good} on track,{" "}
            {t.counts.watch} to watch, {t.counts.risk} at risk
          </p>
        </div>
        <div className="op-header-side">
          {isCompanyId(companyId) ? (
            <nav className="op-pages" aria-label="Company pages">
              <a href={companyBoardPath(companyId)}>Company board</a>
              <a href={`/r/portfolio/${companyId}`} aria-current="page">
                Portfolio
              </a>
            </nav>
          ) : null}
          <p className="op-asof">Figures as of {shortDay(asOf)} · owners and leadership only</p>
        </div>
      </header>

      {partial ? (
        <p className="op-note" role="status">
          {t.activeJobs - t.readJobs} of {t.activeJobs} jobs' money records couldn't be read, so the
          totals below leave them out.
        </p>
      ) : null}

      <section aria-labelledby="op-cp">
        <p className="op-eyebrow" id="op-cp">
          Contract and profit
        </p>
        <div className="op-metrics">
          <Metric
            label="Current contract value"
            value={shortMoney(t.contractCents)}
            note={`Original ${shortMoney(t.originalCents)} plus ${shortMoney(t.changeCents)} in approved change orders`}
          />
          <Metric
            label="Cost budget"
            value={t.budgetJobs ? shortMoney(t.budgetCents) : "Not saved"}
            note={
              t.budgetJobs
                ? `Saved on ${t.budgetJobs} of ${t.activeJobs} jobs`
                : "No job has a cost budget saved"
            }
          />
          <Metric
            label="Planned profit"
            value={
              t.plannedProfitCents == null ? "Not available" : shortMoney(t.plannedProfitCents)
            }
            note={
              t.plannedMargin == null
                ? "Needs a contract and a cost budget"
                : `${percent(t.plannedMargin)} planned margin on ${t.plannedJobs} ${t.plannedJobs === 1 ? "job" : "jobs"}`
            }
          />
          <Metric
            label="IOR projected profit"
            value={t.iorProfitCents == null ? "Not available" : shortMoney(t.iorProfitCents)}
            note={`IOR saved on ${t.iorSavedJobs} of ${t.activeJobs} jobs · projected outcome on ${t.iorOutcomeJobs}`}
            flag={t.iorSavedJobs < t.activeJobs}
          />
        </div>
      </section>

      <section aria-labelledby="op-td">
        <p className="op-eyebrow" id="op-td">
          To date
        </p>
        <div className="op-metrics">
          <Metric
            label="Percent complete"
            value={percent(t.pctComplete, 0)}
            note="Billed to date against current contract"
            meter={t.pctComplete}
          />
          <Metric
            label="Billed to date"
            value={shortMoney(t.billedCents)}
            note={
              t.contractCents > 0
                ? `${percent(t.billedCents / t.contractCents, 0)} of contract`
                : undefined
            }
          />
          <Metric
            label="Received to date"
            value={shortMoney(t.receivedCents)}
            note={`Retainage held ${shortMoney(t.retainageCents)} · owed ${shortMoney(t.unpaidCents)}`}
          />
          <Metric
            label="Cost to date"
            value={t.costJobs ? shortMoney(t.costCents) : "Not available"}
            note={
              t.costJobs
                ? `Posted on ${t.costJobs} of ${t.activeJobs} jobs${t.budgetCents > 0 ? ` · ${percent(t.costCents / t.budgetCents, 0)} of budget` : ""}`
                : "No posted costs yet"
            }
          />
        </div>
      </section>

      <section className="op-panel" aria-labelledby="op-yr">
        <div className="op-panel-head">
          <h2 id="op-yr">This year and next</h2>
          <p>Contract left to bill on active jobs</p>
        </div>
        <div
          className="op-yearbar"
          role="img"
          aria-label={`Billed ${shortMoney(t.billedCents)}, left in ${model.year} ${shortMoney(t.leftThisYearCents)}, spills into ${model.year + 1} ${shortMoney(t.leftNextYearCents)}`}
        >
          <span className="op-y-billed" style={{ width: w(t.billedCents) }} />
          <span className="op-y-now" style={{ width: w(t.leftThisYearCents) }} />
          <span className="op-y-next" style={{ width: w(t.leftNextYearCents) }} />
          <span className="op-y-none" style={{ width: w(t.leftNoFinishCents) }} />
        </div>
        <div className="op-legend">
          <Legend swatch="op-y-billed" label="Billed to date" value={shortMoney(t.billedCents)} />
          <Legend
            swatch="op-y-now"
            label={`Left to bill in ${model.year}`}
            value={shortMoney(t.leftThisYearCents)}
          />
          <Legend
            swatch="op-y-next"
            label={`Spills into ${model.year + 1}`}
            value={shortMoney(t.leftNextYearCents)}
          />
          {t.noFinish.length ? (
            <Legend
              swatch="op-y-none"
              label="No finish date"
              value={shortMoney(t.leftNoFinishCents)}
            />
          ) : null}
        </div>
        <div className="op-finishers">
          <FinishList
            title={`Finishing in ${model.year}`}
            cards={t.finishingThisYear}
            year={model.year}
          />
          <FinishList
            title={`Running into ${model.year + 1}`}
            cards={t.runningIntoNextYear}
            year={model.year}
          />
        </div>
        <p className="op-basis">
          Finish dates come from each job's latest schedule delay analysis, or the contract
          completion date when there isn't one. Work left on jobs that run past December 31 is split
          straight-line by calendar days.
        </p>
      </section>

      {missingIor.length ? (
        <section className="op-panel op-ior" aria-labelledby="op-ior">
          <div className="op-panel-head">
            <h2 id="op-ior">
              IOR missing on {missingIor.length} {missingIor.length === 1 ? "job" : "jobs"}
            </h2>
            <p>Projected profit and margin need each PM's IOR</p>
          </div>
          <ul>
            {missingIor.map((c) => (
              <li key={c.jobId}>
                <a href={jobHomePath(c.jobId)}>
                  {c.jobNumber} {c.name}
                </a>
                <span>PM {c.pm ?? "not set"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="op-jobs">
        <div className="op-panel-head">
          <h2 id="op-jobs">Active jobs</h2>
          <p>Open a job to go to its job board</p>
        </div>
        <div className="op-tools">
          <div className="op-chips" role="group" aria-label="Filter by health">
            {(["all", "risk", "watch", "good"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="op-chip"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f !== "all" ? <span className={`op-dot ${f}`} /> : null}
                {f === "all" ? `All ${t.activeJobs}` : `${HEALTH_LABEL[f]} ${t.counts[f]}`}
              </button>
            ))}
          </div>
          <div className="op-tools-right">
            <label className="op-sort" htmlFor="op-sort">
              Sort
              <select
                id="op-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as PortfolioSort)}
              >
                <option value="health">Health</option>
                <option value="contract">Contract value</option>
                <option value="finish">Finish date</option>
                <option value="margin">Margin</option>
                <option value="number">Job number</option>
              </select>
            </label>
            <div className="op-seg" role="group" aria-label="View">
              <button
                type="button"
                aria-pressed={view === "cards"}
                onClick={() => setView("cards")}
              >
                Cards
              </button>
              <button
                type="button"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                Table
              </button>
            </div>
          </div>
        </div>
        {!cards.length ? (
          <p className="op-sub">
            {t.activeJobs
              ? "No jobs in this group."
              : "No active jobs yet. A job shows here once its contract value or first billing is saved."}
          </p>
        ) : view === "cards" ? (
          <div className="op-cards">
            {cards.map((c) => (
              <JobCard key={c.jobId} card={c} onOpen={() => setOpenId(c.jobId)} />
            ))}
          </div>
        ) : (
          <JobTable cards={cards} onOpen={setOpenId} />
        )}
      </section>

      {model.estimating.length ? (
        <section className="op-panel" aria-labelledby="op-est">
          <div className="op-panel-head">
            <h2 id="op-est">Estimating</h2>
            <p>No contract value saved yet · not in the totals</p>
          </div>
          <ul className="op-est">
            {model.estimating.map((e) => (
              <li key={e.jobId}>
                <a href={jobHomePath(e.jobId)}>
                  {e.jobNumber} {e.name}
                </a>
                <span>PM {e.pm ?? "not set"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="op-panel" aria-labelledby="op-hl">
        <div className="op-panel-head">
          <h2 id="op-hl">How health is set</h2>
        </div>
        <ul className="op-rules">
          <li>
            <b>
              <span className="op-dot risk" /> At risk
            </b>
            <span>
              Finish more than 10 working days late, cost over budget or running 20 points ahead of
              billing, or an invoice unpaid past 60 days.
            </span>
          </li>
          <li>
            <b>
              <span className="op-dot watch" /> Watch
            </b>
            <span>
              Any finish slip, cost running 10 points ahead of billing, an invoice unpaid past 30
              days, no budget or schedule saved, or a schedule not updated in 30 days.
            </span>
          </li>
          <li>
            <b>
              <span className="op-dot good" /> On track
            </b>
            <span>None of the above. Each card names the reason it isn't on track.</span>
          </li>
          <li>
            <b>Margin</b>
            <span>
              Planned margin is contract less the saved cost budget. Projected margin comes from the
              job's IOR once the PM saves one.
            </span>
          </li>
        </ul>
      </section>

      {open ? <JobDrawer card={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  meter,
  flag,
}: {
  label: string;
  value: string;
  note?: string;
  meter?: number | null;
  flag?: boolean;
}) {
  return (
    <div className="op-metric">
      <p className="op-lbl">{label}</p>
      <p className="op-val">{value}</p>
      {note ? <p className={`op-mnote${flag ? " op-flag" : ""}`}>{note}</p> : null}
      {meter != null ? (
        <div className="op-meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, meter * 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div>
      <div className="op-k">
        <i className={swatch} />
        {label}
      </div>
      <div className="op-v">{value}</div>
    </div>
  );
}

function FinishList({
  title,
  cards,
  year,
}: {
  title: string;
  cards: PortfolioCard[];
  year: number;
}) {
  const value = cards.reduce((s, c) => s + (c.money?.contractCents ?? 0), 0);
  return (
    <div>
      <h3>
        {title} · {cards.length} {cards.length === 1 ? "job" : "jobs"}, {shortMoney(value)}
      </h3>
      {cards.length ? (
        <ul>
          {cards.map((c) => (
            <li key={c.jobId}>
              <span>
                {c.jobNumber} {c.name}
              </span>
              <span>
                {c.finish && Number(c.finish.slice(0, 4)) === year
                  ? shortDay(c.finish).replace(/, \d{4}$/, "")
                  : shortDay(c.finish)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="op-sub">None</p>
      )}
    </div>
  );
}

function HealthPill({ health }: { health: Health }) {
  return (
    <span className={`op-pill ${health}`}>
      <span className={`op-dot ${health}`} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

function marginLine(c: PortfolioCard) {
  if (c.iorMargin != null)
    return {
      value: percent(c.iorMargin),
      note: c.plannedMargin != null ? `plan ${percent(c.plannedMargin)}` : "IOR",
    };
  if (c.plannedMargin != null) return { value: percent(c.plannedMargin), note: "planned" };
  return { value: "Not available", note: "" };
}

function JobCard({ card: c, onOpen }: { card: PortfolioCard; onOpen: () => void }) {
  const m = c.money;
  const margin = marginLine(c);
  return (
    <button
      type="button"
      className="op-job"
      onClick={onOpen}
      aria-label={`Open ${c.jobNumber} ${c.name}`}
    >
      <div className="op-job-top">
        <div>
          <div className="op-job-num">
            Job {c.jobNumber} · PM {c.pm ?? "not set"}
          </div>
          <div className="op-job-name">{c.name}</div>
        </div>
        <HealthPill health={c.health} />
      </div>
      {c.reasons.length ? <p className={`op-why ${c.health}`}>{c.reasons.join(" · ")}</p> : null}
      <dl className="op-facts">
        <div>
          <dt>Contract value</dt>
          <dd>
            {shortMoney(m?.contractCents)}
            {m?.changeCents ? (
              <small>
                {" "}
                {m.changeCents > 0 ? "+" : ""}
                {shortMoney(m.changeCents)} COs
              </small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Paid to date</dt>
          <dd>
            {shortMoney(m?.receivedCents)}
            {m?.contractCents && m.receivedCents != null ? (
              <small> {percent(m.receivedCents / m.contractCents, 0)}</small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>IOR</dt>
          <dd>
            {c.iorProfitCents != null ? (
              shortMoney(c.iorProfitCents)
            ) : c.iorSaved ? (
              <small>v{c.iorVersion} saved, no projected outcome</small>
            ) : (
              <span className="op-missing">Not saved</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Margin</dt>
          <dd>
            {margin.value}
            {margin.note ? <small> {margin.note}</small> : null}
          </dd>
        </div>
      </dl>
      <div className="op-pct">
        <div className="op-meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (c.pctComplete ?? 0) * 100)}%` }} />
        </div>
        <span>
          {c.pctComplete == null
            ? "Complete not available"
            : `${percent(c.pctComplete, 0)} complete`}
        </span>
      </div>
      <div className="op-job-foot">
        <span>
          Finish {shortDay(c.finish)}
          {c.spills ? <span className="op-spill">{c.finish?.slice(0, 4)}</span> : null}
        </span>
        <span className="op-open">Details →</span>
      </div>
    </button>
  );
}

function JobTable({ cards, onOpen }: { cards: PortfolioCard[]; onOpen: (id: string) => void }) {
  return (
    <div className="op-tablewrap">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Health</th>
            <th>Contract</th>
            <th>Paid</th>
            <th>Complete</th>
            <th>Cost to date</th>
            <th>Margin</th>
            <th>IOR</th>
            <th>Finish</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr
              key={c.jobId}
              tabIndex={0}
              onClick={() => onOpen(c.jobId)}
              onKeyDown={(e) => (e.key === "Enter" ? onOpen(c.jobId) : undefined)}
            >
              <td data-l="Job">
                {c.jobNumber} {c.name}
              </td>
              <td data-l="Health">
                <HealthPill health={c.health} />
              </td>
              <td data-l="Contract">{shortMoney(c.money?.contractCents)}</td>
              <td data-l="Paid">{shortMoney(c.money?.receivedCents)}</td>
              <td data-l="Complete">{percent(c.pctComplete, 0)}</td>
              <td data-l="Cost to date">{shortMoney(c.money?.costCents)}</td>
              <td data-l="Margin">{marginLine(c).value}</td>
              <td data-l="IOR">
                {c.iorProfitCents != null
                  ? shortMoney(c.iorProfitCents)
                  : c.iorSaved
                    ? `v${c.iorVersion}`
                    : "Not saved"}
              </td>
              <td data-l="Finish">{shortDay(c.finish)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, value, total }: { label: string; value: React.ReactNode; total?: boolean }) {
  return (
    <tr className={total ? "op-total" : undefined}>
      <td>{label}</td>
      <td>{value}</td>
    </tr>
  );
}

function JobDrawer({ card: c, onClose }: { card: PortfolioCard; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (e: KeyboardEvent) => (e.key === "Escape" ? onClose() : undefined);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      back?.focus?.();
    };
  }, [onClose]);
  const m = c.money;
  return (
    <>
      <div className="op-scrim" onClick={onClose} />
      <aside className="op-drawer" role="dialog" aria-modal="true" aria-labelledby="op-dr-title">
        <button type="button" className="op-close" ref={close} onClick={onClose}>
          Close
        </button>
        <p className="op-job-num">
          Job {c.jobNumber} · PM {c.pm ?? "not set"}
        </p>
        <h2 id="op-dr-title">{c.name}</h2>
        <p>
          <HealthPill health={c.health} />
        </p>
        {c.reasons.length ? <p className={`op-why ${c.health}`}>{c.reasons.join(" · ")}</p> : null}
        {!m ? (
          <p className="op-note">{c.moneyReason ?? "This job's money records couldn't be read."}</p>
        ) : (
          <>
            <section>
              <p className="op-eyebrow">Contract</p>
              <table>
                <tbody>
                  <Row label="Original contract" value={fullMoney(m.originalCents)} />
                  <Row label="Approved change orders" value={fullMoney(m.changeCents)} />
                  <Row label="Current contract" value={fullMoney(m.contractCents)} total />
                </tbody>
              </table>
            </section>
            <section>
              <p className="op-eyebrow">Billing and cash</p>
              <table>
                <tbody>
                  <Row
                    label={`Billed to date${c.pctComplete != null ? ` (${percent(c.pctComplete, 0)})` : ""}`}
                    value={fullMoney(m.billedCents)}
                  />
                  <Row label="Received to date" value={fullMoney(m.receivedCents)} />
                  <Row label="Retainage held" value={fullMoney(m.retainageCents)} />
                  <Row
                    label="Owed now"
                    value={
                      <>
                        {fullMoney(m.unpaidCents)}
                        {c.receivableDays != null && c.receivableDays > 30 ? (
                          <span className="op-flag"> · oldest {c.receivableDays} days</span>
                        ) : null}
                      </>
                    }
                  />
                </tbody>
              </table>
            </section>
            <section>
              <p className="op-eyebrow">Cost and profit</p>
              <table>
                <tbody>
                  <Row label="Cost budget" value={fullMoney(m.budgetCents)} />
                  <Row
                    label="Cost to date"
                    value={
                      <>
                        {fullMoney(m.costCents)}
                        {m.costCents != null && m.budgetCents ? (
                          <small> {percent(m.costCents / m.budgetCents, 0)} of budget</small>
                        ) : null}
                      </>
                    }
                  />
                  <Row
                    label="Planned profit · margin"
                    value={
                      c.plannedProfitCents == null
                        ? "Not available"
                        : `${fullMoney(c.plannedProfitCents)} · ${percent(c.plannedMargin)}`
                    }
                  />
                  <Row
                    label="IOR projected profit · margin"
                    value={
                      c.iorProfitCents != null
                        ? `${fullMoney(c.iorProfitCents)} · ${percent(c.iorMargin)}`
                        : c.iorSaved
                          ? `IOR v${c.iorVersion} saved, no projected outcome yet`
                          : "No IOR saved"
                    }
                    total
                  />
                </tbody>
              </table>
            </section>
          </>
        )}
        <section>
          <p className="op-eyebrow">Schedule</p>
          <table>
            <tbody>
              <Row
                label={
                  c.finishBasis === "tia"
                    ? "Forecast finish (delay analysis)"
                    : "Contract completion"
                }
                value={
                  <>
                    {shortDay(c.finish)}
                    {c.slipWorkingDays ? (
                      <span className="op-flag"> · {c.slipWorkingDays} working days late</span>
                    ) : null}
                  </>
                }
              />
              <Row label="Left to bill this year" value={fullMoney(c.leftThisYearCents)} />
              <Row
                label="Left for next year"
                value={c.spills ? fullMoney(c.leftNextYearCents) : "None"}
              />
            </tbody>
          </table>
        </section>
        <a className="op-cta" href={jobHomePath(c.jobId)}>
          Open job board
        </a>
      </aside>
    </>
  );
}
