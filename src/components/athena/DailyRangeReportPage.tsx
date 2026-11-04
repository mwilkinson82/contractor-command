import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  DAILY_RANGE_MAX_DAYS,
  DAILY_SECTIONS,
  PHOTO_MODES,
  PHOTO_MODE_LABEL,
  dailyRangeClient,
  dailyRangePath,
  dailyRangePdfName,
  dateRuns,
  longDate,
  mediumDate,
  numberText,
  photoCaption,
  photoFacts,
  photoMode,
  readDailyRange,
  reported,
  stamp,
  type DailyRangePhoto,
  type DailyRangeReport,
} from "@/lib/daily-range-report";
import { projectReadRecovery } from "@/lib/project-read-recovery";
import { BoardSignIn } from "./BoardSignIn";
import { ProjectReadUnavailable } from "./ProjectReadUnavailable";
import "./daily-range-report.css";

const PHOTO_BUCKET = "athena-progress";
/** About 300 dpi across a half-page photo: sharp in print, small enough that a month of photos stays one file. */
const PDF_PHOTO_EDGE = 1600;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function defaultPeriod(now = new Date()) {
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}

/** Signed links for the on-screen and printed view. The original file, never a thumbnail. */
function usePhotoLinks(report: DailyRangeReport | undefined) {
  const paths = useMemo(
    () => report?.days.flatMap((d) => d.photos.map((p) => p.storage_path)).filter(Boolean) ?? [],
    [report],
  );
  return useQuery({
    queryKey: ["daily-range-photo-links", paths],
    enabled: paths.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const out = new Map<string, string>();
      for (let i = 0; i < paths.length; i += 100) {
        const { data } = await supabase.storage
          .from(PHOTO_BUCKET)
          .createSignedUrls(paths.slice(i, i + 100), 3600);
        for (const row of data ?? [])
          if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
      }
      return out;
    },
  });
}

/** Reads one stored photo and returns it as a print-sized JPEG for the PDF. */
async function pdfPhoto(p: DailyRangePhoto) {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(p.storage_path);
  if (error || !data) throw new Error("unreadable");
  const bitmap = await createImageBitmap(data, { imageOrientation: "from-image" });
  const scale = Math.min(1, PDF_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    data: canvas.toDataURL("image/jpeg", 0.85),
    format: "JPEG" as const,
    width: canvas.width,
    height: canvas.height,
  };
}

async function downloadPdf(
  report: DailyRangeReport,
  progress: (done: number, total: number) => void,
) {
  const { dailyRangePdf } = await import("@/lib/daily-range-pdf");
  const list = report.days.flatMap((d) => d.photos);
  const photos = new Map<string, Awaited<ReturnType<typeof pdfPhoto>> | { reason: string }>();
  let done = 0;
  progress(0, list.length);
  const queue = [...list];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        try {
          photos.set(p.id, await pdfPhoto(p));
        } catch {
          photos.set(p.id, {
            reason: "Photo on file in Athena. It could not be read for this PDF.",
          });
        }
        progress(++done, list.length);
      }
    }),
  );
  const bytes = dailyRangePdf(report, photos);
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = dailyRangePdfName(report.job_number, report.period.from, report.period.to);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function Photo({ photo, href, zone }: { photo: DailyRangePhoto; href?: string; zone: string }) {
  // A stored file that will not decode (damaged or incomplete) shows a plain note, not the
  // browser's broken-image icon and alt text, so the printed record stays clean.
  const [broken, setBroken] = useState(false);
  return (
    <figure className="drr-photo" id={`photo-${photo.id}`}>
      {href && !broken ? (
        <a href={href} target="_blank" rel="noreferrer" title="Open the original photo">
          <img
            src={href}
            alt={photoCaption(photo)}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        </a>
      ) : (
        <div className="drr-photo-missing">
          {broken
            ? "Photo on file in Athena. The stored file could not be displayed."
            : "Photo on file. Preview unavailable."}
        </div>
      )}
      <figcaption>
        <strong>{photoCaption(photo)}</strong>
        <span>{photoFacts(photo, zone).join(" · ")}</span>
        {!photo.client_safe && <span className="drr-internal no-print">Internal</span>}
      </figcaption>
    </figure>
  );
}

export function DailyRangeReportView({
  report,
  links,
}: {
  report: DailyRangeReport;
  links?: Map<string, string>;
}) {
  const zone = report.time_zone_used;
  return (
    <div className="drr-document">
      <section className="drr-cover">
        {report.company && <p className="drr-kicker">{report.company}</p>}
        <h2>Daily Reports</h2>
        <p className="drr-job">
          {report.job_number}
          {report.job_name ? ` · ${report.job_name}` : ""}
        </p>
        <p className="drr-muted">
          Report period {mediumDate(report.period.from)} – {mediumDate(report.period.to)}
        </p>
        <dl className="drr-facts">
          <div>
            <dt>Saved dailies</dt>
            <dd>{report.dailies_count}</dd>
          </div>
          <div>
            <dt>Days without a daily</dt>
            <dd>{report.no_daily_dates.length}</dd>
          </div>
          <div>
            <dt>Progress photos</dt>
            <dd>{report.photos_mode === "none" ? "Not included" : report.photos_count}</dd>
          </div>
          <div>
            <dt>Generated</dt>
            <dd className="drr-small">{stamp(report.captured_at, zone)}</dd>
          </div>
        </dl>
        <div className="drr-table-wrap">
          <table className="drr-summary">
            <thead>
              <tr>
                <th>Date</th>
                <th>Weather</th>
                <th>Crews &amp; hours</th>
                <th>Lines</th>
                <th>Photos</th>
                <th>Issues / delays</th>
              </tr>
            </thead>
            <tbody>
              {report.days.length ? (
                report.days.map((day) => (
                  <tr key={day.date}>
                    <td>
                      <a href={`#day-${day.date}`}>{mediumDate(day.date)}</a>
                    </td>
                    <td>
                      {day.daily ? day.daily.weather || "Not recorded" : <em>No daily saved</em>}
                    </td>
                    <td>{day.daily?.manpower ?? ""}</td>
                    <td>{day.daily ? day.daily.lines.length : ""}</td>
                    <td>{report.photos_mode === "none" ? "–" : day.photos.length}</td>
                    <td>
                      {day.daily
                        ? reported(day.daily.issues) || reported(day.daily.delays)
                          ? "See daily"
                          : "None"
                        : ""}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>No dailies or progress photos are saved for this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {report.no_daily_dates.length > 0 && (
          <p className="drr-note">
            <strong>Dates with no saved daily:</strong> {dateRuns(report.no_daily_dates)}. Nothing
            is inferred for these dates.
          </p>
        )}
        <p className="drr-note">
          <strong>Basis:</strong> generated from the dailies saved in Athena as of{" "}
          {stamp(report.captured_at, zone)} ({zone}). Each daily shows its current saved content
          with the time it was first saved and last updated. Quantities, crews, hours and SOV or CPM
          references are as reported from the field. Photos:{" "}
          {PHOTO_MODE_LABEL[report.photos_mode].toLowerCase()}, grouped by the date each was taken.
        </p>
      </section>
      {report.days.map((day) => (
        <article className="drr-day" id={`day-${day.date}`} key={day.date}>
          <header>
            <p className="drr-kicker">
              {day.daily ? "Daily report" : "Progress photos · no daily saved"}
            </p>
            <h3>{longDate(day.date)}</h3>
            <p className="drr-muted">
              {report.job_number}
              {report.job_name ? ` · ${report.job_name}` : ""}
            </p>
          </header>
          {day.daily ? (
            <>
              <div className="drr-sections">
                {DAILY_SECTIONS.slice(0, 4).map(([key, label]) => (
                  <section key={key}>
                    <h4>{label}</h4>
                    <p>{day.daily![key] || "Not recorded"}</p>
                  </section>
                ))}
              </div>
              <section className="drr-work">
                <h4>Work &amp; production</h4>
                {day.daily.lines.length ? (
                  <div className="drr-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Work performed</th>
                          <th className="num">Qty</th>
                          <th>Unit</th>
                          <th className="num">Crew</th>
                          <th className="num">Hrs each</th>
                          <th>SOV</th>
                          <th>CPM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {day.daily.lines.map((l) => (
                          <tr key={l.line_no}>
                            <td>{l.line_no}</td>
                            <td className="drr-work-text">{l.work || "Not recorded"}</td>
                            <td className="num">{numberText(l.qty)}</td>
                            <td>{l.unit ?? ""}</td>
                            <td className="num">{numberText(l.crew)}</td>
                            <td className="num">{numberText(l.hours)}</td>
                            <td>{l.sov_item ?? "–"}</td>
                            <td>{l.activity_id ?? "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="drr-muted">Work lines not recorded.</p>
                )}
              </section>
              <div className="drr-sections">
                {DAILY_SECTIONS.slice(4).map(([key, label]) => (
                  <section key={key}>
                    <h4>{label}</h4>
                    <p>{day.daily![key] || "Not recorded"}</p>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <p className="drr-muted">
              No daily is saved for this date. The photos below were taken on this date.
            </p>
          )}
          {report.photos_mode !== "none" && day.photos.length > 0 && (
            <section className="drr-photos">
              <h4>Progress photos ({day.photos.length})</h4>
              <div className="drr-photo-grid">
                {day.photos.map((p) => (
                  <Photo key={p.id} photo={p} href={links?.get(p.storage_path)} zone={zone} />
                ))}
              </div>
            </section>
          )}
          {day.daily && (
            <p className="drr-record">
              Record {day.daily.id.slice(0, 8)} · first saved {stamp(day.daily.created_at, zone)} ·
              last updated {stamp(day.daily.updated_at, zone)} ·{" "}
              <a className="no-print" href={`/r/job/${report.job_id}/daily?date=${day.date}`}>
                Open this daily
              </a>
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

export function DailyRangeReportPage({
  jobId,
  from,
  to,
  photos,
}: {
  jobId: string;
  from?: string;
  to?: string;
  photos?: string;
}) {
  const { session, loading } = useAuth();
  const period = from || to ? { from: from ?? "", to: to ?? "" } : defaultPeriod();
  const mode = photoMode(photos);
  const query = useQuery({
    queryKey: ["daily-range-report", jobId, session?.user.id, period.from, period.to, mode],
    enabled: !loading && !!session,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () =>
      readDailyRange(dailyRangeClient(supabase), jobId, {
        from: period.from,
        to: period.to,
        photos: mode,
      }),
  });
  const report = query.error ? undefined : query.data;
  const links = usePhotoLinks(report);
  const [pdf, setPdf] = useState<{ busy: boolean; done: number; total: number; error?: string }>({
    busy: false,
    done: 0,
    total: 0,
  });
  useEffect(() => {
    if (report)
      document.title = `${report.job_number} Daily Reports ${report.period.from} to ${report.period.to}`;
  }, [report]);

  let returnTo = dailyRangePath(jobId);
  try {
    if (from && to) returnTo = dailyRangePath(jobId, { from, to }, mode);
  } catch {
    /* the form shows the date problem */
  }
  if (loading)
    return (
      <main className="drr-page" role="status">
        Checking project access…
      </main>
    );
  if (!session || (query.error && projectReadRecovery(true, query.error) === "sign-in"))
    return <BoardSignIn returnTo={returnTo} />;
  const inputProblem = query.error && /^(Choose|Use valid)/.test(query.error.message);
  if (query.error && !inputProblem) return <ProjectReadUnavailable />;

  const onPdf = async () => {
    if (!report) return;
    setPdf({ busy: true, done: 0, total: 0 });
    try {
      await downloadPdf(report, (done, total) => setPdf({ busy: true, done, total }));
      setPdf({ busy: false, done: 0, total: 0 });
    } catch {
      setPdf({ busy: false, done: 0, total: 0, error: "The PDF could not be built. Try again." });
    }
  };

  return (
    <main className="drr-page">
      <div className="drr-shell">
        <nav className="drr-nav no-print" aria-label="Project navigation">
          <a href={`/r/job/${jobId}/home`}>Project home</a>
          <a href={`/r/job/${jobId}/daily`}>Daily reports</a>
          <a href={`/r/job/${jobId}/photos`}>Progress photos</a>
        </nav>
        <div className="drr-toolbar no-print">
          <div>
            <h1>Daily report export</h1>
            <p className="drr-muted">
              Every saved daily in a date range, with that day's photos, ready to print or attach.
            </p>
          </div>
          <form action={dailyRangePath(jobId)} method="get" className="drr-form">
            <label>
              From
              <input
                type="date"
                name="from"
                required
                defaultValue={period.from}
                key={`f${period.from}`}
              />
            </label>
            <label>
              Through
              <input
                type="date"
                name="to"
                required
                defaultValue={period.to}
                key={`t${period.to}`}
              />
            </label>
            <label>
              Photos
              <select name="photos" defaultValue={mode} key={`p${mode}`}>
                {PHOTO_MODES.map((m) => (
                  <option key={m} value={m}>
                    {PHOTO_MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Run report</button>
          </form>
          <div className="drr-actions">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!report || query.isFetching}
            >
              Print
            </button>
            <button
              type="button"
              className="drr-primary"
              onClick={() => void onPdf()}
              disabled={!report || query.isFetching || pdf.busy}
            >
              {pdf.busy
                ? pdf.total
                  ? `Preparing photos ${pdf.done} of ${pdf.total}…`
                  : "Building PDF…"
                : "Download PDF"}
            </button>
          </div>
          <p className="drr-muted drr-small">
            Up to {DAILY_RANGE_MAX_DAYS} days per export. Print uses your browser's print dialog,
            where you can also choose Save as PDF.
          </p>
          {pdf.error && <p role="alert">{pdf.error}</p>}
        </div>
        {query.isFetching && (
          <p className="drr-muted no-print" role="status">
            Reading saved dailies…
          </p>
        )}
        {query.error ? (
          <p role="alert">{query.error.message}</p>
        ) : report ? (
          <DailyRangeReportView report={report} links={links.data} />
        ) : null}
      </div>
    </main>
  );
}
