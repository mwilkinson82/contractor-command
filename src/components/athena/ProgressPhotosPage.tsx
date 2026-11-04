import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PhotoPagePayload } from "@/lib/report-pages";
import { readPhotoExif, type PhotoExif } from "@/lib/photo-exif";
import {
  dailyHref,
  formatBytes,
  groupByDate,
  isIsoDate,
  isLowRes,
  longDate,
  photoIdFromHash,
  photosHref,
  photoTitle,
  shortDay,
  type GalleryPhoto,
} from "@/lib/progress-photos";
import { AddProgressPhotos } from "./AddProgressPhotos";
import { AthenaBrand, AthenaFooter } from "./AthenaBrand";
import "./progress-photos.css";

const PAGE = 60;
const BUCKET = "athena-progress";

type Row = {
  id: string;
  company_id: string;
  taken_on: string;
  area: string;
  work: string | null;
  sov_item: string | null;
  activity_id: string | null;
  client_safe: boolean;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
  created_by: string | null;
  daily_id: string | null;
  removed_at?: string | null;
  removed_by?: string | null;
  removed_reason?: string | null;
  replaced_by?: string | null;
};

type Loose = {
  from: (t: string) => {
    select: (c: string) => LooseQuery;
  };
};
type LooseQuery = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  eq: (c: string, v: unknown) => LooseQuery;
  is: (c: string, v: null) => LooseQuery;
  in: (c: string, v: unknown[]) => LooseQuery;
  order: (c: string, o: { ascending: boolean }) => LooseQuery;
  range: (a: number, b: number) => LooseQuery;
};
const db = supabase as unknown as Loose;

/** Signed-in members read the photo rows directly (RLS: full and super job access) for the extra metadata. */
async function readMemberPhotos(
  jobId: string,
  date: string | null,
  limit: number,
  userId: string,
  showRemoved: boolean,
) {
  let q = db
    .from("mcp_progress_photos")
    .select(
      "id,company_id,taken_on,area,work,sov_item,activity_id,client_safe,storage_path,mime_type,size_bytes,created_at,created_by,daily_id,removed_at,removed_by,removed_reason,replaced_by",
    )
    .eq("job_id", jobId);
  if (date) q = q.eq("taken_on", date);
  if (!showRemoved) q = q.is("removed_at", null);
  const { data, error } = await q
    .order("taken_on", { ascending: false })
    .order("created_at", { ascending: false })
    .range(0, limit);
  if (error) throw error;
  const rows = (data as Row[]) ?? [];
  const more = rows.length > limit;
  const shown = rows.slice(0, limit);
  const names = new Map<string, string>();
  const people = [
    ...new Set(shown.flatMap((r) => [r.created_by, r.removed_by]).filter((v): v is string => !!v)),
  ];
  if (people.length) {
    const members = await db
      .from("mcp_company_members")
      .select("user_id,display_name,company_id")
      .in("user_id", people);
    if (!members.error)
      for (const m of (members.data as {
        user_id: string;
        display_name: string;
        company_id: string;
      }[]) ?? [])
        if (
          shown.some(
            (r) =>
              (r.created_by === m.user_id || r.removed_by === m.user_id) &&
              r.company_id === m.company_id,
          )
        )
          names.set(m.user_id, m.display_name);
  }
  const photos: GalleryPhoto[] = await Promise.all(
    shown.map(async (r) => {
      const signed = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
      return {
        id: r.id,
        taken_on: r.taken_on,
        area: r.area,
        work: r.work,
        sov_item: r.sov_item,
        activity_id: r.activity_id,
        client_safe: r.client_safe,
        url: signed.data?.signedUrl ?? null,
        storage_path: r.storage_path,
        mime_type: r.mime_type,
        size_bytes: r.size_bytes,
        created_at: r.created_at,
        created_by: r.created_by,
        saved_by:
          r.created_by === userId
            ? "You"
            : r.created_by
              ? (names.get(r.created_by) ?? "A company member")
              : null,
        daily_linked: r.daily_id != null,
        removed_at: r.removed_at ?? null,
        removed_reason: r.removed_reason ?? null,
        removed_by_name:
          r.removed_by === userId
            ? "You"
            : r.removed_by
              ? (names.get(r.removed_by) ?? "A company member")
              : null,
        replaced_by: r.replaced_by ?? null,
      };
    }),
  );
  return { photos, more };
}

function fromPayload(payload: PhotoPagePayload, date: string | null): GalleryPhoto[] {
  return (payload.photos ?? [])
    .filter((p) => !date || p.taken_on === date)
    .map((p, n) => ({
      id: p.id ?? `photo-${n + 1}`,
      taken_on: p.taken_on ?? null,
      area: p.area ?? null,
      work: p.work ?? null,
      sov_item: p.sov_item ?? null,
      activity_id: p.activity_id ?? null,
      client_safe: p.client_safe === true,
      url: p.url ?? null,
      storage_path: p.storage_path ?? null,
      mime_type: p.mime_type ?? null,
      size_bytes: null,
      created_at: null,
      created_by: null,
      saved_by: null,
      daily_linked: null,
    }));
}

type Dims = Record<string, { w: number; h: number } | "broken">;

export function ProgressPhotosPage({
  payload,
  jobId,
  token,
  memberId,
  date: rawDate,
}: {
  payload: PhotoPagePayload;
  jobId: string;
  token?: string;
  memberId?: string;
  date?: string;
}) {
  const date = isIsoDate(rawDate) ? rawDate : null;
  const [limit, setLimit] = useState(PAGE);
  const [showRemoved, setShowRemoved] = useState(false);
  const [replacing, setReplacing] = useState<GalleryPhoto | null>(null);
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["athena-progress-photos", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["daily-photo-strip", jobId] });
  }, [queryClient, jobId]);
  const member = useQuery({
    queryKey: ["athena-progress-photos", jobId, memberId ?? null, date, limit, showRemoved],
    enabled: !!memberId,
    retry: false,
    staleTime: 30_000,
    // Keep the shown photos while "Show more" reads the next page.
    placeholderData: (previous) => previous,
    queryFn: () => readMemberPhotos(jobId, date, limit, memberId!, showRemoved),
  });
  // The member read adds file size, saved time, saved by and the daily link. The page payload is the fallback.
  const fallback = useMemo(() => fromPayload(payload, date), [payload, date]);
  const photos = Array.isArray(member.data?.photos)
    ? member.data.photos
    : member.isLoading
      ? []
      : fallback;
  const more = member.data?.more ?? false;
  const [dims, setDims] = useState<Dims>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const index = openId ? photos.findIndex((p) => p.id.toLowerCase() === openId) : -1;
  const open = index >= 0 ? photos[index] : null;

  const show = useCallback((id: string | null) => {
    setOpenId(id ? id.toLowerCase() : null);
    if (typeof window === "undefined") return;
    const url = `${window.location.pathname}${window.location.search}${id ? `#photo-${id}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  }, []);
  // A "#photo-<id>" link (from chat or the daily report) opens that photo full size.
  useEffect(() => {
    const onHash = () => setOpenId(photoIdFromHash(window.location.hash));
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const measured = (id: string, img: HTMLImageElement) =>
    setDims((d) =>
      d[id] && d[id] !== "broken"
        ? d
        : { ...d, [id]: { w: img.naturalWidth, h: img.naturalHeight } },
    );
  const broken = (id: string) => setDims((d) => ({ ...d, [id]: "broken" }));

  const identity = [payload.job_number, payload.job_name].filter(Boolean).join(" · ") || "Project";
  const groups = groupByDate(photos);
  const homeHref = `/r/job/${jobId}/home${token ? `?t=${encodeURIComponent(token)}` : ""}`;

  return (
    <main className="pp-page">
      <header className="pp-top">
        <AthenaBrand jobId={jobId} token={token} company={payload.company} />
        <nav aria-label="Project navigation">
          <a href={homeHref}>← Project home</a>
          <a href="/today">Morning brief</a>
          <a href={dailyHref(jobId, date, token)}>
            {date ? `Daily report for ${shortDay(date)}` : "Daily reports"}
          </a>
        </nav>
      </header>
      <div className="pp-heading">
        <div>
          <h1>{date ? `Progress photos · ${longDate(date)}` : "Progress photos"}</h1>
          <p>{identity}</p>
        </div>
        <form className="pp-filter" action={`/r/job/${jobId}/photos`} method="get">
          {token && <input type="hidden" name="t" value={token} />}
          <label>
            Show one day
            <input name="date" type="date" required defaultValue={date ?? ""} key={date ?? ""} />
          </label>
          <button type="submit">Show</button>
          {date && (
            <a className="pp-all" href={photosHref(jobId, { token })}>
              All dates
            </a>
          )}
        </form>
      </div>

      {memberId ? (
        <>
          <AddProgressPhotos
            key={replacing?.id ?? "add"}
            jobId={jobId}
            date={date}
            onSaved={refresh}
            replaces={replacing}
            onCancelReplace={() => setReplacing(null)}
          />
          <label className="pp-show-removed">
            <input
              type="checkbox"
              checked={showRemoved}
              onChange={(e) => setShowRemoved(e.target.checked)}
            />
            Show removed and replaced photos
          </label>
        </>
      ) : (
        <p className="pp-add-signin">
          To add photos,{" "}
          <a href={`/login?redirect=${encodeURIComponent(photosHref(jobId, { date, add: true }))}`}>
            sign in to Athena
          </a>{" "}
          with an account that has access to this job.
        </p>
      )}

      {member.isLoading ? (
        <p className="pp-status" role="status">
          Loading photos…
        </p>
      ) : photos.length === 0 ? (
        <section className="pp-empty">
          <h2>
            {date
              ? `No progress photos are saved for ${longDate(date)}.`
              : "No progress photos are saved for this job yet."}
          </h2>
          {date && (
            <p>
              <a href={photosHref(jobId, { token })}>See photos from all dates</a> or{" "}
              <a href={dailyHref(jobId, date, token)}>open the daily report for {shortDay(date)}</a>
              .
            </p>
          )}
        </section>
      ) : (
        groups.map((group) => (
          <section className="pp-day" key={group.date ?? "none"} aria-label={longDate(group.date)}>
            <div className="pp-day-head">
              <h2>{longDate(group.date)}</h2>
              <span>
                {group.photos.length} photo{group.photos.length === 1 ? "" : "s"}
                {group.date && (
                  <>
                    {" · "}
                    <a href={dailyHref(jobId, group.date, token)}>Daily report</a>
                    {!date && (
                      <>
                        {" · "}
                        <a href={photosHref(jobId, { date: group.date, token })}>Only this day</a>
                      </>
                    )}
                  </>
                )}
              </span>
            </div>
            <ul className="pp-grid">
              {group.photos.map((photo) => {
                const d = dims[photo.id];
                const low = d && d !== "broken" && isLowRes(d.w, d.h);
                return (
                  <li key={photo.id} id={`photo-${photo.id}`} data-id={photo.id}>
                    <button
                      type="button"
                      className={photo.removed_at ? "pp-card pp-removed" : "pp-card"}
                      onClick={() => show(photo.id)}
                      aria-label={`Open ${photoTitle(photo)}`}
                    >
                      <span className="pp-thumb">
                        {photo.url && d !== "broken" ? (
                          <img
                            src={photo.url}
                            alt={photoTitle(photo)}
                            loading="lazy"
                            onLoad={(e) => measured(photo.id, e.currentTarget)}
                            onError={() => broken(photo.id)}
                          />
                        ) : (
                          <span className="pp-missing">
                            {photo.url ? "Photo file can't be shown" : "Photo file not available"}
                          </span>
                        )}
                        {photo.removed_at ? (
                          <span className="pp-badge pp-badge-removed">
                            {photo.replaced_by ? "Replaced" : "Removed"}
                          </span>
                        ) : (
                          low && <span className="pp-badge">Low resolution</span>
                        )}
                      </span>
                      <span className="pp-caption">
                        <strong>{photoTitle(photo)}</strong>
                        {photo.work && photo.area && <span className="pp-work">{photo.work}</span>}
                        <span className="pp-tags">
                          {photo.client_safe ? "Client-safe" : "Internal"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {member.error && (
        <p className="pp-status" role="alert">
          Extra photo details couldn't be read. Showing the saved gallery.
        </p>
      )}
      {more && (
        <div className="pp-more">
          <button type="button" onClick={() => setLimit((n) => n + PAGE)}>
            Show more photos
          </button>
        </div>
      )}
      <p className="pp-foot">Private to your company</p>
      <div className="pp-brand-foot">
        <AthenaFooter jobId={jobId} token={token} />
      </div>
      {open && (
        <PhotoViewer
          key={open.id}
          photo={open}
          jobId={jobId}
          token={token}
          jobLabel={identity}
          dims={dims[open.id]}
          position={`${index + 1} of ${photos.length}`}
          onClose={() => show(null)}
          onPrev={index > 0 ? () => show(photos[index - 1].id) : undefined}
          onNext={index < photos.length - 1 ? () => show(photos[index + 1].id) : undefined}
          onMeasured={(img) => measured(open.id, img)}
          onBroken={() => broken(open.id)}
          canEdit={!!memberId && !open.removed_at}
          onReplace={() => {
            setReplacing(open);
            show(null);
          }}
          onRemoved={() => {
            show(null);
            refresh();
          }}
          onOpen={show}
        />
      )}
    </main>
  );
}

function PhotoViewer({
  photo,
  jobId,
  token,
  jobLabel,
  dims,
  position,
  onClose,
  onPrev,
  onNext,
  onMeasured,
  onBroken,
  canEdit,
  onReplace,
  onRemoved,
  onOpen,
}: {
  photo: GalleryPhoto;
  jobId: string;
  token?: string;
  jobLabel: string;
  dims: { w: number; h: number } | "broken" | undefined;
  position: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onMeasured: (img: HTMLImageElement) => void;
  onBroken: () => void;
  canEdit: boolean;
  onReplace: () => void;
  onRemoved: () => void;
  onOpen: (id: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  async function remove() {
    setRemoveBusy(true);
    setRemoveError(null);
    const { error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => PromiseLike<{ error: { message: string } | null }>;
      }
    ).rpc("mcp_progress_photo_remove", {
      _id: photo.id,
      _reason: reason.trim(),
      _replaced_by: null,
    });
    setRemoveBusy(false);
    if (error) {
      setRemoveError(
        /MCP_BAD:(.+)$/.exec(error.message)?.[1]?.trim() ??
          "Athena couldn't remove it. Nothing was changed.",
      );
      return;
    }
    onRemoved();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, onPrev, onNext]);

  // Camera details come from the stored file itself, when the camera wrote them.
  const exif = useQuery({
    queryKey: ["athena-photo-exif", photo.id],
    enabled: !!photo.url && dims !== "broken",
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<PhotoExif & { bytes: number }> => {
      const res = await fetch(photo.url!);
      if (!res.ok) throw new Error("unavailable");
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { ...readPhotoExif(bytes), bytes: bytes.length };
    },
  });
  const size = dims && dims !== "broken" ? dims : null;
  const low = size ? isLowRes(size.w, size.h) : false;
  const fileSize = formatBytes(photo.size_bytes ?? exif.data?.bytes ?? null);
  const savedAt = photo.created_at
    ? new Date(photo.created_at).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const rows: [string, ReactNode][] = [
    ["Date", longDate(photo.taken_on)],
    ["Job", jobLabel],
    ["Location on site", photo.area || "Not recorded"],
    ["Description", photo.work || "Not recorded"],
    ["Visibility", photo.client_safe ? "Client-safe" : "Internal only"],
    ["SOV item", photo.sov_item || "Not recorded"],
    ["CPM activity", photo.activity_id || "Not recorded"],
    [
      "Daily report",
      photo.taken_on ? (
        <a href={dailyHref(jobId, photo.taken_on, token)}>
          {photo.daily_linked === false
            ? "Open that day's daily (not linked yet)"
            : `Daily report for ${shortDay(photo.taken_on)}`}
        </a>
      ) : (
        "Not recorded"
      ),
    ],
    [
      "Camera date",
      exif.isLoading
        ? "Reading…"
        : exif.data?.taken_at
          ? `${exif.data.taken_at} (camera clock)`
          : "Not in the file",
    ],
    ["Camera", exif.isLoading ? "Reading…" : exif.data?.camera || "Not in the file"],
    [
      "Pixels",
      dims === "broken" ? "File can't be read" : size ? `${size.w} × ${size.h}` : "Reading…",
    ],
    [
      "File",
      [photo.mime_type?.replace("image/", "").toUpperCase(), fileSize]
        .filter(Boolean)
        .join(" · ") || "Not recorded",
    ],
    [
      "Saved",
      [savedAt, photo.saved_by ? `by ${photo.saved_by}` : null].filter(Boolean).join(" ") ||
        "Not shown on this link",
    ],
    ["Source", "Saved through Athena"],
    ...(photo.removed_at
      ? ([
          [
            photo.replaced_by ? "Replaced" : "Removed",
            [
              new Date(photo.removed_at).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              }),
              photo.removed_by_name ? `by ${photo.removed_by_name}` : null,
            ]
              .filter(Boolean)
              .join(" "),
          ],
          ["Reason", photo.removed_reason || "Not recorded"],
          ...(photo.replaced_by
            ? ([
                [
                  "Replaced by",
                  <a
                    key="replacement"
                    href={`#photo-${photo.replaced_by}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen(photo.replaced_by!);
                    }}
                  >
                    The replacement photo
                  </a>,
                ],
              ] as [string, ReactNode][])
            : []),
        ] as [string, ReactNode][])
      : []),
  ];
  return (
    <div
      className="pp-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={photoTitle(photo)}
      onClick={onClose}
    >
      <div className="pp-viewer-frame" onClick={(e) => e.stopPropagation()}>
        <div className="pp-viewer-bar">
          <span>{position}</span>
          <div>
            {photo.url && dims !== "broken" && (
              <a href={photo.url} target="_blank" rel="noreferrer noopener">
                Open original
              </a>
            )}
            <button type="button" onClick={onClose} aria-label="Close photo">
              Close
            </button>
          </div>
        </div>
        <div className="pp-viewer-body">
          <div className="pp-viewer-image">
            {onPrev && (
              <button
                type="button"
                className="pp-nav pp-prev"
                onClick={onPrev}
                aria-label="Previous photo"
              >
                ‹
              </button>
            )}
            {photo.url && dims !== "broken" ? (
              <img
                key={photo.id}
                src={photo.url}
                alt={photoTitle(photo)}
                className={low ? "pp-small" : undefined}
                onLoad={(e) => onMeasured(e.currentTarget)}
                onError={onBroken}
              />
            ) : (
              <div className="pp-viewer-missing">
                <strong>This photo's stored file can't be shown.</strong>
                <span>
                  The file is damaged or incomplete. Save the photo again from the original on the
                  phone or camera.
                </span>
              </div>
            )}
            {onNext && (
              <button
                type="button"
                className="pp-nav pp-next"
                onClick={onNext}
                aria-label="Next photo"
              >
                ›
              </button>
            )}
          </div>
          <aside className="pp-meta" aria-label="Photo details">
            <h2>{photoTitle(photo)}</h2>
            {photo.removed_at && (
              <p className="pp-warn">
                {photo.replaced_by ? "This photo was replaced." : "This photo was removed."} It's no
                longer in the gallery or the daily, and is kept here for the job's record.
              </p>
            )}
            {!photo.removed_at && low && size && (
              <p className="pp-warn">
                Low resolution: the stored file is only {size.w} × {size.h} pixels, a small preview
                rather than the original photo.{" "}
                {canEdit
                  ? "Use Replace with original below to swap in the full-size file."
                  : "Save it again from the original file for a sharp record."}
              </p>
            )}
            {!photo.removed_at && dims === "broken" && canEdit && (
              <p className="pp-warn">Use Replace with original below to swap in the photo file.</p>
            )}
            {canEdit && !removing && (
              <div className="pp-actions">
                <button type="button" className="pp-primary" onClick={onReplace}>
                  Replace with original
                </button>
                <button type="button" onClick={() => setRemoving(true)}>
                  Remove
                </button>
              </div>
            )}
            {canEdit && removing && (
              <div className="pp-remove">
                <label>
                  Why remove this photo?
                  <textarea
                    value={reason}
                    maxLength={400}
                    rows={2}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <p>
                  It leaves the gallery and the daily. Athena keeps it in the job's record with who
                  removed it, when and why.
                </p>
                <div className="pp-actions">
                  <button
                    type="button"
                    className="pp-danger"
                    disabled={removeBusy || reason.trim().length < 3}
                    onClick={() => void remove()}
                  >
                    {removeBusy ? "Removing…" : "Remove photo"}
                  </button>
                  <button type="button" onClick={() => setRemoving(false)} disabled={removeBusy}>
                    Cancel
                  </button>
                </div>
                {removeError && <p role="alert">{removeError}</p>}
              </div>
            )}
            <dl>
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </div>
    </div>
  );
}
