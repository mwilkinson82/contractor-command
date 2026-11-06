// Server-only storage for members' own photos (see people-photo.ts). Uses the service role, so every caller must
// already know whose photo it is: the signed-in member (account page, chat tool) or the job's PM (client page).
import { PEOPLE_BUCKET, isPersonPhotoPath } from "./people-photo";

type Bucket = {
  upload: (
    path: string,
    body: Uint8Array,
    o: { contentType: string; upsert: boolean },
  ) => PromiseLike<{ error: { message: string } | null }>;
  remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
  createSignedUrl: (
    path: string,
    seconds: number,
  ) => PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
};

async function bucket(): Promise<Bucket> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin.storage.from(PEOPLE_BUCKET) as unknown as Bucket;
}

/** Stores a checked photo at a people/ path. False when storage refused it. */
export async function storePersonPhoto(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<boolean> {
  if (!isPersonPhotoPath(path)) return false;
  const r = await (await bucket()).upload(path, bytes, { contentType, upsert: false });
  return !r.error;
}

/** Best effort: a leftover file is only storage, never shown anywhere. */
export async function dropPersonPhoto(path: string | null | undefined): Promise<void> {
  if (!isPersonPhotoPath(path)) return;
  try {
    await (await bucket()).remove([path]);
  } catch {
    // ignore
  }
}

/** A short-lived link to a people/ photo, or null. Never signs anything outside people/. */
export async function signPersonPhoto(path: unknown, seconds = 3600): Promise<string | null> {
  if (!isPersonPhotoPath(path)) return null;
  const r = await (await bucket()).createSignedUrl(path, seconds);
  return r.data?.signedUrl ?? null;
}
