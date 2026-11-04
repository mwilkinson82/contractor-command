/**
 * Helpers for the progress photos page and its viewer. Pure functions only, so the page and tests share them.
 */

/** Smallest long edge treated as a full photo; smaller files are previews. Matches PHOTO_MIN_EDGE on save. */
export const LOW_RES_EDGE = 640;

export type GalleryPhoto = {
  id: string;
  taken_on: string | null;
  area: string | null;
  work: string | null;
  sov_item: string | null;
  activity_id: string | null;
  client_safe: boolean;
  url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
  created_by: string | null;
  saved_by: string | null;
  daily_linked: boolean | null;
  /** Set when the photo was removed or replaced; it stays in the record. */
  removed_at?: string | null;
  removed_reason?: string | null;
  removed_by_name?: string | null;
  replaced_by?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** "Tuesday, November 3, 2026" for a calendar date, independent of the viewer's time zone. */
export function longDate(value: string | null | undefined): string {
  if (!isIsoDate(value)) return "Date not recorded";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Nov 3, 2026". */
export function shortDay(value: string | null | undefined): string {
  if (!isIsoDate(value)) return "Date not recorded";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isLowRes(width: number, height: number): boolean {
  return width > 0 && height > 0 && Math.max(width, height) < LOW_RES_EDGE;
}

const tokenQuery = (token?: string | null) => (token ? `t=${encodeURIComponent(token)}` : "");

/** The photos page, optionally narrowed to one day. Keeps a board token when the visitor came in with one. */
export function photosHref(
  jobId: string,
  opts: {
    date?: string | null;
    token?: string | null;
    photoId?: string | null;
    /** Opens the Add photos form, with where on site filled in when given. */
    add?: boolean;
    area?: string | null;
  } = {},
): string {
  const query = [
    isIsoDate(opts.date) ? `date=${opts.date}` : "",
    tokenQuery(opts.token),
    opts.add ? "add=1" : "",
    opts.add && opts.area?.trim()
      ? `area=${encodeURIComponent(opts.area.trim().slice(0, 160))}`
      : "",
  ]
    .filter(Boolean)
    .join("&");
  return `/r/job/${jobId}/photos${query ? `?${query}` : ""}${opts.photoId ? `#photo-${opts.photoId}` : ""}`;
}

/** The saved daily report for a date. */
export function dailyHref(
  jobId: string,
  date: string | null | undefined,
  token?: string | null,
): string {
  const query = [isIsoDate(date) ? `date=${date}` : "", tokenQuery(token)]
    .filter(Boolean)
    .join("&");
  return `/r/job/${jobId}/daily${query ? `?${query}` : ""}`;
}

/** Photo id from a "#photo-<id>" link, or null. */
export function photoIdFromHash(hash: string | null | undefined): string | null {
  const match = /^#?photo-([0-9a-fA-F-]{8,64})$/.exec(hash ?? "");
  return match ? match[1].toLowerCase() : null;
}

/** Groups photos by date, newest date first, keeping the order within a date. */
export function groupByDate<T extends { taken_on: string | null }>(
  photos: T[],
): { date: string | null; photos: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const photo of photos) {
    const key = photo.taken_on ?? "";
    const list = groups.get(key);
    if (list) list.push(photo);
    else groups.set(key, [photo]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a === "" ? 1 : b === "" ? -1 : a < b ? 1 : -1))
    .map(([date, list]) => ({ date: date || null, photos: list }));
}

/** "Interior office / ceiling" or a fallback. */
export function photoTitle(photo: { area: string | null; work: string | null }): string {
  return photo.area?.trim() || photo.work?.trim() || "Progress photo";
}
