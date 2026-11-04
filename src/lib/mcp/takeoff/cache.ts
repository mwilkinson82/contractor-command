/** Bounded, short-lived cache of immutable source bytes, not member data or
 * permissions. Callers must resolve the current authorized source before use. */
const MAX_SOURCE = 24 * 1024 * 1024,
  TTL = 60_000;
let source: { key: string; expires: number; value: Promise<Uint8Array> } | null = null;
export async function cachedSource(
  key: string,
  load: () => Promise<Uint8Array>,
  now = Date.now(),
): Promise<Uint8Array> {
  if (source?.key === key && source.expires > now) {
    source.expires = now + TTL;
    return source.value;
  }
  source = null;
  const entry = { key, expires: now + TTL, value: Promise.resolve().then(load) };
  source = entry;
  try {
    const bytes = await entry.value;
    if (bytes.length > MAX_SOURCE && source === entry) source = null;
    return bytes;
  } catch (e) {
    if (source === entry) source = null;
    throw e;
  }
}
export function clearSourceCache() {
  source = null;
}

/** Only immutable page derivatives. Call after the normal job/source authorization.
 * One entry per kind bounds memory; source hash, page, company and job belong in key. */
export function pageCache<T>(maxBytes: number, measure: (value: T) => number) {
  let entry: { key: string; expires: number; value: Promise<T> } | null = null;
  return async (key: string, load: () => Promise<T>, now = Date.now()): Promise<T> => {
    if (entry?.key === key && entry.expires > now) {
      entry.expires = now + TTL;
      return entry.value;
    }
    const current = { key, expires: now + TTL, value: Promise.resolve().then(load) };
    entry = current;
    try {
      const value = await current.value;
      if (measure(value) > maxBytes && entry === current) entry = null;
      return value;
    } catch (error) {
      if (entry === current) entry = null;
      throw error;
    }
  };
}
