import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { projectReadRecovery } from "@/lib/project-read-recovery";
import {
  RECORD_TYPES,
  TYPE_LABEL,
  TYPE_TAG,
  WHO_OPTIONS,
  byLine,
  clock,
  dayHeading,
  entryId,
  filterEvents,
  groupByDay,
  itemLink,
  itemTrail,
  readProjectRecord,
  recordFileName,
  recordType,
  recordXlsx,
  shortDate,
  stampAt,
  typeCounts,
  validDate,
  zoneAbbr,
  type RecordEvent,
  type RecordFeed,
  type RecordGroup,
  type RecordType,
} from "@/lib/project-record-feed";
import { BoardSignIn } from "./BoardSignIn";
import { ProjectReadUnavailable } from "./ProjectReadUnavailable";
import { AthenaBrand, AthenaFooter } from "./AthenaBrand";
import "./project-record.css";

const HIDE_TIP_KEY = "athena.record.dispute-tip.hidden";
type RpcClient = Parameters<typeof readProjectRecord>[0];

function save(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function filterNote(types: ReadonlySet<RecordType>, who: string, q: string) {
  const parts = [
    types.size ? [...types].map((t) => TYPE_LABEL[t]).join(", ") : "All types",
    who ? (WHO_OPTIONS.find((o) => o.value === who)?.label ?? "") : "Anyone",
  ];
  if (q.trim()) parts.push(`matching "${q.trim()}"`);
  return parts.join(" · ");
}

function Tag({ e }: { e: RecordEvent }) {
  const t = recordType(e.type);
  return <span className={`pr-tag pr-t-${t}`}>{TYPE_TAG[t]}</span>;
}

function Drawer({
  e,
  feed,
  jobId,
  onClose,
  onOpen,
}: {
  e: RecordEvent;
  feed: RecordFeed;
  jobId: string;
  onClose: () => void;
  onOpen: (e: RecordEvent) => void;
}) {
  const zone = feed.time_zone;
  const trail = itemTrail(feed.events, e);
  const link = itemLink(jobId, e);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="pr-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="pr-drawer" role="dialog" aria-modal="true" aria-labelledby="pr-d-title">
        <div className="pr-d-h">
          <button type="button" className="pr-btn pr-ghost pr-sm pr-x" onClick={onClose}>
            Close
          </button>
          <div className="pr-r-top">
            <Tag e={e} />
            <span className="pr-r-id">{entryId(e)}</span>
          </div>
          <h2 id="pr-d-title">{e.title}</h2>
        </div>
        <div className="pr-d-b">
          <dl className="pr-kv">
            <dt>When</dt>
            <dd>{stampAt(e.at, zone)}</dd>
            {e.happened_on ? (
              <>
                <dt>Happened</dt>
                <dd>{shortDate(e.happened_on)}, as told to Athena later</dd>
              </>
            ) : null}
            <dt>System time</dt>
            <dd className="pr-num">{new Date(e.at).toISOString().replace(".000Z", "Z")} (UTC)</dd>
            <dt>By</dt>
            <dd>{e.by_role ? `${e.by}, ${e.by_role}` : e.by}</dd>
            {e.to ? (
              <>
                <dt>To</dt>
                <dd>{e.to}</dd>
              </>
            ) : null}
            {e.how ? (
              <>
                <dt>How</dt>
                <dd>{e.how}</dd>
              </>
            ) : null}
          </dl>
          {e.summary ? (
            <section className="pr-d-sec">
              <h3>Details</h3>
              <p>{e.summary}</p>
            </section>
          ) : null}
          {trail.length > 1 ? (
            <section className="pr-d-sec">
              <h3>This item's trail</h3>
              <ol className="pr-trail">
                {trail.map((t) => (
                  <li key={t.id} className={t.id === e.id ? "here" : ""}>
                    <button type="button" onClick={() => onOpen(t)} disabled={t.id === e.id}>
                      <b>{t.title}</b>
                      <span>
                        {stampAt(t.at, zone)} · {t.by}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <p className="pr-note">
            Saved by the system at the time shown. Entries in the project record cannot be edited.
          </p>
        </div>
        {link ? (
          <div className="pr-d-f">
            <a className="pr-btn" href={link.href}>
              {link.label}
            </a>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function ExportDialog({
  feed,
  events,
  note,
  onClose,
}: {
  feed: RecordFeed;
  events: RecordEvent[];
  note: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"pdf" | "xlsx">("pdf");
  const [details, setDetails] = useState(true);
  const [state, setState] = useState<{ busy?: boolean; done?: string; error?: string }>({});
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const run = async () => {
    setState({ busy: true });
    try {
      const name = recordFileName(feed.job_number, kind, feed.from, feed.to);
      if (kind === "pdf") {
        const { projectRecordPdf } = await import("@/lib/project-record-pdf");
        save(
          projectRecordPdf(feed, events, { details, filterNote: note }),
          name,
          "application/pdf",
        );
      } else {
        save(
          recordXlsx(feed, events, note),
          name,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      }
      setState({ done: `Downloaded ${name}` });
    } catch {
      setState({ error: "The file could not be built. Try again." });
    }
  };
  return (
    <>
      <div className="pr-scrim" onClick={onClose} aria-hidden="true" />
      <div className="pr-modal" role="dialog" aria-modal="true" aria-labelledby="pr-m-title">
        <div className="pr-m-h">
          <div>
            <h2 id="pr-m-title">Export the project record</h2>
            <p>
              {events.length} {events.length === 1 ? "entry" : "entries"} · {note}
            </p>
          </div>
          <button type="button" className="pr-btn pr-ghost pr-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="pr-m-b">
          <div className="pr-tabs" role="group" aria-label="File type">
            <button type="button" aria-pressed={kind === "pdf"} onClick={() => setKind("pdf")}>
              PDF
            </button>
            <button type="button" aria-pressed={kind === "xlsx"} onClick={() => setKind("xlsx")}>
              Excel
            </button>
          </div>
          {kind === "pdf" ? (
            <label className="pr-check">
              <input
                type="checkbox"
                checked={details}
                onChange={(e) => setDetails(e.target.checked)}
              />
              <span>Include each entry's details, not just its title</span>
            </label>
          ) : null}
          <ol className="pr-steps">
            <li>
              Your company name on top, with the job, the dates, the filters and how the record was
              kept.
            </li>
            <li>
              {kind === "pdf"
                ? "Every entry by day, oldest first: time, what happened, who, to whom, how and its entry ID."
                : "One row per entry with the local date and time, the system time in UTC, who, to whom, how and its entry ID."}
            </li>
            <li>A small Powered by Athena in the footer. Nothing is sent to anyone.</li>
          </ol>
          <p className="pr-muted pr-small">
            The export uses the dates, types, person and search you have set on the page. To change
            them, close this and adjust the filters.
          </p>
        </div>
        <div className="pr-m-f">
          <span className={`pr-msg${state.done ? " done" : ""}`} role="status">
            {state.error ?? state.done ?? ""}
          </span>
          <button
            type="button"
            className="pr-btn"
            onClick={() => void run()}
            disabled={state.busy || !events.length}
          >
            {state.busy ? "Building…" : kind === "pdf" ? "Download PDF" : "Download Excel"}
          </button>
        </div>
      </div>
    </>
  );
}

export function ProjectRecordPage({
  jobId,
  from,
  to,
}: {
  jobId: string;
  from?: string;
  to?: string;
}) {
  const { session, loading } = useAuth();
  const range = { from: validDate(from) ? from : "", to: validDate(to) ? to : "" };
  const query = useQuery({
    queryKey: ["project-record", jobId, session?.user.id, range.from, range.to],
    enabled: !loading && !!session,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () =>
      readProjectRecord(supabase as unknown as RpcClient, jobId, {
        from: range.from,
        to: range.to,
      }),
  });
  const feed = query.error ? undefined : query.data;
  const [types, setTypes] = useState<Set<RecordType>>(new Set());
  const [who, setWho] = useState<"" | RecordGroup>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<RecordEvent | null>(null);
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tipHidden, setTipHidden] = useState(true);
  useEffect(() => {
    try {
      setTipHidden(localStorage.getItem(HIDE_TIP_KEY) === "1");
    } catch {
      setTipHidden(false);
    }
  }, []);
  useEffect(() => {
    if (feed) document.title = `${feed.job_number ?? "Job"} Project Record`;
  }, [feed]);

  const counts = useMemo(() => typeCounts(feed?.events ?? []), [feed]);
  const shown = useMemo(
    () => filterEvents(feed?.events ?? [], { types, who, q }),
    [feed, types, who, q],
  );
  const days = useMemo(() => (feed ? groupByDay(shown, feed.time_zone) : []), [feed, shown]);
  const note = filterNote(types, who, q);

  const returnTo = `/r/job/${jobId}/record`;
  if (loading)
    return (
      <main className="pr-page" role="status">
        Checking project access…
      </main>
    );
  if (!session || (query.error && projectReadRecovery(true, query.error) === "sign-in"))
    return <BoardSignIn returnTo={returnTo} />;
  const shownProblem =
    query.error && /^(Choose|The project record needs)/.test(query.error.message)
      ? query.error.message
      : "";
  if (query.error && !shownProblem) return <ProjectReadUnavailable />;

  const toggle = (t: RecordType) =>
    setTypes((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  const clear = () => {
    setTypes(new Set());
    setWho("");
    setQ("");
  };
  const hideTip = () => {
    setTipHidden(true);
    try {
      localStorage.setItem(HIDE_TIP_KEY, "1");
    } catch {
      /* the tip just comes back next visit */
    }
  };
  const disputeExport = () => {
    clear();
    setExporting(true);
  };
  const filtered = types.size > 0 || !!who || !!q.trim();

  return (
    <main className="pr-page">
      <div className="pr-shell">
        <div className="pr-brandbar">
          <AthenaBrand jobId={jobId} company={feed?.company ?? undefined} />
          <nav className="pr-topnav" aria-label="Project navigation">
            <a href={`/r/job/${jobId}/home`}>Project home</a>
            <a href={`/r/job/${jobId}/daily-log`}>Daily reports</a>
            <a href={`/r/job/${jobId}/schedule`}>Schedule</a>
          </nav>
        </div>

        <header className="pr-hero">
          <div>
            <p className="pr-eyebrow">Project record</p>
            <h1>
              {feed
                ? `${feed.job_number ?? ""}${feed.job_name ? ` · ${feed.job_name}` : ""}`
                : "Project record"}
            </h1>
            <p className="pr-sub">Everything logged on this job, with who did it and when.</p>
          </div>
          <div className="pr-btns">
            <button
              type="button"
              className="pr-btn"
              onClick={() => setExporting(true)}
              disabled={!feed}
            >
              Export PDF or Excel
            </button>
          </div>
        </header>

        {!tipHidden && feed ? (
          <section className="pr-next" aria-label="Next step">
            <div className="pr-q">
              <img src="/brand/athena/athena-mark-blue.svg" alt="" width={26} height={19} />
              <div>
                <b>Pulling dates for a dispute?</b>
                <span>
                  Set the dates below, then export the whole record as a PDF your attorney or the
                  owner can read, or as Excel to sort.
                </span>
              </div>
            </div>
            <div className="pr-btns">
              <button type="button" className="pr-btn" onClick={disputeExport}>
                Build a dispute export
              </button>
              <button type="button" className="pr-btn pr-ghost" onClick={hideTip}>
                Not now
              </button>
            </div>
          </section>
        ) : null}

        <div className="pr-facts">
          <span>Each entry is time-stamped by the system when it's saved and can't be edited.</span>
          <span>Every entry names who did it.</span>
          <span>When someone tells Athena later, both dates show.</span>
        </div>

        <section
          className="pr-filters"
          data-open={filtersOpen ? "true" : "false"}
          aria-label="Filters"
        >
          <button
            type="button"
            className="pr-btn pr-ghost pr-sm pr-f-toggle"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {filtersOpen ? "Hide filters" : `Filters${filtered ? " (on)" : ""}`}
          </button>
          <div className="pr-f-body">
            <div className="pr-chips" role="group" aria-label="Types">
              {RECORD_TYPES.filter((t) => (counts.get(t) ?? 0) > 0 || types.has(t)).map((t) => (
                <button
                  type="button"
                  key={t}
                  className="pr-chip"
                  aria-pressed={types.has(t)}
                  onClick={() => toggle(t)}
                >
                  {TYPE_LABEL[t]} <small>{counts.get(t) ?? 0}</small>
                </button>
              ))}
            </div>
            <form className="pr-f-row" action={returnTo} method="get">
              <label className="pr-fld pr-grow">
                Search
                <input
                  type="search"
                  value={q}
                  placeholder="RFI 14, temporary power, Spark Electric…"
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              <label className="pr-fld">
                Who
                <select value={who} onChange={(e) => setWho(e.target.value as "" | RecordGroup)}>
                  {WHO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pr-fld">
                From
                <input type="date" name="from" defaultValue={range.from} key={`f${range.from}`} />
              </label>
              <label className="pr-fld">
                Through
                <input type="date" name="to" defaultValue={range.to} key={`t${range.to}`} />
              </label>
              <button type="submit" className="pr-btn pr-ghost">
                Apply dates
              </button>
            </form>
            <div className="pr-f-foot">
              <span>
                {feed
                  ? `Showing ${shown.length} of ${feed.count} ${feed.count === 1 ? "entry" : "entries"}${
                      range.from || range.to
                        ? `, ${range.from ? shortDate(range.from) : "start"} to ${range.to ? shortDate(range.to) : "today"}`
                        : ""
                    }. Times in ${feed.time_zone.replace(/_/g, " ")}.`
                  : ""}
              </span>
              {filtered || range.from || range.to ? (
                <span className="pr-btns">
                  {filtered ? (
                    <button type="button" className="pr-link" onClick={clear}>
                      Clear filters
                    </button>
                  ) : null}
                  {range.from || range.to ? (
                    <a className="pr-link" href={returnTo}>
                      All dates
                    </a>
                  ) : null}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {shownProblem ? (
          <p role="alert" className="pr-alert">
            {shownProblem}
          </p>
        ) : null}
        {feed?.unavailable_sources.length ? (
          <p className="pr-alert pr-warn" role="status">
            Not shown right now because they could not be read:{" "}
            {feed.unavailable_sources.join(", ")}.
          </p>
        ) : null}
        {feed?.truncated ? (
          <p className="pr-alert pr-warn" role="status">
            Showing the newest 5,000 entries. Choose dates above to see older ones.
          </p>
        ) : null}

        <section className="pr-log" aria-label="Entries" aria-busy={query.isFetching}>
          {query.isFetching && !feed ? (
            <p className="pr-empty" role="status">
              Reading the project record…
            </p>
          ) : !feed ? null : !shown.length ? (
            <div className="pr-empty">
              {feed.count ? (
                <>
                  <p>No entries match these filters.</p>
                  <button type="button" className="pr-btn pr-ghost pr-sm" onClick={clear}>
                    Clear filters
                  </button>
                </>
              ) : (
                <p>
                  Nothing is logged on this job yet. As your team and Athena send submittals and
                  RFIs, save dailies and schedules, and record payments, each one lands here with
                  its time.
                </p>
              )}
            </div>
          ) : (
            days.map((g) => (
              <div key={g.day}>
                <h2 className="pr-day">{dayHeading(g.day)}</h2>
                {g.events.map((e) => (
                  <button type="button" key={e.id} className="pr-row" onClick={() => setOpen(e)}>
                    <span className="pr-r-time">
                      {clock(e.at, feed.time_zone)}
                      <small>{zoneAbbr(e.at, feed.time_zone)}</small>
                    </span>
                    <span className="pr-r-main">
                      <span className="pr-r-top">
                        <Tag e={e} />
                        <span className="pr-r-title">{e.title}</span>
                        {e.happened_on ? (
                          <span className="pr-flag">Happened {shortDate(e.happened_on)}</span>
                        ) : null}
                      </span>
                      {e.summary ? <span className="pr-r-sum">{e.summary}</span> : null}
                      <span className="pr-r-meta">{byLine(e)}</span>
                    </span>
                    <span className="pr-r-side">
                      <span className="pr-r-id">{entryId(e)}</span>
                      <span className="pr-r-open">Details</span>
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </section>

        <AthenaFooter jobId={jobId} />
      </div>
      {open && feed ? (
        <Drawer e={open} feed={feed} jobId={jobId} onClose={() => setOpen(null)} onOpen={setOpen} />
      ) : null}
      {exporting && feed ? (
        <ExportDialog feed={feed} events={shown} note={note} onClose={() => setExporting(false)} />
      ) : null}
    </main>
  );
}
