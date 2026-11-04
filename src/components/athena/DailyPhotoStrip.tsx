import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isIsoDate, photosHref, shortDay } from "@/lib/progress-photos";
import "./daily-photo-strip.css";

type Loose = {
  from: (t: string) => {
    select: (c: string, o?: { count: "exact" }) => LooseQuery;
  };
};
type LooseQuery = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}> & {
  eq: (c: string, v: unknown) => LooseQuery;
  order: (c: string, o: { ascending: boolean }) => LooseQuery;
  limit: (n: number) => LooseQuery;
};
const db = supabase as unknown as Loose;
const SHOWN = 8;

/**
 * That day's progress photos for a daily report: thumbnails that open the photo full size, a link to the day's
 * photos and a link to all photos. Signed-in members see the thumbnails; a board-link visitor gets the links.
 */
export function DailyPhotoStrip({
  jobId,
  date,
  token,
  memberId,
}: {
  jobId: string;
  date: string;
  token?: string;
  memberId?: string;
}) {
  const valid = isIsoDate(date);
  const q = useQuery({
    queryKey: ["daily-photo-strip", jobId, date, memberId ?? null],
    enabled: valid && !!memberId,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error, count } = await db
        .from("mcp_progress_photos")
        .select("id,area,storage_path", { count: "exact" })
        .eq("job_id", jobId)
        .eq("taken_on", date)
        .order("created_at", { ascending: true })
        .limit(SHOWN);
      if (error) throw error;
      const rows = (data as { id: string; area: string; storage_path: string }[]) ?? [];
      const photos = await Promise.all(
        rows.map(async (r) => {
          const signed = await supabase.storage
            .from("athena-progress")
            .createSignedUrl(r.storage_path, 3600);
          return { id: r.id, area: r.area, url: signed.data?.signedUrl ?? null };
        }),
      );
      return { photos, total: count ?? rows.length };
    },
  });
  if (!valid) return null;
  const day = shortDay(date);
  const dayHref = photosHref(jobId, { date, token });
  const allHref = photosHref(jobId, { token });
  const photos = Array.isArray(q.data?.photos) ? q.data.photos : [];
  const total = typeof q.data?.total === "number" ? q.data.total : undefined;
  return (
    <div className="dr-photos">
      {memberId && q.isLoading && <p role="status">Reading photos for {day}…</p>}
      {memberId && q.data && total === 0 && <p>No progress photos are saved for {day}.</p>}
      {photos.length > 0 && (
        <ul className="dr-photo-strip">
          {photos.map((p) => (
            <li key={p.id}>
              <a href={photosHref(jobId, { date, token, photoId: p.id })} title={p.area}>
                {p.url ? <img src={p.url} alt={p.area} loading="lazy" /> : <span>{p.area}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="dr-photo-links">
        <a href={dayHref}>
          {total
            ? `Open ${total} progress photo${total === 1 ? "" : "s"} for ${day}`
            : `Open progress photos for ${day}`}
        </a>
        <span aria-hidden="true"> · </span>
        <a href={allHref}>All progress photos</a>
      </p>
      {q.error && (
        <p role="alert">Photo thumbnails couldn't be read. The links above still work.</p>
      )}
    </div>
  );
}
